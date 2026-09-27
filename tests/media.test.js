import { beforeEach, describe, expect, it, vi } from "vitest";

import { createMediaSection, mediaConfig, mediaPlan } from "../src/media.js";

const pick = (plan) => Object.fromEntries(plan.map(({ kind, route }) => [kind.key, route?.channel || null]));

describe("media backends from the connected Providers", () => {
  beforeEach(() => window.localStorage.clear());

  it("turns on what the connected Providers can do, best first, and nothing else", () => {
    // A ChatGPT and a Claude subscription: images only.
    expect(pick(mediaPlan(new Set(["openai-codex", "anthropic"])))).toEqual({ image: "openai-codex", video: null, speech: null, listen: null });
    // Grok's subscription makes images and video, not speech; an OpenAI key adds speech and dictation.
    expect(pick(mediaPlan(new Set(["xai-oauth", "openai-api"])))).toEqual({ image: "xai-oauth", video: "xai-oauth", speech: "openai-api", listen: "openai-api" });
  });

  it("keeps a chosen Provider while it is connected, and goes back to the best one when it is not", () => {
    const connected = new Set(["openai-codex", "openrouter"]);
    expect(pick(mediaPlan(connected, { image: "openrouter" })).image).toBe("openrouter");
    expect(pick(mediaPlan(new Set(["openai-codex"]), { image: "openrouter" })).image).toBe("openai-codex");
  });

  it("writes each backend in use and offers only the media tools that have one", () => {
    expect(mediaConfig(mediaPlan(new Set(["openai-codex"])))).toEqual({
      platform_toolsets: { api_server: ["hermes-api-server", "image_gen"] },
      image_gen: { provider: "openai-codex" },
    });
    expect(mediaConfig(mediaPlan(new Set(["xai", "groq"])))).toEqual({
      platform_toolsets: { api_server: ["hermes-api-server", "image_gen", "video_gen", "tts"] },
      image_gen: { provider: "xai" },
      video_gen: { provider: "xai" },
      tts: { provider: "xai" },
      stt: { enabled: true, provider: "groq" },
    });
    expect(mediaConfig(mediaPlan(new Set(["anthropic"])))).toEqual({ platform_toolsets: { api_server: ["hermes-api-server"] } });
  });
});

describe("Settings → 미디어", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    window.localStorage.clear();
  });

  it("shows what each kind runs on, which Provider would turn it on, and a choice only when there is one", () => {
    let connected = new Set(["openai-codex", "openrouter"]);
    const onChange = vi.fn();
    const section = createMediaSection({ getConnected: () => connected, onChange });
    document.body.append(section.element);
    section.render();
    const row = (key) => document.querySelector(`[data-media="${key}"]`);
    expect(row("image").querySelector(".media-status").textContent).toBe("ChatGPT 구독로 연결됨");
    expect(row("video").querySelector(".media-status").textContent).toBe("OpenRouter로 연결됨");
    expect(row("speech").querySelector(".field-note").textContent).toContain("OpenAI나 Gemini");
    expect(row("video").querySelector("select")).toBeNull();

    const select = row("image").querySelector("select");
    select.value = "openrouter";
    select.dispatchEvent(new Event("change"));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(pick(onChange.mock.calls[0][0]).image).toBe("openrouter");
    expect(document.querySelector('[data-media="image"] .media-status').textContent).toBe("OpenRouter로 연결됨");

    // The choice is kept for the next start.
    connected = new Set(["openai-codex", "openrouter"]);
    expect(pick(createMediaSection({ getConnected: () => connected, onChange }).plan()).image).toBe("openrouter");
  });
});
