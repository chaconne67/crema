import { describe, expect, it, vi } from "vitest";

import { createVoiceSection } from "../src/voice.js";

// The shape of Thock's /api/settings (thock/app.py public_settings).
const SETTINGS = {
  hotkey: "capslock", input_mode: "toggle", input_modes: { hold: "누르고 있는 동안 녹음", toggle: "눌러서 녹음 켜고 끄기" },
  polish: true, polish_level: "clean", polish_levels: { verbatim: "말한 그대로", clean: "군더더기만 빼기", smooth: "읽기 좋게 다듬기" },
  style: "none", styles: { none: "바꾸지 않음", bullets: "개조식", custom: "직접 적기" }, style_custom: "",
  terms: ["Crema", "Thock"], learn: true, sound_processing: true, keep_audio: false,
  microphone: null, microphones: ["USB 마이크"], sound_keyboard: "hhkb", sound_keyboards: { hhkb: "HHKB Professional Hybrid", rainy75: "Rainy75" },
  notes: [{ old: "크래마", new: "Crema", state: "on" }],
  profile: { domain: "소프트웨어 개발", topics: ["음성 입력"], terms: ["Tauri"], updated: "2026-10-02", building: false },
  personal_ready: true, personal_key: "pk1", embedded: false,
  account: { state: "signed_in", email: "me@example.com", error_reports: { enabled: false } }, version: "0.5.1.dev4",
};

function setup(overrides = {}) {
  let settings = { ...SETTINGS, ...overrides };
  const calls = [];
  const host = {
    thockApi: vi.fn(async (path, body) => {
      calls.push([path, body]);
      if (path === "/api/settings" && body) settings = { ...settings, ...body };
      if (path === "/api/notes") {
        settings = { ...settings, notes: [...settings.notes, { old: body.old, new: body.new, state: "on" }] };
        return settings.notes;
      }
      return settings;
    }),
    thockSound: vi.fn(async () => new ArrayBuffer(4)),
    confirm: vi.fn(async () => true),
  };
  const section = createVoiceSection({ host });
  document.body.replaceChildren(section.element);
  return { section, host, calls, element: section.element };
}

describe("Settings → 음성 입력 (voice.js)", () => {
  it("draws Thock's settings with Crema's controls, the dictation group open", async () => {
    const { section, element } = setup();
    await section.load();
    const groups = [...element.querySelectorAll("details.settings-group")];
    expect(groups.map((group) => group.querySelector("summary").textContent)).toEqual(["받아쓰기", "타건음", "용어 사전과 배우기", "기타"]);
    expect(groups.map((group) => group.open)).toEqual([true, false, false, false]);
    expect(element.querySelector("iframe")).toBeNull();
    const mode = element.querySelector("#voice-input-mode");
    expect(mode.options[mode.selectedIndex].textContent).toBe("눌러서 녹음 켜고 끄기");
    expect(element.querySelector('[data-voice-segment="hotkey"] [aria-pressed="true"]').textContent).toBe("CapsLock");
    expect(element.textContent).toContain("CapsLock을 한 번 눌러 시작하고, 다시 누르면 끝납니다.");
    expect(element.textContent).toContain("음·어 같은 망설임 말과 끊긴 말 조각을 빼고");
    expect(element.querySelector(".dropdown")).not.toBeNull(); // Crema's own dropdowns
    expect(element.textContent).toContain("크래마 → Crema");
    expect(element.textContent).toContain("따로 설치한 Thock을 씁니다 · me@example.com");
  });

  it("applies a choice at once and says so", async () => {
    const { section, element, calls } = setup();
    await section.load();
    element.querySelector('[data-voice-segment="hotkey"] [data-value="scrolllock"]').click();
    await vi.waitFor(() => expect(calls.at(-1)).toEqual(["/api/settings", { hotkey: "scrolllock", personal_key: "pk1" }]));
    await vi.waitFor(() => expect(element.textContent).toContain("ScrollLock을 한 번 눌러 시작하고"));
    expect(element.querySelector('[role="status"]').textContent).toBe("저장했습니다. 바로 적용됩니다.");

    const polish = element.querySelector('[data-voice-flag="polish"]');
    polish.checked = false;
    polish.dispatchEvent(new Event("change", { bubbles: true }));
    await vi.waitFor(() => expect(calls.at(-1)[1]).toMatchObject({ polish: false }));
    await vi.waitFor(() => expect(element.querySelector("#voice-polish-level").disabled).toBe(true));
  });

  it("saves the term list with its button and adds a typo note", async () => {
    const { section, element, calls } = setup();
    await section.load();
    const save = element.querySelector("[data-voice-terms-save]");
    expect(save.disabled).toBe(true);
    const terms = element.querySelector("[data-voice-terms]");
    terms.value = "Crema\nThock\nHermes";
    terms.dispatchEvent(new Event("input", { bubbles: true }));
    expect(element.querySelector("[data-voice-terms-count]").textContent).toBe("3개");
    save.click();
    await vi.waitFor(() => expect(calls.at(-1)).toEqual(["/api/settings", { terms: ["Crema", "Thock", "Hermes"], personal_key: "pk1" }]));

    element.querySelector("[data-voice-note-old]").value = "쏙";
    element.querySelector("[data-voice-note-new]").value = "Thock";
    element.querySelector("[data-voice-note-form]").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(element.textContent).toContain("쏙 → Thock"));
    expect(calls.at(-1)).toEqual(["/api/notes", { action: "add", old: "쏙", new: "Thock", personal_key: "pk1" }]);
  });

  it("applies 직접 적기 only with its line", async () => {
    const { section, element, calls } = setup();
    await section.load();
    const style = element.querySelector("#voice-style");
    style.value = "custom";
    style.dispatchEvent(new Event("change", { bubbles: true }));
    expect(calls.length).toBe(1); // only the first read
    element.querySelector("[data-voice-style-custom]").value = "회의록처럼 짧게";
    element.querySelector("[data-voice-style-form]").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(calls.at(-1)[1]).toMatchObject({ style_custom: "회의록처럼 짧게", style: "custom" }));
  });

  it("says when no Thock answers and checks again", async () => {
    const { section, element, host } = setup();
    const missing = Object.assign(new Error("thock_unavailable"), { userMessage: "음성 입력을 시작하지 못했습니다." });
    host.thockApi.mockRejectedValueOnce(missing);
    await section.load();
    expect(element.textContent).toContain("음성 입력을 시작하지 못했습니다.");
    element.querySelector("[data-voice-retry]").click();
    await vi.waitFor(() => expect(element.querySelectorAll("details.settings-group").length).toBe(4));
  });
});
