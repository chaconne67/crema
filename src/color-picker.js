// Color popup for 모양 → 글자색·배경색: a hue × saturation field, a brightness bar and the hex code
// (the pick applies at once, so the screen itself is the preview).

/** "#rrggbb" from hue 0–360, saturation and value 0–1. */
export function hsvToHex(h, s, v) {
  const channel = (n) => {
    const k = (n + h / 60) % 6;
    return Math.round(255 * (v - v * s * Math.max(0, Math.min(k, 4 - k, 1))));
  };
  return `#${[channel(5), channel(3), channel(1)].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

/** Hue, saturation and value of "#rrggbb". */
export function hexToHsv(hex) {
  const [r, g, b] = [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const range = max - Math.min(r, g, b);
  let h = 0;
  if (range) {
    if (max === r) h = ((g - b) / range) % 6;
    else if (max === g) h = (b - r) / range + 2;
    else h = (r - g) / range + 4;
  }
  return { h: (h * 60 + 360) % 360, s: max ? range / max : 0, v: max };
}

const clamp01 = (value) => Math.min(1, Math.max(0, value));

let popup;
let state;

function render() {
  const { h, s, v } = state.hsv;
  const hex = hsvToHex(h, s, v);
  popup.style.setProperty("--hue-color", hsvToHex(h, 1, 1));
  popup.style.setProperty("--darken", String(1 - v));
  popup.querySelector(".picker-marker").style.cssText = `left: ${(h / 360) * 100}%; top: ${(1 - s) * 100}%`;
  popup.querySelector(".picker-value").value = String(Math.round(v * 100));
  const input = popup.querySelector(".picker-hex");
  if (document.activeElement !== input) input.value = hex.toUpperCase();
  return hex;
}

function pick(hsv) {
  state.hsv = { ...state.hsv, ...hsv };
  state.onChange(render());
}

function close() {
  if (popup) popup.hidden = true;
  state = null;
}

function mount() {
  popup = document.createElement("div");
  popup.className = "color-popup";
  popup.setAttribute("role", "dialog");
  popup.hidden = true;
  popup.innerHTML = `
    <div class="picker-field" aria-label="색상과 선명도"><span class="picker-marker"></span></div>
    <input class="picker-value" type="range" min="0" max="100" step="1" aria-label="밝기" />
    <input class="picker-hex" type="text" maxlength="7" spellcheck="false" autocomplete="off" aria-label="헥사 코드" />`;
  document.body.append(popup);

  const field = popup.querySelector(".picker-field");
  const fromPointer = (event) => {
    const box = field.getBoundingClientRect();
    pick({ h: clamp01((event.clientX - box.left) / box.width) * 360, s: 1 - clamp01((event.clientY - box.top) / box.height) });
  };
  field.addEventListener("pointerdown", (event) => {
    field.setPointerCapture(event.pointerId);
    fromPointer(event);
  });
  field.addEventListener("pointermove", (event) => {
    if (field.hasPointerCapture(event.pointerId)) fromPointer(event);
  });
  popup.querySelector(".picker-value").addEventListener("input", (event) => pick({ v: Number(event.target.value) / 100 }));
  const hexInput = popup.querySelector(".picker-hex");
  // A typed code applies once it is a full #rrggbb (the # may be left out).
  hexInput.addEventListener("input", () => {
    const value = hexInput.value.trim().replace(/^#?/, "#");
    if (/^#[0-9a-f]{6}$/i.test(value)) pick(hexToHsv(value.toLowerCase()));
  });
  hexInput.addEventListener("change", render);
  document.addEventListener("pointerdown", (event) => {
    if (state && !popup.contains(event.target) && !state.anchor.contains(event.target)) close();
  });
  document.addEventListener(
    "keydown",
    (event) => {
      if (event.key !== "Escape" || !state) return;
      // Closes the popup only, not the settings panel under it.
      event.stopPropagation();
      state.anchor.focus();
      close();
    },
    true,
  );
}

/** Opens the popup under `anchor` on `hex`; `onChange(hex)` runs on every change. Opening it again closes it. */
export function openColorPicker({ anchor, hex, onChange }) {
  if (!popup) mount();
  if (state?.anchor === anchor) {
    close();
    return;
  }
  state = { anchor, onChange, hsv: hexToHsv(hex) };
  render();
  popup.hidden = false;
  const box = anchor.getBoundingClientRect();
  const width = popup.offsetWidth;
  popup.style.left = `${Math.max(8, Math.min(box.left, window.innerWidth - width - 8))}px`;
  const below = box.bottom + 6;
  popup.style.top = `${below + popup.offsetHeight > window.innerHeight - 8 ? Math.max(8, box.top - popup.offsetHeight - 6) : below}px`;
}

export const closeColorPicker = close;
