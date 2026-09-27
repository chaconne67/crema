import { endpointMethod, freeProviders, saveProviderKey } from "./providers.js";

// The AI setup guide: while it runs, the chat becomes one block — the step it is on ("2/4"), what to do
// there, and the site's live page right under it (a second webview laid over the block's frame). Whenever
// the page changes, its visible labelled controls go (masked) to crema-agent.site, whose Jev picks the one
// to use next; the line names it and a ring on the page points at it. The user does every click and entry
// on the site. A key or code the page shows is offered for Crema with one press, the Crema control to use
// is lit while the rest dims, and the connection is checked before the guide says it is done.

const POLL_MS = 1500;
const CONTROLS =
  "a[href], button, input:not([type=hidden]), select, textarea, [role=button], [role=link], [role=checkbox], [role=tab], [role=menuitem], [role=option]";
const MAX_CONTROLS = 120;
const MAX_ERRORS = 5;
// Icons inside a control, whose own names (a Material Symbols "key") are not what it says.
const ICONS = "[aria-hidden=true], [class*=material-icons], [class*=material-symbols], mat-icon, svg";

// A sign-in page on the way: Google's, or a site's own log-in / sign-up address.
const SIGN_IN = "accounts\\.google\\.com|/(log-?in|sign-?in|sign-?up|authenticate)\\b";
// A sign-in shown in place, the address unchanged (Groq, OpenRouter): its fields or buttons say so.
const SIGN_IN_CONTROL = /^input: .*(password|비밀번호|e-?mail|이메일)|^\w+: (continue with google|sign in with google|google(으)?로 계속하기|log ?in|sign ?in|로그인)$/i;

/**
 * Every connection the guide leads, keyed by the engine channel it connects. `kind`: "key" (an API key the
 * page shows is saved), "device" (a code Crema shows is entered on the page), "paste" (a code the page shows
 * is handed to Crema). `steps`: [what to do, page address it applies to] — the step is the first whose
 * address matches the page, else the one before stays; bringing the value into Crema and the check after
 * it follow on their own. `goal` is what Jev aims each page at; `sample` says what the value looks like.
 */
export const GUIDES = {
  gemini: {
    name: "Gemini", free: true, kind: "key", env: "GEMINI_API_KEY",
    url: "https://aistudio.google.com/apikey", keyPattern: "AIza[0-9A-Za-z_-]{35}", sample: "AIza로 시작하는 긴 글자",
    goal: "Get a Gemini API key in Google AI Studio: sign in with a Google account if asked, accept the terms if asked, open API keys, press Create API key, choose or create a project if asked, then show the new key.",
    steps: [["구글 계정으로 로그인하세요", SIGN_IN], ["API 키를 만드세요", "aistudio\\.google\\.com"]],
  },
  groq: {
    name: "Groq", free: true, kind: "key",
    url: "https://console.groq.com/keys", keyPattern: "gsk_[0-9A-Za-z]{52}", sample: "gsk_로 시작하는 긴 글자",
    goal: "Get a Groq API key in GroqCloud: sign in or sign up if asked (signing in with Google is fine), accept the terms if asked, open API Keys, press Create API Key, give it any name, submit, then show the new key.",
    steps: [["Groq에 로그인하세요", SIGN_IN], ["API 키를 만드세요", "console\\.groq\\.com"]],
  },
  openrouter: {
    name: "OpenRouter", free: true, kind: "key", env: "OPENROUTER_API_KEY",
    url: "https://openrouter.ai/settings/keys", keyPattern: "sk-or-v1-[0-9a-f]{64}", sample: "sk-or-v1-로 시작하는 긴 글자",
    goal: "Get an OpenRouter API key: sign in or sign up if asked (signing in with Google is fine), open Keys in the settings, press Create API Key, give it any name, create it, then show the new key.",
    steps: [["OpenRouter에 로그인하세요", SIGN_IN], ["API 키를 만드세요", "openrouter\\.ai"]],
  },
  "openai-codex": {
    name: "ChatGPT 구독", kind: "device",
    goal: "Sign in to the ChatGPT (OpenAI) account if asked, enter the one-time device code that Crema shows into the code field, continue, and approve the access.",
    steps: [["ChatGPT에 로그인하세요", SIGN_IN], ["코드를 넣고 승인하세요", "auth\\.openai\\.com"]],
  },
  anthropic: {
    name: "Claude 구독", kind: "paste", sample: "가운데에 #이 있는 긴 코드",
    goal: "Sign in to the Claude account if asked, approve the access with Authorize, then show the authorization code to copy.",
    steps: [["Claude에 로그인하세요", SIGN_IN], ["접근을 승인하세요", "claude\\.ai"]],
    // The page with the code to bring into Crema.
    pasteAt: "(console\\.anthropic\\.com|platform\\.claude\\.com)/oauth/code",
  },
  // A tool's key, not an AI model's: web search. `feature` is what it turns on.
  brave: {
    name: "Brave 검색", kind: "key", tool: true, feature: "웹 검색", env: "BRAVE_SEARCH_API_KEY",
    url: "https://api-dashboard.search.brave.com/app/keys", keyPattern: "BSA[0-9A-Za-z_-]{20,}", sample: "BSA로 시작하는 글자",
    goal: "Get a Brave Search API key: sign in or sign up if asked, subscribe to the free plan if asked, open API Keys, press Add API Key, give it any name, then show the new key.",
    steps: [["Brave에 로그인하세요", SIGN_IN], ["API 키를 만드세요", "search\\.brave\\.com"]],
  },
};

