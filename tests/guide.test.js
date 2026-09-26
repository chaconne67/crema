import { beforeEach, describe, expect, it, vi } from "vitest";

import { collectScript, createGuide, maskLabel, stepText } from "../src/guide.js";

const KEY = "AIza" + "B".repeat(35);
const PATTERN = "AIza[0-9A-Za-z_-]{35}";

describe("sign-up guide", () => {
  it("hides e-mail addresses, long numbers and keys before a label leaves this PC", () => {
    expect(maskLabel("link: me@example.com 계정으로 계속", PATTERN)).toBe("link: [이메일] 계정으로 계속");
    expect(maskLabel("button: 010-1234-5678 인증", PATTERN)).toBe("button: [숫자] 인증");
    expect(maskLabel(`input: ${KEY}`, PATTERN)).toBe("input: [키]");
  });

  it("names the control to use, and says when the user must decide or act alone", () => {
    const step = { target: "e2", confidence: 0.9, consent: 0.1, blocked: 0.1 };
    expect(stepText(step, "button: Get API key")).toBe("‘Get API key’ 버튼을 누르세요.");
    expect(stepText({ ...step, consent: 0.8 }, "checkbox: I agree")).toBe("동의를 묻는 화면이에요. 내용을 확인하고 동의하시면 ‘I agree’을(를) 체크하세요.");
    expect(stepText({ ...step, confidence: 0.3 }, "input: Email")).toBe("‘Email’ 칸에 입력하세요. 확실하지 않으니 화면을 한 번 확인해 주세요.");
    // A control to use comes first; the rest is said only when there is none.
    expect(stepText({ ...step, blocked: 0.9 }, "input: Email")).toBe("‘Email’ 칸에 입력하세요.");
    expect(stepText({ ...step, target: null, blocked: 0.9 }, undefined)).toContain("직접 처리해 주세요");
    expect(stepText({ ...step, target: null, consent: 0.7 }, undefined)).toContain("직접 정해 주세요");
    expect(stepText({ ...step, target: null }, undefined)).toBe("화면이 바뀌기를 기다리고 있어요.");
  });

  it("reads a page's controls and a shown key, never a password field's value", () => {
    document.body.innerHTML = `
      <button>Get API key</button>
      <a href="/docs">Docs</a>
      <input type="password" value="${"AIza" + "C".repeat(35)}" />
      <code>${KEY}</code>`;
    // jsdom lays nothing out: give every control a size.
    const box = vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({ left: 1, top: 1, width: 40, height: 20, bottom: 21 });
    const page = (0, eval)(collectScript(PATTERN));
    expect(page.elements).toEqual({ e0: "button: Get API key", e1: "link: Docs" });
    expect(page.key).toBe(KEY);
    box.mockRestore();
  });
});

describe("sign-up guide flow", () => {
  let host;
  let shell;
  let cards;
  let page;

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '<div class="app-shell"><header class="app-bar"></header><main class="conversation-scroll"></main><footer class="composer-shell"></footer></div>';
    shell = document.querySelector(".app-shell");
    cards = [];
    window.ResizeObserver = class {
      observe() {}
      disconnect() {}
    };
    page = { url: "https://aistudio.google.com/apikey?authuser=me@example.com", title: "API keys", elements: { e0: "button: Get API key" }, key: "" };
    host = {
      guideOpen: vi.fn(async () => {}),
      guideBounds: vi.fn(),
      guideClose: vi.fn(async () => {}),
      guideVisible: vi.fn(),
      guideEval: vi.fn(async () => page),
      guideStep: vi.fn(async () => ({ target: "e0", confidence: 0.9, consent: 0, blocked: 0 })),
      hermesAdmin: vi.fn(async () => ({ ok: true })),
    };
  });

  const line = () => document.querySelector(".guide-say").textContent;

  it("turns the chat into the guide, names the next control, and saves a key that appears", async () => {
    const onConnected = vi.fn(async () => {});
    const onUseAuto = vi.fn();
    const guide = createGuide({ host, shell, hasConversation: () => true, showCard: (card) => cards.push(card), onConnected, onUseAuto });
    const started = guide.start("gemini");
    await vi.advanceTimersByTimeAsync(20);
    await started;
    expect(host.guideOpen).toHaveBeenCalledWith("https://aistudio.google.com/apikey", expect.any(Object));
    expect(shell.classList.contains("guiding")).toBe(true);
    expect(document.querySelector(".guide-view").hidden).toBe(false);

    await vi.advanceTimersByTimeAsync(1600);
    expect(host.guideStep).toHaveBeenCalledWith(
      expect.objectContaining({ url: "https://aistudio.google.com/apikey", elements: { e0: "button: Get API key" } }),
    );
    expect(line()).toBe("‘Get API key’ 버튼을 누르세요.");

    // Unchanged page: no new judgment.
    await vi.advanceTimersByTimeAsync(1600);
    expect(host.guideStep).toHaveBeenCalledTimes(1);

    // Peeking at the earlier chat puts the page away; returning brings it back.
    document.querySelector("[data-guide-earlier]").click();
    expect(shell.classList.contains("guide-peek")).toBe(true);
    expect(host.guideVisible).toHaveBeenLastCalledWith(false);
    document.querySelector("[data-guide-earlier]").click();
    expect(host.guideVisible).toHaveBeenLastCalledWith(true);

    // Settings over the chat: the page steps aside meanwhile.
    guide.setCovered(true);
    expect(host.guideVisible).toHaveBeenLastCalledWith(false);
    guide.setCovered(false);

    page = { ...page, key: KEY };
    await vi.advanceTimersByTimeAsync(1600);
    expect(line()).toBe("키를 찾았어요 · AIza••••BBB");
    expect(document.querySelector(".guide-block").classList.contains("found")).toBe(true);
    document.querySelector("[data-guide-save-button]").click();
    await vi.advanceTimersByTimeAsync(10);
    expect(host.hermesAdmin).toHaveBeenCalledWith("PUT", "/api/env", { key: "GEMINI_API_KEY", value: KEY });
    expect(onConnected).toHaveBeenCalled();
    expect(host.guideClose).toHaveBeenCalled();
    expect(shell.classList.contains("guiding")).toBe(false);
    expect(cards[0].textContent).toContain("Google Gemini를 연결했어요");
    cards[0].querySelector("button").click();
    expect(onUseAuto).toHaveBeenCalled();
    vi.useRealTimers();
  });
});
