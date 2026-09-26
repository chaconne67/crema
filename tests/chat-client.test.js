import { describe, expect, it } from "vitest";

import {
  createChatClient,
  readResponseBody,
} from "../src/chat-client.js";

async function collect(iterable) {
  let result = "";
  for await (const chunk of iterable) result += chunk;
  return result;
}

describe("chat client streams", () => {
  it("sends only the newest request and conversation to the transport", async () => {
    let request;
    const client = createChatClient({
      async transport(args) {
        request = args;
        return new Response('data: {"event":"message.delta","run_id":"run_1","delta":"완료"}\n\n');
      },
    });
    const text = await collect(
      client.streamReply({
        messages: [{ role: "user", content: "이전" }, { role: "user", content: "질문" }],
        conversationId: "conversation-1",
      }),
    );

    expect(text).toBe("완료");
    expect(request).toMatchObject({ content: "질문", conversationId: "conversation-1" });
  });

  it("reads a Hermes run: text, tool use and an approval request each go to their place", async () => {
    const event = (fields) => `data: ${JSON.stringify({ run_id: "run_1", timestamp: 1, ...fields })}\n\n`;
    const response = new Response(
      event({ event: "message.delta", delta: "확인" }) +
        event({ event: "tool.started", tool: "terminal", preview: "rm -rf build" }) +
        event({ event: "approval.request", command: "rm -rf build", request_id: "req_1", choices: ["once", "deny"] }) +
        event({ event: "tool.completed", tool: "terminal" }) +
        event({ event: "message.delta", delta: "했습니다" }) +
        event({ event: "run.completed", output: "확인했습니다" }) +
        ": stream closed\n\n",
    );
    const activity = [];
    const approvals = [];
    const text = await collect(
      readResponseBody(response, { onActivity: (item) => activity.push(item), onApproval: (item) => approvals.push(item) }),
    );
    expect(text).toBe("확인했습니다");
    expect(activity).toEqual([{ status: "running", tool: "terminal" }, { status: "done", tool: "terminal" }]);
    expect(approvals.map((item) => item.request_id)).toEqual(["req_1"]);
  });

  it("uses a run's final output when nothing was streamed, and fails visibly on a failed run", async () => {
    const run = (...events) =>
      new Response(events.map((fields) => `data: ${JSON.stringify({ run_id: "run_1", ...fields })}\n\n`).join(""));
    expect(await collect(readResponseBody(run({ event: "run.completed", output: "완료" })))).toBe("완료");
    await expect(collect(readResponseBody(run({ event: "run.failed", error: "boom" })))).rejects.toThrow(
      "Crema 엔진 응답이 완료되지 않았습니다.",
    );
  });

  it("reports which Provider actually answered a run", async () => {
    const served = [];
    const response = new Response(
      'data: {"event":"run.completed","output":"답","runtime":{"provider":"groq","model":"openai/gpt-oss-120b"}}\n\n',
    );
    expect(await collect(readResponseBody(response, { onServed: (runtime) => served.push(runtime) }))).toBe("답");
    expect(served).toEqual([{ provider: "groq", model: "openai/gpt-oss-120b" }]);
  });

  it("hands a reply cut off midway to the transport once, from where it stopped", async () => {
    const event = (fields) => `data: ${JSON.stringify(fields)}\n\n`;
    const calls = [];
    const client = createChatClient({
      async transport(args) {
        calls.push(args);
        return calls.length === 1
          ? new Response(event({ event: "message.delta", delta: "앞부분" }) + event({ event: "run.failed", error: "dropped" }))
          : new Response(event({ event: "message.delta", delta: " 뒷부분" }) + event({ event: "run.completed", output: " 뒷부분" }));
      },
    });
    const text = await collect(client.streamReply({ messages: [{ role: "user", content: "질문" }], conversationId: "c1" }));
    expect(text).toBe("앞부분 뒷부분");
    expect(calls[1].resume).toBeInstanceOf(Error);
    expect(calls[1].content).toContain("[받은 부분의 끝]\n앞부분");
  });

  it("keeps the cut-off when nothing can take the reply over, and does not resume before any text", async () => {
    const event = (fields) => `data: ${JSON.stringify(fields)}\n\n`;
    const cutOff = createChatClient({
      async transport(args) {
        if (args.resume) throw args.resume;
        return new Response(event({ event: "message.delta", delta: "앞" }) + event({ event: "run.failed", error: "dropped" }));
      },
    });
    await expect(collect(cutOff.streamReply({ messages: [{ role: "user", content: "질문" }], conversationId: "c1" }))).rejects.toThrow("dropped");
    let calls = 0;
    const early = createChatClient({
      async transport() {
        calls += 1;
        return new Response(event({ event: "run.failed", error: "no key" }));
      },
    });
    await expect(collect(early.streamReply({ messages: [{ role: "user", content: "질문" }], conversationId: "c1" }))).rejects.toThrow("no key");
    expect(calls).toBe(1);
  });

  it("does not treat an empty Hermes stream as a completed answer", async () => {
    const client = createChatClient({
      transport: async () => new Response('data: {"event":"run.completed","run_id":"run_1","output":""}\n\n'),
    });
    await expect(collect(client.streamReply({
      messages: [{ role: "user", content: "질문" }],
      conversationId: "conversation-1",
    }))).rejects.toThrow("Crema 엔진 응답에 내용이 없습니다.");
  });
});
