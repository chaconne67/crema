import { enhanceSelect } from "./dropdown.js";

const CHOICES_KEY = "agent-client:media:v1";

/**
 * What each kind of media can be made with, best first: [connected engine channel, the engine's backend
 * for it, how it is shown]. A backend reached only through a subscription that the provider refuses for
 * that use is left out (xAI's SuperGrok sign-in for speech and dictation).
 */
export const MEDIA_KINDS = [
  {
    key: "image", label: "이미지 생성", config: "image_gen", toolset: "image_gen",
    hint: "ChatGPT·Grok 구독이나 OpenAI·OpenRouter를 연결하면 자동으로 켜져요.",
    routes: [["openai-codex", "openai-codex", "ChatGPT 구독"], ["xai-oauth", "xai", "Grok 구독"], ["openai-api", "openai", "OpenAI API 키"], ["xai", "xai", "xAI API 키"], ["openrouter", "openrouter", "OpenRouter"]],
  },
  {
    key: "video", label: "영상 생성", config: "video_gen", toolset: "video_gen",
    hint: "Grok 구독이나 xAI·OpenRouter를 연결하면 자동으로 켜져요.",
    routes: [["xai-oauth", "xai", "Grok 구독"], ["xai", "xai", "xAI API 키"], ["openrouter", "openrouter", "OpenRouter"]],
  },
  {
    key: "speech", label: "말하기 (소리로 읽어 주기)", config: "tts", toolset: "tts",
    hint: "OpenAI나 Gemini API 키를 연결하면 자동으로 켜져요.",
    routes: [["openai-api", "openai", "OpenAI API 키"], ["gemini", "gemini", "Gemini API 키"], ["xai", "xai", "xAI API 키"]],
  },
  {
    key: "listen", label: "받아쓰기 (음성 입력)", config: "stt",
    hint: "OpenAI·Groq API 키를 연결하면 자동으로 켜져요.",
    routes: [["openai-api", "openai", "OpenAI API 키"], ["groq", "groq", "Groq"], ["xai", "xai", "xAI API 키"]],
  },
].map((kind) => ({ ...kind, routes: kind.routes.map(([channel, provider, label]) => ({ channel, provider, label })) }));

/**
 * Per kind, the routes the connected channels allow and the one in use: the chosen channel while it is
 * still connected, else the best available ("자동"). `choices`: { [kind]: channel | "auto" }.
 */
export function mediaPlan(connected, choices = {}) {
  return MEDIA_KINDS.map((kind) => {
    const available = kind.routes.filter((route) => connected.has(route.channel));
    const route = available.find((item) => item.channel === choices[kind.key]) || available[0] || null;
    return { kind, available, route };
  });
}

/**
 * The engine config for a plan: each backend in use, and the run API's tools — its own set plus the
 * media tools that have a backend. A kind with none keeps its setting; its tool is simply not offered.
 */
export function mediaConfig(plan) {
  const config = { platform_toolsets: { api_server: ["hermes-api-server"] } };
  for (const { kind, route } of plan) {
    if (!route) continue;
    config[kind.config] = kind.key === "listen" ? { enabled: true, provider: route.provider } : { provider: route.provider };
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

/**
 * Settings "미디어": for each kind, what it runs on now (or which Provider would turn it on) and, when
 * more than one connected Provider can do it, a choice between 자동 and each of them.
 * getConnected() → Set of connected channel ids; onChange(plan) applies a new choice.
 */
export function createMediaSection({ getConnected, onChange }) {
  const element = document.createElement("div");
  element.className = "media-section";
  let choices = loadMediaChoices();
  let dropdowns = [];

  function render() {
    const plan = mediaPlan(getConnected(), choices);
    element.innerHTML = plan
      .map(({ kind, available, route }) => {
        const options = [["auto", `자동${available[0] ? ` (${available[0].label})` : ""}`], ...available.map((item) => [item.channel, item.label])];
        const chosen = available.some((item) => item.channel === choices[kind.key]) ? choices[kind.key] : "auto";
        return `
          <div class="media-row" data-media="${kind.key}">
            <span class="field-label">${kind.label}</span>
            <p class="media-status" data-on="${Boolean(route)}">${route ? `${route.label}로 연결됨` : "연결된 Provider가 없어요"}</p>
            ${available.length > 1
              ? `<select aria-label="${kind.label}에 쓸 Provider">${options.map(([value, label]) => `<option value="${value}"${value === chosen ? " selected" : ""}>${label}</option>`).join("")}</select>`
              : ""}
            ${route ? "" : `<p class="field-note">${kind.hint}</p>`}
          </div>`;
      })
      .join("");
    dropdowns = [...element.querySelectorAll("select")].map(enhanceSelect);
    for (const select of element.querySelectorAll("select")) {
      select.addEventListener("change", () => {
        const key = select.closest("[data-media]").dataset.media;
        choices = { ...choices, [key]: select.value };
        saveMediaChoices(choices);
        render();
        onChange(mediaPlan(getConnected(), choices));
      });
    }
  }

  return {
    element,
    render,
    /** The plan for the Providers connected now, with the saved choices. */
    plan: () => mediaPlan(getConnected(), choices),
    refreshDropdowns: () => dropdowns.forEach((dropdown) => dropdown.refresh()),
  };
}