/** The steps shown as "n/N": the guide's own, then bringing the value into Crema (not for a device code), then the check. */
function stepTitles(guide) {
  return [...guide.steps.map(([title]) => title), ...(guide.kind === "device" ? [] : ["Crema에 넣으세요"]), "연결을 확인하고 있어요"];
}

/**
 * The step a page belongs to: the first whose address matches, else `current`. A sign-in shown on the
 * page (`labels` as collected) is the sign-in step whatever the address.
 */
export function stepAt(guide, url, current, labels = []) {
  if (guide.steps[0][1] === SIGN_IN && labels.some((label) => SIGN_IN_CONTROL.test(label))) return 0;
  const found = guide.steps.findIndex(([, at]) => new RegExp(at).test(url));
  return found < 0 ? current : found;
}

/**
 * Script run in the page: its visible labelled controls as { url, title, elements: { eN: "role: label" },
 * errors, key }. Each listed control is tagged `data-crema-e="eN"` for markScript; `key` is the first text
 * matching `keyPattern` (never read from a password field) and its holder is tagged "key".
 */
export function collectScript(keyPattern) {
  return `(() => {
  for (const old of document.querySelectorAll("[data-crema-e]")) old.removeAttribute("data-crema-e");
  const elements = {};
  let count = 0;
  for (const node of document.querySelectorAll(${JSON.stringify(CONTROLS)})) {
    const box = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    if (box.width < 2 || box.height < 2 || style.visibility === "hidden" || style.display === "none") continue;
    const tag = node.tagName.toLowerCase();
    const type = (node.getAttribute("type") || "").toLowerCase();
    const role = node.getAttribute("role") || (tag === "a" ? "link" : tag === "select" ? "select" : tag === "textarea" ? "input"
      : tag === "input" ? (type === "checkbox" || type === "radio" ? "checkbox" : ["button", "submit"].includes(type) ? "button" : "input") : "button");
    // An icon's own name ("key" in a Material Symbols span) is not part of what the control says.
    let text = node.innerText ?? node.textContent;
    if (node.querySelector(${JSON.stringify(ICONS)})) {
      const copy = node.cloneNode(true);
      copy.querySelectorAll(${JSON.stringify(ICONS)}).forEach((icon) => icon.remove());
      text = copy.textContent;
    }
    const label = (node.getAttribute("aria-label") || text || node.getAttribute("placeholder") || node.getAttribute("title")
      || (["button", "submit"].includes(type) ? node.value : "") || "").replace(/\\s+/g, " ").trim().slice(0, 80);
    if (!label) continue;
    node.setAttribute("data-crema-e", "e" + count);
    elements["e" + count++] = role + ": " + label;
    if (count >= ${MAX_CONTROLS}) break;
  }
  const errors = [...document.querySelectorAll("[role=alert], [aria-live=assertive], [class*=error], [class*=Error]")]
    .map((node) => (node.innerText ?? node.textContent ?? "").replace(/\\s+/g, " ").trim().slice(0, 200))
    .filter((text, index, all) => text && all.indexOf(text) === index)
    .slice(0, ${MAX_ERRORS});
  let key = "";${keyPattern ? `
  const pattern = new RegExp(${JSON.stringify(keyPattern)});
  const holder = [...document.querySelectorAll("input:not([type=password]), textarea, code, pre")].find((node) => pattern.test(node.value || node.textContent || ""));
  const found = (holder ? holder.value || holder.textContent : document.body ? document.body.innerText : "").match(pattern);
  if (found) {
    key = found[0];
    if (holder) holder.setAttribute("data-crema-e", "key");
  }` : ""}
  return { url: location.href, title: document.title, elements, errors, key };
})()`;
}

