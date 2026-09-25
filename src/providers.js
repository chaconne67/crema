// A Provider is the company the user holds access from. Hermes lists each way of reaching one as its
// own channel ("openai-codex" = ChatGPT subscription, "openai-api" = OpenAI API key); these are merged.
const GROUPS = {
  openai: { name: "OpenAI", ids: ["openai-codex", "openai-api"] },
  anthropic: { name: "Anthropic", ids: ["anthropic"] },
  google: { name: "Google", ids: ["gemini"] },
};
const GROUP_OF = Object.fromEntries(Object.entries(GROUPS).flatMap(([key, group]) => group.ids.map((id) => [id, key])));

// The only channels Crema offers, to add and to use (its engine keeps these; see crema-engine CREMA.md).
// Others the engine may still report (e.g. its mixture-of-agents channel, a Copilot token from the GitHub
// CLI) never show. Claude's subscription is the Anthropic login; the engine does not borrow Claude Code's.
const OFFERED_CHANNELS = new Set(["openai-codex", "openai-api", "anthropic", "gemini", "openrouter"]);

// Subscription channels by name; any channel whose engine credential is OAuth (a Claude login) counts too.
const SUBSCRIPTION_CHANNELS = new Set(["openai-codex"]);

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
    if (!OFFERED_CHANNELS.has(channel.id) || kinds[channel.id]?.relogin) continue;
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

// Small, fast models for predicting the next input: subscriptions first (ChatGPT, then Claude — its
// third-party use may draw extra usage credits, so it comes later), then an API key.
const SUGGESTION_MODELS = [
  ["openai-codex", "gpt-6-luna"],
  ["anthropic", "claude-haiku-4-5-20251001"],
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

/**
 * Providers that can still be added, with their sign-in methods, from Hermes' settings backend:
 * account sign-ins (`/api/providers/oauth`) and API-key variables (`/api/env`). Providers already
 * in the model list are left out; aliases of one method (e.g. GOOGLE_/GEMINI_API_KEY) count once.
 */
export function addableProviders(accountRows, envRows, connectedKeys) {
  const groups = new Map();
  const add = (channelId, fallbackName, method) => {
    const { key, name } = providerOf(channelId, fallbackName);
    if (connectedKeys.has(key) || !OFFERED_CHANNELS.has(channelId)) return;
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
  return [...groups.values()];
}
