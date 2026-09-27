import { enhanceSelect } from "./dropdown.js";
import { GUIDES } from "./guide.js";

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

/**
 * Settings "서비스 연동": the services the AI models alone cannot stand in for. Image and video generation
 * show what they are connected through (a choice when more than one connected service can, and the model
 * on OpenRouter, from the engine's live catalog); web search runs on the engine's free search unless Brave
 * is connected; the table says per feature whether it can be used, through what, and what to do. Off, 연결하기 starts the AI setup guide (asking which service first when there is more than
 * one). getConnected() → Set of connected channel ids; onChange(plan) applies a new choice; onGuide(id)
 * starts the guide; host reads the engine (model catalogs, whether the Brave key is set); onUpdate() runs
 * when what was read from the engine changes the summary.
 */
export function createMediaSection({ host, getConnected, onChange, onGuide = () => {}, onUpdate = () => {} }) {
  const element = document.createElement("div");
  element.className = "media-section";
  let choices = loadMediaChoices();
  let dropdowns = [];
  // Per kind, OpenRouter's catalog once read: { models, default }.
  const catalogs = {};
  const loading = new Set();
  let brave = null; // whether the Brave key is set; null until read

  const option = (value, label, chosen) => `<option value="${value}"${value === chosen ? " selected" : ""}>${label}</option>`;

  function modelSelect(kind, model) {
    const catalog = catalogs[kind.key];
    if (!catalog) return "";
    const known = catalog.models.find((item) => item.id === catalog.default);
    const chosen = catalog.models.some((item) => item.id === model) ? model : "";
    return `<select data-model aria-label="${kind.label} 모델">${[
      option("", `기본 (${known?.display || catalog.default})`, chosen),
      ...catalog.models.filter((item) => item.id !== catalog.default).map((item) => option(item.id, item.display, chosen)),
    ].join("")}</select>`;
  }

  // One feature: its row (기능 · 상태 · 연결된 서비스 · what can be done), and under it the choices it has.
  const featureRow = ({ key, label, on, service, action = "", options = "" }) => `
    <tbody class="feature" data-media="${key}" data-on="${on}">
      <tr>
        <th scope="row" class="feature-name">${label}</th>
        <td><span class="feature-state" data-state="${on ? "on" : "off"}">${on ? "사용 가능" : "사용 불가"}</span></td>
        <td class="feature-service">${service}</td>
        <td class="feature-action">${action}</td>
      </tr>
      ${options}
    </tbody>`;

  const optionRow = (label, control, attrs = "") => `
      <tr class="feature-option"${attrs}><td></td><td colspan="3"><span class="feature-option-label">${label}</span>${control}</td></tr>`;

  function mediaRow({ kind, available, route, model }) {
    if (!route) {
      return featureRow({
        key: kind.key, label: kind.label, on: false, service: '<span class="feature-none">없음</span>',
        action: '<button class="secondary-button feature-connect" type="button" data-connect>연결하기</button>',
        options: kind.guides.length > 1
          ? optionRow("어느 서비스로 연결할까요?", `<span class="feature-choices">${kind.guides.map((id) => `<button class="secondary-button" type="button" data-guide="${id}">${GUIDES[id].name}</button>`).join("")}</span>`, " data-choices hidden")
          : "",
      });
    }
    const chosen = available.some((item) => item.channel === choices[kind.key]) ? choices[kind.key] : "auto";
    const services = available.length > 1
      ? optionRow("사용할 서비스", `<select data-service aria-label="${kind.label}에 쓸 서비스">${[
        option("auto", `자동 (${available[0].label})`, chosen),
        ...available.map((item) => option(item.channel, item.label, chosen)),
      ].join("")}</select>`)
      : "";
    const models = route.provider === "openrouter" && catalogs[kind.key] ? optionRow("모델", modelSelect(kind, model)) : "";
    return featureRow({ key: kind.key, label: kind.label, on: true, service: route.label, options: services + models });
  }

  // Web search always works: on the engine's free search, or on Brave once it is connected.
  const webRow = () => featureRow({
    key: "web", label: "웹 검색", on: true,
    service: brave ? "Brave 검색" : "기본 검색",
    action: brave ? "" : '<button class="secondary-button feature-connect" type="button" data-guide="brave">Brave로 바꾸기</button>',
  });

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
    element.innerHTML = `
      <table class="feature-table">
        <thead><tr><th scope="col">기능</th><th scope="col">상태</th><th scope="col">연결된 서비스</th><th scope="col"><span class="sr-only">할 일</span></th></tr></thead>
        ${plan.map(mediaRow).join("")}${webRow()}
      </table>
      ${plan.some(({ route }) => !route) ? '<p class="feature-note">연결하기를 누르면 연결할 서비스를 고른 뒤, 안내에 따라 계정이나 API 키를 연결합니다.</p>' : ""}`;
    dropdowns = [...element.querySelectorAll("select")].map(enhanceSelect);
    for (const item of plan) {
      if (item.route?.provider === "openrouter" && !catalogs[item.kind.key] && !loading.has(item.kind.key)) loadCatalog(item.kind);
    }
  }

  element.addEventListener("change", (event) => {
    const select = event.target.closest("select");
    if (!select) return;
    const key = select.closest("[data-media]").dataset.media;
    choices = select.matches("[data-model]")
      ? { ...choices, models: { ...choices.models, [key]: select.value } }
      : { ...choices, [key]: select.value };
    saveMediaChoices(choices);
    render();
    onChange(mediaPlan(getConnected(), choices));
  });

  element.addEventListener("click", (event) => {
    const guide = event.target.closest("[data-guide]")?.dataset.guide;
    if (guide) return onGuide(guide);
    const connect = event.target.closest("[data-connect]");
    if (!connect) return;
    const key = connect.closest("[data-media]").dataset.media;
    const { guides } = MEDIA_KINDS.find((kind) => kind.key === key);
    if (guides.length === 1) return onGuide(guides[0]);
    const list = connect.closest("[data-media]").querySelector("[data-choices]");
    list.hidden = !list.hidden;
    connect.setAttribute("aria-expanded", String(!list.hidden));
  });

  return {
    element,
    /** Draws the rows and reads again whether Brave is connected. */
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
