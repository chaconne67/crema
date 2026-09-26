import { freeProviders } from "./providers.js";

// The sign-up guide: while it runs, the chat becomes one block — a line saying what to do next, and the
// Provider's live sign-up page right under it (a second webview laid over the block's frame). Whenever
// the page changes, its visible labelled controls go (masked) to crema-agent.site, whose Jev picks the
// one to use next; the line names it. The user does every click and entry. A key that appears on the
// page is offered for saving; it stays on this PC.

const POLL_MS = 1500;
const CONTROLS =
  "a[href], button, input:not([type=hidden]), select, textarea, [role=button], [role=link], [role=checkbox], [role=tab], [role=menuitem], [role=option]";
const MAX_CONTROLS = 120;

/**
 * Script run in the page: its visible labelled controls as { url, title, elements: { eN: "role: label" },
 * key } — `key` is the first text matching the Provider's key pattern (never read from a password field).
 */
export function collectScript(keyPattern) {
  return `(() => {
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
    elements["e" + count++] = role + ": " + label;
    if (count >= ${MAX_CONTROLS}) break;
  }
  const shown = [...document.querySelectorAll("input:not([type=password]), textarea, code, pre")].map((node) => node.value || node.textContent || "");
  const found = [document.body ? document.body.innerText : "", ...shown].join("\\n").match(new RegExp(${JSON.stringify(keyPattern)}));
  return { url: location.href, title: document.title, elements, key: found ? found[0] : "" };
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

/**
 * The guide in the chat. `shell` is the chat column (.app-shell); `hasConversation()` says whether there
 * is earlier chat to peek at; `showCard(element)` leaves a line in the chat when a Provider is connected;
 * `onConnected()` runs after a found key is saved; `onUseAuto()` switches the chat to "자동 (무료 AI)".
 */
export function createGuide({ host, shell, hasConversation = () => false, showCard, onConnected, onUseAuto }) {
  const view = document.createElement("div");
  view.className = "guide-view";
  view.hidden = true;
  view.innerHTML = `
    <button class="guide-earlier" type="button" data-guide-earlier aria-expanded="false"></button>
    <section class="guide-block" aria-labelledby="guide-say">
      <div class="guide-bar">
        <div class="guide-top">
          <span data-guide-title></span>
          <span class="guide-actions">
            <button type="button" data-guide-retry>다른 화면이에요</button>
            <button type="button" data-guide-close>닫기</button>
          </span>
        </div>
        <p class="guide-say" id="guide-say" role="status" aria-live="polite"></p>
        <div class="guide-save" data-guide-save hidden>
          <span class="guide-save-note">이 PC에만 저장되고 Crema 서버로 보내지 않아요</span>
          <button class="primary-button" type="button" data-guide-save-button>이 PC에 저장</button>
        </div>
      </div>
      <div class="guide-frame" data-guide-frame></div>
    </section>`;
  shell.querySelector(".app-bar").after(view);
  const $ = (selector) => view.querySelector(selector);
  const frame = $("[data-guide-frame]");
  const rect = () => {
    const box = frame.getBoundingClientRect();
    return { x: box.left, y: box.top, width: box.width, height: box.height };
  };
  const resized = new ResizeObserver(() => active && !active.peek && host.guideBounds(rect()));

  let active = null; // { name, signup, lastSig, step, offered, busy, timer, peek, covered }

  function say(text) {
    $(".guide-say").textContent = text;
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

  function offerKey(key) {
    $(".guide-block").classList.add("found");
    say(`키를 찾았어요 · ${key.slice(0, 4)}••••${key.slice(-3)}`);
    $("[data-guide-save]").hidden = false;
    $("[data-guide-save-button]").onclick = () => saveKey(key);
  }

  async function saveKey(key) {
    const { env } = active.signup;
    say("키를 확인하고 있어요…");
    $("[data-guide-save]").hidden = true;
    try {
      const check = await host.hermesAdmin("POST", "/api/providers/validate", { key: env, value: key });
      if (!check.ok && check.reachable) {
        $(".guide-block").classList.remove("found");
        say("이 키를 쓸 수 없다고 해요. 화면에서 새 키를 만들어 주세요.");
        return;
      }
      await host.hermesAdmin("PUT", "/api/env", { key: env, value: key });
      await onConnected();
      const name = active.name;
      stop();
      showCard(doneCard(name));
    } catch (error) {
      say(error?.userMessage || "키를 저장하지 못했어요. 다시 눌러 주세요.");
      $("[data-guide-save]").hidden = false;
    }
  }

  function doneCard(name) {
    const card = document.createElement("section");
    card.className = "notice-card guide-done";
    card.setAttribute("role", "status");
    card.innerHTML = `<span></span><button class="secondary-button" type="button">자동 (무료 AI)로 쓰기</button>`;
    card.querySelector("span").textContent = `✓ ${name}를 연결했어요`;
    card.querySelector("button").addEventListener("click", onUseAuto);
    return card;
  }

  async function tick() {
    if (!active || active.busy || active.peek || active.covered) return;
    active.busy = true;
    const current = active;
    try {
      const { signup } = current;
      const page = await host.guideEval(collectScript(signup.key_pattern));
      if (active !== current) return;
      if (page.key && page.key !== current.offered) {
        current.offered = page.key;
        offerKey(page.key);
        return;
      }
      if (current.offered) return;
      const labels = Object.fromEntries(Object.entries(page.elements).map(([id, label]) => [id, maskLabel(label, signup.key_pattern)]));
      const url = page.url.split(/[?#]/)[0];
      const sig = `${url}|${Object.values(labels).join("|")}`;
      if (sig === current.lastSig) return;
      current.lastSig = sig;
      say("화면을 살펴보고 있어요…");
      let step;
      try {
        step = await host.guideStep({ goal: signup.goal, url, title: page.title, elements: labels });
      } catch {
        say("안내를 불러오지 못했어요. 인터넷 연결을 확인해 주세요. 아래 화면은 그대로 쓸 수 있어요.");
        return;
      }
      if (active === current) say(stepText(step, labels[step.target]));
    } catch {
      // A page still loading cannot be read yet; the next tick tries again.
    } finally {
      current.busy = false;
    }
  }

  function stop() {
    if (!active) return;
    clearInterval(active.timer);
    active = null;
    resized.disconnect();
    view.hidden = true;
    shell.classList.remove("guiding", "guide-peek");
    host.guideClose();
  }

  async function start(providerId) {
    const provider = freeProviders().find((item) => item.id === providerId);
    if (!provider?.signup) return;
    if (active) {
      stop();
      // The old page must be gone before the new one opens under the same webview.
      await host.guideClose();
    }
    active = { name: provider.name, signup: provider.signup, lastSig: null, offered: "", busy: false, peek: false, covered: false };
    $(".guide-block").classList.remove("found");
    $("[data-guide-save]").hidden = true;
    $("[data-guide-title]").textContent = `${provider.name} 연결 중`;
    say("가입 화면을 여는 중이에요…");
    view.hidden = false;
    shell.classList.add("guiding");
    $("[data-guide-earlier]").hidden = !hasConversation();
    $("[data-guide-earlier]").textContent = "이전 대화 보기";
    await new Promise((resolve) => requestAnimationFrame(resolve));
    try {
      await host.guideOpen(provider.signup.url, rect());
    } catch (error) {
      stop();
      showCard(Object.assign(document.createElement("section"), { className: "notice-card", textContent: error?.userMessage || "가입 화면을 열지 못했어요." }));
      return;
    }
    resized.observe(frame);
    active.timer = setInterval(tick, POLL_MS);
  }

  $("[data-guide-close]").addEventListener("click", stop);
  $("[data-guide-retry]").addEventListener("click", () => {
    if (!active) return;
    active.lastSig = null;
    active.offered = "";
    $(".guide-block").classList.remove("found");
    $("[data-guide-save]").hidden = true;
    say("화면을 다시 살펴볼게요…");
  });
  $("[data-guide-earlier]").addEventListener("click", () => {
    if (!active) return;
    active.peek = !active.peek;
    place();
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
