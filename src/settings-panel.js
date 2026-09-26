import { REASONING_LEVELS } from "./desktop.js";
import { closeColorPicker, openColorPicker } from "./color-picker.js";
import { enhanceSelect } from "./dropdown.js";
import { AUTO_LABEL, AUTO_NOTE, createModelPicker } from "./model-picker.js";
import { createProviderSection } from "./provider-panel.js";
import { buildCatalog, freeChain, locate, pickRoute, providerStatus } from "./providers.js";
import {
  COLOR_FIELDS,
  FONTS,
  PRESETS,
  RANGES,
  SYSTEM_RANGES,
  WEIGHT_LABELS,
  normalizeAppearance,
  normalizeColor,
  resolveTheme,
  shownWeight,
  weightRange,
} from "./settings.js";

const CLOSE_ICON = `
  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"></path></svg>`;

// `decimals` is how the typed-in value is shown and rounded.
const SYSTEM_SLIDERS = [{ name: "systemSize", label: "글자 크기", unit: "px", decimals: 0 }];
// Its range follows the chosen font (weightRange); the unit spot names the weight (보통, 굵게…).
const WEIGHT_SLIDER = { name: "weight", label: "굵기", unit: "", decimals: 0 };
const SLIDERS = [
  { name: "size", label: "글자 크기", unit: "px", decimals: 0 },
  { name: "leading", label: "행간", unit: "배", decimals: 2 },
  { name: "tracking", label: "자간", unit: "em", decimals: 3 },
  { name: "width", label: "줄 너비", unit: "px", decimals: 0 },
];

const THEMES = [
  ["light", "밝게"],
  ["dark", "어둡게"],
  ["system", "시스템"],
];

const SECTIONS_KEY = "agent-client:settings-sections:v1";
// 모양's 시스템/본문 groups left open (closed at first: the section has many settings).
const GROUPS_KEY = "agent-client:settings-groups:v1";

const DEFAULT_OPEN_SECTIONS = ["model"];
const CHEVRON_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"></path></svg>`;

