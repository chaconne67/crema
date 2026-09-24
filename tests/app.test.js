import { beforeEach, describe, expect, it, vi } from "vitest";

import { createChatApp } from "../src/app.js";

function submit(text) {
  document.querySelector("#prompt").value = text;
  document
    .querySelector("[data-composer]")
    .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
}

describe("chat app", () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
    window.localStorage.clear();
    window.matchMedia = vi.fn(() => ({ matches: false }));
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      configurable: true,
      value: vi.fn(),
    });
    document.execCommand = vi.fn(() => true);
  });

  it("keeps a reply going while another chat is open and shows it live on return", async () => {
    let release;
    const gate = new Promise((resolve) => (release = resolve));
    const client = {
      async *streamReply() {
        yield "앞부분";
        await gate;
        yield " 뒷부분";
      },
    };
    const app = createChatApp({ client, host: { openLink: vi.fn() } });
    app.mount(document.querySelector("#app"));
    app.showConversation("chat-a");
    submit("질문");
    await vi.waitFor(() => expect(document.querySelector(".assistant-content").textContent).toContain("앞부분"));

    app.showConversation("chat-b");
    expect(document.querySelector(".stop-button").hidden).toBe(true);
    app.showConversation("chat-a");
    expect(document.querySelector(".stop-button").hidden).toBe(false);

    release();
    await vi.waitFor(() => expect(document.querySelector(".assistant-content").textContent.trim()).toBe("앞부분 뒷부분"));
    const stored = JSON.parse(window.localStorage.getItem("agent-client:chat:chat-a"));
    expect(stored.at(-1)).toMatchObject({ role: "assistant", status: "complete", content: "앞부분 뒷부분" });
    expect(window.localStorage.getItem("agent-client:chat:chat-b")).toBeNull();
  });

  it("keeps a chat's queued turn and sends it after the reply ends, even from another chat", async () => {
    let release;
    const gate = new Promise((resolve) => (release = resolve));
    const asked = [];
    const client = {
      async *streamReply({ messages }) {
        asked.push(messages[0].content);
        if (asked.length === 1) await gate;
        yield `답 ${asked.length}`;
      },
    };
    const app = createChatApp({ client, host: { openLink: vi.fn() } });
    app.mount(document.querySelector("#app"));
    app.showConversation("chat-a");
    submit("첫 질문");
    submit("둘째 질문");
    expect(document.querySelector(".queued-text").textContent).toBe("둘째 질문");

    app.showConversation("chat-b");
    expect(document.querySelector("[data-queue]").hidden).toBe(true);
    app.showConversation("chat-a");
    expect(document.querySelector(".queued-text").textContent).toBe("둘째 질문");
    app.showConversation("chat-b");

    release();
    await vi.waitFor(() => {
      const stored = JSON.parse(window.localStorage.getItem("agent-client:chat:chat-a"));
      expect(stored.map((m) => `${m.role}:${m.content}:${m.status}`)).toEqual([
        "user:첫 질문:complete",
        "assistant:답 1:complete",
        "user:둘째 질문:complete",
        "assistant:답 2:complete",
      ]);
    });
    expect(asked).toEqual(["첫 질문", "둘째 질문"]);
  });

  it("renames the open chat from the title or Ctrl+Alt+R in a dialog", () => {
    HTMLDialogElement.prototype.showModal ??= function () {
      this.open = true;
    };
    HTMLDialogElement.prototype.close ??= function () {
      this.open = false;
    };
    const onRenameChat = vi.fn();
    const app = createChatApp({ client: { async *streamReply() {} }, host: { openLink: vi.fn() }, onRenameChat });
    app.mount(document.querySelector("#app"));
    app.showConversation("chat-1");
    app.setTitle("첫 요청 문장");
    expect(document.querySelector("[data-chat-title]").textContent).toBe("첫 요청 문장");

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "r", code: "KeyR", ctrlKey: true, altKey: true }));
    const dialog = document.querySelector("[data-rename-dialog]");
    expect(dialog.open).toBe(true);
    expect(dialog.querySelector("input").value).toBe("첫 요청 문장");

    dialog.querySelector("input").value = "  통합 에이전트   서비스 구상 ";
    dialog.querySelector("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    expect(onRenameChat).toHaveBeenCalledWith("통합 에이전트 서비스 구상");
  });

  it("stops a deleted chat's reply without saving it again", async () => {
    const client = {
      async *streamReply({ signal }) {
        yield "시작";
        await new Promise((_, reject) =>
          signal.addEventListener("abort", () => reject(new DOMException("stopped", "AbortError"))),
        );
      },
    };
    const app = createChatApp({ client, host: { openLink: vi.fn() } });
    app.mount(document.querySelector("#app"));
    app.showConversation("chat-a");
    submit("질문");
    await vi.waitFor(() => expect(document.querySelector(".assistant-content").textContent).toContain("시작"));

    app.showConversation("chat-b");
    app.discardReply("chat-a");
    window.localStorage.removeItem("agent-client:chat:chat-a");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(window.localStorage.getItem("agent-client:chat:chat-a")).toBeNull();
  });

  it("submits one prompt, renders the streamed Markdown, stores it, and copies code", async () => {
    const client = {
      async *streamReply() {
        yield "## 답변\n\n`인라인`\n\n```ts\nconst ok = true;\n```";
      },
    };
    const host = { openLink: vi.fn() };
    const app = createChatApp({ client, host });
    app.mount(document.querySelector("#app"));
    app.showConversation("chat-1");

    submit("**내 요청**");

    await vi.waitFor(() => {
      expect(document.querySelector(".assistant-content h2")?.textContent).toBe("답변");
    });

    expect(document.querySelector(".user-message strong")?.textContent).toBe("내 요청");
    expect(document.querySelector(".assistant-message .code-block")).not.toBeNull();
    expect(document.querySelector(".send-button").hidden).toBe(false);
    expect(document.querySelector(".stop-button").hidden).toBe(true);

    const stored = JSON.parse(window.localStorage.getItem("agent-client:chat:chat-1"));
    expect(stored).toHaveLength(2);
    expect(stored.at(-1)).toMatchObject({ role: "assistant", status: "complete" });

    document.querySelector("[data-copy-code]").click();
    await vi.waitFor(() => {
      expect(document.querySelector("[data-live-region]").textContent).toBe("코드를 복사했습니다.");
    });
    expect(document.execCommand).toHaveBeenCalledWith("copy");
  });

  it("asks for a new chat and offers connection only while disconnected", async () => {
    const client = {
      async *streamReply() {
        yield "답변";
      },
    };
    const onOpenSettings = vi.fn();
    const onNewChat = vi.fn();
    const app = createChatApp({ client, host: { openLink: vi.fn() }, onOpenSettings, onNewChat });
    app.mount(document.querySelector("#app"));
    app.showConversation("chat-1");

    const newChat = document.querySelector("[data-new-chat]");
    const connect = document.querySelector("[data-connect]");
    expect(newChat.disabled).toBe(true);

    app.setStatus("offline", "연결 전 · 예시 응답");
    expect(connect.hidden).toBe(false);
    connect.click();
    expect(onOpenSettings).toHaveBeenCalled();
    app.setStatus("connected", "Hermes 연결됨");
    expect(connect.hidden).toBe(true);

    submit("질문");
    await vi.waitFor(() => expect(newChat.disabled).toBe(false));
    newChat.click();
    expect(onNewChat).toHaveBeenCalled();
  });

  it("starts a new Hermes session in the same window with /new", async () => {
    const conversations = [];
    const client = {
      async *streamReply({ conversationId, messages }) {
        conversations.push([conversationId, messages[0].content]);
        yield "답변";
      },
    };
    let session = "s1";
    const onNewSession = vi.fn(() => {
      session = "s2";
    });
    const app = createChatApp({ client, host: { openLink: vi.fn() }, onNewSession, sessionFor: () => session });
    app.mount(document.querySelector("#app"));
    app.showConversation("chat-1");

    submit("/new");
    expect(onNewSession).not.toHaveBeenCalled();

    submit("첫 질문");
    await vi.waitFor(() => expect(document.querySelector(".stop-button").hidden).toBe(true));
    submit("/new");
    expect(onNewSession).toHaveBeenCalledWith("chat-1");
    expect(document.querySelector(".session-divider")).not.toBeNull();
    expect(document.querySelector("#prompt").value).toBe("");

    submit("둘째 질문");
    await vi.waitFor(() => expect(document.querySelectorAll(".turn")).toHaveLength(4));
    expect(conversations).toEqual([
      ["s1", "첫 질문"],
      ["s2", "둘째 질문"],
    ]);
    expect(JSON.parse(window.localStorage.getItem("agent-client:chat:chat-1")).map((m) => m.role)).toEqual([
      "user",
      "assistant",
      "session",
      "user",
      "assistant",
    ]);
  });

  it("opens the command menu from the button and routes Hermes commands to the host", async () => {
    const onCommand = vi.fn((id, arg, ui) => ui.notice({ title: "상태", rows: [["모델", "gpt-6-sol"]] }));
    const client = {
      async *streamReply() {
        yield "답변";
      },
    };
    const app = createChatApp({ client, host: { openLink: vi.fn() }, onCommand });
    app.mount(document.querySelector("#app"));
    app.showConversation("chat-1");

    document.querySelector("[data-menu-button]").click();
    const labels = [...document.querySelectorAll(".menu-item .menu-label")].map((node) => node.textContent);
    expect(labels).toContain("모델 선택");
    expect(labels).toContain("상태 보기");

    const statusRow = [...document.querySelectorAll(".menu-item")].find((node) => node.textContent.includes("상태 보기"));
    statusRow.click();
    expect(onCommand).toHaveBeenCalledWith("status", "", expect.any(Object));
    expect(document.querySelector(".notice-card dd").textContent).toBe("gpt-6-sol");
    expect(document.querySelector("[data-command-menu]").hidden).toBe(true);

    submit("/모델 gpt-6-luna");
    expect(onCommand).toHaveBeenLastCalledWith("model", "gpt-6-luna", expect.any(Object));

    submit("/stop");
    const notices = [...document.querySelectorAll(".notice-card")];
    expect(notices.at(-1).textContent).toContain("진행 중인 답변이 없습니다.");
    expect(document.querySelectorAll(".turn")).toHaveLength(0);
  });

  it("returns from a picker to the command list with the back row or Escape", () => {
    const onCommand = vi.fn((id, arg, ui) =>
      ui.picker({ title: "모델 선택", items: [{ label: "gpt-6-sol", value: "gpt-6-sol" }], onSelect: vi.fn() }),
    );
    const app = createChatApp({ client: { async *streamReply() {} }, host: { openLink: vi.fn() }, onCommand });
    app.mount(document.querySelector("#app"));
    app.showConversation("chat-1");

    const labels = () => [...document.querySelectorAll(".menu-item .menu-label")].map((node) => node.textContent);
    document.querySelector("[data-menu-button]").click();
    [...document.querySelectorAll(".menu-item")].find((node) => node.textContent.includes("모델 선택")).click();
    expect(labels()).toEqual(["gpt-6-sol"]);

    document.querySelector("[data-menu-back]").click();
    expect(labels()).toContain("상태 보기");
    expect(document.querySelector(".menu-item.active .menu-label").textContent).toBe("모델 선택");

    document.querySelector(".menu-item.active").click();
    const input = document.querySelector("#prompt");
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(labels()).toContain("상태 보기");
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(document.querySelector("[data-command-menu]").hidden).toBe(true);
  });

  it("keeps each chat's history separate and uses the chat id as the Hermes conversation", async () => {
    const conversations = [];
    const client = {
      async *streamReply({ conversationId }) {
        conversations.push(conversationId);
        yield "답변";
      },
    };
    const onConversationUpdate = vi.fn();
    const app = createChatApp({ client, host: { openLink: vi.fn() }, onConversationUpdate });
    app.mount(document.querySelector("#app"));

    app.showConversation("chat-a", { project: { name: "agent-client", path: "C:\\work\\agent-client" } });
    expect(document.querySelector("[data-project-name]").textContent).toBe("agent-client");
    expect(document.querySelector("[data-project-chip]").classList.contains("is-empty")).toBe(false);
    expect(document.querySelector("[data-empty-title]").textContent).toBe("agent-client에서 무엇을 할까요?");
    submit("첫 대화");
    await vi.waitFor(() => expect(document.querySelectorAll(".turn")).toHaveLength(2));

    app.showConversation("chat-b");
    expect(document.querySelectorAll(".turn")).toHaveLength(0);
    // No project: the chip stays, offering to pick one.
    expect(document.querySelector("[data-project-name]").textContent).toBe("프로젝트 없음");
    expect(document.querySelector("[data-project-chip]").classList.contains("is-empty")).toBe(true);

    app.showConversation("chat-a");
    expect(document.querySelector(".user-message").textContent).toContain("첫 대화");
    expect(conversations).toEqual(["chat-a"]);
    expect(onConversationUpdate).toHaveBeenCalledWith("chat-a", expect.any(Array));
  });
});
