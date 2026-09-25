import { describe, expect, it } from "vitest";

import { addableProviders, buildCatalog, locate, pickRoute, providerStatus, routesFor, suggestionRoute } from "../src/providers.js";

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
    AWS_REGION: { category: "provider", provider: "bedrock", provider_label: "AWS Bedrock", url: null },
    HERMES_ANON_API_SECRET: { category: "provider", provider: "", provider_label: "" },
  };

  it("lists the offered Providers not yet signed in, one entry per sign-in method", () => {
    const addable = addableProviders(ACCOUNTS, ENV, new Set(["openai"]));
    // Nous Portal is not one Crema offers.
    expect(addable.map((group) => group.name)).toEqual(["Anthropic", "Google"]);
    const anthropic = addable[0];
    expect(anthropic.methods.map((method) => [method.kind, method.id])).toEqual([
      ["subscription", "anthropic"],
      ["api_key", "anthropic"],
    ]);
    expect(addable[1].methods).toEqual([
      { kind: "api_key", id: "gemini", envVar: "GOOGLE_API_KEY", url: "https://aistudio.google.com" },
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
