import { describe, expect, it } from "vitest";

import bundled from "../server/web/free_catalog.json";
import {
  addCategories,
  addableProviders,
  autoRoute,
  buildCatalog,
  freeChain,
  freeProviders,
  setFreeCatalog,
  locate,
  pickRoute,
  providerStatus,
  routesFor,
  suggestionRoute,
  turnNeeds,
  turnRoute,
} from "../src/providers.js";

const CHANNELS = [
  { id: "nous", name: "Nous Portal", models: ["hermes-5"], capabilities: {} },
  { id: "openrouter", name: "OpenRouter", models: ["anthropic/claude-opus-5"], capabilities: {} },
  { id: "moa", name: "Mixture of Agents", models: ["moa-default"], capabilities: {} },
  { id: "xai", name: "xAI", models: ["grok-5", "grok-5-mini"], capabilities: {} },
  { id: "openai-codex", name: "ChatGPT or Codex Subscription", models: ["gpt-6-sol"], capabilities: { "gpt-6-sol": { fast: true } } },
  { id: "xai-oauth", name: "xAI Grok OAuth", models: ["grok-5"], capabilities: {} },
];

const KINDS = { nous: { kind: "oauth", relogin: true }, "xai-oauth": { kind: "oauth", relogin: false } };

describe("Provider model list", () => {
  it("groups channels by Provider, leaving out re-login and virtual channels", () => {
    const catalog = buildCatalog(CHANNELS, KINDS);
    expect(catalog.map((group) => group.provider)).toEqual(["OpenRouter", "xAI", "OpenAI"]);
    expect(catalog[1].models.map((model) => model.name)).toEqual(["grok-5", "grok-5-mini"]);
    expect(catalog[2].models[0].fast).toBe(true);
  });

  it("uses a Provider's subscription before its API key, keeping a working current channel", () => {
    const catalog = buildCatalog(CHANNELS, KINDS);
    const grok = catalog[1].models[0];
    expect(routesFor(grok, false).map((route) => route.providerId)).toEqual(["xai-oauth", "xai"]);
    expect(pickRoute(grok, false, "openai-codex").providerId).toBe("xai-oauth");
    expect(pickRoute(grok, false, "xai").providerId).toBe("xai");
    expect(locate(catalog, "xai", "grok-5")).toMatchObject({ key: "xai", provider: "xAI", model: grok });
  });
});

describe("Provider status list", () => {
  it("shows each connected Provider and how it is signed in, leaving out lapsed sign-ins", () => {
    expect(providerStatus(CHANNELS, KINDS)).toEqual([
      { key: "openrouter", name: "OpenRouter", methods: ["api_key"] },
      { key: "xai", name: "xAI", methods: ["subscription", "api_key"] },
      { key: "openai", name: "OpenAI", methods: ["subscription"] },
    ]);
  });
});

describe("Providers that can be added", () => {
  const ACCOUNTS = [
    { id: "nous", name: "Nous Portal", flow: "device_code", cli_command: "hermes auth add nous" },
    { id: "openai-codex", name: "ChatGPT or Codex Subscription", flow: "device_code" },
    { id: "anthropic", name: "Anthropic API Key", flow: "external", cli_command: "hermes auth add anthropic" },
    { id: "claude-code", name: "Anthropic OAuth", flow: "external", cli_command: "claude setup-token" },
  ];
  const ENV = {
    OPENAI_API_KEY: { category: "provider", provider: "openai-api", provider_label: "OpenAI API", url: null },
    ANTHROPIC_API_KEY: { category: "provider", provider: "anthropic", provider_label: "Anthropic", url: null },
    GOOGLE_API_KEY: { category: "provider", provider: "gemini", provider_label: "Google AI Studio", url: "https://aistudio.google.com" },
    GEMINI_API_KEY: { category: "provider", provider: "gemini", provider_label: "Google AI Studio", url: "https://aistudio.google.com" },
    GEMINI_BASE_URL: { category: "provider", provider: "gemini", provider_label: "Google AI Studio", url: null },
    COPILOT_GITHUB_TOKEN: { category: "provider", provider: "copilot", provider_label: "GitHub Copilot", url: null },
    AWS_REGION: { category: "provider", provider: "bedrock", provider_label: "AWS Bedrock", url: null },
    HERMES_ANON_API_SECRET: { category: "provider", provider: "", provider_label: "" },
  };

  it("lists Providers not yet signed in, one entry per sign-in method done inside Crema", () => {
    const addable = addableProviders(ACCOUNTS, ENV, new Set(["openai"]));
    expect(addable.map((group) => group.name)).toEqual(["Nous Portal", "Anthropic", "Google", "GitHub Copilot", "Groq", "Mistral"]);
    // Sign-ins the engine leaves to a terminal (Claude's subscription, Claude Code's token) are not offered.
    expect(addable.flatMap((group) => group.methods).some((method) => method.id === "claude-code")).toBe(false);
    const anthropic = addable[1];
    expect(anthropic.methods.map((method) => [method.kind, method.id])).toEqual([["api_key", "anthropic"]]);
    expect(addable[2].methods).toEqual([
      { kind: "api_key", id: "gemini", envVar: "GOOGLE_API_KEY", url: "https://aistudio.google.com" },
    ]);
  });
});

