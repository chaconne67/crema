import { enhanceSelect } from "./dropdown.js";
import { GUIDES } from "./guide.js";
import { saveProviderKey } from "./providers.js";

const CHOICES_KEY = "agent-client:media:v1";

/**
 * What each kind of media can be made with, best first: [connected engine channel, the engine's backend
 * for it, how it is shown]. A backend reached only through a subscription that the provider refuses for
 * that use is left out (xAI's SuperGrok sign-in for speech and dictation). `guides`: the connections the
 * AI setup guide leads that turn the kind on, the one to offer first first. Only image and video are
 * shown in 서비스 연동; speech and dictation follow the connected Providers on their own.
 */
export const MEDIA_KINDS = [
  {
    key: "image", label: "이미지 생성", config: "image_gen", toolset: "image_gen", guides: ["openai-codex", "openrouter"],
    routes: [["openai-codex", "openai-codex", "ChatGPT 구독"], ["xai-oauth", "xai", "Grok 구독"], ["openai-api", "openai", "OpenAI API 키"], ["xai", "xai", "xAI API 키"], ["openrouter", "openrouter", "OpenRouter"]],
  },
  {
    key: "video", label: "동영상 생성", config: "video_gen", toolset: "video_gen", guides: ["openrouter"],
    routes: [["xai-oauth", "xai", "Grok 구독"], ["xai", "xai", "xAI API 키"], ["openrouter", "openrouter", "OpenRouter"]],
  },
  {
    key: "speech", label: "말하기", config: "tts", toolset: "tts",
    routes: [["openai-api", "openai", "OpenAI API 키"], ["gemini", "gemini", "Gemini API 키"], ["xai", "xai", "xAI API 키"]],
  },
  {
    key: "listen", label: "받아쓰기", config: "stt",
    routes: [["openai-api", "openai", "OpenAI API 키"], ["groq", "groq", "Groq"], ["xai", "xai", "xAI API 키"]],
  },
].map((kind) => ({ ...kind, routes: kind.routes.map(([channel, provider, label]) => ({ channel, provider, label })) }));

/**
 * Per kind, the routes the connected channels allow, the one in use (the chosen channel while it is still
 * connected, else the best available: "자동"), and on OpenRouter the chosen model ("" = its default).
 * `choices`: { [kind]: channel | "auto", models: { [kind]: model id } }.
 */
export function mediaPlan(connected, choices = {}) {
  return MEDIA_KINDS.map((kind) => {
    const available = kind.routes.filter((route) => connected.has(route.channel));
    const route = available.find((item) => item.channel === choices[kind.key]) || available[0] || null;
    const model = route?.provider === "openrouter" ? choices.models?.[kind.key] || "" : "";
    return { kind, available, route, model };
  });
}

/**
 * The engine config for a plan: each backend in use, and the run API's tools — its own set plus the
 * media tools that have a backend. A kind with none keeps its setting; its tool is simply not offered.
 * The OpenRouter image model goes under its own key (image_gen.openrouter.model), so the other image
 * services keep theirs; video has one shared model key, cleared ("" = default) off OpenRouter.
 */
export function mediaConfig(plan) {
  const config = { platform_toolsets: { api_server: ["hermes-api-server"] } };
  for (const { kind, route, model } of plan) {
    if (!route) continue;
    config[kind.config] =
      kind.key === "listen" ? { enabled: true, provider: route.provider }
      : kind.key === "image" && route.provider === "openrouter" ? { provider: route.provider, openrouter: { model } }
      : kind.key === "video" ? { provider: route.provider, model }
      : { provider: route.provider };
    if (kind.toolset) config.platform_toolsets.api_server.push(kind.toolset);
  }
  return config;
}

export function loadMediaChoices(storage = window.localStorage) {
  try {
    return JSON.parse(storage.getItem(CHOICES_KEY) || "null") || {};
  } catch {
    return {};
  }
}

function saveMediaChoices(choices, storage = window.localStorage) {
  try {
    storage.setItem(CHOICES_KEY, JSON.stringify(choices));
  } catch {
    // Without storage the choice lasts until the app closes; 자동 comes back after.
  }
}

