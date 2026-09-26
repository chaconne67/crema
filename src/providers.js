// A Provider is the company the user holds access from. Hermes lists each way of reaching one as its
// own channel ("openai-codex" = ChatGPT subscription, "openai-api" = OpenAI API key); these are merged.
const GROUPS = {
  openai: { name: "OpenAI", ids: ["openai-codex", "openai-api"] },
  anthropic: { name: "Anthropic", ids: ["anthropic", "claude-code"] },
  xai: { name: "xAI", ids: ["xai-oauth", "xai"] },
  minimax: { name: "MiniMax", ids: ["minimax-oauth", "minimax"] },
  qwen: { name: "Qwen", ids: ["qwen-oauth", "alibaba"] },
  copilot: { name: "GitHub Copilot", ids: ["copilot", "copilot-acp"] },
  google: { name: "Google", ids: ["gemini"] },
};
const GROUP_OF = Object.fromEntries(Object.entries(GROUPS).flatMap(([key, group]) => group.ids.map((id) => [id, key])));

// Hermes' virtual mixture-of-agents channel is not a Provider. Claude Code's channel borrows that
// program's login, which Crema's engine does not do (auth.adopt_external_logins is off): Claude's
// subscription is the Anthropic login instead.
const SKIPPED_CHANNELS = new Set(["moa", "claude-code"]);

// Subscription channels: Hermes' OAuth registry (hermes_cli/auth.py) plus Copilot, a GitHub-login
// subscription; any channel whose local auth.json credential is OAuth counts too.
const SUBSCRIPTION_CHANNELS = new Set(["openai-codex", "xai-oauth", "qwen-oauth", "minimax-oauth", "nous", "copilot"]);

export const METHOD_LABELS = { subscription: "구독", api_key: "API 키" };

export function providerOf(channelId, fallbackName) {
  const key = GROUP_OF[channelId] || channelId;
  return { key, name: GROUPS[key]?.name || fallbackName || channelId };
}

/**
 * Model list: Provider → models, from channels that are signed in now (a channel needing a new
 * login is left out). Each model keeps its routes — the channels able to serve it — subscription first.
 */
export function buildCatalog(channels, kinds = {}) {
  const groups = new Map();
  for (const channel of channels) {
    if (SKIPPED_CHANNELS.has(channel.id) || kinds[channel.id]?.relogin) continue;
    const { key, name } = providerOf(channel.id, channel.name);
    if (!groups.has(key)) groups.set(key, { key, provider: name, models: new Map() });
    const models = groups.get(key).models;
    const subscription = SUBSCRIPTION_CHANNELS.has(channel.id) || kinds[channel.id]?.kind === "oauth";
    for (const modelId of channel.models) {
      if (!models.has(modelId)) models.set(modelId, { name: modelId, routes: [] });
      models.get(modelId).routes.push({
        providerId: channel.id,
        modelId,
        subscription,
        fast: Boolean(channel.capabilities?.[modelId]?.fast),
      });
    }
  }
  return [...groups.values()].map(({ key, provider, models }) => ({
    key,
    provider,
    models: [...models.values()].map((model) => ({ ...model, fast: model.routes.some((route) => route.fast) })),
  }));
}

/** The Provider section's list: each connected Provider and how it is signed in (subscription first). */
export function providerStatus(channels, kinds = {}) {
  return buildCatalog(channels, kinds).map((group) => {
    const routes = group.models.flatMap((model) => model.routes);
    const methods = ["subscription", "api_key"].filter((method) => routes.some((route) => route.subscription === (method === "subscription")));
    return { key: group.key, name: group.provider, methods };
  });
}

// Small, fast models for predicting the next input: subscriptions first (ChatGPT, Copilot, Claude,
// SuperGrok — Claude's third-party use may draw extra usage credits, so it comes late), then an API key.
const SUGGESTION_MODELS = [
  ["openai-codex", "gpt-6-luna"],
  ["copilot", "gpt-5-mini"],
  ["anthropic", "claude-haiku-4-5-20251001"],
  ["xai-oauth", "grok-4.20-0309-non-reasoning"],
  ["gemini", "gemini-3.1-flash-lite"],
];

/** The route that writes next-input predictions, or null when none of those models is signed in. */
export function suggestionRoute(catalog) {
  for (const [channelId, modelId] of SUGGESTION_MODELS) {
    for (const group of catalog) {
      const route = group.models.flatMap((model) => model.routes).find((item) => item.providerId === channelId && item.modelId === modelId);
      if (route) return { ...route, provider: group.provider };
    }
  }
  return null;
}

/** Channels able to serve the choice; subscriptions first. */
export function routesFor(model, fast) {
  return model.routes.filter((route) => !fast || route.fast).sort((a, b) => Number(b.subscription) - Number(a.subscription));
}

/** Keeps the current channel when it serves the choice, else prefers a subscription. */
export function pickRoute(model, fast, currentChannelId) {
  const routes = routesFor(model, fast);
  return routes.find((route) => route.providerId === currentChannelId) || routes[0] || null;
}

/** Where the saved choice (channel + model id) sits in the model list. */
export function locate(catalog, channelId, modelId) {
  for (const group of catalog) {
    const model = group.models.find((item) => item.routes.some((route) => route.providerId === channelId && route.modelId === modelId));
    if (model) return { key: group.key, provider: group.provider, model };
  }
  return null;
}

