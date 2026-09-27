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
      // Off OpenRouter the shared video model is cleared, so Grok uses its own default.
      video_gen: { provider: "xai", model: "" },
      tts: { provider: "xai" },
      stt: { enabled: true, provider: "groq" },
    });
    expect(mediaConfig(mediaPlan(new Set(["anthropic"])))).toEqual({ platform_toolsets: { api_server: ["hermes-api-server"] } });
  });

  it("writes the chosen OpenRouter models: image under OpenRouter's own key, video in the shared one", () => {
    const choices = { models: { image: "google/gemini-3-pro-image", video: "google/veo-3.1" } };
    const config = mediaConfig(mediaPlan(new Set(["openrouter"]), choices));
    expect(config.image_gen).toEqual({ provider: "openrouter", openrouter: { model: "google/gemini-3-pro-image" } });
    expect(config.video_gen).toEqual({ provider: "openrouter", model: "google/veo-3.1" });
    // A model chosen for OpenRouter does not follow the image to ChatGPT.
    expect(mediaConfig(mediaPlan(new Set(["openai-codex", "openrouter"]), { ...choices, image: "openai-codex" })).image_gen).toEqual({ provider: "openai-codex" });
  });
});

describe("Settings → 서비스 연동", () => {
  let env;
  let host;
  let imageAsks;

  beforeEach(() => {
    document.body.innerHTML = "";
    window.localStorage.clear();
    env = {};
    imageAsks = 0;
    host = {
      hermesAdmin: vi.fn(async (method, path) => {
        if (path === "/api/env") return env;
        if (path === "/api/tools/toolsets/video_gen/models") {
          return { plugin: "openrouter", default: "minimax/hailuo-3-max", models: [{ id: "minimax/hailuo-3-max", display: "MiniMax: Hailuo 3 Max" }, { id: "google/veo-3.1", display: "Google: Veo 3.1" }] };
        }
        // Asked first, the engine still has ChatGPT as the image backend; then OpenRouter.
        if (path === "/api/tools/toolsets/image_gen/models") {
          imageAsks += 1;
          return imageAsks === 1
            ? { plugin: "openai-codex", default: "gpt-image", models: [{ id: "gpt-image", display: "GPT Image" }] }
            : { plugin: "openrouter", default: "openai/gpt-5.4-image-2", models: [{ id: "openai/gpt-5.4-image-2", display: "OpenAI GPT-5.4 Image 2" }, { id: "google/gemini-3-pro-image", display: "Gemini 3 Pro Image" }] };
        }
        return {};
      }),
    };
  });

  const row = (key) => document.querySelector(`[data-media="${key}"]`);
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  it("shows image, video and web search with what each is connected through, and nothing else", async () => {
    const onChange = vi.fn();
    const section = createMediaSection({ host, getConnected: () => new Set(["openai-codex", "openrouter"]), onChange });
    document.body.append(section.element);
    section.render();
    await flush();
    expect([...document.querySelectorAll(".feature-name")].map((item) => item.textContent)).toEqual(["이미지 생성", "동영상 생성", "웹 검색"]);
    const cells = (key) => [".feature-state", ".feature-service"].map((cell) => row(key).querySelector(cell).textContent);
    expect(cells("image")).toEqual(["사용 가능", "ChatGPT 구독"]);
    expect(cells("video")).toEqual(["사용 가능", "OpenRouter"]);
    expect(cells("web")).toEqual(["사용 가능", "기본 검색"]);
    expect(document.querySelector(".field-note")).toBeNull();

    // Video runs on OpenRouter: its models to choose from, the default first.
    const model = row("video").querySelector("[data-model]");
    expect([...model.options].map((item) => item.textContent)).toEqual(["기본 (MiniMax: Hailuo 3 Max)", "Google: Veo 3.1"]);
    model.value = "google/veo-3.1";
    model.dispatchEvent(new Event("change", { bubbles: true }));
    expect(onChange.mock.calls[0][0].find((item) => item.kind.key === "video").model).toBe("google/veo-3.1");

    // Image goes on OpenRouter: the engine's catalog is taken only once it is OpenRouter's, asked again.
    const service = row("image").querySelector("[data-service]");
    service.value = "openrouter";
    service.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();
    expect(row("image").querySelector("[data-model]")).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 1600));
    expect([...row("image").querySelector("[data-model]").options].map((item) => item.textContent)).toEqual(["기본 (OpenAI GPT-5.4 Image 2)", "Gemini 3 Pro Image"]);

    // The choices are kept for the next start.
    const again = createMediaSection({ host, getConnected: () => new Set(["openai-codex", "openrouter"]), onChange });
    expect(again.plan().find((item) => item.kind.key === "video").model).toBe("google/veo-3.1");
    expect(again.summary()).toBe("3개 중 3개 사용 가능");
  });

  it("starts the guide from 연결하기, asking which service when there is more than one, and connects Brave for web search", async () => {
    const onGuide = vi.fn();
    const section = createMediaSection({ host, getConnected: () => new Set(), onChange: vi.fn(), onGuide });
    document.body.append(section.element);
    section.render();
    await flush();
    expect(row("image").dataset.on).toBe("false");
    expect(row("image").querySelector(".feature-state").textContent).toBe("사용 불가");
    expect(row("image").querySelector(".feature-service").textContent).toBe("없음");
    expect(section.summary()).toBe("3개 중 1개 사용 가능");

    row("video").querySelector("[data-connect]").click();
    expect(onGuide).toHaveBeenLastCalledWith("openrouter");
    row("image").querySelector("[data-connect]").click();
    const choices = row("image").querySelector("[data-choices]");
    expect(choices.hidden).toBe(false);
    expect([...choices.querySelectorAll("button")].map((item) => item.textContent)).toEqual(["ChatGPT 구독", "OpenRouter"]);
    row("web").querySelector('[data-guide="brave"]').click();
    expect(onGuide).toHaveBeenLastCalledWith("brave");

    env = { BRAVE_SEARCH_API_KEY: { is_set: true } };
    section.render();
    await flush();
    expect(row("web").querySelector(".feature-service").textContent).toBe("Brave 검색");
    expect(row("web").querySelector("[data-guide]")).toBeNull();
    expect(section.summary()).toBe("3개 중 1개 사용 가능");
  });
});
