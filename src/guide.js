import { freeProviders } from "./providers.js";

// The sign-up guide: a free AI's sign-up site beside the chat. Whenever the page changes, its visible
// controls go (masked) to crema-agent.site, whose Jev picks the one to use next; the page marks it and
// a card in the chat says what to do, with a capture of the page. The user does every click and entry.
// A key that appears on the page is offered for saving; it stays on this PC.

const POLL_MS = 1500;
const CONTROLS =
  "a[href], button, input:not([type=hidden]), select, textarea, [role=button], [role=link], [role=checkbox], [role=tab], [role=menuitem], [role=option]";
const MAX_CONTROLS = 120;
const MARK_ID = "crema-guide-mark";

/**
 * Script run in the page: tags its visible labelled controls data-crema-id="eN" and returns
 * { url, title, elements: { eN: "role: label" }, key } — `key` is the first text matching the
 * Provider's key pattern (never read from a password field).
 */
export function collectScript(keyPattern) {
  return `(() => {
  for (const node of document.querySelectorAll("[data-crema-id]")) node.removeAttribute("data-crema-id");
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
    const label = (node.getAttribute("aria-label") || (node.innerText ?? node.textContent) || node.getAttribute("placeholder") || node.getAttribute("title")
      || (["button", "submit"].includes(type) ? node.value : "") || "").replace(/\\s+/g, " ").trim().slice(0, 80);
    if (!label) continue;
    const id = "e" + count++;
    node.setAttribute("data-crema-id", id);
    elements[id] = role + ": " + label;
    if (count >= ${MAX_CONTROLS}) break;
  }
  const shown = [...document.querySelectorAll("input:not([type=password]), textarea, code, pre")].map((node) => node.value || node.textContent || "");
  const found = [document.body ? document.body.innerText : "", ...shown].join("\\n").match(new RegExp(${JSON.stringify(keyPattern)}));
  return { url: location.href, title: document.title, elements, key: found ? found[0] : "" };
})()`;
}

/** Script run in the page: a red frame over control `id` (none clears it), scrolled into view when `scroll`. */
export function markScript(id, scroll) {
  return `(() => {
  document.getElementById(${JSON.stringify(MARK_ID)})?.remove();
  const id = ${JSON.stringify(id || "")};
  const node = id && document.querySelector("[data-crema-id=" + CSS.escape(id) + "]");
  if (!node) return false;
  if (${Boolean(scroll)}) node.scrollIntoView({ block: "center", inline: "nearest" });
  const box = node.getBoundingClientRect();
  const mark = document.createElement("div");
  mark.id = ${JSON.stringify(MARK_ID)};
  mark.style.cssText = "position:fixed;pointer-events:none;z-index:2147483647;border:3px solid #e5484d;border-radius:8px;box-shadow:0 0 0 4px rgba(229,72,77,.25);"
    + "left:" + (box.left - 5) + "px;top:" + (box.top - 5) + "px;width:" + (box.width + 10) + "px;height:" + (box.height + 10) + "px";
  document.documentElement.appendChild(mark);
  return true;
})()`;
}

/** A control's label as sent to the site: e-mail addresses, long numbers and key-like text hidden. */
export function maskLabel(label, keyPattern) {
  return label
    .replace(new RegExp(keyPattern, "g"), "[키]")
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "[이메일]")
    .replace(/\d[\d\s-]{3,}\d/g, "[숫자]");
}

const NOUNS = { button: "버튼을", link: "링크를", tab: "탭을", menuitem: "메뉴를", option: "항목을" };

/**
 * What the card says for a step ({ target, confidence, consent, blocked }) on the target's "role: label".
 * A marked control comes first; without one, a consent or a check only the user can handle is said.
 */
