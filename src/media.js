import { enhanceSelect } from "./dropdown.js";
import { GUIDES } from "./guide.js";

const CHOICES_KEY = "agent-client:media:v1";

/**
 * What each kind of media can be made with, best first: [connected engine channel, the engine's backend
 * for it, how it is shown]. A backend reached only through a subscription that the provider refuses for
 * that use is left out (xAI's SuperGrok sign-in for speech and dictation). `guides`: the connections the
 * AI setup guide leads that turn the kind on, the one to offer first first.
 */
export const MEDIA_KINDS = [
  {
    key: "image", label: "그림", config: "image_gen", toolset: "image_gen", guides: ["openai-codex", "openrouter"],
    routes: [["openai-codex", "openai-codex", "ChatGPT 구독"], ["xai-oauth", "xai", "Grok 구독"], ["openai-api", "openai", "OpenAI API 키"], ["xai", "xai", "xAI API 키"], ["openrouter", "openrouter", "OpenRouter"]],
  },
  {
    key: "video", label: "영상", config: "video_gen", toolset: "video_gen", guides: ["openrouter"],
    routes: [["xai-oauth", "xai", "Grok 구독"], ["xai", "xai", "xAI API 키"], ["openrouter", "openrouter", "OpenRouter"]],
  },
  {
    key: "speech", label: "말하기", config: "tts", toolset: "tts", guides: ["gemini"],
    routes: [["openai-api", "openai", "OpenAI API 키"], ["gemini", "gemini", "Gemini API 키"], ["xai", "xai", "xAI API 키"]],
  },
  {
    key: "listen", label: "받아쓰기", config: "stt", guides: ["groq"],
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

// Chat is on once any Provider has models to choose from (hasChat); which one answers is chosen under 고급 > AI.
const CHAT = { key: "chat", label: "대화", guides: ["gemini", "openai-codex", "anthropic", "groq", "openrouter"] };

const guideLabel = (id) => `${GUIDES[id].name}${GUIDES[id].free ? " · 무료" : ""}`;

/**
 * Settings "기능": one row per feature. On: ✓, and a choice only when more than one connected Provider
 * can do it. Off: one 연결하기, which starts the AI setup guide (asking which connection first when
 * there is more than one). getConnected() → Set of connected channel ids; onChange(plan) applies a new
 * choice; onGuide(id) starts the guide for a connection; hasChat() says whether chat is on.
 */
export function createMediaSection({ getConnected, onChange, onGuide = () => {}, hasChat = () => getConnected().size > 0 }) {
  const element = document.createElement("div");
  element.className = "media-section";
  let choices = loadMediaChoices();
  let dropdowns = [];

  function row(kind, on, available = []) {
    const options = [["auto", `자동${available[0] ? ` (${available[0].label})` : ""}`], ...available.map((item) => [item.channel, item.label])];
    const chosen = available.some((item) => item.channel === choices[kind.key]) ? choices[kind.key] : "auto";
    return `
      <div class="feature-row" data-media="${kind.key}" data-on="${on}">
        <span class="feature-name">${kind.label}</span>
        ${on
          ? `<span class="feature-on" aria-label="켜짐">✓</span>${available.length > 1
            ? `<select aria-label="${kind.label}에 쓸 AI">${options.map(([value, label]) => `<option value="${value}"${value === chosen ? " selected" : ""}>${label}</option>`).join("")}</select>`
            : ""}`
          : `<button class="secondary-button feature-connect" type="button" data-connect>연결하기</button>
            <div class="feature-choices" data-choices hidden>${kind.guides.map((id) => `<button class="text-button" type="button" data-guide="${id}">${guideLabel(id)}</button>`).join("")}</div>`}
      </div>`;
  }

  function render() {
    const connected = getConnected();
    element.innerHTML = row(CHAT, hasChat()) + mediaPlan(connected, choices).map(({ kind, available, route }) => row(kind, Boolean(route), available)).join("");
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

  element.addEventListener("click", (event) => {
    const guide = event.target.closest("[data-guide]")?.dataset.guide;
    if (guide) return onGuide(guide);
    const connect = event.target.closest("[data-connect]");
    if (!connect) return;
    const key = connect.closest("[data-media]").dataset.media;
    const { guides } = key === CHAT.key ? CHAT : MEDIA_KINDS.find((kind) => kind.key === key);
    if (guides.length === 1) return onGuide(guides[0]);
    const list = connect.nextElementSibling;
    list.hidden = !list.hidden;
    connect.setAttribute("aria-expanded", String(!list.hidden));
  });

  return {
    element,
    render,
    /** The plan for the Providers connected now, with the saved choices. */
    plan: () => mediaPlan(getConnected(), choices),
    refreshDropdowns: () => dropdowns.forEach((dropdown) => dropdown.refresh()),
  };
}
