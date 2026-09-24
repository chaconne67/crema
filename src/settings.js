const STORAGE_KEY = "agent-client:appearance:v1";

// `weights` are the weights each font really has (fonts.css), so the weight choice never offers a dud;
// a `variable` font has every weight between its first and last.
// Object order is the list order; `group` heads the list sections.
const FALLBACK = '"Malgun Gothic", system-ui, sans-serif';
export const FONTS = {
  hcr: { label: "함초롬돋움", group: "고딕", weights: [400, 700], stack: `"Codex HCR", "HCR Dotum", ${FALLBACK}` },
  pretendard: { label: "Pretendard", group: "고딕", variable: true, weights: [100, 900], stack: `"Pretendard Variable", ${FALLBACK}` },
  noto: { label: "본고딕", group: "고딕", variable: true, weights: [100, 900], stack: `"Noto Sans KR Variable", ${FALLBACK}` },
  nanum: { label: "나눔고딕", group: "고딕", weights: [400, 700, 800], stack: `"Nanum Gothic", ${FALLBACK}` },
  barun: { label: "나눔바른고딕", group: "고딕", weights: [400, 700], stack: `"NanumBarunGothic", ${FALLBACK}` },
  malgun: { label: "맑은 고딕", group: "고딕", weights: [400, 700], stack: '"Malgun Gothic", system-ui, sans-serif' },
  spoqa: { label: "스포카 한 산스 Neo", group: "고딕", weights: [300, 400, 500, 700], stack: `"Spoqa Han Sans Neo", ${FALLBACK}` },
  score: { label: "에스코어 드림", group: "고딕", weights: [300, 400, 500, 600, 700], stack: `"S-Core Dream", ${FALLBACK}` },
  paperlogy: { label: "페이퍼로지", group: "고딕", weights: [300, 400, 500, 600, 700], stack: `"Paperlogy", ${FALLBACK}` },
  pen: { label: "나눔손글씨 펜", group: "손글씨", weights: [400], stack: `"Nanum Pen Script", ${FALLBACK}` },
  coding: { label: "나눔고딕코딩", group: "코딩", weights: [400, 700], stack: '"Nanum Gothic Coding", "Codex HCR", "Malgun Gothic", monospace' },
};

export const WEIGHT_LABELS = {
  100: "가장 얇게", 200: "아주 얇게", 300: "얇게", 400: "보통", 500: "중간", 600: "진하게", 700: "굵게", 800: "아주 굵게", 900: "가장 굵게",
};

// Presets set type only; colour belongs to the theme setting.
export const PRESETS = {
  read: { label: "읽기", font: "hcr", weight: 400, size: 17, leading: 1.7, tracking: -0.012, width: 820 },
  code: { label: "코딩", font: "hcr", weight: 400, size: 15, leading: 1.6, tracking: 0, width: 1040 },
};

export const RANGES = {
  size: { min: 13, max: 22, step: 1 },
  leading: { min: 1.3, max: 2.1, step: 0.05 },
  tracking: { min: -0.04, max: 0.04, step: 0.002 },
  width: { min: 600, max: 1280, step: 20 },
};

// The app's own text (sidebar, settings, menus, composer chrome), apart from the conversation text above.
export const SYSTEM_RANGES = { systemSize: { min: 12, max: 20, step: 1 } };

// 글자색·배경색 of the system text and the conversation text, kept per theme (a dark ink chosen
// for 밝게 would vanish on 어둡게); an unset color is the theme's own.
export const COLOR_FIELDS = { systemInk: "system-ink", systemBg: "system-bg", bodyInk: "body-ink", bodyBg: "body-bg" };

/** "#rrggbb" in lower case, or "" for anything else (unset). */
export function normalizeColor(value) {
  const hex = String(value ?? "").trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(hex)) return hex;
  if (/^#[0-9a-f]{3}$/.test(hex)) return `#${[...hex.slice(1)].map((digit) => digit + digit).join("")}`;
  return "";
}

function normalizeColors(value = {}) {
  const colors = {};
  for (const theme of ["light", "dark"]) {
    colors[theme] = {};
    for (const field of Object.keys(COLOR_FIELDS)) {
      const color = normalizeColor(value?.[theme]?.[field]);
      if (color) colors[theme][field] = color;
    }
  }
  return colors;
}

export const DEFAULT_APPEARANCE = {
  preset: "read",
  ...PRESETS.read,
  systemFont: "hcr",
  systemSize: 16,
  theme: "light",
  spellcheck: true,
  suggest: true,
};