const SHOWN = ["image", "video"];
const BRAVE = "BRAVE_SEARCH_API_KEY";

function escapeHtml(value) {
  return String(value).replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]);
}

// What each feature does, said once under its name.
const ABOUT = {
  image: "대화에서 이미지를 만들어 달라고 하면 이 서비스로 만듭니다.",
  video: "대화에서 동영상을 만들어 달라고 하면 이 서비스로 만듭니다.",
  web: "최신 정보가 필요할 때 에이전트가 웹을 검색합니다.",
};

// How each service the guide leads is connected, for choosing one.
const HOW = {
  "openai-codex": "ChatGPT 계정으로 로그인해 연결합니다.",
  openrouter: "무료로 가입하고 API 키를 받아 연결합니다. 여러 모델 중에서 고를 수 있습니다.",
  brave: "무료 요금제로 가입하고 API 키를 받아 연결합니다. 기본 검색보다 결과가 정확하고 빠릅니다.",
};

/**
 * Settings "서비스 연동": the services the AI models alone cannot stand in for, one card per feature
 * (이미지 생성, 동영상 생성, 웹 검색). Each card says whether the feature can be used now, the details of
 * that state (the service in use, its model on OpenRouter, the services connected), and one button that
 * opens, in place, what changing it takes: the service to use (a connected one, or one to connect), the
 * model, and 적용; or, for a service not connected yet, the AI setup guide or its API key typed in.
 * getConnected() → Set of connected channel ids; onChange(plan) applies a new choice; onGuide(id) starts
 * the guide; onConnected() reloads the Providers after a key is saved here; host reads and writes the
 * engine (model catalogs, the Brave key); onUpdate() runs when what was read changes the summary.
 */
