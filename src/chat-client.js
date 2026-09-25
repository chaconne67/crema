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

/** Streams replies through the Hermes transport — the app's only reply path. */
export function createChatClient({ transport }) {
  return {
    streamReply({ messages, conversationId, signal, onActivity, onApproval }) {
      return streamTransportResponse({ transport, messages, conversationId, signal, onActivity, onApproval });
    },
  };
}