/**
 * Script run in the page: a ring with a short `note` around the control tagged `id` by collectScript,
 * following it as the page scrolls (scrolled into view first); none when `id` is empty. Only points.
 */
export function markScript(id, note = "") {
  return `(() => {
  let ring = document.getElementById("crema-guide-ring");
  if (!ring) {
    ring = document.createElement("div");
    ring.id = "crema-guide-ring";
    ring.style.cssText = "position:fixed;z-index:2147483647;pointer-events:none;border:3px solid #d99a55;border-radius:10px;box-shadow:0 0 0 5px rgba(217,154,85,.28);display:none";
    const tag = document.createElement("span");
    tag.style.cssText = "position:absolute;right:-3px;padding:3px 9px;border-radius:7px;background:#9a5527;color:#fff;font:700 13px/1.5 system-ui,sans-serif;white-space:nowrap";
    ring.append(tag);
    document.documentElement.append(ring);
  }
  ring.firstChild.textContent = ${JSON.stringify(note)};
  const target = ${id ? `document.querySelector('[data-crema-e="${id}"]')` : "null"};
  window.__cremaTarget = target;
  cancelAnimationFrame(window.__cremaFrame);
  if (target) {
    const box = target.getBoundingClientRect();
    if (box.top < 0 || box.bottom > innerHeight) target.scrollIntoView({ block: "center" });
  }
  const follow = () => {
    const node = window.__cremaTarget;
    const box = node && node.isConnected ? node.getBoundingClientRect() : null;
    if (!box || !box.width) {
      ring.style.display = "none";
      if (!node || !node.isConnected) return;
    } else {
      Object.assign(ring.style, { display: "block", left: box.left - 6 + "px", top: box.top - 6 + "px", width: box.width + 6 + "px", height: box.height + 6 + "px" });
      const below = box.top < 36;
      Object.assign(ring.firstChild.style, { top: below ? "calc(100% + 6px)" : "auto", bottom: below ? "auto" : "calc(100% + 6px)" });
    }
    window.__cremaFrame = requestAnimationFrame(follow);
  };
  follow();
  return true;
})()`;
}

/** A label or error as sent to the site: e-mail addresses, long numbers and key-like text hidden. */
export function maskLabel(label, keyPattern) {
  return (keyPattern ? label.replace(new RegExp(keyPattern, "g"), "[키]") : label)
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "[이메일]")
    .replace(/\d[\d\s-]{3,}\d/g, "[숫자]");
}

const NOUNS = { button: "버튼을", link: "링크를", tab: "탭을", menuitem: "메뉴를", option: "항목을" };

