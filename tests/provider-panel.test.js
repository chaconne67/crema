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
  DEEPSEEK_API_KEY: { category: "provider", provider: "deepseek", provider_label: "DeepSeek", url: "https://platform.deepseek.com" },
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("Provider section", () => {
  let connection;
  let status;
  let host;
  let onChanged;
  let section;

  beforeEach(() => {
    document.body.innerHTML = "";
    connection = { mode: "local" };
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
      status = [...status, { key: "deepseek", name: "DeepSeek", methods: ["api_key"] }];
    });
    section = createProviderSection({ host, getConnection: () => connection, getStatus: () => status, onChanged });
    document.body.append(section.element);
    section.render();
  });

  const $ = (selector) => document.querySelector(selector);
  const rows = () => [...document.querySelectorAll(".provider-list li")].map((row) => [...row.children].map((cell) => cell.textContent).filter(Boolean).join(" "));

  it("lists each connected Provider, marked ON, with how it is signed in", async () => {
    expect(rows()).toEqual(["OpenAION 구독", "xAION 구독 · API 키"]);
  });

  it("offers only the Providers not yet added", async () => {
    $("[data-provider-add]").click();
    await flush();
    expect([...$("#provider-select").options].map((option) => option.textContent)).toEqual(["Anthropic", "DeepSeek"]);
    // Anthropic has two sign-in methods, so the choice is shown; it starts on the terminal sign-in.
    expect($("[data-method-field]").hidden).toBe(false);
    $("[data-open-terminal]").click();
    expect(host.openLoginTerminal).toHaveBeenCalledWith("hermes auth add anthropic");
  });

  it("asks nothing about the method when there is one, and saves a checked API key through Hermes", async () => {
    $("[data-provider-add]").click();
    await flush();
    const select = $("#provider-select");
    select.value = "1";
    select.dispatchEvent(new Event("change"));
    expect($("[data-method-field]").hidden).toBe(true);

    $("#provider-key").value = "sk-test";
    $("[data-save-key]").click();
    await flush();
    await flush();
    expect(host.hermesAdmin).toHaveBeenCalledWith("POST", "/api/providers/validate", { key: "DEEPSEEK_API_KEY", value: "sk-test" });
    expect(host.hermesAdmin).toHaveBeenCalledWith("PUT", "/api/env", { key: "DEEPSEEK_API_KEY", value: "sk-test" });
    expect(onChanged).toHaveBeenCalled();
    expect($("[data-provider-form]").hidden).toBe(true);
    expect(rows()).toContain("DeepSeekON API 키");
  });

  it("leaves a remote Hermes' Providers to the server", () => {
    connection.mode = "remote";
    section.render();
    expect($("[data-provider-add]").hidden).toBe(true);
    expect($("[data-provider-note]").textContent).toContain("서버");
  });
});