export function createMediaSection({ host, getConnected, onChange, onGuide = () => {}, onConnected = async () => {}, onUpdate = () => {} }) {
  const element = document.createElement("div");
  element.className = "media-section";
  let choices = loadMediaChoices();
  let dropdowns = [];
  // Per kind, OpenRouter's catalog once read: { models, default }.
  const catalogs = {};
  const loading = new Set();
  let brave = null; // whether the Brave key is set; null until read
  // The card whose change is open, and what is picked in it (not applied until 적용).
  let editing = null;
  let draft = {};
  // A line under a card after something was done in it: { key, text, tone }.
  let notice = null;

  const option = (value, label, chosen) => `<option value="${escapeHtml(value)}"${value === chosen ? " selected" : ""}>${escapeHtml(label)}</option>`;

  const modelName = (kind, model) => {
    const catalog = catalogs[kind.key];
    const id = model || catalog?.default;
    const known = catalog?.models.find((item) => item.id === id);
    return model ? known?.display || model : `기본${known ? ` (${known.display})` : ""}`;
  };

  function modelSelect(kind, model) {
    const catalog = catalogs[kind.key];
    if (!catalog) return '<p class="feature-hint">모델 목록을 불러오고 있습니다…</p>';
    const chosen = catalog.models.some((item) => item.id === model) ? model : "";
    return `<select data-model aria-label="${kind.label} 모델">${[
      option("", modelName(kind, ""), chosen),
      ...catalog.models.filter((item) => item.id !== catalog.default).map((item) => option(item.id, item.display, chosen)),
    ].join("")}</select>`;
  }

  const details = (rows) => `<dl class="feature-details">${rows.map(([term, value]) => `<div><dt>${term}</dt><dd>${value}</dd></div>`).join("")}</dl>`;

  // A service not connected yet: the guide, or its key typed in when it takes one.
  function connectStep(id) {
    const guide = GUIDES[id];
    const typed = guide.kind === "key"
      ? `<div class="feature-key">
          <label for="feature-key-${id}">API 키가 이미 있다면 붙여넣으세요</label>
          <input id="feature-key-${id}" type="password" data-key="${id}" autocomplete="off" spellcheck="false" placeholder="${escapeHtml(guide.sample)}" value="${escapeHtml(draft.key || "")}" />
          <button class="secondary-button" type="button" data-save-key="${id}">확인하고 저장</button>
        </div>`
      : "";
    return `
      <div class="feature-connect-step">
        <button class="primary-button" type="button" data-guide="${id}">안내받으며 연결하기</button>
        ${typed}
      </div>`;
  }

  const statusLine = (key) => (notice?.key === key ? `<p class="provider-status" data-tone="${notice.tone || ""}" role="status">${escapeHtml(notice.text)}</p>` : "");

  const card = ({ key, label, on, body }) => `
    <article class="feature" data-media="${key}" data-on="${on}" aria-labelledby="feature-${key}">
      <header class="feature-head">
        <h4 class="feature-name" id="feature-${key}">${label}</h4>
        <span class="feature-state" data-state="${on ? "on" : "off"}">${on ? "사용 가능" : "사용 불가"}</span>
      </header>
      <p class="feature-about">${ABOUT[key]}</p>
      ${body}
      ${statusLine(key)}
    </article>`;

  function mediaCard({ kind, available, route, model }) {
    const connectable = kind.guides.filter((id) => !available.some((item) => item.channel === id));
    const others = kind.routes.filter((item) => !kind.guides.includes(item.channel) && !available.includes(item)).map((item) => item.label);
    const auto = !available.some((item) => item.channel === choices[kind.key]);

    if (editing !== kind.key) {
      const rows = route
        ? [
          ["사용 중인 서비스", `${escapeHtml(route.label)}${auto && available.length > 1 ? ' <span class="feature-tag">자동 선택</span>' : ""}`],
          ...(route.provider === "openrouter" ? [["모델", escapeHtml(modelName(kind, model))]] : []),
          ["연결된 서비스", available.map((item) => escapeHtml(item.label)).join(", ")],
        ]
        : [["사용 중인 서비스", '<span class="feature-none">없음</span>']];
      const button = route
        ? '<button class="secondary-button feature-open" type="button" data-edit>서비스 변경</button>'
        : '<button class="primary-button feature-open" type="button" data-edit>연결하기</button>';
      return card({ key: kind.key, label: kind.label, on: Boolean(route), body: details(rows) + button });
    }

    // The change, open: the service to use, then what it needs (a model, or connecting it).
    const picks = [
      ...(available.length > 1 ? [{ value: "auto", name: "자동", hint: `연결된 서비스 중 가장 알맞은 것을 씁니다. 지금은 ${available[0].label}입니다.` }] : []),
      ...available.map((item) => ({ value: item.channel, name: item.label, hint: "연결됨", on: true })),
      ...connectable.map((id) => ({ value: id, name: GUIDES[id].name, hint: `연결 필요 · ${HOW[id]}` })),
    ];
    const picked = picks.some((item) => item.value === draft.service) ? draft.service : picks[0].value;
    const pickedRoute = picked === "auto" ? available[0] : available.find((item) => item.channel === picked);
    // 적용 only when something differs from what is in use.
    const current = auto ? (available.length > 1 ? "auto" : available[0]?.channel) : choices[kind.key];
    const changed = pickedRoute && (picked !== current || (pickedRoute.provider === "openrouter" && (draft.model ?? model) !== model));
    const body = `
      <div class="feature-editor" data-editor>
        <p class="field-label" id="pick-${kind.key}">${route ? "사용할 서비스" : "연결할 서비스"}</p>
        <div class="feature-picks" role="radiogroup" aria-labelledby="pick-${kind.key}">
          ${picks.map((item) => `
            <button class="feature-pick" type="button" role="radio" aria-checked="${item.value === picked}" data-pick="${item.value}">
              <span class="feature-pick-name">${escapeHtml(item.name)}${item.on ? '<span class="feature-tag" data-tone="on">연결됨</span>' : ""}</span>
              ${item.on ? "" : `<span class="feature-pick-hint">${escapeHtml(item.hint.replace(/^연결 필요 · /, ""))}</span>`}
            </button>`).join("")}
        </div>
        ${others.length ? `<p class="feature-hint">${escapeHtml(others.join(", "))}로도 쓸 수 있습니다. 설정 › Provider 추가에서 연결하면 여기에 나타납니다.</p>` : ""}
        ${pickedRoute?.provider !== "openrouter" ? ""
          // The engine lists OpenRouter's models only once it is this feature's service.
          : pickedRoute === route ? `<label>모델</label>${modelSelect(kind, draft.model ?? model)}`
          : '<p class="feature-hint">모델은 적용한 뒤 서비스 변경에서 고를 수 있습니다.</p>'}
        ${pickedRoute ? "" : connectStep(picked)}
        <div class="feature-actions">
          ${pickedRoute ? `<button class="primary-button" type="button" data-apply${changed ? "" : " disabled"}>적용</button>` : ""}
          <button class="secondary-button" type="button" data-cancel>취소</button>
        </div>
      </div>`;
    return card({ key: kind.key, label: kind.label, on: Boolean(route), body });
  }

  // Web search always works: on the engine's free search, or on Brave once its key is set.
  function webCard() {
    const rows = [["사용 중인 검색", brave ? "Brave 검색" : '기본 검색 <span class="feature-none">(무료, 설정 필요 없음)</span>']];
    const body = editing === "web"
      ? `
        <div class="feature-editor" data-editor>
          <p class="feature-hint">${brave ? "새 Brave 검색 API 키를 넣으면 바뀝니다." : HOW.brave}</p>
          ${brave
            ? `<div class="feature-key">
                <label for="feature-key-brave">새 API 키</label>
                <input id="feature-key-brave" type="password" data-key="brave" autocomplete="off" spellcheck="false" placeholder="${escapeHtml(GUIDES.brave.sample)}" value="${escapeHtml(draft.key || "")}" />
                <button class="primary-button" type="button" data-save-key="brave">확인하고 저장</button>
              </div>`
            : connectStep("brave")}
          <div class="feature-actions"><button class="secondary-button" type="button" data-cancel>취소</button></div>
        </div>`
      : `<button class="secondary-button feature-open" type="button" data-edit>${brave ? "API 키 바꾸기" : "Brave 검색으로 바꾸기"}</button>`;
    return card({ key: "web", label: "웹 검색", on: true, body: details(rows) + body });
  }

  /**
   * OpenRouter's catalog for a kind, from the engine once it has OpenRouter as that kind's backend. Asked
   * right after OpenRouter is connected or chosen, the engine may still answer for the previous service
   * (its config is written just after): then it is asked again a little later.
   */
  async function loadCatalog(kind) {
    loading.add(kind.key);
    for (let attempt = 0; attempt < 4 && !catalogs[kind.key]; attempt += 1) {
      if (attempt) await new Promise((resolve) => setTimeout(resolve, 1500));
      try {
        const reply = await host.hermesAdmin("GET", `/api/tools/toolsets/${kind.config}/models`);
        if (reply?.plugin === "openrouter" && reply.models?.length) catalogs[kind.key] = { models: reply.models, default: reply.default };
      } catch {
        // No catalog this time.
      }
    }
    loading.delete(kind.key);
    // Without one the model stays the default and no choice is shown.
    if (catalogs[kind.key]) render();
  }

  async function loadBrave() {
    try {
      const env = await host.hermesAdmin("GET", "/api/env");
      const set = Boolean(env?.[BRAVE]?.is_set);
      if (set !== brave) {
        brave = set;
        render();
        onUpdate();
      }
    } catch {
      // Unread: shown as the free search.
    }
  }

  function render() {
    const plan = mediaPlan(getConnected(), choices).filter(({ kind }) => SHOWN.includes(kind.key));
    element.innerHTML = plan.map(mediaCard).join("") + webCard();
    dropdowns = [...element.querySelectorAll("select")].map(enhanceSelect);
    for (const item of plan) {
      if (item.route?.provider === "openrouter" && !catalogs[item.kind.key] && !loading.has(item.kind.key)) loadCatalog(item.kind);
    }
  }

  const keyOf = (target) => target.closest("[data-media]")?.dataset.media;

  function open(key) {
    editing = key;
    draft = { service: choices[key] || "auto" };
    notice = null;
    render();
    element.querySelector(`[data-media="${key}"] [data-editor] [aria-checked="true"], [data-media="${key}"] [data-editor] input, [data-media="${key}"] [data-editor] button`)?.focus();
  }

  function close(key, text = "", tone = "") {
    editing = null;
    draft = {};
    notice = text ? { key, text, tone } : null;
    render();
    element.querySelector(`[data-media="${key}"] [data-edit]`)?.focus();
  }

  function apply(key) {
    const plan = mediaPlan(getConnected(), choices);
    const { kind, available } = plan.find((item) => item.kind.key === key);
    const service = available.some((item) => item.channel === draft.service) ? draft.service : "auto";
    const route = service === "auto" ? available[0] : available.find((item) => item.channel === service);
    choices = { ...choices, [key]: service };
    if (route.provider === "openrouter" && draft.model !== undefined) choices = { ...choices, models: { ...choices.models, [key]: draft.model } };
    saveMediaChoices(choices);
    const next = mediaPlan(getConnected(), choices);
    onChange(next);
    const used = next.find((item) => item.kind.key === key);
    close(key, `적용했습니다. 이제 ${kind.label}에 ${used.route.label}${used.route.provider === "openrouter" ? ` · ${modelName(kind, used.model)}` : ""}을(를) 씁니다.`);
  }

  async function saveKey(key, id) {
    const value = (draft.key || "").trim();
    if (!value) {
      notice = { key, text: "API 키를 붙여넣어 주세요.", tone: "error" };
      return render();
    }
    notice = { key, text: "키를 확인하고 있습니다…" };
    render();
    try {
      await saveProviderKey(host, { id, envVar: GUIDES[id].env }, value, false);
      if (id === "brave") {
        brave = null;
        await loadBrave();
      } else {
        await onConnected();
      }
      close(key, `${GUIDES[id].name}을(를) 연결했습니다.`);
    } catch (error) {
      notice = { key, text: error?.reason === "refused" ? "이 키를 받아들이지 않았습니다. 키를 다시 확인해 주세요." : error?.userMessage || "키를 저장하지 못했습니다.", tone: "error" };
      render();
    }
  }

  element.addEventListener("change", (event) => {
    const select = event.target.closest("select[data-model]");
    if (!select) return;
    draft = { ...draft, model: select.value };
    render();
  });

  element.addEventListener("input", (event) => {
    if (event.target.matches("[data-key]")) draft = { ...draft, key: event.target.value };
  });

  element.addEventListener("click", (event) => {
    const target = event.target.closest("button");
    if (!target) return;
    const key = keyOf(target);
    if (target.matches("[data-edit]")) return open(key);
    if (target.matches("[data-cancel]")) return close(key);
    if (target.matches("[data-apply]")) return apply(key);
    if (target.matches("[data-guide]")) return onGuide(target.dataset.guide);
    if (target.matches("[data-save-key]")) return saveKey(key, target.dataset.saveKey);
    if (target.matches("[data-pick]")) {
      draft = { ...draft, service: target.dataset.pick, key: "" };
      render();
      element.querySelector(`[data-media="${key}"] [data-pick="${target.dataset.pick}"]`)?.focus();
    }
  });

  return {
    element,
    /** Draws the cards and reads again whether Brave is connected. */
    render() {
      render();
      loadBrave();
    },
    /** The plan for the Providers connected now, with the saved choices. */
    plan: () => mediaPlan(getConnected(), choices),
    /** How many features can be used, for the section's folded line. */
    summary: () => {
      const shown = mediaPlan(getConnected(), choices).filter(({ kind }) => SHOWN.includes(kind.key));
      // Web search is always usable.
      return `${shown.length + 1}개 중 ${shown.filter(({ route }) => route).length + 1}개 사용 가능`;
    },
    refreshDropdowns: () => dropdowns.forEach((dropdown) => dropdown.refresh()),
  };
}
