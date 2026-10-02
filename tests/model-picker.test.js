import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildCatalog } from "../src/providers.js";

const CHANNELS = [
  { id: "openai-codex", name: "ChatGPT or Codex Subscription", models: ["gpt-6-astra", "gpt-6-sol"], capabilities: { "gpt-6-astra": { fast: true } } },
  { id: "anthropic", name: "Anthropic", models: ["claude-opus-5.5"], capabilities: {} },
];

describe("Settings → AI 연결: Provider, then 모델 선택", () => {
  let connection;
  let onConnectionChange;

  beforeEach(async () => {
    document.body.innerHTML = "";
    window.matchMedia = vi.fn(() => ({ matches: false, addEventListener() {} }));
    const { createSettingsPanel } = await import("../src/settings-panel.js");
    const { loadAppearance } = await import("../src/settings.js");
    connection = { provider: "openai-codex", model: "gpt-6-sol", fast: false };
    onConnectionChange = vi.fn();
    const panel = createSettingsPanel({
      appearance: loadAppearance(), connection, host: { readSoul: vi.fn(async () => "") },
      onAppearanceChange() {}, onConnectionChange, onProvidersChanged: async () => {}, onSignOut() {},
    });
    const shell = document.createElement("div");
    document.body.append(shell);
    panel.mount(shell);
    panel.setProviders(CHANNELS);
  });

  const options = (id) => [...document.querySelectorAll(`#${id} option`)].map((option) => option.textContent);
  const choose = (id, value) => {
    const select = document.querySelector(`#${id}`);
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  };

  it("lists the connected Providers and only the chosen one's models, fast ones also as 빠른 속도", () => {
    expect(document.querySelector('[data-section="ai"] h3').textContent).toBe("AI 연결");
    expect(options("provider-select")).toEqual(["OpenAI", "Anthropic"]);
    expect(document.querySelector("#provider-select").value).toBe("openai");
    expect(options("model-select")).toEqual(["gpt-6-astra", "gpt-6-astra · 빠른 속도", "gpt-6-sol"]);
    expect(document.querySelector("#model-select").selectedOptions[0].textContent).toBe("gpt-6-sol");
  });

  it("changes the model list with the Provider and uses that Provider's model", () => {
    choose("provider-select", "anthropic");
    expect(options("model-select")).toEqual(["claude-opus-5.5"]);
    expect(connection).toMatchObject({ auto: false, provider: "anthropic", model: "claude-opus-5.5", fast: false });
    choose("provider-select", "openai");
    choose("model-select", "1");
    expect(connection).toMatchObject({ provider: "openai-codex", model: "gpt-6-astra", fast: true });
    expect(onConnectionChange).toHaveBeenCalledTimes(3);
  });

  it("offers 자동 (무료 AI) as a Provider when it is the choice, with no model list", async () => {
    document.body.innerHTML = "";
    const { createSettingsPanel } = await import("../src/settings-panel.js");
    const { loadAppearance } = await import("../src/settings.js");
    const panel = createSettingsPanel({
      appearance: loadAppearance(), connection: { auto: true }, host: { readSoul: vi.fn(async () => "") },
      onAppearanceChange() {}, onConnectionChange() {}, onProvidersChanged: async () => {}, onSignOut() {},
    });
    const shell = document.createElement("div");
    document.body.append(shell);
    panel.mount(shell);
    panel.setProviders(CHANNELS);
    expect(options("provider-select")).toEqual(["자동 (무료 AI)", "OpenAI", "Anthropic"]);
    expect(document.querySelector("#provider-select").value).toBe("auto");
    expect(document.querySelector("#model-select").disabled).toBe(true);
  });
});