export function stepText(step, element) {
  if (!step.target || !element) {
    if (step.blocked >= 0.5) return "이 화면은 직접 처리해 주세요(인증 코드·오류 확인 등). 끝나면 이어서 안내할게요.";
    if (step.consent >= 0.5) return "동의를 묻는 창이에요. 내용을 보고 직접 정해 주세요. 그다음 누를 곳을 표시할게요.";
    return "화면이 바뀌기를 기다리고 있어요. 필요한 곳이 보이면 표시할게요.";
  }
  const [role, ...rest] = element.split(": ");
  const label = `‘${rest.join(": ")}’`;
  const action =
    role === "input" ? `${label} 칸에 필요한 내용을 입력하세요.`
    : role === "checkbox" ? `${label}을(를) 체크하세요.`
    : role === "select" ? `${label}에서 알맞은 것을 고르세요.`
    : `${label} ${NOUNS[role] || "버튼을"} 누르세요.`;
  const consent = step.consent >= 0.5 ? "약관·동의 화면이에요. 내용을 확인하고 동의하시면 " : "";
  const unsure = step.confidence < 0.5 ? " 확실하지 않으니 표시된 곳이 맞는지 한 번 확인해 주세요." : "";
  return `${consent}오른쪽 화면에 빨간 테두리로 표시한 ${action}${unsure}`;
}

/**
 * The guide beside the chat. `shell` holds the site pane; `showCard(element)` puts a card in the chat;
 * `onConnected()` runs once a found key is saved.
 */