describe("free Provider failover", () => {
  const channel = (id, models) => ({ id, name: id, models, capabilities: {} });
  const CONNECTED = [
    channel("openrouter", ["anthropic/claude-opus-5", "qwen/qwen3.8:free"]),
    channel("gemini", ["gemini-3.5-flash", "gemini-3.5-flash-lite"]),
    channel("groq", ["llama-4-scout", "openai/gpt-oss-120b"]),
    channel("xai", ["grok-5"]),
  ];

  it("chains the connected free Providers in order, each on its free model, leaving out those cooling off", () => {
    expect(freeChain(CONNECTED)).toEqual([
      { provider: "gemini", model: "gemini-3.5-flash-lite" },
      { provider: "groq", model: "openai/gpt-oss-120b" },
      { provider: "openrouter", model: "qwen/qwen3.8:free" },
    ]);
    expect(freeChain(CONNECTED, { gemini: 2000, groq: 500 }, 1000).map((entry) => entry.provider)).toEqual(["groq", "openrouter"]);
  });

  it("answers a turn from the next free Provider only while the chosen one cools off", () => {
    const chosen = { provider: "gemini", model: "gemini-3.5-flash", reasoning: "high", fast: false };
    const chain = freeChain(CONNECTED, { gemini: 2000 }, 1000);
    expect(turnRoute(chosen, chain, {}, 1000)).toBe(chosen);
    expect(turnRoute(chosen, chain, { gemini: 2000 }, 1000)).toEqual({ provider: "groq", model: "openai/gpt-oss-120b", reasoning: "", fast: false });
    expect(turnRoute(chosen, [], { gemini: 2000 }, 1000)).toBe(chosen);
  });

  it("picks an automatic turn's model: kept in the conversation, a common allowance before a scarce one, images read when needed", () => {
    const connected = [
      channel("gemini", ["gemini-3.5-flash", "gemini-3.5-flash-lite"]),
      channel("groq", ["openai/gpt-oss-120b", "openai/gpt-oss-20b"]),
      channel("mistral", ["mistral-small-latest"]),
    ];
    expect(autoRoute(connected)).toEqual({ provider: "gemini", model: "gemini-3.5-flash-lite" });
    // Hard requests skip tier 1, and keep the scarce Gemini Flash behind Groq's common allowance.
    expect(autoRoute(connected, {}, { difficulty: 2 })).toEqual({ provider: "groq", model: "openai/gpt-oss-120b" });
    expect(autoRoute(connected, { gemini: 2000 }, {}, null, 1000)).toEqual({ provider: "groq", model: "openai/gpt-oss-20b" });
    expect(autoRoute(connected, { gemini: 2000 }, { vision: true }, null, 1000)).toEqual({ provider: "mistral", model: "mistral-small-latest" });
    const kept = { provider: "mistral", model: "mistral-small-latest" };
    expect(autoRoute(connected, {}, {}, kept)).toEqual(kept);
    expect(autoRoute([channel("xai", ["grok-5"])])).toBeNull();
  });

  it("turns the site's judgment into what a turn needs", () => {
    expect(turnNeeds("안녕", null)).toEqual({ vision: false });
    expect(turnNeeds([{ type: "text", text: "이거 봐" }, { type: "image_url", image_url: { url: "data:" } }], null)).toEqual({ vision: true });
    const judged = (fields) => turnNeeds("질문", { difficulty: 0, confidence: 1, needs_tools: 0, sensitive: 0, ...fields });
    expect(judged({})).toEqual({ vision: false, difficulty: 1, private: false });
    expect(judged({ difficulty: 2.99 })).toEqual({ vision: false, difficulty: 3, private: false });
    // Unsure goes one up; the computer or live information needs at least tier 2; personal data asks for privacy.
    expect(judged({ difficulty: 1.47, confidence: 0.5, sensitive: 0.98 })).toEqual({ vision: false, difficulty: 2, private: true });
    expect(judged({ difficulty: 0.14, needs_tools: 0.92 })).toEqual({ vision: false, difficulty: 2, private: false });
  });

  it("eases a hard or private automatic turn step by step and says so", () => {
    const connected = [channel("gemini", ["gemini-3.5-flash", "gemini-3.5-flash-lite"]), channel("groq", ["openai/gpt-oss-20b"])];
    // No tier-3 free model: the best tier 2 (scarce Gemini Flash), noted as eased.
    expect(autoRoute(connected, {}, { difficulty: 3 })).toEqual({ provider: "gemini", model: "gemini-3.5-flash", eased: "difficulty" });
    // Personal data leaves out Gemini (trains on input) while anything else fits.
    expect(autoRoute(connected, {}, { difficulty: 1, private: true })).toEqual({ provider: "groq", model: "openai/gpt-oss-20b" });
    expect(autoRoute([connected[0]], {}, { difficulty: 1, private: true })).toEqual({
      provider: "gemini",
      model: "gemini-3.5-flash-lite",
      eased: "private",
    });
  });

  it("takes a catalog from the site and ignores one of another shape", () => {
    const connected = [channel("groq", ["openai/gpt-oss-20b"]), channel("newfree", ["n-1"])];
    setFreeCatalog({ providers: [{ id: "newfree", name: "NewFree", models: [{ id: "n-1", tier: 1, scarcity: "common" }] }] });
    expect(freeChain(connected)).toEqual([{ provider: "newfree", model: "n-1" }]);
    setFreeCatalog({ broken: true });
    expect(freeChain(connected)).toEqual([{ provider: "newfree", model: "n-1" }]);
    // The site cannot change which page the sign-up guide opens, nor drop it.
    setFreeCatalog({ providers: [{ id: "gemini", name: "Gemini", signup: { url: "https://elsewhere.example" }, models: [] }] });
    expect(freeProviders().find((item) => item.id === "gemini").signup.url).toBe("https://aistudio.google.com/apikey");
    setFreeCatalog({ providers: [{ id: "gemini", name: "Gemini", models: [] }] });
    expect(freeProviders().find((item) => item.id === "gemini").signup.url).toBe("https://aistudio.google.com/apikey");
    // The site cannot move where a key is sent.
    setFreeCatalog({ providers: [{ id: "groq", name: "Groq", endpoint: { base_url: "https://elsewhere.example/v1", key_env: "GROQ_API_KEY" }, models: [{ id: "openai/gpt-oss-20b", tier: 1 }] }] });
    expect(addableProviders([], {}, new Set()).find((group) => group.key === "groq").methods[0].endpoint.base_url).toBe("https://api.groq.com/openai/v1");
    setFreeCatalog(bundled);
    expect(freeChain(connected)).toEqual([{ provider: "groq", model: "openai/gpt-oss-20b" }]);
  });

  it("offers Groq and Mistral as OpenAI-compatible endpoints with their free model", () => {
    const groq = addableProviders([], {}, new Set()).find((group) => group.key === "groq");
    expect(groq.methods).toEqual([
      {
        kind: "api_key",
        id: "groq",
        envVar: "GROQ_API_KEY",
        url: "https://console.groq.com/keys",
        endpoint: expect.objectContaining({ base_url: "https://api.groq.com/openai/v1", key_env: "GROQ_API_KEY", model: "openai/gpt-oss-120b" }),
      },
    ]);
  });
});

