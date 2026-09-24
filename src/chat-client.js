const DEMO_MARKDOWN = `아직 Hermes에 연결되지 않아 **이 PC에서 만든 예시 응답**을 보여드립니다. 설정에서 연결하면 실제 답변이 표시됩니다.

- 봇의 답변은 대화 영역 전체 너비를 사용합니다.
- 사용자 요청만 오른쪽의 말풍선으로 표시됩니다.
- 제목, 목록, 표와 \`인라인 코드\`가 Markdown으로 렌더링됩니다.

\`\`\`typescript
const theme = {
  surface: "#fdfdfd",
  ink: "#202020",
  accent: "#339cff",
};
\`\`\`

| 항목 | 적용 상태 |
| --- | --- |
| Markdown | 적용 |
| 코드 글꼴 | Nanum Gothic Coding |
| Hermes 연결 | 설정 필요 |`;

function delay(milliseconds, signal) {
  if (!milliseconds) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(resolve, milliseconds);
    signal?.addEventListener(
      "abort",
      () => {
        window.clearTimeout(timer);
        reject(new DOMException("응답 생성이 중지되었습니다.", "AbortError"));
      },
      { once: true },
    );
  });
}

export async function* streamDemoResponse({ signal, delayMs = 18 } = {}) {
  const chunks = DEMO_MARKDOWN.match(/[\s\S]{1,7}/g) || [];

  for (const chunk of chunks) {
    if (signal?.aborted) {
      throw new DOMException("응답 생성이 중지되었습니다.", "AbortError");
    }
    await delay(delayMs, signal);
    yield chunk;
  }
}

/** Answer text of one Hermes run event; tool use and approval requests go to their callbacks. */
function runEventText(event, { onActivity, onApproval }) {
  switch (event.event) {
    case "message.delta":
      return event.delta || "";
    case "tool.started":
      onActivity?.({ status: "running", tool: event.tool });
      return "";
    case "tool.completed":
      onActivity?.({ status: "done", tool: event.tool });
      return "";
    case "approval.request":
      onApproval?.(event);
      return "";
    case "run.failed":
    case "run.interrupted":
      throw new Error(`Hermes 응답이 완료되지 않았습니다. (${event.error || event.event})`);
    case "run.cancelled":
      throw new DOMException("응답 생성이 중지되었습니다.", "AbortError");
    default:
      return "";
  }
}

/**
 * Reads a Hermes run's event stream (`/v1/runs/{id}/events`, SSE `data: {event, ...}` frames):
 * yields answer text; tool use goes to onActivity and approval requests to onApproval.
 */
export async function* readResponseBody(response, { onActivity, onApproval } = {}) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let streamed = false;
  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const frames = buffer.split(/\r?\n\r?\n/);
    buffer = done ? "" : frames.pop();

    for (const frame of frames) {
      // Keepalive and close notes are SSE comments (": ...") and carry no data.
      const data = frame
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (!data) continue;
      const event = JSON.parse(data);
      if (event.event === "run.completed") {
        // Providers that do not stream send the whole answer only here.
        if (!streamed && event.output) yield event.output;
        return;
      }
      const text = runEventText(event, { onActivity, onApproval });
      if (text) {
        streamed = true;
        yield text;
      }
    }
    if (done) return;
  }
}

async function* streamTransportResponse({ transport, messages, conversationId, signal, onActivity, onApproval }) {
  const response = await transport({ content: messages.at(-1).content, conversationId, signal });

  let hasContent = false;
  for await (const chunk of readResponseBody(response, { onActivity, onApproval })) {
    hasContent = true;
    yield chunk;
  }
  if (!hasContent) {
    throw new Error("Hermes 응답에 내용이 없습니다.");
  }
}

/** Uses the transport when connected; otherwise plays a clearly local example reply. */
export function createChatClient({ transport = null } = {}) {
  return {
    streamReply({ messages, conversationId, signal, onActivity, onApproval }) {
      if (transport) {
        return streamTransportResponse({ transport, messages, conversationId, signal, onActivity, onApproval });
      }

      const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
      return streamDemoResponse({ signal, delayMs: reduceMotion ? 0 : 18 });
    },
  };
}
