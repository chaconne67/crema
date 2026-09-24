import { beforeEach, describe, expect, it, vi } from "vitest";

import { createModelPicker } from "../src/model-picker.js";
import { buildCatalog, locate } from "../src/providers.js";

const CATALOG = buildCatalog([
  { id: "openai-codex", name: "ChatGPT or Codex Subscription", models: ["gpt-6-astra", "gpt-6-sol"], capabilities: { "gpt-6-astra": { fast: true } } },
  { id: "anthropic", name: "Anthropic", models: ["claude-opus-5.5"], capabilities: {} },
]);

describe("Provider → model picker", () => {
  let current;
  let onChoose;

  beforeEach(() => {
    document.body.innerHTML = "";
    current = { provider: "openai-codex", model: "gpt-6-sol", fast: false };
    const getSelection = () => {
      const found = locate(CATALOG, current.provider, current.model);
      return { key: found?.key, provider: found?.provider, name: current.model, fast: current.fast };
    };
    onChoose = vi.fn(({ model, fast }) => Object.assign(current, { model: model.routes[0].modelId, provider: model.routes[0].providerId, fast }));
    const picker = createModelPicker({ getCatalog: () => CATALOG, getSelection, onChoose });
    document.body.append(picker.element);
    picker.refresh();
  });

  const labels = () => [...document.querySelectorAll(".dropdown-list .menu-label")].map((node) => node.textContent);
  const items = () => document.querySelectorAll(".dropdown-list .menu-item");

  it("opens with every Provider folded but the current one, its model highlighted", () => {
    document.querySelector(".dropdown-button").click();
    expect(labels()).toEqual(["OpenAI", "gpt-6-astra", "gpt-6-astra", "gpt-6-sol", "Anthropic"]);
    expect(items()[0].getAttribute("aria-expanded")).toBe("true");
    expect(items()[4].getAttribute("aria-expanded")).toBe("false");
    expect(items()[2].querySelector(".zap")).not.toBeNull();
    expect(document.querySelector(".menu-item[aria-selected='true'] .menu-label").textContent).toBe("gpt-6-sol");
    expect(document.querySelector(".menu-item.active .menu-label").textContent).toBe("gpt-6-sol");
  });

  it("opens another Provider in place and reports the chosen model and speed", () => {
    const button = document.querySelector(".dropdown-button");
    button.click();
    items()[4].click();
    expect(labels()).toEqual(["OpenAI", "Anthropic", "claude-opus-5.5"]);
    items()[0].click();
    expect(labels()).toEqual(["OpenAI", "gpt-6-astra", "gpt-6-astra", "gpt-6-sol", "Anthropic"]);
    items()[2].click();

    expect(onChoose).toHaveBeenCalledWith({ model: CATALOG[0].models[0], fast: true });
    expect(button.querySelector(".zap")).not.toBeNull();
    expect(button.querySelector(".model-provider").textContent).toBe("OpenAI");
    expect(document.querySelector(".dropdown-list").hidden).toBe(true);
  });
});