/**
 * The line for a step ({ target, confidence, consent, blocked }) on the target's "role: label".
 * A control to use comes first; without one, a consent or a check only the user can handle is said.
 */
export function stepText(step, element) {
  if (!step.target || !element) {
    if (step.blocked >= 0.5) return "이 화면은 직접 처리해 주세요(인증 코드·오류 확인 등). 끝나면 이어서 안내할게요.";
    if (step.consent >= 0.5) return "동의를 묻는 화면이에요. 내용을 보고 직접 정해 주세요.";
    return "화면이 바뀌기를 기다리고 있어요.";
  }
  const [role, ...rest] = element.split(": ");
  const label = `‘${rest.join(": ")}’`;
  const action =
    role === "input" ? `${label} 칸에 입력하세요.`
    : role === "checkbox" ? `${label}을(를) 체크하세요.`
    : role === "select" ? `${label}에서 알맞은 것을 고르세요.`
    : `${label} ${NOUNS[role] || "버튼을"} 누르세요.`;
  const consent = step.consent >= 0.5 ? "동의를 묻는 화면이에요. 내용을 확인하고 동의하시면 " : "";
  const unsure = step.confidence < 0.5 ? " 확실하지 않으니 화면을 한 번 확인해 주세요." : "";
  return `${consent}${action}${unsure}`;
}

