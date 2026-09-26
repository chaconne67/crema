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
 * yields answer text; tool use goes to onActivity, approval requests to onApproval, and the
 * `{provider, model}` that actually answered (after any engine failover) to onServed.
 */
export async function* readResponseBody(response, { onActivity, onApproval, onServed } = {}) {
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
        if (event.runtime) onServed?.(event.runtime);
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

/** The request that hands a reply cut off midway to another Provider, from where it stopped. */
export function resumeRequest(partial) {
  return [
    "[이어쓰기] 방금 답변이 전송 중에 끊겼다. 사용자는 아래 [받은 부분의 끝]까지 받았다.",
    "앞부분을 되풀이하거나 이 안내를 언급하지 말고, 끊긴 곳 바로 다음부터 이어서 쓴다.",
    "",
    "[받은 부분의 끝]",
    partial.slice(-1500),
  ].join("\n");
}

async function* streamTransportResponse({ transport, messages, conversationId, signal, onActivity, onApproval, onServed }) {
  const read = (response) => readResponseBody(response, { onActivity, onApproval, onServed });
  let text = "";
  try {
    for await (const chunk of read(await transport({ content: messages.at(-1).content, conversationId, signal }))) {
      text += chunk;
      yield chunk;
    }
  } catch (error) {
    // A reply cut off midway goes once to the transport's next Provider (`resume`); it throws when there is none.
    if (error?.name === "AbortError" || !text) throw error;
    for await (const chunk of read(await transport({ content: resumeRequest(text), conversationId, signal, resume: error }))) {
      text += chunk;
      yield chunk;
    }
  }
  if (!text) {
    throw new Error("Hermes 응답에 내용이 없습니다.");
  }
}

/** Streams replies through the Hermes transport — the app's only reply path. */
export function createChatClient({ transport }) {
  return {
    streamReply({ messages, conversationId, signal, onActivity, onApproval, onServed }) {
      return streamTransportResponse({ transport, messages, conversationId, signal, onActivity, onApproval, onServed });
    },
  };
}
