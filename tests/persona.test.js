import { beforeEach, describe, expect, it, vi } from "vitest";

import { createPersonaSetup, withPersona } from "../src/persona.js";

const DEFAULT_SOUL = "당신은 Crema의 AI 에이전트입니다. 사용자가 쓰는 언어로 답합니다.";

function memoryStorage() {
  const values = new Map();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)) };
}

describe("first-run persona setup", () => {
  let host;
  let storage;

  beforeEach(() => {
    document.body.innerHTML = "";
    host = { readSoul: vi.fn(async () => DEFAULT_SOUL + "\n"), writeSoul: vi.fn(async () => {}) };
    storage = memoryStorage();
  });

  it("puts the persona in front of the current SOUL.md, only the fields given", () => {
    expect(withPersona(DEFAULT_SOUL, { userName: "주인님", polite: true, agentName: "루나", wishes: "결론부터 말해 줘." })).toBe(
      `당신의 이름은 루나입니다.\n사용자를 "주인님"이라고 부릅니다.\n사용자에게 항상 존댓말을 씁니다.\n사용자가 바라는 점:\n결론부터 말해 줘.\n\n${DEFAULT_SOUL}\n`,
    );
    expect(withPersona(DEFAULT_SOUL, { userName: "", polite: false, agentName: "", wishes: "" })).toBe(`사용자에게 편한 반말을 씁니다.\n\n${DEFAULT_SOUL}\n`);
    // 이라고 after a final consonant, 라고 otherwise.
    expect(withPersona("", { userName: "철수", polite: true, agentName: "", wishes: "" })).toBe('사용자를 "철수"라고 부릅니다.\n사용자에게 항상 존댓말을 씁니다.\n');
    expect(withPersona("", { userName: "Boss", polite: true, agentName: "", wishes: "" })).toContain('"Boss"라고 부릅니다.');
  });

  it("writes the answers into SOUL.md and is not shown again", async () => {
    const done = createPersonaSetup({ host, storage }).show();
    document.querySelector("#persona-user").value = "민수님";
    document.querySelector('[data-polite="false"]').click();
    document.querySelector("[data-persona-form]").dispatchEvent(new Event("submit", { cancelable: true }));
    await done;

    expect(host.writeSoul).toHaveBeenCalledWith(`사용자를 "민수님"이라고 부릅니다.\n사용자에게 편한 반말을 씁니다.\n\n${DEFAULT_SOUL}\n`);
    expect(document.querySelector(".persona-setup")).toBeNull();
    await createPersonaSetup({ host, storage }).show();
    expect(document.querySelector(".persona-setup")).toBeNull();
  });

  it("skipping leaves SOUL.md as it is and is remembered", async () => {
    const done = createPersonaSetup({ host, storage }).show();
    document.querySelector("[data-persona-skip]").click();
    await done;
    expect(host.writeSoul).not.toHaveBeenCalled();
    await createPersonaSetup({ host, storage }).show();
    expect(document.querySelector(".persona-setup")).toBeNull();
  });

  it("says why saving failed and stays open", async () => {
    host.writeSoul.mockRejectedValueOnce(Object.assign(new Error("file_write"), { userMessage: "파일을 저장하지 못했습니다." }));
    createPersonaSetup({ host, storage }).show();
    document.querySelector("[data-persona-form]").dispatchEvent(new Event("submit", { cancelable: true }));
    await vi.waitFor(() => expect(document.querySelector("[data-persona-status]").textContent).toBe("파일을 저장하지 못했습니다."));
    expect(document.querySelector(".persona-setup")).not.toBeNull();
    expect(document.querySelector("[type=submit]").disabled).toBe(false);
  });
});

describe("Settings → 페르소나", () => {
  it("shows SOUL.md when Settings opens and saves it whole", async () => {
    document.body.innerHTML = "";
    window.matchMedia = vi.fn(() => ({ matches: false, addEventListener() {} }));
    const { createSettingsPanel } = await import("../src/settings-panel.js");
    const { loadAppearance } = await import("../src/settings.js");
    const host = { readSoul: vi.fn(async () => DEFAULT_SOUL), writeSoul: vi.fn(async () => {}) };
    const panel = createSettingsPanel({
      appearance: loadAppearance(),
      connection: {},
      host,
      onAppearanceChange() {},
      onConnectionChange() {},
      onConnect: async () => ({ state: "connected", message: "" }),
      onProvidersChanged: async () => {},
      onSignOut() {},
    });
    const shell = document.createElement("div");
    document.body.append(shell);
    panel.mount(shell);
    panel.open();
    await vi.waitFor(() => expect(document.querySelector("#persona-text").value).toBe(DEFAULT_SOUL));
    const save = document.querySelector("[data-save-persona]");
    const text = document.querySelector("#persona-text");
    // Nothing to save until the text changes, and again once it is back as it was.
    expect(save.disabled).toBe(true);
    text.value = "당신은 JUDY입니다.";
    text.dispatchEvent(new Event("input"));
    expect(save.disabled).toBe(false);
    text.value = DEFAULT_SOUL;
    text.dispatchEvent(new Event("input"));
    expect(save.disabled).toBe(true);

    // Reopening Settings keeps an unsaved edit.
    text.value = "당신은 JUDY입니다.";
    text.dispatchEvent(new Event("input"));
    panel.open();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(text.value).toBe("당신은 JUDY입니다.");
    expect(host.readSoul).toHaveBeenCalledTimes(1);

    save.click();
    expect(save.disabled).toBe(true);
    await vi.waitFor(() => expect(document.querySelector("[data-persona-status]").textContent).toBe("저장했습니다. 다음 메시지부터 적용됩니다."));
    expect(save.disabled).toBe(true);
    expect(host.writeSoul).toHaveBeenCalledWith("당신은 JUDY입니다.");
  });
});
