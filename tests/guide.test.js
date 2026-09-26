import { beforeEach, describe, expect, it, vi } from "vitest";

import { collectScript, createGuide, markScript, maskLabel, stepText } from "../src/guide.js";

const KEY = "AIza" + "B".repeat(35);
const PATTERN = "AIza[0-9A-Za-z_-]{35}";

describe("sign-up guide", () => {
  it("hides e-mail addresses, long numbers and keys before a label leaves this PC", () => {
    expect(maskLabel("link: me@example.com 계정으로 계속", PATTERN)).toBe("link: [이메일] 계정으로 계속");
    expect(maskLabel("button: 010-1234-5678 인증", PATTERN)).toBe("button: [숫자] 인증");
    expect(maskLabel(`input: ${KEY}`, PATTERN)).toBe("input: [키]");
  });

  it("says what to do with the marked control, and when the user must decide or act alone", () => {
    const step = { target: "e2", confidence: 0.9, consent: 0.1, blocked: 0.1 };
    expect(stepText(step, "button: Get API key")).toBe("오른쪽 화면에 빨간 테두리로 표시한 ‘Get API key’ 버튼을 누르세요.");
    expect(stepText({ ...step, consent: 0.8 }, "checkbox: I agree")).toBe(
      "약관·동의 화면이에요. 내용을 확인하고 동의하시면 오른쪽 화면에 빨간 테두리로 표시한 ‘I agree’을(를) 체크하세요.",
    );
    expect(stepText({ ...step, confidence: 0.3 }, "input: Email")).toContain("확실하지 않으니");
    // A marked control comes first; the rest is said only when nothing is marked.
    expect(stepText({ ...step, blocked: 0.9 }, "input: Email")).toContain("‘Email’ 칸에");
    expect(stepText({ ...step, target: null, blocked: 0.9 }, undefined)).toContain("직접 처리해 주세요");
    expect(stepText({ ...step, target: null, consent: 0.7 }, undefined)).toContain("직접 정해 주세요");
    expect(stepText({ ...step, target: null }, undefined)).toContain("기다리고 있어요");
  });

  it("reads a page's controls and a shown key, and marks one control", () => {
    document.body.innerHTML = `
      <button>Get API key</button>
      <a href="/docs">Docs</a>
      <input type="password" value="${KEY}" />
      <code>${KEY}</code>`;
    // jsdom lays nothing out: give every control a size.
    const box = vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({ left: 1, top: 1, width: 40, height: 20, bottom: 21 });
    Element.prototype.scrollIntoView = vi.fn();
    // jsdom has no CSS.escape; WebView2 does.
    globalThis.CSS ??= { escape: (value) => value.replace(/[^\w-]/g, (char) => `\\${char}`) };
    const page = (0, eval)(collectScript(PATTERN));
    expect(page.elements).toEqual({ e0: "button: Get API key", e1: "link: Docs" });
    expect(page.key).toBe(KEY);
    expect((0, eval)(markScript("e0", true))).toBe(true);
    expect(document.getElementById("crema-guide-mark")).not.toBeNull();
    expect((0, eval)(markScript(null, false))).toBe(false);
    expect(document.getElementById("crema-guide-mark")).toBeNull();
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
    document.body.innerHTML = '<div class="app-shell"></div>';
    shell = document.querySelector(".app-shell");
    cards = [];
    window.ResizeObserver = class {
      observe() {}
      disconnect() {}
    };
    URL.createObjectURL = vi.fn(() => "blob:shot");
    URL.revokeObjectURL = vi.fn();
    page = { url: "https://aistudio.google.com/apikey?authuser=me@example.com", title: "API keys", elements: { e0: "button: Get API key" }, key: "" };
    host = {
      guideOpen: vi.fn(async () => {}),
      guideBounds: vi.fn(),
      guideClose: vi.fn(),
      guideEval: vi.fn(async (script) => (script.includes("querySelectorAll") ? page : true)),
      guideCapture: vi.fn(async () => new ArrayBuffer(4)),
      guideStep: vi.fn(async () => ({ target: "e0", confidence: 0.9, consent: 0, blocked: 0 })),
      hermesAdmin: vi.fn(async () => ({ ok: true })),
    };
  });

  const text = () => cards[0].querySelector("[data-guide-text]").textContent;

  it("opens the site beside the chat, marks the next control, and saves a key that appears", async () => {
    const onConnected = vi.fn(async () => {});
    const guide = createGuide({ host, shell, showCard: (card) => cards.push(card), onConnected });
    const started = guide.start("gemini");
    await vi.advanceTimersByTimeAsync(20);
    await started;
    expect(host.guideOpen).toHaveBeenCalledWith("https://aistudio.google.com/apikey", expect.any(Object));
    expect(shell.classList.contains("guide-open")).toBe(true);

    await vi.advanceTimersByTimeAsync(1600);
    expect(host.guideStep).toHaveBeenCalledWith(
      expect.objectContaining({ url: "https://aistudio.google.com/apikey", elements: { e0: "button: Get API key" } }),
    );
    expect(text()).toContain("‘Get API key’ 버튼을 누르세요");
    expect(cards[0].querySelector("[data-guide-shot]").hidden).toBe(false);

    // Unchanged page: no new judgment.
    await vi.advanceTimersByTimeAsync(1600);
    expect(host.guideStep).toHaveBeenCalledTimes(1);

    page = { ...page, key: KEY };
    await vi.advanceTimersByTimeAsync(1600);
    expect(text()).toContain("AIza••••BBB");
    [...cards[0].querySelectorAll("button")].find((button) => button.textContent === "저장").click();
    await vi.advanceTimersByTimeAsync(10);
    expect(host.hermesAdmin).toHaveBeenCalledWith("PUT", "/api/env", { key: "GEMINI_API_KEY", value: KEY });
    expect(host.guideStep).not.toHaveBeenCalledWith(expect.objectContaining({ elements: expect.objectContaining({ key: KEY }) }));
    expect(onConnected).toHaveBeenCalled();
    expect(host.guideClose).toHaveBeenCalled();
    expect(shell.classList.contains("guide-open")).toBe(false);
    expect(text()).toContain("연결을 마쳤어요");
    vi.useRealTimers();
  });
});