export function createGuide({ host, shell, showCard, onConnected }) {
  const pane = document.createElement("aside");
  pane.className = "guide-pane";
  pane.hidden = true;
  pane.innerHTML = `
    <div class="guide-pane-head"><span data-guide-title></span><button class="text-button" type="button" data-guide-close>안내 닫기</button></div>
    <div class="guide-frame" data-guide-frame></div>`;
  shell.append(pane);
  const frame = pane.querySelector("[data-guide-frame]");
  const rect = () => {
    const box = frame.getBoundingClientRect();
    return { x: box.left, y: box.top, width: box.width, height: box.height };
  };
  const resized = new ResizeObserver(() => active && host.guideBounds(rect()));

  let active = null; // { provider, signup, card, timer, lastSig, step, offered, busy, image }

  function card(title) {
    const element = document.createElement("section");
    element.className = "notice-card guide-card";
    element.setAttribute("role", "status");
    element.innerHTML = `
      <div class="notice-title"></div>
      <p data-guide-text></p>
      <img data-guide-shot alt="안내한 곳을 표시한 화면" hidden />
      <div class="guide-actions" data-guide-actions></div>`;
    element.querySelector(".notice-title").textContent = title;
    return element;
  }

  function say(text, actions = []) {
    const element = active?.card;
    if (!element) return;
    element.querySelector("[data-guide-text]").textContent = text;
    const row = element.querySelector("[data-guide-actions]");
    row.replaceChildren(
      ...actions.map(([label, run, primary]) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = primary ? "primary-button" : "secondary-button";
        button.textContent = label;
        button.addEventListener("click", run);
        return button;
      }),
    );
  }

  const baseActions = () => [
    ["다시 보기", () => active && (active.lastSig = null)],
    ["안내 닫기", () => stop("안내를 닫았어요.")],
  ];

  async function show(step) {
    const shot = active.card.querySelector("[data-guide-shot]");
    try {
      const png = await host.guideCapture();
      if (active?.image) URL.revokeObjectURL(active.image);
      active.image = URL.createObjectURL(new Blob([png], { type: "image/png" }));
      shot.src = active.image;
      shot.hidden = false;
    } catch {
      shot.hidden = true;
    }
  }

  async function saveKey(key) {
    const { env } = active.signup;
    say("키를 확인하고 있어요…");
    try {
      const check = await host.hermesAdmin("POST", "/api/providers/validate", { key: env, value: key });
      if (!check.ok && check.reachable) {
        say("Provider가 이 키를 받아들이지 않았어요. 다시 만들어 보거나 화면을 확인해 주세요.", baseActions());
        return;
      }
      await host.hermesAdmin("PUT", "/api/env", { key: env, value: key });
      await onConnected();
      stop(`${active.name} 연결을 마쳤어요. 이제 모델 목록과 "자동 (무료 AI)"에서 쓸 수 있어요.`);
    } catch (error) {
      say(error?.userMessage || "키를 저장하지 못했어요.", baseActions());
    }
  }

  async function tick() {
    if (!active || active.busy) return;
    active.busy = true;
    const current = active;
    try {
      const { signup } = current;
      const page = await host.guideEval(collectScript(signup.key_pattern));
      if (active !== current) return;
      if (page.key && page.key !== current.offered) {
        current.offered = page.key;
        await host.guideEval(markScript(null, false));
        say(`키가 보여요: ${page.key.slice(0, 4)}••••${page.key.slice(-3)}. 이 PC의 Crema에 저장할까요? Crema 서버로는 보내지 않아요.`, [
          ["저장", () => saveKey(page.key), true],
          ...baseActions(),
        ]);
        return;
      }
      if (current.offered) return;
      const labels = Object.fromEntries(Object.entries(page.elements).map(([id, label]) => [id, maskLabel(label, signup.key_pattern)]));
      const url = page.url.split(/[?#]/)[0];
      const sig = `${url}|${Object.values(labels).join("|")}`;
      if (sig === current.lastSig) {
        if (current.step?.target) await host.guideEval(markScript(current.step.target, false));
        return;
      }
      current.lastSig = sig;
      say("화면을 살펴보고 있어요…", baseActions());
      let step = null;
      try {
        step = await host.guideStep({ goal: signup.goal, url, title: page.title, elements: labels });
      } catch {
        say("안내를 불러오지 못했어요. Crema 로그인과 인터넷 연결을 확인해 주세요. 오른쪽 화면은 그대로 쓸 수 있어요.", baseActions());
        return;
      }
      if (active !== current) return;
      current.step = step;
      await host.guideEval(markScript(step.target, true));
      say(stepText(step, labels[step.target]), baseActions());
      await show(step);
    } catch {
      // A page still loading cannot be read yet; the next tick tries again.
    } finally {
      current.busy = false;
    }
  }

  function stop(text) {
    if (!active) return;
    const { timer, image } = active;
    say(text);
    active.card.querySelector("[data-guide-shot]").hidden = true;
    clearInterval(timer);
    if (image) URL.revokeObjectURL(image);
    active = null;
    resized.disconnect();
    pane.hidden = true;
    shell.classList.remove("guide-open");
    host.guideClose();
  }

  async function start(providerId) {
    const provider = freeProviders().find((item) => item.id === providerId);
    if (!provider?.signup) return;
    if (active) {
      stop("다른 안내를 시작해서 이 안내를 닫았어요.");
      // The old page must be gone before the new one opens under the same webview.
      await host.guideClose();
    }
    active = { name: provider.name, signup: provider.signup, card: card(`${provider.name} 연결`), lastSig: null, step: null, offered: "", busy: false };
    showCard(active.card);
    say("오른쪽에 가입 화면을 여는 중이에요. 클릭과 입력은 직접 하시고, 어디를 누를지는 제가 표시할게요.", baseActions());
    pane.querySelector("[data-guide-title]").textContent = `${provider.name} 가입`;
    pane.hidden = false;
    shell.classList.add("guide-open");
    await new Promise((resolve) => requestAnimationFrame(resolve));
    try {
      await host.guideOpen(provider.signup.url, rect());
    } catch (error) {
      stop(error?.userMessage || "가입 화면을 열지 못했어요.");
      return;
    }
    resized.observe(frame);
    active.timer = setInterval(tick, POLL_MS);
  }

  pane.querySelector("[data-guide-close]").addEventListener("click", () => stop("안내를 닫았어요."));
  return { start, stop: () => stop("안내를 닫았어요.") };
}
