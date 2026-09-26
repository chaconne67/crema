import { beforeEach, describe, expect, it, vi } from "vitest";

import { createProviderSection } from "../src/provider-panel.js";

const ACCOUNTS = {
  providers: [
    { id: "openai-codex", name: "ChatGPT or Codex Subscription", flow: "device_code" },
    { id: "anthropic", name: "Anthropic API Key", flow: "external", cli_command: "hermes auth add anthropic" },
  ],
};
const ENV = {
  ANTHROPIC_API_KEY: { category: "provider", provider: "anthropic", provider_label: "Anthropic", url: null },
  OPENROUTER_API_KEY: { category: "provider", provider: "openrouter", provider_label: "OpenRouter", url: "https://openrouter.ai/keys" },
  DEEPSEEK_API_KEY: { category: "provider", provider: "deepseek", provider_label: "DeepSeek", url: null },
  COPILOT_GITHUB_TOKEN: { category: "provider", provider: "copilot", provider_label: "GitHub Copilot", url: null },
  NEWCO_API_KEY: { category: "provider", provider: "newco", provider_label: "NewCo", url: null },
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("Provider section", () => {
  let status;
  let host;
  let onChanged;
  let section;

  beforeEach(() => {
    document.body.innerHTML = "";
    status = [
      { key: "openai", name: "OpenAI", methods: ["subscription"] },
      { key: "xai", name: "xAI", methods: ["subscription", "api_key"] },
    ];
    host = {
      hermesAdmin: vi.fn(async (method, path) => {
        if (path === "/api/providers/oauth") return ACCOUNTS;
        if (path === "/api/env" && method === "GET") return ENV;
        if (path === "/api/providers/validate") return { ok: true, reachable: true };
        return {};
      }),
      openLoginTerminal: vi.fn(async () => {}),
      openLink: vi.fn(),
    };
    onChanged = vi.fn(async () => {
      status = [...status, { key: "openrouter", name: "OpenRouter", methods: ["api_key"] }];
    });
    section = createProviderSection({ host, getStatus: () => status, onChanged });
    document.body.append(section.element);
    section.render();
  });

  const $ = (selector) => document.querySelector(selector);
  const rows = () => [...document.querySelectorAll(".provider-list li")].map((row) => [...row.children].map((cell) => cell.textContent).filter(Boolean).join(" "));
  const groups = () =>
    [...document.querySelectorAll(".provider-group")].map((group) => ({
      label: group.querySelector("summary").firstChild.textContent,
      open: group.open,
      items: [...group.querySelectorAll(".provider-choice")].map((item) => item.textContent),
    }));
  const choose = (name) => [...document.querySelectorAll(".provider-choice")].find((item) => item.textContent.startsWith(name)).click();

  it("lists each connected Provider, marked ON, with how it is signed in", async () => {
    expect(rows()).toEqual(["OpenAION 구독", "xAION 구독 · API 키"]);
  });

  it("offers the Providers not yet added by the name people know, folded by what they are", async () => {
    $("[data-provider-add]").click();
    await flush();
    // Only the popular ones open; a Provider no category names falls under the last; a GitHub token is not an API key.
    expect(groups()).toEqual([
      { label: "많이 쓰는 AI", open: true, items: ["Claude (Anthropic)구독 · API 키", "GitHub Copilot토큰"] },
      { label: "여러 AI를 한 곳에서", open: false, items: ["OpenRouterAPI 키"] },
      { label: "중국 AI", open: false, items: ["DeepSeekAPI 키"] },
      { label: "기타 (개발자·기업용)", open: false, items: ["NewCoAPI 키"] },
    ]);
    choose("Claude");
    expect($("[data-chosen-name]").textContent).toBe("Claude (Anthropic)");
    expect($("[data-provider-picker]").hidden).toBe(true);
    // Anthropic has two sign-in methods, so the choice is shown; it starts on the terminal sign-in.
    expect($("[data-method-field]").hidden).toBe(false);
    $("[data-open-terminal]").click();
    expect(host.openLoginTerminal).toHaveBeenCalledWith("hermes auth add anthropic");
  });

  it("finds a Provider by name, and goes back to the list to pick another", async () => {
    $("[data-provider-add]").click();
    await flush();
    const search = $("[data-provider-search]");
    search.value = "deep";
    search.dispatchEvent(new Event("input"));
    expect(groups()).toEqual([{ label: "중국 AI", open: true, items: ["DeepSeekAPI 키"] }]);
    choose("DeepSeek");
    $("[data-provider-repick]").click();
    expect($("[data-provider-picker]").hidden).toBe(false);
    expect($("[data-provider-step]").textContent).toBe("");
  });

  it("asks nothing about the method when there is one, and saves a checked API key through the engine", async () => {
    $("[data-provider-add]").click();
    await flush();
    choose("OpenRouter");
    expect($("[data-method-field]").hidden).toBe(true);

    $("#provider-key").value = "sk-test";
    $("[data-save-key]").click();
    await flush();
    await flush();
    expect(host.hermesAdmin).toHaveBeenCalledWith("POST", "/api/providers/validate", { key: "OPENROUTER_API_KEY", value: "sk-test" });
    expect(host.hermesAdmin).toHaveBeenCalledWith("PUT", "/api/env", { key: "OPENROUTER_API_KEY", value: "sk-test" });
    expect(onChanged).toHaveBeenCalled();
    expect($("[data-provider-form]").hidden).toBe(true);
    expect(rows()).toContain("OpenRouterON API 키");
  });
});
