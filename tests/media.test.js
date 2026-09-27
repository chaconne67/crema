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
  let puts;

  beforeEach(() => {
    document.body.innerHTML = "";
    window.localStorage.clear();
    env = {};
    imageAsks = 0;
    puts = [];
    host = {
      hermesAdmin: vi.fn(async (method, path, body) => {
        if (method === "PUT" && path === "/api/env") {
          puts.push(body);
          env = { ...env, [body.key]: { is_set: true } };
          return {};
        }
        if (path === "/api/providers/validate") return { ok: true };
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

  const card = (key) => document.querySelector(`[data-media="${key}"]`);
  const state = (key) => card(key).querySelector(".feature-state").textContent;
  const detail = (key) => Object.fromEntries([...card(key).querySelectorAll(".feature-details > div")].map((row) => [row.querySelector("dt").textContent, row.querySelector("dd").textContent]));
  const click = (key, selector) => card(key).querySelector(selector).click();
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  it("shows a card per feature: whether it can be used, and the details of that", async () => {
    const section = createMediaSection({ host, getConnected: () => new Set(["openai-codex", "openrouter"]), onChange: vi.fn() });
    document.body.append(section.element);
    section.render();
    await flush();
    expect([...document.querySelectorAll(".feature-name")].map((item) => item.textContent)).toEqual(["이미지 생성", "동영상 생성", "웹 검색"]);
    expect([state("image"), state("video"), state("web")]).toEqual(["ON", "ON", "ON"]);
    expect(detail("image")).toEqual({ "사용 중인 서비스": "ChatGPT 구독 자동 선택" });
    expect(detail("video")).toEqual({ "사용 중인 서비스": "OpenRouter", "모델": "기본 (MiniMax: Hailuo 3 Max)" });
    expect(detail("web")["사용 중인 검색"]).toBe("기본 검색 (무료)");
    expect(section.summary()).toBe("3개 중 3개 ON");
  });

  it("changes the service and the model only on 적용, and keeps them", async () => {
    const onChange = vi.fn();
    const section = createMediaSection({ host, getConnected: () => new Set(["openai-codex", "openrouter"]), onChange });
    document.body.append(section.element);
    section.render();
    await flush();

    // Video: its models to choose from, the default first; nothing changes until 적용.
    click("video", "[data-edit]");
    expect(card("video").querySelector("[data-apply]").disabled).toBe(true);
    const model = card("video").querySelector("[data-model]");
    expect([...model.options].map((item) => item.textContent)).toEqual(["기본 (MiniMax: Hailuo 3 Max)", "Google: Veo 3.1"]);
    model.value = "google/veo-3.1";
    model.dispatchEvent(new Event("change", { bubbles: true }));
    expect(onChange).not.toHaveBeenCalled();
    click("video", "[data-apply]");
    expect(onChange.mock.calls[0][0].find((item) => item.kind.key === "video").model).toBe("google/veo-3.1");
    expect(detail("video")["모델"]).toBe("Google: Veo 3.1");
    expect(card("video").querySelector("[role=status]").textContent).toContain("적용했습니다");

    // Image: 자동 and each connected service; 취소 leaves it as it was.
    click("image", "[data-edit]");
    expect([...card("image").querySelectorAll("[data-pick]")].map((item) => item.dataset.pick)).toEqual(["auto", "openai-codex", "openrouter"]);
    expect(card("image").querySelector('[aria-checked="true"]').dataset.pick).toBe("auto");
    click("image", '[data-pick="openrouter"]');
    click("image", "[data-cancel]");
    expect(detail("image")["사용 중인 서비스"]).toBe("ChatGPT 구독 자동 선택");

    // Image goes on OpenRouter: the engine's catalog is taken only once it is OpenRouter's, asked again.
    click("image", "[data-edit]");
    click("image", '[data-pick="openrouter"]');
    click("image", "[data-apply]");
    expect(detail("image")["사용 중인 서비스"]).toBe("OpenRouter");
    await new Promise((resolve) => setTimeout(resolve, 1600));
    expect(detail("image")["모델"]).toBe("기본 (OpenAI GPT-5.4 Image 2)");

    const again = createMediaSection({ host, getConnected: () => new Set(["openai-codex", "openrouter"]), onChange });
    expect(again.plan().find((item) => item.kind.key === "video").model).toBe("google/veo-3.1");
    expect(again.plan().find((item) => item.kind.key === "image").route.channel).toBe("openrouter");
  });

  it("connects what is not: a service picked, then the guide or its key", async () => {
    const onGuide = vi.fn();
    const onConnected = vi.fn(async () => {});
    const section = createMediaSection({ host, getConnected: () => new Set(), onChange: vi.fn(), onGuide, onConnected });
    document.body.append(section.element);
    section.render();
    await flush();
    expect(state("image")).toBe("OFF");
    expect(detail("image")["사용 중인 서비스"]).toBe("없음");
    expect(section.summary()).toBe("3개 중 1개 ON");

    click("image", "[data-edit]");
    expect([...card("image").querySelectorAll("[data-pick]")].map((item) => item.dataset.pick)).toEqual(["openai-codex", "openrouter"]);
    // ChatGPT: a sign-in, so only the guide; no 적용 while nothing is connected.
    expect(card("image").querySelector("[data-key]")).toBeNull();
    expect(card("image").querySelector("[data-apply]")).toBeNull();
    click("image", "[data-guide]");
    expect(onGuide).toHaveBeenLastCalledWith("openai-codex");

    // OpenRouter: the guide, or a key typed in.
    click("image", '[data-pick="openrouter"]');
    const input = card("image").querySelector('[data-key="openrouter"]');
    input.value = "sk-or-v1-test";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    click("image", "[data-save-key]");
    await flush();
    await flush();
    expect(puts).toEqual([{ key: "OPENROUTER_API_KEY", value: "sk-or-v1-test" }]);
    expect(onConnected).toHaveBeenCalled();

    // Web search: Brave's key, then it is Brave's.
    click("web", "[data-edit]");
    click("web", "[data-guide]");
    expect(onGuide).toHaveBeenLastCalledWith("brave");
    const key = card("web").querySelector('[data-key="brave"]');
    key.value = "BSA-test-key-0123456789ab";
    key.dispatchEvent(new Event("input", { bubbles: true }));
    click("web", "[data-save-key]");
    await flush();
    await flush();
    expect(detail("web")["사용 중인 검색"]).toBe("Brave 검색");
    expect(card("web").querySelector("[data-edit]").textContent).toBe("API 키 바꾸기");
  });
});
