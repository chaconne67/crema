import { describe, expect, it, vi } from "vitest";

import { closeColorPicker, hexToHsv, hsvToHex, openColorPicker } from "../src/color-picker.js";

describe("color picker", () => {
  it("converts between hex and hue/saturation/value", () => {
    for (const hex of ["#ffffff", "#000000", "#ff0000", "#1e293b", "#f2f2f2", "#a855f7"]) {
      const { h, s, v } = hexToHsv(hex);
      expect(hsvToHex(h, s, v)).toBe(hex);
    }
    expect(hexToHsv("#ff0000")).toEqual({ h: 0, s: 1, v: 1 });
  });

  it("opens on the given color, applies a typed hex code and toggles closed from its button", () => {
    document.body.innerHTML = '<button id="anchor">색</button>';
    const anchor = document.querySelector("#anchor");
    const onChange = vi.fn();
    openColorPicker({ anchor, hex: "#f2f2f2", onChange });
    const popup = document.querySelector(".color-popup");
    expect(popup.hidden).toBe(false);
    const hex = popup.querySelector(".picker-hex");
    expect(hex.value).toBe("#F2F2F2");

    hex.value = "1e293b";
    hex.dispatchEvent(new Event("input", { bubbles: true }));
    expect(onChange).toHaveBeenLastCalledWith("#1e293b");

    const value = popup.querySelector(".picker-value");
    value.value = "0";
    value.dispatchEvent(new Event("input", { bubbles: true }));
    expect(onChange).toHaveBeenLastCalledWith("#000000");

    openColorPicker({ anchor, hex: "#000000", onChange });
    expect(popup.hidden).toBe(true);
    closeColorPicker();
  });
});
