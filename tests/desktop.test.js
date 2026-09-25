import { beforeEach, describe, expect, it } from "vitest";

import {
  loadConnection,
  parseModelChoice,
  supportsFast,
  usableProviders,
} from "../src/desktop.js";

const PROVIDERS = [
  {
    id: "openai-codex",
    name: "ChatGPT or Codex Subscription",
    models: ["gpt-6-astra", "gpt-5.5"],
    capabilities: { "gpt-6-astra": { fast: true }, "gpt-5.5": { fast: false } },
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    models: ["gpt-6-astra", "claude-opus-5.5"],
    capabilities: {},
  },
];

describe("desktop connection", () => {
  beforeEach(() => window.localStorage.clear());

  it("defaults to the engine's own default model", () => {
    expect(loadConnection()).toEqual({ provider: "", model: "" });
  });

  it("offers only signed-in providers that have models, with their capabilities", () => {
    const providers = usableProviders({
      providers: [
        {
          slug: "openai-codex",
          name: "ChatGPT or Codex Subscription",
          authenticated: true,
          models: ["gpt-6-sol"],
          capabilities: { "gpt-6-sol": { fast: true } },
        },
        { slug: "fireworks", name: "Fireworks AI", authenticated: false, models: [] },
        { slug: "moa", name: "Mixture", authenticated: true, models: [] },
      ],
    });
    expect(providers).toEqual([
      {
        id: "openai-codex",
        name: "ChatGPT or Codex Subscription",
        models: ["gpt-6-sol"],
        capabilities: { "gpt-6-sol": { fast: true } },
      },
    ]);
  });
});

describe("model choices", () => {
  it("reads a typed fast choice and knows which sign-in offers priority processing", () => {
    expect(parseModelChoice("gpt-6-astra#fast")).toEqual({ model: "gpt-6-astra", fast: true });
    expect(parseModelChoice("gpt-6-astra")).toEqual({ model: "gpt-6-astra", fast: false });
    expect(supportsFast(PROVIDERS, "openrouter", "gpt-6-astra")).toBe(false);
  });
});
