import { describe, expect, it } from "vitest";

import {
  createChatClient,
  readResponseBody,
  streamDemoResponse,
} from "../src/chat-client.js";

async function collect(iterable) {
  let result = "";
  for await (const chunk of iterable) result += chunk;
  return result;
}

describe("chat client streams", () => {
  it("produces a Markdown demonstration response", async () => {
    const response = await collect(streamDemoResponse({ delayMs: 0 }));
    expect(response).toContain("**이 PC에서 만든 예시 응답**");
    expect(response).toContain("```typescript");
    expect(response).toContain("| 항목 | 적용 상태 |");
  });

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
      "Hermes 응답이 완료되지 않았습니다.",
    );
  });

  it("does not treat an empty Hermes stream as a completed answer", async () => {
    const client = createChatClient({
      transport: async () => new Response('data: {"event":"run.completed","run_id":"run_1","output":""}\n\n'),
    });
    await expect(collect(client.streamReply({
      messages: [{ role: "user", content: "질문" }],
      conversationId: "conversation-1",
    }))).rejects.toThrow("Hermes 응답에 내용이 없습니다.");
  });
});