function clamp(value, { min, max }) {
  return Math.min(max, Math.max(min, value));
}

/** The weights the 굵기 slider offers for a font: any 10 in a variable font's range, else steps of 100. */
export function weightRange(font) {
  const { weights, variable } = FONTS[font];
  return { min: weights[0], max: weights.at(-1), step: variable ? 10 : 100 };
}

/**
 * The weight a font can really show for the one asked for. The stored weight stays as asked, so a
 * font without it shows its nearest and switching back to a font that has it shows it again.
 */
export function shownWeight(font, wanted) {
  const { weights, variable } = FONTS[font];
  if (variable) return clamp(wanted, weightRange(font));
  return weights.reduce((best, weight) => (Math.abs(weight - wanted) < Math.abs(best - wanted) ? weight : best));
}

/** Bold (강조) a clear step above the body weight: +300 in a variable font, else the font's next weight at least 200 heavier. */
export function strongWeight(font, wanted) {
  const shown = shownWeight(font, wanted);
  if (FONTS[font].variable) return Math.min(weightRange(font).max, shown + 300);
  return FONTS[font].weights.find((weight) => weight >= shown + 200) ?? FONTS[font].weights.at(-1);
}

function normalizeType(value, fallback) {
  const type = { font: value.font in FONTS ? value.font : fallback.font };
  type.weight = clamp(Math.round(Number(value.weight) || fallback.weight || 400), { min: 100, max: 900 });
  for (const [name, range] of Object.entries(RANGES)) {
    const number = Number(value[name]);
    type[name] = clamp(Number.isFinite(number) ? number : fallback[name], range);
  }
  return type;
}

/**
 * Each mode (읽기·코딩) keeps its own adjustments in `modes`; the top-level type fields are the
 * active mode's and win over its stored copy. An old "custom" or unknown preset becomes 읽기 with its values.
 */
export function normalizeAppearance(value = {}) {
  const preset = value.preset in PRESETS ? value.preset : "read";
  const modes = {};
  for (const [name, defaults] of Object.entries(PRESETS)) modes[name] = normalizeType(value.modes?.[name] || {}, defaults);
  modes[preset] = normalizeType(value, modes[preset]);
  return {
    preset,
    systemFont: value.systemFont in FONTS ? value.systemFont : DEFAULT_APPEARANCE.systemFont,
    systemSize: clamp(Number(value.systemSize) || DEFAULT_APPEARANCE.systemSize, SYSTEM_RANGES.systemSize),
    colors: normalizeColors(value.colors),
    theme: ["light", "dark", "system"].includes(value.theme) ? value.theme : DEFAULT_APPEARANCE.theme,
    spellcheck: value.spellcheck !== false,
    suggest: value.suggest !== false,
    ...modes[preset],
    modes,
  };
}

export function loadAppearance() {
  try {
    return normalizeAppearance(JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "{}"));
  } catch {
    return normalizeAppearance();
  }
}

export function saveAppearance(appearance) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(appearance));
  } catch {
    // Appearance still applies for this session when storage is unavailable.
  }
}

export function resolveTheme(theme) {
  if (theme !== "system") return theme;
  return window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ? "dark" : "light";
}

export function applyAppearance(appearance, root = document.documentElement) {
  const theme = resolveTheme(appearance.theme);
  root.dataset.theme = theme;
  root.style.setProperty("--font-ui", FONTS[appearance.systemFont].stack);
  root.style.setProperty("--system-size", `${appearance.systemSize}px`);
  root.style.setProperty("--font-body", FONTS[appearance.font].stack);
  root.style.setProperty("--body-size", `${appearance.size}px`);
  root.style.setProperty("--body-weight", String(shownWeight(appearance.font, appearance.weight)));
  root.style.setProperty("--strong-weight", String(strongWeight(appearance.font, appearance.weight)));
  root.style.setProperty("--body-leading", String(appearance.leading));
  root.style.setProperty("--body-tracking", `${appearance.tracking}em`);
  root.style.setProperty("--content-width", `${appearance.width}px`);
  for (const [field, name] of Object.entries(COLOR_FIELDS)) {
    const color = appearance.colors?.[theme]?.[field];
    if (color) root.style.setProperty(`--${name}`, color);
    else root.style.removeProperty(`--${name}`);
  }
  // Inputs without their own spellcheck attribute inherit this.
  root.spellcheck = appearance.spellcheck;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#2b2b2b" : "#fdfdfd");
}
