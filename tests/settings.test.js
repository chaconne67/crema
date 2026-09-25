import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_APPEARANCE,
  FONTS,
  PRESETS,
  applyAppearance,
  loadAppearance,
  normalizeAppearance,
  shownWeight,
  strongWeight,
} from "../src/settings.js";

describe("appearance settings", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.matchMedia = vi.fn(() => ({ matches: true }));
  });

  it("starts from the reading preset", () => {
    const { label, ...reading } = PRESETS.read;
    const { label: codeLabel, ...coding } = PRESETS.code;
    expect(loadAppearance()).toEqual({
      preset: "read", ...reading, systemFont: "nanum", systemSize: 16, colors: { light: {}, dark: {} }, theme: "light",
      spellcheck: true, suggest: true, modes: { read: reading, code: coding },
    });
  });

  it("keeps text and background colors per theme and applies only the theme in use", () => {
    const appearance = normalizeAppearance({
      theme: "light",
      colors: { light: { bodyInk: "#1E293B", bodyBg: "#fff", systemInk: "red" }, dark: { systemBg: "#0f172a" } },
    });
    // Hex codes are kept as #rrggbb; anything else is dropped (the theme's own color).
    expect(appearance.colors).toEqual({ light: { bodyInk: "#1e293b", bodyBg: "#ffffff" }, dark: { systemBg: "#0f172a" } });
    const root = document.createElement("div");
    applyAppearance(appearance, root);
    expect(root.style.getPropertyValue("--body-ink")).toBe("#1e293b");
    expect(root.style.getPropertyValue("--body-bg")).toBe("#ffffff");
    expect(root.style.getPropertyValue("--system-bg")).toBe("");
    applyAppearance({ ...appearance, theme: "dark" }, root);
    expect(root.style.getPropertyValue("--body-ink")).toBe("");
    expect(root.style.getPropertyValue("--system-bg")).toBe("#0f172a");
  });

  it("sets the app's system text apart from the conversation text", () => {
    const appearance = normalizeAppearance({ systemFont: "pretendard", systemSize: 40, font: "nanum", size: 15 });
    expect(appearance).toMatchObject({ systemFont: "pretendard", systemSize: 20, font: "nanum", size: 15 });
    // Switching the conversation mode keeps the system text as it is.
    expect(normalizeAppearance({ ...appearance, preset: "code", ...appearance.modes.code })).toMatchObject({
      systemFont: "pretendard",
      systemSize: 20,
    });
    const root = document.createElement("div");
    applyAppearance(appearance, root);
    expect(root.style.getPropertyValue("--font-ui")).toContain("Pretendard");
    expect(root.style.getPropertyValue("--system-size")).toBe("20px");
    expect(root.style.getPropertyValue("--font-body")).toContain("Nanum Gothic");
    expect(root.style.getPropertyValue("--body-size")).toBe("15px");
  });

  it("keeps colour out of presets and keeps an old custom setup as the reading mode's type", () => {
    for (const preset of Object.values(PRESETS)) expect(preset).not.toHaveProperty("theme");
    const old = normalizeAppearance({ preset: "night", theme: "dark", font: "coding", size: 17 });
    expect(old).toMatchObject({ preset: "read", theme: "dark", font: "coding", size: 17 });
    expect(old.modes.read).toMatchObject({ font: "coding", size: 17 });
  });

  it("keeps each mode's own adjustments while switching between them", () => {
    const reading = normalizeAppearance({ ...normalizeAppearance(), size: 19 });
    expect(reading).toMatchObject({ preset: "read", size: 19 });
    const coding = normalizeAppearance({ ...reading, preset: "code", ...reading.modes.code });
    expect(coding).toMatchObject({ preset: "code", size: PRESETS.code.size });
    const back = normalizeAppearance({ ...coding, preset: "read", ...coding.modes.read });
    expect(back).toMatchObject({ preset: "read", size: 19 });
  });

  it("shows only a weight the font really has, keeps the chosen one, per mode", () => {
    expect(normalizeAppearance({ font: "pretendard", weight: 600 })).toMatchObject({ font: "pretendard", weight: 600 });
    // Nanum Gothic has 400/700/800: 500 shows as 400, 900 as 800; a single-weight font shows 400.
    expect(shownWeight("nanum", normalizeAppearance({ font: "nanum", weight: 500 }).weight)).toBe(400);
    expect(shownWeight("nanum", normalizeAppearance({ font: "nanum", weight: 900 }).weight)).toBe(800);
    expect(shownWeight("pen", normalizeAppearance({ font: "pen", weight: 700 }).weight)).toBe(400);
    // A variable font shows any weight in its range.
    expect(shownWeight("pretendard", 650)).toBe(650);
    // The chosen weight survives a font without it: back on Pretendard, 600 is shown again.
    const onBarun = normalizeAppearance({ ...normalizeAppearance({ font: "pretendard", weight: 600 }), font: "barun" });
    expect(shownWeight("barun", onBarun.weight)).toBe(700);
    expect(normalizeAppearance({ ...onBarun, font: "pretendard" }).weight).toBe(600);
    // Bold stays a weight the font has above the body; none heavier means it cannot stand out.
    expect(strongWeight("pretendard", 400)).toBe(700);
    expect(strongWeight("nanum", 400)).toBe(700);
    expect(strongWeight("barun", 700)).toBe(700);
    const coding = normalizeAppearance({ ...normalizeAppearance({ font: "pretendard", weight: 300 }), preset: "code", ...PRESETS.code });
    expect(coding.weight).toBe(400);
    expect(coding.modes.read).toMatchObject({ font: "pretendard", weight: 300 });
    for (const font of Object.values(FONTS)) expect(font.weights.length).toBeGreaterThan(0);
  });

  it("clamps out-of-range values and rejects unknown fonts", () => {
    const appearance = normalizeAppearance({ preset: "x", size: 99, leading: 0.5, tracking: 1, width: 10, font: "nope" });
    expect(appearance).toMatchObject({ preset: "read", size: 22, leading: 1.3, tracking: 0.04, width: 600, font: "nanum" });
  });

  it("applies typography values and resolves the system theme", () => {
    const root = document.documentElement;
    applyAppearance({ ...DEFAULT_APPEARANCE, theme: "system", size: 18, leading: 1.8, tracking: -0.02, width: 900 }, root);
    expect(root.dataset.theme).toBe("dark");
    expect(root.style.getPropertyValue("--body-size")).toBe("18px");
    expect(root.style.getPropertyValue("--body-leading")).toBe("1.8");
    expect(root.style.getPropertyValue("--body-tracking")).toBe("-0.02em");
    expect(root.style.getPropertyValue("--content-width")).toBe("900px");
    expect(root.style.getPropertyValue("--body-weight")).toBe("400");
    expect(root.spellcheck).toBe(true);
    applyAppearance({ ...DEFAULT_APPEARANCE, spellcheck: false }, root);
    expect(root.spellcheck).toBe(false);
  });
});