// "막혔어요": what the site's Jev found stops the user (server/web/views.py HELP_CAUSES), said plainly.
export const HELP = {
  sign_in: "로그인이 필요하거나 로그인이 풀린 화면이에요. 아래 화면에서 계정으로 로그인해 주세요.",
  verification: "휴대폰이나 이메일로 받은 인증 코드를 기다리는 화면이에요. 받은 코드를 직접 넣어 주세요.",
  captcha: "사람인지 확인하는 화면이에요. 화면에 나온 대로 직접 풀어 주세요.",
  terms: "약관 동의가 남아 있어요. 내용을 보고 동의하시면 체크한 뒤 계속을 눌러 주세요.",
  account_type: "회사나 학교 계정은 막혀 있을 수 있어요. 개인 계정으로 로그인해 보세요.",
  region: "이 나라나 이 계정에서는 쓸 수 없다고 하는 화면이에요. 다른 계정이나 다른 AI를 골라 주세요.",
  payment: "결제나 유료 구독이 필요하다고 하는 화면이에요. 무료로 쓰려면 닫고 다른 AI를 골라 주세요.",
  limit: "만들 수 있는 개수나 사용 한도에 걸렸어요. 쓰지 않는 키를 지우거나 잠시 뒤에 다시 해 주세요.",
  site_error: "사이트에서 오류가 났어요. 잠시 뒤 다시 해 보거나, 닫고 처음부터 시작해 주세요.",
  wrong_page: "목표와 다른 화면에 와 있어요. 처음 화면으로 돌아갈게요.",
  loading: "화면이 아직 바뀌는 중이에요. 잠시만 기다려 주세요.",
  other: "화면만으로는 원인을 찾기 어려워요. 닫고 처음부터 다시 해 보세요.",
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Dims Crema around `target` and puts `note` beside it; clicks still reach it, and it takes the focus
 * when it is a field. Returns what takes the light away.
 */
function spotlight(target, note) {
  const light = document.createElement("div");
  light.className = "spotlight";
  light.innerHTML = '<span class="spotlight-note"></span>';
  light.firstChild.textContent = note;
  document.body.append(light);
  let frame = 0;
  const follow = () => {
    const box = target.getBoundingClientRect();
    Object.assign(light.style, { left: `${box.left - 6}px`, top: `${box.top - 6}px`, width: `${box.width + 12}px`, height: `${box.height + 12}px` });
    frame = requestAnimationFrame(follow);
  };
  target.scrollIntoView?.({ block: "nearest" });
  if (target.matches("input, textarea")) target.focus();
  follow();
  return () => {
    cancelAnimationFrame(frame);
    light.remove();
  };
}

/**
 * The guide in the chat. `shell` is the chat column (.app-shell); `hasConversation()` says whether there
 * is earlier chat to peek at; `showCard(element)` leaves a line in the chat when it ends; `onConnected()`
 * reloads the connected Providers; `isConnected(channel)` and `hasProviders()` read them; `featuresOf(channel)`
 * names what the channel turned on; `onUseAuto()` switches the chat to "자동 (무료 AI)".
 */
export function createGuide({
  host,
  shell,
  hasConversation = () => false,
  showCard,
  onConnected,
  isConnected = () => true,
  hasProviders = () => true,
  featuresOf = () => [],
  onUseAuto,
}) {
  const view = document.createElement("div");
  view.className = "guide-view";
  view.hidden = true;
  view.innerHTML = `
    <button class="guide-earlier" type="button" data-guide-earlier aria-expanded="false"></button>
    <section class="guide-block" aria-labelledby="guide-task">
      <div class="guide-bar">
        <div class="guide-top">
          <span data-guide-title></span>
          <span class="guide-actions">
            <button type="button" data-guide-stuck>막혔어요</button>
            <button type="button" data-guide-close>닫기</button>
          </span>
        </div>
        <p class="guide-task" id="guide-task"></p>
        <p class="guide-say" role="status" aria-live="polite"></p>
        <p class="guide-help" data-guide-help role="status" hidden></p>
        <div class="guide-code" data-guide-code hidden>
          <span class="guide-code-value" data-guide-code-value></span>
          <button class="secondary-button" type="button" data-guide-copy>복사</button>
        </div>
        <div class="guide-put" data-guide-put hidden>
          <input type="password" data-guide-value autocomplete="off" spellcheck="false" aria-label="Crema에 넣을 값" />
          <button class="primary-button" type="button" data-guide-put-button>Crema에 넣기</button>
          <span class="guide-save-note">이 PC에만 저장돼요 · Crema 서버로 보내지 않아요</span>
        </div>
      </div>
      <div class="guide-frame" data-guide-frame></div>
    </section>`;
  shell.querySelector(".app-bar").after(view);
  const $ = (selector) => view.querySelector(selector);
  const frame = $("[data-guide-frame]");
  const valueInput = $("[data-guide-value]");
  const rect = () => {
    const box = frame.getBoundingClientRect();
    return { x: box.left, y: box.top, width: box.width, height: box.height };
  };
  const resized = new ResizeObserver(() => active && !active.peek && host.guideBounds(rect()));

  // { id, guide, url, keyPattern, method, session, step, lastSig, offered, busy, peek, covered, timer, unlight, polling, page }
  let active = null;

  function say(text) {
    $(".guide-say").textContent = text;
  }

  function showHelp(text) {
    $("[data-guide-help]").textContent = text;
    $("[data-guide-help]").hidden = !text;
  }

  function light(target, note) {
    active.unlight?.();
    active.unlight = target ? spotlight(target, note) : null;
  }

  /** Moves to step `index` (of stepTitles): the "n/N", what to do, and the Crema field once it is near. */
  function setStep(index) {
    const titles = stepTitles(active.guide);
    active.step = index;
    $("[data-guide-title]").textContent = `${active.guide.name} 연결 · ${index + 1}/${titles.length}`;
    $(".guide-task").textContent = titles[index];
    // From the last step on the site, the value can be pasted in as well as found.
    $("[data-guide-put]").hidden = active.guide.kind === "device" || index < active.guide.steps.length - 1;
    valueInput.placeholder = active.guide.sample ? `${active.guide.sample}를 여기에 붙여넣어도 돼요` : "";
  }

  /** Shows the site only when the block is on screen and nothing of the app lies over it. */
  function place() {
    if (!active) return;
    const visible = !active.peek && !active.covered;
    shell.classList.toggle("guide-peek", active.peek);
    const earlier = $("[data-guide-earlier]");
    earlier.textContent = active.peek ? "안내로 돌아가기" : "이전 대화 보기";
    earlier.setAttribute("aria-expanded", String(active.peek));
    earlier.hidden = !hasConversation();
    host.guideVisible(visible);
    if (visible) requestAnimationFrame(() => active && host.guideBounds(rect()));
  }

  const mark = (id, note) => host.guideEval(markScript(id, note)).catch(() => {});

  /** A key or code found on the page: pointed at there, filled in here, and the one press it needs lit. */
  function offer(value) {
    setStep(active.guide.steps.length);
    $(".guide-block").classList.add("found");
    valueInput.value = value;
    say(`찾았어요 · ${value.slice(0, 4)}••••${value.slice(-3)}`);
    mark("key", "찾은 값");
    light($("[data-guide-put-button]"), "누르면 Crema에 들어가요");
  }

  async function put(value) {
    const current = active;
    if (!current || current.putting) return;
    current.putting = true;
    light(null);
    setStep(current.guide.steps.length);
    say("Crema에 넣고 있어요…");
    try {
      if (current.guide.kind === "paste") {
        await host.hermesAdmin("POST", `/api/providers/oauth/${current.id}/submit`, { session_id: current.session.session_id, code: value });
      } else {
        await saveProviderKey(host, current.method, value, !hasProviders());
      }
    } catch (error) {
      current.putting = false;
      $(".guide-block").classList.remove("found");
      valueInput.value = "";
      if (current.guide.kind === "paste") {
        // The engine forgets a login once its code is used or refused: a new one starts.
        say("코드가 받아들여지지 않았어요. 처음부터 다시 열게요.");
        await wait(1200);
        if (active === current) start(current.id);
        return;
      }
      say(error.reason === "refused" ? "이 키를 쓸 수 없다고 해요. 화면에서 새 키를 만들어 주세요." : error?.userMessage || "넣지 못했어요. 다시 눌러 주세요.");
      return;
    }
    await confirm(current);
  }

  /**
   * The last step: the Providers read again (each asked for its models) and this one found among them;
   * for a tool's key, the engine holding it.
   */
  async function confirm(current) {
    setStep(stepTitles(current.guide).length - 1);
    say("실제로 쓸 수 있는지 확인하고 있어요…");
    await onConnected().catch(() => {});
    if (active !== current) return;
    const { guide } = current;
    const connected = guide.tool
      ? await host.hermesAdmin("GET", "/api/env").then((env) => Boolean(env?.[guide.env]?.is_set), () => false)
      : isConnected(current.id);
    if (active !== current) return;
    stop();
    showCard(doneCard(current, connected));
  }

  function doneCard({ id, guide }, connected) {
    const card = document.createElement("section");
    card.className = "notice-card guide-done";
    card.setAttribute("role", "status");
    card.innerHTML = "<span></span>";
    const features = guide.tool ? [guide.feature] : featuresOf(id);
    card.firstChild.textContent = connected
      ? `✓ ${guide.name} 연결 완료${features.length ? ` · 켜진 기능: ${features.join(" · ")}` : ""}`
      : `${guide.name} 연결을 저장했지만 아직 쓸 수 있는지 확인하지 못했어요. 잠시 뒤 설정의 고급 > Provider에서 확인해 주세요.`;
    if (connected && guide.free) {
      const button = Object.assign(document.createElement("button"), { className: "secondary-button", type: "button", textContent: "자동 (무료 AI)로 쓰기" });
      button.addEventListener("click", onUseAuto);
      card.append(button);
    }
    return card;
  }

  async function tick() {
    if (!active || active.busy || active.peek || active.covered || active.putting) return;
    active.busy = true;
    const current = active;
    try {
      const { guide, keyPattern } = current;
      const page = await host.guideEval(collectScript(keyPattern));
      if (active !== current) return;
      current.page = page;
      if (page.key && page.key !== current.offered) {
        current.offered = page.key;
        showHelp("");
        offer(page.key);
        return;
      }
      if (current.offered) return;
      const labels = Object.fromEntries(Object.entries(page.elements).map(([id, label]) => [id, maskLabel(label, keyPattern)]));
      const url = page.url.split(/[?#]/)[0];
      const sig = `${url}|${Object.values(labels).join("|")}`;
      if (sig === current.lastSig) return;
      current.lastSig = sig;
      showHelp("");
      setStep(stepAt(guide, url, current.step, Object.values(labels)));
      if (guide.pasteAt && new RegExp(guide.pasteAt).test(url)) {
        // The page holds the code but it was not read: the user copies it into the lit field.
        setStep(guide.steps.length);
        say(`화면의 코드를 복사해 아래 칸에 붙여넣으세요(${guide.sample}).`);
        light(valueInput, "여기에 붙여넣으세요");
        return;
      }
      if (guide.kind === "device" && current.step === guide.steps.length - 1 && !current.copied) {
        light($("[data-guide-code]"), "이 코드를 복사해 화면의 칸에 넣으세요");
      }
      say("화면을 살펴보고 있어요…");
      let step;
      try {
        step = await host.guideStep({ goal: guide.goal, url, title: page.title, elements: labels });
      } catch {
        say("안내를 불러오지 못했어요. 인터넷 연결을 확인해 주세요. 아래 화면은 그대로 쓸 수 있어요.");
        return;
      }
      if (active !== current) return;
      const element = labels[step.target];
      // No one control to name on a sign-in: the user picks how to sign in.
      const signingIn = !element && step.blocked < 0.5 && step.consent < 0.5 && guide.steps[0][1] === SIGN_IN && current.step === 0;
      say(signingIn ? "아래 화면에서 로그인 방법을 골라 진행해 주세요." : stepText(step, element));
      mark(element ? step.target : "", element?.startsWith("input:") ? "여기에 입력" : "여기를 누르세요");
    } catch {
      // A page still loading cannot be read yet; the next tick tries again.
    } finally {
      current.busy = false;
    }
  }

  /** ChatGPT's sign-in: its page is told the code Crema shows, and the engine is asked until it is approved. */
  async function pollDevice(current) {
    const interval = Math.max(2, Number(current.session.poll_interval) || 5) * 1000;
    while (active === current) {
      await wait(interval);
      if (active !== current) return;
      let poll;
      try {
        poll = await host.hermesAdmin("GET", `/api/providers/oauth/${current.id}/poll/${current.session.session_id}`);
      } catch {
        continue;
      }
      if (active !== current) return;
      if (poll.status === "approved") return confirm(current);
      if (poll.status === "expired") {
        say("코드가 만료됐어요. 새 코드로 다시 열게요.");
        await wait(1200);
        if (active === current) start(current.id);
        return;
      }
      if (poll.status !== "pending") {
        say("로그인하지 못했어요. 닫고 처음부터 다시 해 주세요.");
        return;
      }
    }
  }

  async function stuck() {
    const current = active;
    if (!current) return;
    showHelp("화면을 살펴보고 있어요…");
    let page = current.page;
    try {
      page = await host.guideEval(collectScript(current.keyPattern));
    } catch {
      // The last read page stands in.
    }
    if (active !== current) return;
    const masked = (text) => maskLabel(text, current.keyPattern);
    const errors = (page?.errors || []).map(masked);
    const shown = errors.length ? `화면에 나온 말: “${errors[0]}” · ` : "";
    let cause = "other";
    try {
      ({ cause } = await host.guideHelp({
        goal: current.guide.goal,
        step: stepTitles(current.guide)[current.step],
        url: (page?.url || "").split(/[?#]/)[0],
        title: page?.title || "",
        elements: Object.fromEntries(Object.entries(page?.elements || {}).map(([id, label]) => [id, masked(label)])),
        errors,
      }));
    } catch {
      if (active === current) showHelp(`${shown}지금은 원인을 살펴보지 못했어요. 인터넷 연결을 확인해 주세요.`);
      return;
    }
    if (active !== current) return;
    showHelp(`${shown}${HELP[cause] || HELP.other}`);
    if (cause === "wrong_page") {
      current.lastSig = null;
      host.guideOpen(current.url, rect()).catch(() => {});
    }
  }

  function stop() {
    if (!active) return;
    clearInterval(active.timer);
    active.unlight?.();
    active = null;
    resized.disconnect();
    view.hidden = true;
    shell.classList.remove("guiding", "guide-peek");
    host.guideClose();
  }

  function fail(text) {
    stop();
    showCard(Object.assign(document.createElement("section"), { className: "notice-card", textContent: text }));
  }

  async function start(id) {
    const guide = GUIDES[id];
    if (!guide) return;
    if (active) {
      stop();
      // The old page must be gone before the new one opens under the same webview.
      await host.guideClose();
    }
    const current = { id, guide, step: 0, lastSig: null, offered: "", busy: false, peek: false, covered: false };
    active = current;
    $(".guide-block").classList.remove("found");
    valueInput.value = "";
    showHelp("");
    $("[data-guide-code]").hidden = true;
    setStep(0);
    say(`${guide.name} 화면을 여는 중이에요…`);
    view.hidden = false;
    shell.classList.add("guiding");
    $("[data-guide-earlier]").hidden = !hasConversation();
    $("[data-guide-earlier]").textContent = "이전 대화 보기";
    try {
      if (guide.kind === "key") {
        const free = freeProviders().find((item) => item.id === id);
        current.method = free?.endpoint ? endpointMethod(free) : { id, envVar: guide.env };
        Object.assign(current, { url: guide.url, keyPattern: guide.keyPattern });
      } else {
        current.session = await host.hermesAdmin("POST", `/api/providers/oauth/${id}/start`);
        if (active !== current) return;
        current.url = current.session.verification_url || current.session.auth_url;
        if (guide.kind === "paste") {
          // Claude's page shows `code#state`; the state is this login's own.
          current.keyPattern = `[A-Za-z0-9_-]{8,}#${escapeRegExp(new URL(current.url).searchParams.get("state") || "")}`;
        } else {
          $("[data-guide-code-value]").textContent = current.session.user_code;
          $("[data-guide-copy]").textContent = "복사";
          $("[data-guide-code]").hidden = false;
        }
      }
      await new Promise((resolve) => requestAnimationFrame(resolve));
      await host.guideOpen(current.url, rect());
    } catch (error) {
      if (active === current) fail(error?.userMessage || `${guide.name} 화면을 열지 못했어요.`);
      return;
    }
    if (active !== current) return;
    // The block is centred: a wider window (or the sidebar folding) moves it without resizing it.
    resized.observe(frame);
    resized.observe(shell);
    current.timer = setInterval(tick, POLL_MS);
    if (guide.kind === "device") pollDevice(current);
  }

  $("[data-guide-close]").addEventListener("click", stop);
  $("[data-guide-stuck]").addEventListener("click", stuck);
  $("[data-guide-earlier]").addEventListener("click", () => {
    if (!active) return;
    active.peek = !active.peek;
    place();
  });
  $("[data-guide-copy]").addEventListener("click", () => {
    if (!active?.session) return;
    navigator.clipboard?.writeText(active.session.user_code).catch(() => {});
    active.copied = true;
    $("[data-guide-copy]").textContent = "복사했어요";
    light(null);
  });
  $("[data-guide-put-button]").addEventListener("click", () => {
    const value = valueInput.value.trim();
    if (value) put(value);
    else if (active) light(valueInput, "여기에 붙여넣으세요");
  });
  // A pasted value that has the right shape goes in by itself.
  valueInput.addEventListener("input", () => {
    const value = valueInput.value.trim();
    if (active?.keyPattern && new RegExp(`^(${active.keyPattern})$`).test(value)) put(value);
  });

  return {
    start,
    stop,
    /** An app overlay (settings) opens or closes over the chat: the site steps aside meanwhile. */
    setCovered(covered) {
      if (!active) return;
      active.covered = covered;
      place();
    },
  };
}