// Free tiers chained so one running out does not end a reply, in failover order. Groq and Mistral are
// not engine providers: they are added as named OpenAI-compatible endpoints (config `providers:`).
export const FREE_PROVIDERS = [
  { id: "gemini", model: /flash-lite/ },
  {
    id: "groq",
    model: "openai/gpt-oss-120b",
    endpoint: { name: "Groq", base_url: "https://api.groq.com/openai/v1", key_env: "GROQ_API_KEY", url: "https://console.groq.com/keys" },
  },
  { id: "openrouter", model: /:free$/ },
  {
    id: "mistral",
    model: "mistral-small-latest",
    endpoint: { name: "Mistral", base_url: "https://api.mistral.ai/v1", key_env: "MISTRAL_API_KEY", url: "https://console.mistral.ai/api-keys" },
  },
];

// How long a Provider that failed a turn is left out.
export const COOL_MS = 15 * 60 * 1000;

/** The connected free Providers not cooling off, as `fallback_providers` entries in failover order. */
export function freeChain(channels, cooling = {}, now = Date.now()) {
  return FREE_PROVIDERS.flatMap(({ id, model }) => {
    const models = channels.find((channel) => channel.id === id)?.models || [];
    const pick = typeof model === "string" ? (models.includes(model) ? model : models[0]) : models.find((name) => model.test(name));
    return pick && !(cooling[id] > now) ? [{ provider: id, model: pick }] : [];
  });
}

/** The route for a turn: the chosen one, or the first free Provider in `chain` while the chosen one cools off. */
export function turnRoute(chosen, chain, cooling = {}, now = Date.now()) {
  if (!(cooling[chosen.provider] > now)) return chosen;
  const next = chain.find((entry) => entry.provider !== chosen.provider);
  return next ? { ...chosen, ...next, reasoning: "", fast: false } : chosen;
}

/**
 * Providers that can still be added, with their sign-in methods, from Hermes' settings backend:
 * account sign-ins (`/api/providers/oauth`) and API-key variables (`/api/env`). Providers already
 * in the model list are left out; aliases of one method (e.g. GOOGLE_/GEMINI_API_KEY) count once.
 */
export function addableProviders(accountRows, envRows, connectedKeys) {
  const groups = new Map();
  const add = (channelId, fallbackName, method) => {
    const { key, name } = providerOf(channelId, fallbackName);
    if (connectedKeys.has(key) || SKIPPED_CHANNELS.has(channelId)) return;
    if (!groups.has(key)) groups.set(key, { key, name, methods: [] });
    const methods = groups.get(key).methods;
    if (!methods.some((item) => item.kind === method.kind)) methods.push(method);
  };
  for (const row of accountRows) {
    add(row.id, row.name, { kind: "subscription", id: row.id, flow: row.flow, command: row.cli_command || "" });
  }
  for (const [envVar, meta] of Object.entries(envRows)) {
    if (meta.category !== "provider" || !meta.provider || !/_(KEY|TOKEN)$/.test(envVar)) continue;
    add(meta.provider, meta.provider_label, { kind: "api_key", id: meta.provider, envVar, url: meta.url || "" });
  }
  for (const { id, model, endpoint } of FREE_PROVIDERS) {
    if (endpoint) add(id, endpoint.name, { kind: "api_key", id, envVar: endpoint.key_env, url: endpoint.url, endpoint: { ...endpoint, model } });
  }
  return [...groups.values()];
}

// The add list, for people who know an AI by its product name rather than its company: the popular
// ones first and open, the rest folded by what they are, each in order of how widely it is known. A
// Provider not listed falls under the last one, alphabetically after the listed ones.
const ADD_CATEGORIES = [
  { label: "많이 쓰는 AI", open: true, keys: ["openai", "anthropic", "google", "xai", "copilot", "meta-ai"] },
  { label: "여러 AI를 한 곳에서", keys: ["openrouter", "ai-gateway", "kilocode", "opencode-zen", "opencode-go", "nous"] },
  { label: "오픈소스 모델 서비스", keys: ["groq", "mistral", "huggingface", "fireworks", "deepinfra", "novita", "gmi", "nebius-token-factory", "nvidia", "ollama-cloud", "arcee"] },
  {
    label: "중국 AI",
    keys: ["deepseek", "qwen", "kimi-coding", "kimi-coding-cn", "zai", "minimax", "minimax-cn", "stepfun", "xiaomi",
      "tencent-tokenhub", "tencent-tokenplan", "alibaba-token-plan", "alibaba-token-plan-cn", "alibaba-coding-plan", "alibaba-coding-plan-cn"],
  },
  { label: "내 컴퓨터·직접 연결", keys: ["lmstudio"] },
  { label: "기타 (개발자·기업용)", keys: [] },
];

// The name people know, where the engine gives the company's or a plan's.
const KNOWN_NAMES = {
  openai: "ChatGPT (OpenAI)", anthropic: "Claude (Anthropic)", google: "Gemini (Google)", xai: "Grok (xAI)",
  "meta-ai": "Meta AI (Llama)", qwen: "Qwen (Alibaba)", zai: "GLM (Z.ai)",
  "kimi-coding": "Kimi (Moonshot)", "kimi-coding-cn": "Kimi (Moonshot, China)",
};

/** addableProviders() rows in folded categories: [{ label, open, items }], empty categories left out. */
export function addCategories(addable) {
  // A mainland-China endpoint reads as such, whatever the engine calls it.
  const named = addable.map((group) => ({ ...group, name: (KNOWN_NAMES[group.key] || group.name).replace(/\bChina\b/g, "중국 본토") }));
  const placed = new Set();
  const categories = ADD_CATEGORIES.map(({ label, open = false, keys }) => {
    const items = keys.map((key) => named.find((group) => group.key === key)).filter(Boolean);
    items.forEach((group) => placed.add(group.key));
    return { label, open, items };
  });
  const unlisted = named.filter((group) => !placed.has(group.key)).sort((a, b) => a.name.localeCompare(b.name));
  categories.at(-1).items.push(...unlisted);
  return categories.filter((category) => category.items.length);
}
