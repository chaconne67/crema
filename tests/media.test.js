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

describe("Settings → 기능", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    window.localStorage.clear();
  });

  it("marks what is on, offers a choice only when there is one, and never leaves a hint line", () => {
    let connected = new Set(["openai-codex", "openrouter"]);
    const onChange = vi.fn();
    const section = createMediaSection({ getConnected: () => connected, onChange });
    document.body.append(section.element);
    section.render();
    const row = (key) => document.querySelector(`[data-media="${key}"]`);
    expect([...document.querySelectorAll(".feature-name")].map((item) => item.textContent)).toEqual(["대화", "그림", "영상", "말하기", "받아쓰기"]);
    expect(["chat", "image", "video", "speech", "listen"].map((key) => row(key).dataset.on)).toEqual(["true", "true", "true", "false", "false"]);
    expect(row("video").querySelector("select")).toBeNull();
    expect(document.querySelector(".field-note")).toBeNull();

    const select = row("image").querySelector("select");
    select.value = "openrouter";
    select.dispatchEvent(new Event("change"));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(pick(onChange.mock.calls[0][0]).image).toBe("openrouter");

    // The choice is kept for the next start.
    connected = new Set(["openai-codex", "openrouter"]);
    expect(pick(createMediaSection({ getConnected: () => connected, onChange }).plan()).image).toBe("openrouter");
  });

  it("starts the AI setup guide from 연결하기, asking which connection when there is more than one", () => {
    const onGuide = vi.fn();
    const section = createMediaSection({ getConnected: () => new Set(), onChange: vi.fn(), onGuide });
    document.body.append(section.element);
    section.render();
    const row = (key) => document.querySelector(`[data-media="${key}"]`);
    expect(row("chat").dataset.on).toBe("false");

    // One connection turns speech on: it starts at once.
    row("speech").querySelector("[data-connect]").click();
    expect(onGuide).toHaveBeenLastCalledWith("gemini");

    // Images: ChatGPT's subscription or OpenRouter.
    row("image").querySelector("[data-connect]").click();
    expect(onGuide).toHaveBeenCalledTimes(1);
    const choices = row("image").querySelector("[data-choices]");
    expect(choices.hidden).toBe(false);
    expect([...choices.querySelectorAll("button")].map((item) => item.textContent)).toEqual(["ChatGPT 구독", "OpenRouter · 무료"]);
    choices.querySelector('[data-guide="openai-codex"]').click();
    expect(onGuide).toHaveBeenLastCalledWith("openai-codex");
  });
});
