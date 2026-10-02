import { beforeEach, describe, expect, it, vi } from "vitest";

import { createChatApp, listContinuation } from "../src/app.js";
import { documentNote, requestContent } from "../src/attachments.js";

function submit(text) {
  document.querySelector("#prompt").value = text;
  document.querySelector("[data-composer]").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
}

describe("attachment request content", () => {
  it("sends plain text alone, puts document notes first, and images as inline parts", () => {
    expect(requestContent("질문", [])).toBe("질문");
    const withFile = requestContent("요약해줘", [{ kind: "file", name: "보고서.pdf", stagedPath: "C:\\cache\\1_보고서.pdf" }]);
    expect(withFile).toMatch(/^\[The user sent a document: '보고서\.pdf'\. It is saved at: C:\\cache\\1_보고서\.pdf\./);
    expect(withFile.endsWith("\n\n요약해줘")).toBe(true);
    expect(requestContent("이거 봐", [{ kind: "image", dataUrl: "data:image/png;base64,AA" }])).toEqual([
      { type: "text", text: "이거 봐" },
      { type: "image_url", image_url: { url: "data:image/png;base64,AA" } },
    ]);
  });

  it("tells the agent to read text files and extract binary ones, as Hermes' own channels do", () => {
    expect(documentNote("notes.md", "/c/notes.md")).toContain("text document");
    expect(documentNote("deck.pptx", "/c/deck.pptx")).toContain("binary format");
  });
});

describe("composer", () => {
  let requests;
  let release;
  let host;

  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
    window.localStorage.clear();
    window.matchMedia = vi.fn(() => ({ matches: false }));
    Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: vi.fn() });
    requests = [];
    release = null;
    host = {
      openLink: vi.fn(),
      pickFiles: vi.fn(async () => ["C:\\work\\shot.png", "C:\\work\\보고서.pdf"]),
      readFile: vi.fn(async () => new Uint8Array([137, 80, 78, 71]).buffer),
      stageDocument: vi.fn(async () => "C:\\hermes\\cache\\documents\\1_보고서.pdf"),
      listProjectFiles: vi.fn(async () => ["src/app.js", "src/main.js"]),
    };
  });

  // "+" opens the 추가 menu (as in Codex); its first row picks files.
  function attachFiles() {
    document.querySelector("[data-attach]").click();
    const menu = document.querySelector("[data-command-menu]");
    expect(menu.querySelector(".menu-title").textContent).toBe("추가");
    expect(menu.querySelector(".menu-item .menu-description").textContent).toBeTruthy();
    menu.querySelector(".menu-item").click();
  }

  function mount(options = {}) {
    const client = {
      async *streamReply({ messages }) {
        requests.push(messages.at(-1).content);
        if (requests.length === 1) await new Promise((resolve) => (release = resolve));
        yield "답변";
      },
    };
    const app = createChatApp({ client, host, ...options });
    app.mount(document.querySelector("#app"));
    return app;
  }

  it("continues a list on Shift+Enter, as in Claude Code, and ends it on an empty item", () => {
    expect(listContinuation("- 첫째")).toBe("- ");
    expect(listContinuation("  * 둘째")).toBe("  * ");
    expect(listContinuation("9. 아홉")).toBe("10. ");
    expect(listContinuation("3) 셋")).toBe("4) ");
    expect(listContinuation("1. ")).toBe("");
    expect(listContinuation("그냥 글")).toBeNull();
    expect(listContinuation("1.5배")).toBeNull();

    mount();
    const prompt = document.querySelector("#prompt");
    const shiftEnter = () => prompt.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true, cancelable: true }));
    prompt.value = "할 일\n1. 장보기";
    prompt.setSelectionRange(prompt.value.length, prompt.value.length);
    shiftEnter();
    expect(prompt.value).toBe("할 일\n1. 장보기\n2. ");
    prompt.setRangeText("빨래", prompt.value.length, prompt.value.length, "end");
    shiftEnter();
    expect(prompt.value).toBe("할 일\n1. 장보기\n2. 빨래\n3. ");
    // An empty item ends the list: its number goes, the line stays for plain text.
    shiftEnter();
    expect(prompt.value).toBe("할 일\n1. 장보기\n2. 빨래\n");
    // Not a list line: Shift+Enter is left to make a plain new line.
    prompt.value = "그냥 글";
    prompt.setSelectionRange(prompt.value.length, prompt.value.length);
    const event = new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true, cancelable: true });
    prompt.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });

  it("draws - and * items in the draft with a bullet while the text stays Markdown", () => {
    mount();
    const prompt = document.querySelector("#prompt");
    const mirror = document.querySelector("[data-draft-mirror]");
    prompt.value = "할 일\n- 장보기 <b>꼭</b>\n  * 우유\n12. 빨래\n1.5배\n";
    prompt.dispatchEvent(new Event("input", { bubbles: true }));
    // Same characters in the same places as the textarea, so the caret lines up.
    expect(mirror.textContent).toBe(`${prompt.value} `);
    expect([...mirror.querySelectorAll(".draft-bullet")].map((node) => node.textContent)).toEqual(["- ", "* "]);
    // Typed text is text, never markup.
    expect(mirror.querySelector("b")).toBeNull();
    prompt.value = "";
    prompt.dispatchEvent(new Event("input", { bubbles: true }));
    expect(mirror.textContent).toBe("");
  });

  it("queues a turn typed during a reply and sends it when the reply ends", async () => {
    const app = mount();
    app.showConversation("chat-1");
    submit("첫 질문");
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    submit("이어서 할 질문");
    expect(document.querySelector(".queued-text").textContent).toBe("이어서 할 질문");
    expect(requests).toEqual(["첫 질문"]);

    release();
    await vi.waitFor(() => expect(requests).toEqual(["첫 질문", "이어서 할 질문"]));
    expect(document.querySelector("[data-queue]").hidden).toBe(true);
  });

  it("attaches an image inline and a document through Hermes' cache, showing both on the request", async () => {
    const app = mount();
    app.showConversation("chat-1");
    attachFiles();
    await vi.waitFor(() => expect(document.querySelectorAll(".draft-attachment")).toHaveLength(2));
    expect(document.querySelector(".draft-attachment.is-image img").src).toMatch(/^data:image\/png;base64,/);

    submit("확인해줘");
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    release();
    const [text, image] = requests[0];
    expect(host.stageDocument).toHaveBeenCalledWith("C:\\work\\보고서.pdf");
    expect(text.text).toContain("It is saved at: C:\\hermes\\cache\\documents\\1_보고서.pdf");
    expect(text.text.endsWith("확인해줘")).toBe(true);
    expect(image.type).toBe("image_url");
    // Above the request: the image as itself, the document by name.
    const stack = document.querySelector(".turn-user .user-message-stack");
    expect([...stack.children].map((node) => node.className)).toEqual(["message-attachments", "user-message markdown", "message-meta"]);
    expect(stack.querySelector(".message-image img").src).toMatch(/^data:image\/png;base64,/);
    expect([...stack.querySelectorAll(".attachment-chip")].map((chip) => chip.textContent)).toEqual(["보고서.pdf"]);
    expect(document.querySelector("[data-attachments]").hidden).toBe(true);

    // Clicking the image shows it large; a click closes it.
    stack.querySelector(".message-image").click();
    const viewer = document.querySelector(".image-viewer");
    expect(viewer.querySelector("img").src).toMatch(/^data:image\/png;base64,/);
    viewer.click();
    expect(document.querySelector(".image-viewer")).toBeNull();
  });

  it("offers finding a project file only in a project, and starts the @ search when chosen", async () => {
    const app = mount();
    app.showConversation("chat-1");
    document.querySelector("[data-attach]").click();
    expect([...document.querySelectorAll(".command-menu .menu-item")].map((row) => row.querySelector(".menu-label").firstChild.textContent)).toEqual([
      "파일 첨부",
    ]);
    document.querySelector("[data-attach]").click();

    app.showConversation("chat-2", { project: { name: "agent-client", path: "/work/agent-client" } });
    document.querySelector("[data-attach]").click();
    const rows = [...document.querySelectorAll(".command-menu .menu-item")];
    expect(rows[1].textContent).toContain("프로젝트 파일 선택");
    rows[1].click();
    expect(document.querySelector("#prompt").value).toBe("@");
    await vi.waitFor(() => expect(host.listProjectFiles).toHaveBeenCalledWith("/work/agent-client", ""));
    await vi.waitFor(() => expect(document.querySelector(".command-menu .menu-title").textContent).toBe("agent-client 파일"));
  });

  it("offers project files after @ and inserts the chosen path", async () => {
    const app = mount();
    app.showConversation("chat-1", { project: { name: "agent-client", path: "C:\\work\\agent-client" } });
    const textarea = document.querySelector("#prompt");
    textarea.value = "이 파일 봐줘 @ap";
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    textarea.dispatchEvent(new Event("input"));
    await vi.waitFor(() => expect(document.querySelectorAll(".command-menu .menu-item")).toHaveLength(2));
    expect(host.listProjectFiles).toHaveBeenCalledWith("C:\\work\\agent-client", "ap");
    document.querySelector(".command-menu .menu-item").click();
    expect(textarea.value).toBe("이 파일 봐줘 @src/app.js ");
  });

  it("filters a chip menu by its search box, offers creating a new name, and skips disabled rows", async () => {
    const chosen = vi.fn();
    const app = mount({
      onContextMenu(kind, ui) {
        ui.picker({
          title: "브랜치",
          search: { placeholder: "브랜치 검색 또는 새 이름", extra: (name) => (name && name !== "main" ? [{ label: `'${name}' 만들기`, create: name }] : []) },
          items: [{ label: "main", selected: true }, { label: "release", disabled: true }, { label: "feature/login" }],
          onSelect: chosen,
        });
      },
    });
    app.showConversation("chat-1", { project: { name: "demo", path: "C:\demo" } });
    app.setBranch({ branch: "main" });
    document.querySelector("[data-branch-chip]").click();
    const search = document.querySelector("[data-menu-search]");
    expect(document.activeElement).toBe(search);

    search.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(document.querySelector(".menu-item.active .menu-label").textContent).toBe("feature/login");

    search.value = "hotfix";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    expect([...document.querySelectorAll(".command-menu .menu-label")].map((row) => row.textContent)).toEqual(["'hotfix' 만들기"]);
    search.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(chosen).toHaveBeenCalledWith(expect.objectContaining({ create: "hotfix" }));
    expect(document.querySelector("[data-command-menu]").hidden).toBe(true);
  });

  it("shows the predicted next input after an answer, takes it with Tab, and drops it when typing", async () => {
    const suggestNext = vi.fn(async () => "테스트도 돌려줘");
    const app = mount({ suggestNext });
    app.showConversation("chat-1");
    submit("고쳐줘");
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    release();
    const textarea = document.querySelector("#prompt");
    await vi.waitFor(() => expect(textarea.placeholder).toBe("테스트도 돌려줘"));
    expect(suggestNext).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ role: "assistant", content: "답변" })]), expect.any(AbortSignal));
    expect(document.querySelector("[data-suggest-hint]").hidden).toBe(false);

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
    expect(textarea.value).toBe("테스트도 돌려줘");
    expect(textarea.placeholder).toBe("무엇이든 요청하세요");

    textarea.value = "";
    submit("다른 질문");
    await vi.waitFor(() => expect(textarea.placeholder).toBe("테스트도 돌려줘"));
    textarea.value = "직";
    textarea.dispatchEvent(new Event("input"));
    expect(textarea.placeholder).toBe("무엇이든 요청하세요");
    expect(document.querySelector("[data-suggest-hint]").hidden).toBe(true);
  });

  it("shows the model with its effort and opens the model menu from the chip", () => {
    const onContextMenu = vi.fn();
    const app = mount({ onContextMenu });
    app.showConversation("chat-1");
    app.setModel({ name: "gpt-6-sol", detail: "높음", fast: true });
    expect(document.querySelector("[data-model-name]").textContent).toBe("gpt-6-sol");
    expect(document.querySelector("[data-model-detail]").textContent).toBe("높음");
    expect(document.querySelector("[data-model-fast]").hidden).toBe(false);
    document.querySelector("[data-model-chip]").click();
    expect(onContextMenu).toHaveBeenCalledWith("model", expect.any(Object), null);

    app.setAccess("off");
    expect(document.querySelector("[data-access]").textContent).toContain("승인 없이 실행");
    app.setAccess(null);
    expect(document.querySelector("[data-access]").hidden).toBe(true);
  });
});
