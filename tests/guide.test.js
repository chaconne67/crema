import { beforeEach, describe, expect, it, vi } from "vitest";

import { GUIDES, collectScript, createGuide, markScript, maskLabel, stepAt, stepText } from "../src/guide.js";

const KEY = "AIza" + "B".repeat(35);
const PATTERN = "AIza[0-9A-Za-z_-]{35}";

describe("AI setup guide", () => {
  it("hides e-mail addresses, long numbers and keys before a label leaves this PC", () => {
    expect(maskLabel("link: me@example.com 계정으로 계속", PATTERN)).toBe("link: [이메일] 계정으로 계속");
    expect(maskLabel("button: 010-1234-5678 인증", PATTERN)).toBe("button: [숫자] 인증");
    expect(maskLabel(`input: ${KEY}`, PATTERN)).toBe("input: [키]");
    expect(maskLabel("input: me@example.com", null)).toBe("input: [이메일]");
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

  it("knows the step from the page address, and keeps it on a page it does not know", () => {
    const { gemini, "openai-codex": chatgpt, anthropic } = GUIDES;
    expect(stepAt(gemini, "https://accounts.google.com/v3/signin/identifier", 1)).toBe(0);
    expect(stepAt(gemini, "https://aistudio.google.com/apikey", 0)).toBe(1);
    expect(stepAt(gemini, "https://myaccount.google.com/", 1)).toBe(1);
    expect(stepAt(chatgpt, "https://auth.openai.com/log-in", 1)).toBe(0);
    expect(stepAt(chatgpt, "https://auth.openai.com/codex/device", 0)).toBe(1);
    expect(stepAt(anthropic, "https://claude.ai/login", 1)).toBe(0);
    expect(stepAt(anthropic, "https://claude.ai/oauth/authorize", 0)).toBe(1);
    // A sign-in over the key page, its address unchanged.
    const { groq } = GUIDES;
    expect(stepAt(groq, "https://console.groq.com/keys", 1, ["button: Continue with Google"])).toBe(0);
    expect(stepAt(groq, "https://console.groq.com/keys", 0, ["input: Enter your email address", "button: Continue"])).toBe(0);
    expect(stepAt(groq, "https://console.groq.com/keys", 0, ["button: Create API Key", "button: Log out"])).toBe(1);
  });

  it("reads a page's controls, errors and a shown key, never a password field's value, and tags them for the ring", () => {
    document.body.innerHTML = `
      <button>Get API key</button>
      <button><span class="material-symbols-outlined">key</span>API 키 만들기</button>
      <a href="/docs">Docs</a>
      <input type="password" value="${"AIza" + "C".repeat(35)}" />
      <div role="alert">Something went wrong</div>
      <code>${KEY}</code>`;
    // jsdom lays nothing out: give every control a size.
    const box = vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({ left: 1, top: 1, width: 40, height: 20, bottom: 21 });
    const page = (0, eval)(collectScript(PATTERN));
    // An icon's own name ("key") is not part of the label.
    expect(page.elements).toEqual({ e0: "button: Get API key", e1: "button: API 키 만들기", e2: "link: Docs" });
    expect(page.errors).toEqual(["Something went wrong"]);
    expect(page.key).toBe(KEY);
    expect(document.querySelector("button").dataset.cremaE).toBe("e0");
    expect(document.querySelector("code").dataset.cremaE).toBe("key");
    // Without a pattern (a code Crema shows) nothing is looked for.
    expect((0, eval)(collectScript(null)).key).toBe("");

    // The ring goes round the tagged control with its note, and away when there is none.
    window.requestAnimationFrame = () => 0;
    window.cancelAnimationFrame = () => {};
    (0, eval)(markScript("e0", "여기를 누르세요"));
    const ring = document.getElementById("crema-guide-ring");
    expect(ring.style.display).toBe("block");
    expect(ring.textContent).toBe("여기를 누르세요");
    (0, eval)(markScript("", ""));
    expect(ring.style.display).toBe("none");
    box.mockRestore();
  });
});

describe("AI setup guide flow", () => {
  let host;
  let shell;
  let cards;
  let page;
  let connected;
  let options;

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '<div class="app-shell"><header class="app-bar"></header><main class="conversation-scroll"></main><footer class="composer-shell"></footer></div>';
    shell = document.querySelector(".app-shell");
    cards = [];
    connected = new Set();
    window.ResizeObserver = class {
      observe() {}
      disconnect() {}
    };
    page = { url: "https://aistudio.google.com/apikey?authuser=me@example.com", title: "API keys", elements: { e0: "button: Get API key" }, errors: [], key: "" };
    host = {
      guideOpen: vi.fn(async () => {}),
      guideBounds: vi.fn(),
      guideClose: vi.fn(async () => {}),
      guideVisible: vi.fn(),
      // Page reads return the page; the ring script returns true.
      guideEval: vi.fn(async (script) => (script.includes("crema-guide-ring") ? true : page)),
      guideStep: vi.fn(async () => ({ target: "e0", confidence: 0.9, consent: 0, blocked: 0 })),
      guideHelp: vi.fn(async () => ({ cause: "verification" })),
      hermesAdmin: vi.fn(async () => ({ ok: true })),
    };
    options = {
      host,
      shell,
      hasConversation: () => true,
      showCard: (card) => cards.push(card),
      onConnected: vi.fn(async () => {}),
      isConnected: (id) => connected.has(id),
      hasProviders: () => connected.size > 0,
      featuresOf: () => ["대화", "말하기"],
      onUseAuto: vi.fn(),
    };
  });

  const $ = (selector) => document.querySelector(selector);
  const line = () => $(".guide-say").textContent;
  const marks = () => host.guideEval.mock.calls.map(([script]) => script).filter((script) => script.includes("crema-guide-ring"));
  const begin = async (id) => {
    const guide = createGuide(options);
    const started = guide.start(id);
    await vi.advanceTimersByTimeAsync(20);
    await started;
    return guide;
  };

  it("leads a key from the site into Crema: the step, the control, the found key lit, then the check", async () => {
    options.onConnected = vi.fn(async () => connected.add("gemini"));
    options.onGuided = vi.fn();
    const guide = await begin("gemini");
    expect(host.guideOpen).toHaveBeenCalledWith("https://aistudio.google.com/apikey", expect.any(Object));
    expect(shell.classList.contains("guiding")).toBe(true);
    expect($(".guide-view").hidden).toBe(false);

    await vi.advanceTimersByTimeAsync(1600);
    expect(host.guideStep).toHaveBeenCalledWith(
      expect.objectContaining({ url: "https://aistudio.google.com/apikey", elements: { e0: "button: Get API key" } }),
    );
    expect($("[data-guide-title]").textContent).toBe("Gemini 연결 · 2/4");
    expect($(".guide-task").textContent).toBe("API 키를 만드세요");
    expect(line()).toBe("‘Get API key’ 버튼을 누르세요.");
    expect(marks().at(-1)).toContain('data-crema-e="e0"');
    // From the last step on the site, a key can be pasted in too.
    expect($("[data-guide-put]").hidden).toBe(false);

    // Unchanged page: no new judgment.
    await vi.advanceTimersByTimeAsync(1600);
    expect(host.guideStep).toHaveBeenCalledTimes(1);

    // Peeking at the earlier chat puts the page away; returning brings it back.
    $("[data-guide-earlier]").click();
    expect(shell.classList.contains("guide-peek")).toBe(true);
    expect(host.guideVisible).toHaveBeenLastCalledWith(false);
    $("[data-guide-earlier]").click();
    expect(host.guideVisible).toHaveBeenLastCalledWith(true);

    // Settings over the chat: the page steps aside meanwhile.
    guide.setCovered(true);
    expect(host.guideVisible).toHaveBeenLastCalledWith(false);
    guide.setCovered(false);

    page = { ...page, key: KEY };
    await vi.advanceTimersByTimeAsync(1600);
    expect(line()).toBe("찾았어요 · AIza••••BBB");
    expect($(".guide-task").textContent).toBe("Crema에 넣으세요");
    expect($(".guide-block").classList.contains("found")).toBe(true);
    expect(marks().at(-1)).toContain('data-crema-e="key"');
    expect($(".spotlight").textContent).toBe("누르면 Crema에 들어가요");

    $("[data-guide-put-button]").click();
    await vi.advanceTimersByTimeAsync(10);
    expect(host.hermesAdmin).toHaveBeenCalledWith("POST", "/api/providers/validate", { key: "GEMINI_API_KEY", value: KEY });
    expect(host.hermesAdmin).toHaveBeenCalledWith("PUT", "/api/env", { key: "GEMINI_API_KEY", value: KEY });
    expect(options.onConnected).toHaveBeenCalled();
    expect(host.guideClose).toHaveBeenCalled();
    expect(shell.classList.contains("guiding")).toBe(false);
    expect($(".spotlight")).toBeNull();
    expect(cards[0].textContent).toContain("✓ Gemini 연결 완료 · 켜진 기능: 대화 · 말하기");
    // A confirmed connection counts toward the free plan's one guided connection.
    expect(options.onGuided).toHaveBeenCalledTimes(1);
    cards[0].querySelector("button").click();
    expect(options.onUseAuto).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("takes a pasted key of the right shape by itself, and says so when the check does not find it", async () => {
    options.onGuided = vi.fn();
    await begin("groq");
    page = { url: "https://console.groq.com/keys", title: "API Keys", elements: { e0: "button: Create API Key" }, errors: [], key: "" };
    await vi.advanceTimersByTimeAsync(1600);
    const key = "gsk_" + "a".repeat(52);
    const input = $("[data-guide-value]");
    input.value = key;
    input.dispatchEvent(new Event("input"));
    await vi.advanceTimersByTimeAsync(10);
    // Groq is not an engine Provider: its key and endpoint, the default when nothing else is connected.
    expect(host.hermesAdmin).toHaveBeenCalledWith("PUT", "/api/env", { key: "GROQ_API_KEY", value: key });
    expect(host.hermesAdmin).toHaveBeenCalledWith("PUT", "/api/config", {
      config: {
        providers: { groq: expect.objectContaining({ base_url: "https://api.groq.com/openai/v1", key_env: "GROQ_API_KEY" }) },
        model: { provider: "groq", default: "openai/gpt-oss-120b" },
      },
    });
    expect(cards[0].textContent).toContain("확인하지 못했어요");
    expect(options.onGuided).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("on a sign-in with no one control to name, asks the user to pick how to sign in", async () => {
    host.guideStep = vi.fn(async () => ({ target: null, confidence: 0.4, consent: 0, blocked: 0 }));
    await begin("openrouter");
    page = { url: "https://openrouter.ai/workspace-redirect/keys", title: "OpenRouter", elements: { e0: "input: Enter your email address" }, errors: [], key: "" };
    await vi.advanceTimersByTimeAsync(1600);
    expect($(".guide-task").textContent).toBe("OpenRouter에 로그인하세요");
    expect(line()).toBe("아래 화면에서 로그인 방법을 골라 진행해 주세요.");
    vi.useRealTimers();
  });

  it("connects Brave for web search: its key into the engine, checked there, and says web search is on", async () => {
    let set = false;
    host.hermesAdmin = vi.fn(async (method, path) => {
      if (path === "/api/env" && method === "GET") return { BRAVE_SEARCH_API_KEY: { is_set: set } };
      if (path === "/api/env" && method === "PUT") set = true;
      return { ok: true, reachable: false };
    });
    await begin("brave");
    expect(host.guideOpen).toHaveBeenCalledWith("https://api-dashboard.search.brave.com/app/keys", expect.any(Object));
    const key = "BSA" + "x".repeat(27);
    page = { url: "https://api-dashboard.search.brave.com/app/keys", title: "API Keys", elements: {}, errors: [], key };
    await vi.advanceTimersByTimeAsync(1600);
    $("[data-guide-put-button]").click();
    await vi.advanceTimersByTimeAsync(10);
    expect(host.hermesAdmin).toHaveBeenCalledWith("PUT", "/api/env", { key: "BRAVE_SEARCH_API_KEY", value: key });
    expect(cards[0].textContent).toContain("✓ Brave 검색 연결 완료 · 켜진 기능: 웹 검색");
    expect(cards[0].querySelector("button")).toBeNull();
    vi.useRealTimers();
  });

  it("on the free plan after its one guided connection, says so instead of opening the page", async () => {
    options.mayGuide = () => false;
    await begin("gemini");
    expect(host.guideOpen).not.toHaveBeenCalled();
    expect(cards.at(-1).textContent).toContain("무료 플랜에서는 AI 설정 안내를 한 번만");
    expect(shell.classList.contains("guiding")).toBe(false);
  });

  it("keeps a refused key off and asks for a new one", async () => {
    host.hermesAdmin = vi.fn(async () => ({ ok: false, reachable: true }));
    await begin("gemini");
    page = { ...page, key: KEY };
    await vi.advanceTimersByTimeAsync(1600);
    $("[data-guide-put-button]").click();
    await vi.advanceTimersByTimeAsync(10);
    expect(line()).toBe("이 키를 쓸 수 없다고 해요. 화면에서 새 키를 만들어 주세요.");
    expect(host.hermesAdmin).not.toHaveBeenCalledWith("PUT", "/api/env", expect.anything());
    expect(shell.classList.contains("guiding")).toBe(true);
    vi.useRealTimers();
  });

  it("signs in to ChatGPT with the code Crema shows, lit until copied, and waits for approval", async () => {
    connected.add("openai-codex");
    let status = "pending";
    host.hermesAdmin = vi.fn(async (method, path) => {
      if (path.endsWith("/start")) return { session_id: "s1", user_code: "ABCD-1234", verification_url: "https://auth.openai.com/codex/device", poll_interval: 2 };
      if (path.includes("/poll/")) return { status };
      return {};
    });
    navigator.clipboard = { writeText: vi.fn(async () => {}) };
    await begin("openai-codex");
    expect(host.hermesAdmin).toHaveBeenCalledWith("POST", "/api/providers/oauth/openai-codex/start");
    expect(host.guideOpen).toHaveBeenCalledWith("https://auth.openai.com/codex/device", expect.any(Object));
    expect($("[data-guide-code-value]").textContent).toBe("ABCD-1234");
    expect($("[data-guide-put]").hidden).toBe(true);

    page = { url: "https://auth.openai.com/codex/device", title: "Device", elements: { e0: "input: Code" }, errors: [], key: "" };
    await vi.advanceTimersByTimeAsync(1600);
    expect($("[data-guide-title]").textContent).toBe("ChatGPT 구독 연결 · 2/3");
    expect($(".spotlight").textContent).toBe("이 코드를 복사해 화면의 칸에 넣으세요");
    expect(marks().at(-1)).toContain("여기에 입력");
    $("[data-guide-copy]").click();
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("ABCD-1234");
    expect($(".spotlight")).toBeNull();

    status = "approved";
    await vi.advanceTimersByTimeAsync(2100);
    expect(cards[0].textContent).toContain("✓ ChatGPT 구독 연결 완료");
    // Not a free AI: no switch to 자동 (무료 AI).
    expect(cards[0].querySelector("button")).toBeNull();
    vi.useRealTimers();
  });

  it("brings Claude's code into Crema: found on its page, or pasted into the lit field, and starts over on a refusal", async () => {
    connected.add("anthropic");
    let refuse = true;
    host.hermesAdmin = vi.fn(async (method, path) => {
      if (path.endsWith("/start")) return { session_id: "s1", auth_url: "https://claude.ai/oauth/authorize?code=true&state=st4te-_x" };
      if (path.endsWith("/submit") && refuse) throw new Error("refused");
      return {};
    });
    await begin("anthropic");
    // The code page, its code not read: the field is lit for pasting.
    page = { url: "https://platform.claude.com/oauth/code/callback", title: "Code", elements: {}, errors: [], key: "" };
    await vi.advanceTimersByTimeAsync(1600);
    expect($(".guide-task").textContent).toBe("Crema에 넣으세요");
    expect($(".spotlight").textContent).toBe("여기에 붙여넣으세요");
    const input = $("[data-guide-value]");
    input.value = "abc123XYZ_-#st4te-_x";
    input.dispatchEvent(new Event("input"));
    await vi.advanceTimersByTimeAsync(10);
    expect(host.hermesAdmin).toHaveBeenCalledWith("POST", "/api/providers/oauth/anthropic/submit", { session_id: "s1", code: "abc123XYZ_-#st4te-_x" });
    expect(line()).toContain("처음부터 다시 열게요");
    await vi.advanceTimersByTimeAsync(1300);
    expect(host.hermesAdmin.mock.calls.filter(([, path]) => path.endsWith("/start"))).toHaveLength(2);

    // Found on the page this time: one press.
    refuse = false;
    page = { ...page, key: "abc123XYZ_-#st4te-_x" };
    await vi.advanceTimersByTimeAsync(1600);
    $("[data-guide-put-button]").click();
    await vi.advanceTimersByTimeAsync(10);
    expect(cards[0].textContent).toContain("✓ Claude 구독 연결 완료");
    vi.useRealTimers();
  });

  it("says plainly what stops the user, quoting the page, and takes a wandering page back to the start", async () => {
    await begin("gemini");
    page = { ...page, url: "https://accounts.google.com/v3/signin/challenge", errors: ["Wrong code for me@example.com"] };
    await vi.advanceTimersByTimeAsync(1600);
    $("[data-guide-stuck]").click();
    await vi.advanceTimersByTimeAsync(10);
    expect(host.guideHelp).toHaveBeenCalledWith(
      expect.objectContaining({ step: "구글 계정으로 로그인하세요", url: "https://accounts.google.com/v3/signin/challenge", errors: ["Wrong code for [이메일]"] }),
    );
    expect($("[data-guide-help]").textContent).toBe("화면에 나온 말: “Wrong code for [이메일]” · 휴대폰이나 이메일로 받은 인증 코드를 기다리는 화면이에요. 받은 코드를 직접 넣어 주세요.");

    host.guideHelp = vi.fn(async () => ({ cause: "wrong_page" }));
    host.guideOpen.mockClear();
    $("[data-guide-stuck]").click();
    await vi.advanceTimersByTimeAsync(10);
    expect(host.guideOpen).toHaveBeenCalledWith("https://aistudio.google.com/apikey", expect.any(Object));
    vi.useRealTimers();
  });
});