// Lucide (ISC) marks for the panel title and each section.
const icon = (body) => `<svg viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;
const SETTINGS_ICON = icon('<path d="M14 17H5"/><path d="M19 7h-9"/><circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/>');
const SECTION_ICONS = {
  // Lucide (ISC) "circle-user".
  account: icon('<circle cx="12" cy="12" r="10"/><circle cx="12" cy="10" r="3"/><path d="M7 20.662V19a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v1.662"/>'),
  providers: icon('<path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z"/><circle cx="16.5" cy="7.5" r=".5" fill="currentColor"/>'),
  connection: icon('<path d="M12 22v-5"/><path d="M15 8V2"/><path d="M17 8a1 1 0 0 1 1 1v4a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1z"/><path d="M9 8V2"/>'),
  model: icon('<path d="M12 20v2"/><path d="M12 2v2"/><path d="M17 20v2"/><path d="M17 2v2"/><path d="M2 12h2"/><path d="M2 17h2"/><path d="M2 7h2"/><path d="M20 12h2"/><path d="M20 17h2"/><path d="M20 7h2"/><path d="M7 20v2"/><path d="M7 2v2"/><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="8" y="8" width="8" height="8" rx="1"/>'),
  appearance: icon('<path d="M12 4v16"/><path d="M4 7V5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2"/><path d="M9 20h6"/>'),
  theme: icon('<path d="M12 2v2"/><path d="M14.837 16.385a6 6 0 1 1-7.223-7.222c.624-.147.97.66.715 1.248a4 4 0 0 0 5.26 5.259c.589-.255 1.396.09 1.248.715"/><path d="M16 12a4 4 0 0 0-4-4"/><path d="m19 5-1.256 1.256"/><path d="M20 12h2"/>'),
  input: icon('<path d="M10 8h.01"/><path d="M12 12h.01"/><path d="M14 8h.01"/><path d="M16 12h.01"/><path d="M18 8h.01"/><path d="M6 8h.01"/><path d="M7 16h10"/><path d="M8 12h.01"/><rect width="20" height="16" x="2" y="4" rx="2"/>'),
};

const CONNECTION_STATES = { connected: "연결됨", error: "연결 안 됨", checking: "확인 중", offline: "연결 전" };

const ALL_SLIDERS = [...SYSTEM_SLIDERS, WEIGHT_SLIDER, ...SLIDERS];
const ALL_RANGES = { ...RANGES, ...SYSTEM_RANGES, weight: { min: 100, max: 900, step: 100 } };

/** Font choices grouped (고딕·손글씨·코딩), for both the system and the conversation font. */
const FONT_OPTIONS = [...new Set(Object.values(FONTS).map((font) => font.group))]
  .map(
    (group) => `<optgroup label="${group}">${Object.entries(FONTS)
      .filter(([, font]) => font.group === group)
      .map(([value, font]) => `<option value="${value}">${font.label}</option>`)
      .join("")}</optgroup>`,
  )
  .join("");

/** 글자색 or 배경색: the color in use (opens the color popup) and a way back to the theme's own. */
function colorField(field, label) {
  return `
    <span class="field-label">${label}</span>
    <div class="color-field" data-color-field="${field}">
      <button type="button" class="color-chip" data-color-open aria-label="${label} 고르기">
        <span class="color-chip-swatch" aria-hidden="true"></span><span class="color-chip-value"></span>
      </button>
      <button type="button" class="text-button" data-color-reset>테마 기본색으로</button>
    </div>`;
}

function slider({ name, label, unit }) {
  return `
    <label class="range-label" for="range-${name}">${label}</label>
    <div class="range-control">
      <input id="range-${name}" type="range" min="${ALL_RANGES[name].min}" max="${ALL_RANGES[name].max}" step="${ALL_RANGES[name].step}" data-range="${name}" />
      <div class="range-value">
        <input type="text" inputmode="decimal" spellcheck="false" autocomplete="off" data-range-input="${name}" aria-label="${unit ? `${label} (${unit})` : label}" />
        <span class="range-unit" aria-hidden="true">${unit}</span>
      </div>
    </div>`;
}

function segmented(name, label, options) {
  return `
    <div class="segmented" role="group" aria-label="${label}" data-segment="${name}">
      ${options.map(([value, text]) => `<button type="button" data-value="${value}" aria-pressed="false">${text}</button>`).join("")}
    </div>`;
}

export function createSettingsPanel({
  appearance,
  connection,
  host,
  onAppearanceChange,
  onConnectionChange,
  onConnect,
  onProvidersChanged,
  onSignOut,
}) {
  let current = appearance;
  let account = null;
  let providers = [];
  let panel;
  let shell;
  let opener = null;
  let dropdowns = [];
  let connectionState = "checking";
  let modelPicker = null;
  let providerSection = null;
  let authKinds = {};
  let catalog = [];

  /** The saved choice located in the Provider → model list. */
  function selection() {
    if (connection.auto) return { auto: true, name: AUTO_LABEL, provider: "", fast: false };
    const found = locate(catalog, connection.provider, connection.model);
    return { key: found?.key, provider: found?.provider || connection.provider, name: connection.model, fast: Boolean(connection.fast) };
  }

  const refreshDropdowns = () => dropdowns.forEach((dropdown) => dropdown.refresh());

  function notifyConnection(options) {
    onConnectionChange(connection, options);
    updateSummaries();
  }

  function syncAppearanceControls() {
    queueMicrotask(updateSummaries);
    for (const button of panel.querySelectorAll('[data-segment="preset"] button')) {
      button.setAttribute("aria-pressed", String(button.dataset.value === current.preset));
    }
    for (const button of panel.querySelectorAll('[data-segment="theme"] button')) {
      button.setAttribute("aria-pressed", String(button.dataset.value === current.theme));
    }
    panel.querySelector("#font-select").value = current.font;
    panel.querySelector("#system-font-select").value = current.systemFont;
    refreshDropdowns();
    panel.querySelector("#spellcheck-toggle").checked = current.spellcheck;
    panel.querySelector("#suggest-toggle").checked = current.suggest;
    for (const { name, decimals } of ALL_SLIDERS) {
      const range = panel.querySelector(`#range-${name}`);
      const { min, max, step } = rangeOf(name);
      // The weight shown is the one the font can really draw (the stored one is kept for other fonts).
      const value = name === "weight" ? shownWeight(current.font, current.weight) : current[name];
      Object.assign(range, { min: String(min), max: String(max), step: String(step), value: String(value) });
      // The track paints its filled part up to --fill (see styles.css).
      range.style.setProperty("--fill", `${max > min ? ((value - min) / (max - min)) * 100 : 100}%`);
      panel.querySelector(`[data-range-input="${name}"]`).value = value.toFixed(decimals);
    }
    const theme = resolveTheme(current.theme);
    panel.querySelector("[data-color-note]").textContent =
      `글자색·배경색은 테마마다 따로 정합니다. 지금은 ${theme === "dark" ? "어둡게" : "밝게"} 테마의 색입니다.`;
    for (const box of panel.querySelectorAll("[data-color-field]")) {
      const color = themeColorOf(box.dataset.colorField);
      box.querySelector(".color-chip-swatch").style.background = color.hex;
      box.querySelector(".color-chip-value").textContent = color.custom ? color.hex.toUpperCase() : "테마 기본";
      box.querySelector("[data-color-reset]").hidden = !color.custom;
    }
    // 굵기: locked for a single-weight font.
    const shown = shownWeight(current.font, current.weight);
    const single = FONTS[current.font].weights.length < 2;
    panel.querySelector("#range-weight").disabled = single;
    panel.querySelector('[data-range-input="weight"]').disabled = single;
    panel.querySelector('[data-range-input="weight"]').nextElementSibling.textContent = WEIGHT_LABELS[Math.round(shown / 100) * 100];
    panel.querySelector("[data-weight-note]").hidden = !single;
  }

  /** A color setting of the theme in use: the chosen one, else the theme's own (as #rrggbb). */
  function themeColorOf(field) {
    const chosen = current.colors[resolveTheme(current.theme)][field];
    if (chosen) return { hex: chosen, custom: true };
    const token = field.endsWith("Ink") ? "--theme-ink" : field === "systemBg" ? "--theme-sidebar-surface" : "--theme-surface";
    return { hex: normalizeColor(getComputedStyle(document.documentElement).getPropertyValue(token).trim()) || "#000000", custom: false };
  }

  /** A slider's range; 굵기 follows the chosen font. */
  function rangeOf(name) {
    return name === "weight" ? weightRange(current.font) : ALL_RANGES[name];
  }

  /** ↑↓ on 굵기: the next weight the font really has (a fixed-weight font would otherwise stay put). */
  function nextWeight(direction) {
    const shown = shownWeight(current.font, current.weight);
    if (FONTS[current.font].variable) return shown + direction * weightRange(current.font).step;
    const weights = direction > 0 ? FONTS[current.font].weights : [...FONTS[current.font].weights].reverse();
    return weights.find((weight) => (weight - shown) * direction > 0) ?? shown;
  }

  function updateAppearance(next) {
    current = normalizeAppearance(next);
    syncAppearanceControls();
    onAppearanceChange(current);
  }

  function renderModelOptions() {
    queueMicrotask(updateSummaries);
    modelPicker?.refresh();
    providerSection?.render();
    panel.querySelector("#reasoning-select").value = connection.reasoning || "";
    refreshDropdowns();
    panel.querySelector("[data-model-note]").textContent = connection.auto
      ? AUTO_NOTE
      : providers.length
      ? "선택한 모델은 다음 질문부터 적용됩니다."
      : "연결되면 사용할 수 있는 모델 목록을 불러옵니다.";
  }

  function updateSummaries() {
    const reasoning = REASONING_LEVELS.find((level) => level.value === (connection.reasoning || ""));
    const summaries = {
      account: account?.email || "",
      connection: CONNECTION_STATES[connectionState] || "",
      providers: catalog.length ? `${catalog.length}개 연결됨` : "",
      model: [connection.auto ? AUTO_LABEL : connection.model, connection.fast && "빠른 속도", connection.reasoning && reasoning?.label].filter(Boolean).join(" · "),
      appearance: `시스템 ${current.systemSize}px · 본문 ${current.size}px`,
      theme: THEMES.find(([value]) => value === current.theme)?.[1] || "",
      input: [current.spellcheck && "맞춤법 검사", current.suggest && "다음 입력 예상"].filter(Boolean).join(" · ") || "꺼짐",
    };
    for (const [id, text] of Object.entries(summaries)) {
      const target = panel?.querySelector(`[data-section="${id}"] .section-summary`);
      if (target) target.textContent = text;
    }
  }

  function loadOpenSections() {
    try {
      return JSON.parse(window.localStorage.getItem(SECTIONS_KEY) || "null") || DEFAULT_OPEN_SECTIONS;
    } catch {
      return DEFAULT_OPEN_SECTIONS;
    }
  }

  function setSectionOpen(section, open) {
    section.querySelector(".section-toggle").setAttribute("aria-expanded", String(open));
    section.querySelector(".section-body").hidden = !open;
    const openIds = [...panel.querySelectorAll(".settings-section")]
      .filter((item) => !item.querySelector(".section-body").hidden)
      .map((item) => item.dataset.section);
    try {
      window.localStorage.setItem(SECTIONS_KEY, JSON.stringify(openIds));
    } catch {
      // Open/closed state is a convenience; the panel works without storage.
    }
  }

  /** Turns each section heading into a toggle; the rest of the section becomes its body. */
  function makeSectionsCollapsible() {
    const openIds = loadOpenSections();
    for (const section of panel.querySelectorAll(".settings-section")) {
      const heading = section.querySelector("h3");
      const id = heading.id.replace(/-title$/, "");
      section.dataset.section = id;
      const body = document.createElement("div");
      body.className = "section-body";
      body.id = `${id}-body`;
      body.append(...[...section.childNodes].filter((node) => node !== heading));
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "section-toggle";
      toggle.setAttribute("aria-controls", body.id);
      toggle.innerHTML = `<span class="section-icon">${SECTION_ICONS[id] || ""}</span><span class="section-summary"></span>${CHEVRON_ICON}`;
      toggle.firstElementChild.after(heading);
      toggle.addEventListener("click", () => setSectionOpen(section, body.hidden));
      section.append(toggle, body);
      toggle.setAttribute("aria-expanded", String(openIds.includes(id)));
      body.hidden = !openIds.includes(id);
    }
  }

  function showConnectionMessage(result) {
    // Problems need the fix button in view.
    const connectionSection = panel.querySelector('[data-section="connection"]');
    if (result.state === "error" && connectionSection) setSectionOpen(connectionSection, true);
    const line = panel.querySelector("[data-connection-line]");
    line.dataset.state = result.state;
    line.textContent = result.message;
    connectionState = result.state;
    updateSummaries();
  }

  async function connect() {
    showConnectionMessage({ state: "checking", message: "연결을 확인하고 있습니다…" });
    showConnectionMessage(await onConnect());
  }

  function close() {
    panel.hidden = true;
    shell.classList.remove("settings-open");
    opener?.focus();
  }

  return {
    open(trigger) {
      opener = trigger || document.activeElement;
      panel.hidden = false;
      shell.classList.add("settings-open");
      panel.querySelector("[data-close-settings]").focus();
    },

    showConnection(result) {
      showConnectionMessage(result);
    },

    /** The signed-in Crema account ({ email, name }). */
    setAccount(next) {
      account = next;
      panel.querySelector("[data-account-line]").textContent = account
        ? [account.email, account.name].filter(Boolean).join(" · ")
        : "로그인하지 않았습니다.";
      updateSummaries();
    },

    setProviders(next) {
      providers = next;
      catalog = buildCatalog(providers, authKinds);
      renderModelOptions();
    },

    /** Credential kind per channel ("oauth" = subscription) from Hermes' own records. */
    setAuthKinds(next) {
      authKinds = next || {};
      catalog = buildCatalog(providers, authKinds);
      renderModelOptions();
    },

    getCatalog: () => catalog,

    /** Which model writes next-input predictions (shown under the setting). */
    setSuggestModel(text) {
      panel.querySelector("[data-suggest-note]").textContent = text;
    },

    /** Re-reads model, reasoning, and fast mode after a slash command changed them. */
    syncModel() {
      renderModelOptions();
    },

    mount(appShell) {
      shell = appShell;
      panel = document.createElement("aside");
      panel.className = "settings-panel";
      panel.hidden = true;
      panel.setAttribute("aria-labelledby", "settings-title");
      panel.innerHTML = `
        <div class="settings-head">
          <h2 id="settings-title"><span class="settings-mark">${SETTINGS_ICON}</span>설정</h2>
          <button class="icon-button" type="button" data-close-settings aria-label="설정 닫기">${CLOSE_ICON}</button>
        </div>
        <div class="settings-body">
          <section class="settings-section" aria-labelledby="account-title">
            <h3 id="account-title">계정</h3>
            <p class="connection-line" data-account-line></p>
            <button class="secondary-button" type="button" data-sign-out>로그아웃</button>
          </section>
          <section class="settings-section" aria-labelledby="connection-title">
            <h3 id="connection-title">연결</h3>
            <p class="connection-line" data-connection-line role="status"></p>
            <button class="secondary-button" type="button" data-check>연결 다시 확인</button>
          </section>

          <section class="settings-section" aria-labelledby="providers-title">
            <h3 id="providers-title">Provider</h3>
            <div data-provider-section></div>
          </section>

          <section class="settings-section" aria-labelledby="model-title">
            <h3 id="model-title">AI</h3>
            <label for="model-picker-button">모델</label>
            <div data-model-picker></div>
            <label for="reasoning-select">추론 강도</label>
            <select id="reasoning-select">
              ${REASONING_LEVELS.map((level) => `<option value="${level.value}">${level.label}</option>`).join("")}
            </select>
            <p class="field-note" data-model-note></p>
          </section>

          <section class="settings-section" aria-labelledby="appearance-title">
            <h3 id="appearance-title">모양</h3>
            <p class="field-note" data-color-note></p>
            <details class="settings-group" data-group="system">
              <summary>시스템</summary>
              <div class="settings-group-body">
                <p class="field-note">사이드바, 설정, 메뉴, 버튼처럼 앱 화면의 글자와 바탕입니다.</p>
                <label for="system-font-select">글꼴</label>
                <select id="system-font-select">${FONT_OPTIONS}</select>
                ${SYSTEM_SLIDERS.map(slider).join("")}
                ${colorField("systemInk", "글자색")}
                ${colorField("systemBg", "배경색")}
              </div>
            </details>
            <details class="settings-group" data-group="body">
              <summary>본문</summary>
              <div class="settings-group-body">
                <p class="field-note">대화 글과 입력하는 글, 그 바탕입니다.</p>
                <span class="field-label">모드</span>
                ${segmented("preset", "모드", Object.entries(PRESETS).map(([value, preset]) => [value, preset.label]))}
                <label for="font-select">글꼴</label>
                <select id="font-select">${FONT_OPTIONS}</select>
                ${slider(WEIGHT_SLIDER)}
                <p class="field-note" data-weight-note hidden>이 글꼴은 굵기가 한 가지입니다.</p>
                ${SLIDERS.map(slider).join("")}
                ${colorField("bodyInk", "글자색")}
                ${colorField("bodyBg", "배경색")}
                <button class="text-button" type="button" data-reset-appearance>기본값으로</button>
              </div>
            </details>
          </section>

          <section class="settings-section" aria-labelledby="theme-title">
            <h3 id="theme-title">테마</h3>
            ${segmented("theme", "테마", THEMES)}
          </section>

          <section class="settings-section" aria-labelledby="input-title">
            <h3 id="input-title">입력</h3>
            <label class="check-row"><input id="spellcheck-toggle" type="checkbox" /> 입력할 때 맞춤법 검사</label>
            <label class="check-row"><input id="suggest-toggle" type="checkbox" /> 다음 입력 예상</label>
            <p class="field-note" data-suggest-note></p>
          </section>
        </div>`;
      shell.append(panel);
      dropdowns = [...panel.querySelectorAll("select")].map(enhanceSelect);
      modelPicker = createModelPicker({
        getCatalog: () => catalog,
        getSelection: selection,
        offerAuto: () => Boolean(connection.auto) || freeChain(providers).length > 0,
        onChoose({ model, fast, auto }) {
          if (auto) {
            Object.assign(connection, { auto: true, provider: "", model: "", fast: false });
            renderModelOptions();
            notifyConnection({ reconnect: false });
            return;
          }
          const route = pickRoute(model, fast, connection.provider);
          if (!route) return;
          Object.assign(connection, { auto: false, provider: route.providerId, model: route.modelId, fast });
          renderModelOptions();
          notifyConnection({ reconnect: false });
        },
      });
      panel.querySelector("[data-model-picker]").replaceWith(modelPicker.element);
      providerSection = createProviderSection({
        host,
        getStatus: () => providerStatus(providers, authKinds),
        onChanged: onProvidersChanged,
      });
      panel.querySelector("[data-provider-section]").replaceWith(providerSection.element);
      makeSectionsCollapsible();
      updateSummaries();

      panel.querySelector("#reasoning-select").addEventListener("change", (event) => {
        connection.reasoning = event.target.value;
        notifyConnection({ reconnect: false });
      });
      panel.querySelector('[data-segment="preset"]').addEventListener("click", (event) => {
        const preset = event.target.closest("button")?.dataset.value;
        // Each mode comes back with its own adjustments.
        if (preset) updateAppearance({ ...current, preset, ...current.modes[preset] });
      });
      panel.querySelector('[data-segment="theme"]').addEventListener("click", (event) => {
        const theme = event.target.closest("button")?.dataset.value;
        if (theme) updateAppearance({ ...current, theme });
      });
      panel.querySelector("#font-select").addEventListener("change", (event) => {
        updateAppearance({ ...current, font: event.target.value });
      });
      const setColor = (field, value) => {
        const theme = resolveTheme(current.theme);
        const color = normalizeColor(value);
        const themeColors = { ...current.colors[theme], [field]: color };
        if (!color) delete themeColors[field];
        updateAppearance({ ...current, colors: { ...current.colors, [theme]: themeColors } });
      };
      for (const box of panel.querySelectorAll("[data-color-field]")) {
        const field = box.dataset.colorField;
        box.querySelector("[data-color-open]").addEventListener("click", (event) =>
          openColorPicker({ anchor: event.currentTarget, hex: themeColorOf(field).hex, onChange: (hex) => setColor(field, hex) }),
        );
        box.querySelector("[data-color-reset]").addEventListener("click", () => {
          closeColorPicker();
          setColor(field, "");
        });
      }
      // 시스템/본문 fold; which ones are open is remembered.
      const openGroups = (() => {
        try {
          return JSON.parse(window.localStorage.getItem(GROUPS_KEY) || "[]");
        } catch {
          return [];
        }
      })();
      for (const group of panel.querySelectorAll("[data-group]")) {
        group.open = openGroups.includes(group.dataset.group);
        group.addEventListener("toggle", () => {
          const open = [...panel.querySelectorAll("[data-group]")].filter((item) => item.open).map((item) => item.dataset.group);
          try {
            window.localStorage.setItem(GROUPS_KEY, JSON.stringify(open));
          } catch {
            // Open groups are a convenience; the panel works without storage.
          }
        });
      }
      panel.querySelector("#system-font-select").addEventListener("change", (event) => {
        updateAppearance({ ...current, systemFont: event.target.value });
      });
      for (const input of panel.querySelectorAll("[data-range]")) {
        input.addEventListener("input", () => {
          updateAppearance({ ...current, [input.dataset.range]: Number(input.value) });
        });
      }
      // Typed values: applied on Enter or leaving the box, clamped to the slider's range; ↑↓ step.
      for (const box of panel.querySelectorAll("[data-range-input]")) {
        const { name, decimals } = ALL_SLIDERS.find((item) => item.name === box.dataset.rangeInput);
        const apply = (value) => {
          if (Number.isFinite(value)) updateAppearance({ ...current, [name]: Number(value.toFixed(decimals)) });
          else syncAppearanceControls();
        };
        box.addEventListener("change", () => apply(parseFloat(box.value.replace(",", "."))));
        box.addEventListener("keydown", (event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            box.blur();
          } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
            event.preventDefault();
            const direction = event.key === "ArrowUp" ? 1 : -1;
            apply(name === "weight" ? nextWeight(direction) : current[name] + direction * rangeOf(name).step);
          } else if (event.key === "Escape") {
            // Undo the draft here instead of closing the settings panel.
            event.stopPropagation();
            syncAppearanceControls();
            box.blur();
          }
        });
      }
      panel.querySelector("#suggest-toggle").addEventListener("change", (event) => {
        updateAppearance({ ...current, suggest: event.target.checked });
      });
      panel.querySelector("#spellcheck-toggle").addEventListener("change", (event) => {
        updateAppearance({ ...current, spellcheck: event.target.checked });
      });
      panel.querySelector("[data-reset-appearance]").addEventListener("click", () =>
        // Resets only the current mode's type; the other mode, theme and input settings stay.
        updateAppearance({ ...current, ...PRESETS[current.preset] }),
      );

      panel.querySelector("[data-check]").addEventListener("click", connect);
      panel.querySelector("[data-sign-out]").addEventListener("click", () => onSignOut());
      panel.querySelector("[data-close-settings]").addEventListener("click", close);
      panel.addEventListener("keydown", (event) => {
        if (event.key === "Escape") close();
      });

      syncAppearanceControls();
      renderModelOptions();
    },
  };
}