describe("next-input prediction model", () => {
  const channel = (id, models) => ({ id, name: id, models, capabilities: {} });

  it("prefers a small subscription model and falls back to Gemini 3.1 Flash Lite", () => {
    const both = buildCatalog([channel("gemini", ["gemini-3.1-flash-lite"]), channel("openai-codex", ["gpt-6-sol", "gpt-6-luna"])]);
    expect(suggestionRoute(both)).toMatchObject({ providerId: "openai-codex", modelId: "gpt-6-luna", subscription: true, provider: "OpenAI" });
    const keyOnly = buildCatalog([channel("gemini", ["gemini-3.1-flash-lite", "gemini-2.5-pro"])]);
    expect(suggestionRoute(keyOnly)).toMatchObject({ providerId: "gemini", modelId: "gemini-3.1-flash-lite", subscription: false });
    expect(suggestionRoute(buildCatalog([channel("openrouter", ["x"])]))).toBeNull();
  });
});

describe("Provider add list", () => {
  const group = (key, name) => ({ key, name, methods: [{ kind: "api_key" }] });

  it("keeps each category in order of how widely known, and reads mainland-China endpoints as such", () => {
    const categories = addCategories([
      group("alibaba-coding-plan-cn", "Alibaba Cloud (Coding Plan, China)"),
      group("kimi-coding", "Kimi / Kimi Coding Plan"),
      group("deepseek", "DeepSeek"),
      group("zeta", "Zeta"),
      group("acme", "Acme"),
    ]);
    expect(categories.map((category) => [category.label, category.items.map((item) => item.name)])).toEqual([
      ["중국 AI", ["DeepSeek", "Kimi (Moonshot)", "Alibaba Cloud (Coding Plan, 중국 본토)"]],
      ["기타 (개발자·기업용)", ["Acme", "Zeta"]],
    ]);
  });
});
