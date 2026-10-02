import { REASONING_LEVELS } from "./desktop.js";
import { closeColorPicker, openColorPicker } from "./color-picker.js";
import { enhanceSelect } from "./dropdown.js";
import { AUTO_LABEL, AUTO_NOTE } from "./model-picker.js";
import { createMediaSection } from "./media.js";
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
// Groups left open (closed at first): AI 연결's Provider/모델 선택, 모양's 폰트 및 배경 (with 시스템/본문)/테마.
const GROUPS_KEY = "agent-client:settings-groups:v1";

const DEFAULT_OPEN_SECTIONS = ["plan", "media"];
const CHEVRON_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"></path></svg>`;

// Lucide (ISC) marks for the panel title and each section.
const icon = (body) => `<svg viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;
const SETTINGS_ICON = icon('<path d="M14 17H5"/><path d="M19 7h-9"/><circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/>');
const SECTION_ICONS = {
  // Lucide (ISC) "circle-user".
  plan: icon('<circle cx="12" cy="12" r="10"/><circle cx="12" cy="10" r="3"/><path d="M7 20.662V19a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v1.662"/>'),
  ai: icon('<path d="M12 20v2"/><path d="M12 2v2"/><path d="M17 20v2"/><path d="M17 2v2"/><path d="M2 12h2"/><path d="M2 17h2"/><path d="M2 7h2"/><path d="M20 12h2"/><path d="M20 17h2"/><path d="M20 7h2"/><path d="M7 20v2"/><path d="M7 2v2"/><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="8" y="8" width="8" height="8" rx="1"/>'),
  // Lucide (ISC) "image".
  media: icon('<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>'),
  // Lucide (ISC) "brain".
  memory: icon('<path d="M12 18V5"/><path d="M15 13a4.17 4.17 0 0 1-3-4 4.17 4.17 0 0 1-3 4"/><path d="M17.598 6.5A3 3 0 1 0 12 5a3 3 0 1 0-5.598 1.5"/><path d="M17.997 5.125a4 4 0 0 1 2.526 5.77"/><path d="M18 18a4 4 0 0 0 2-7.464"/><path d="M19.967 17.483A4 4 0 1 1 12 18a4 4 0 1 1-7.967-.517"/><path d="M6 18a4 4 0 0 1-2-7.464"/><path d="M6.003 5.125a4 4 0 0 0-2.526 5.77"/>'),
  // Lucide (ISC) "smile".
  persona: icon('<circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" x2="9.01" y1="9" y2="9"/><line x1="15" x2="15.01" y1="9" y2="9"/>'),
  appearance: icon('<path d="M12 4v16"/><path d="M4 7V5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2"/><path d="M9 20h6"/>'),
  input: icon('<path d="M10 8h.01"/><path d="M12 12h.01"/><path d="M14 8h.01"/><path d="M16 12h.01"/><path d="M18 8h.01"/><path d="M6 8h.01"/><path d="M7 16h10"/><path d="M8 12h.01"/><rect width="20" height="16" x="2" y="4" rx="2"/>'),
};

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

/** The plan card's line: the account's grade from /api/me ({ label, until }) with its end date, or, before
 * grades, the subscription ({ status, days_left, price }); "무료" otherwise. */
export function planLabel(plan, member) {
  if (member?.label) {
    const until = member.until ? new Date(member.until) : null;
    return until ? `${member.label} · ${until.getMonth() + 1}월 ${until.getDate()}일까지` : member.label;
  }
  if (plan?.status === "trial") return `체험 중 · ${plan.days_left}일 남음`;
  if (plan?.status === "paid") return `구독 중 · 월 ${Number(plan.price).toLocaleString("ko-KR")}원`;
  return "무료";
}

/** The plan card's voice line: time left this period when the access includes Thock voice input. */
export function voiceLabel(member, voice) {
  if (!member?.voice || !voice) return "";
  const minutes = (seconds) => Math.floor((seconds || 0) / 60);
  return `음성 입력 · ${minutes(voice.remaining_seconds)}분 남음 (기간마다 ${minutes(voice.allowance_seconds)}분)`;
}

export function createSettingsPanel({
  appearance,
  connection,
  host,
  onAppearanceChange,
  onConnectionChange,
  onProvidersChanged,
  // (plan) → media backends to use (media.js), after a choice in 미디어.
  onMediaChange = () => {},
  onSignOut,
  onRedeemInvite = async () => {},
  onGuide = () => {},
  // 음성 입력 설정 열기: Thock's own settings window.
  onOpenVoiceSettings = async () => {},
  // (open) → the panel opened or closed; the sign-up guide's page must not cover it.
  onOpenChange = () => {},
}) {
  let current = appearance;
  let account = null;
  let providers = [];
  let panel;
  let shell;
  let opener = null;
  let dropdowns = [];
  // 모델 선택's rows for the chosen Provider: { model, fast }, by option index.
  let modelChoices = [];
  let providerSection = null;
  let mediaSection = null;
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
    panel.querySelector("#voice-toggle").checked = current.voice;
    panel.querySelector("[data-voice-settings]").disabled = !current.voice;
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

  /**
   * AI 연결: the Provider in use (or 자동), and 모델 선택 listing only that Provider's models — each
   * fast-capable one also as its 빠른 속도 variant.
   */
  function renderModelChoices() {
    const chosen = selection();
    const providerSelect = panel.querySelector("#provider-select");
    const auto = Boolean(connection.auto) || freeChain(providers).length > 0;
    providerSelect.replaceChildren(
      ...(auto ? [new Option(AUTO_LABEL, "auto")] : []),
      ...catalog.map((group) => new Option(group.provider, group.key)),
    );
    providerSelect.value = chosen.auto ? "auto" : chosen.key || "";
    const group = chosen.auto ? null : catalog.find((item) => item.key === chosen.key);
    modelChoices = (group?.models || []).flatMap((model) => [false, ...(model.fast ? [true] : [])].map((fast) => ({ model, fast })));
    const modelSelect = panel.querySelector("#model-select");
    modelSelect.replaceChildren(...modelChoices.map(({ model, fast }, index) => new Option(fast ? `${model.name} · 빠른 속도` : model.name, String(index))));
    modelSelect.value = String(modelChoices.findIndex(({ model, fast }) => model.name === chosen.name && fast === Boolean(chosen.fast)));
    modelSelect.disabled = !group;
  }

  /** Uses a model of the chosen Provider (its own route kept when it serves it). */
  function chooseModel({ model, fast }) {
    const route = pickRoute(model, fast, connection.provider);
    if (!route) return;
    Object.assign(connection, { auto: false, provider: route.providerId, model: route.modelId, fast });
    renderModelOptions();
    notifyConnection({ reconnect: false });
  }

  function renderModelOptions() {
    queueMicrotask(updateSummaries);
    renderModelChoices();
    providerSection?.render();
    mediaSection?.render();
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
    const voiceShown = account?.member?.voice === true;
    const summaries = {
      plan: [planLabel(account?.plan, account?.member), account?.email].filter(Boolean).join(" · "),
      ai: [connection.auto ? AUTO_LABEL : connection.model, connection.fast && "빠른 속도", connection.reasoning && reasoning?.label].filter(Boolean).join(" · "),
      media: mediaSection?.summary() || "",
      appearance: [`본문 ${current.size}px`, THEMES.find(([value]) => value === current.theme)?.[1]].filter(Boolean).join(" · "),
      input:
        [current.spellcheck && "맞춤법 검사", current.suggest && "다음 입력 예상", voiceShown && current.voice && "음성 입력"].filter(Boolean).join(" · ") || "꺼짐",
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

  const personaStatus = (text, tone = "") => {
    const status = panel.querySelector("[data-persona-status]");
    status.textContent = text;
    status.dataset.tone = tone;
  };

  // SOUL.md as last read or saved; 저장 is on only while the text differs from it.
  let savedPersona = null;
  let savingPersona = false;
  const personaText = () => panel.querySelector("#persona-text");
  function syncPersonaSave() {
    panel.querySelector("[data-save-persona]").disabled = savingPersona || savedPersona === null || personaText().value === savedPersona;
  }

  /** SOUL.md as it is now, read each time Settings opens (the first-run setup may have written it); an unsaved edit is kept. */
  async function loadPersona() {
    if (savedPersona !== null && personaText().value !== savedPersona) return;
    try {
      savedPersona = await host.readSoul();
      personaText().value = savedPersona;
      personaStatus("");
    } catch (error) {
      personaStatus(error.userMessage, "error");
    }
    syncPersonaSave();
  }

  async function savePersona() {
    const content = personaText().value;
    savingPersona = true;
    syncPersonaSave();
    personaStatus("저장하고 있습니다…");
    try {
      await host.writeSoul(content);
      savedPersona = content;
      personaStatus("저장했습니다. 다음 메시지부터 적용됩니다.");
    } catch (error) {
      personaStatus(error.userMessage, "error");
    }
    savingPersona = false;
    syncPersonaSave();
  }

  function close() {
    panel.hidden = true;
    shell.classList.remove("settings-open");
    onOpenChange(false);
    opener?.focus();
  }

  return {
    open(trigger) {
      opener = trigger || document.activeElement;
      panel.hidden = false;
      shell.classList.add("settings-open");
      onOpenChange(true);
      loadPersona();
      panel.querySelector("[data-close-settings]").focus();
    },

    /** The signed-in Crema account ({ email, name }). */
    setAccount(next) {
      account = next;
      panel.querySelector(".plan-name").textContent = planLabel(account?.plan, account?.member);
      const voiceLine = panel.querySelector("[data-plan-voice]");
      voiceLine.textContent = voiceLabel(account?.member, account?.voice);
      voiceLine.hidden = !voiceLine.textContent;
      panel.querySelector("[data-voice-controls]").hidden = account?.member?.voice !== true;
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

    /** Media backends for the Providers connected now (media.js mediaPlan). */
    mediaPlan: () => mediaSection?.plan() || [],

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
          <section class="settings-section" aria-labelledby="plan-title">
            <h3 id="plan-title">계정</h3>
            <div class="plan-card">
              <span class="plan-name">무료</span>
              <span class="plan-account" data-plan-voice hidden></span>
              <span class="plan-account" data-account-line></span>
            </div>
            <button class="text-button" type="button" data-sign-out>로그아웃</button>
            <label for="invite-code">초대 코드</label>
            <input id="invite-code" type="text" autocomplete="off" spellcheck="false" maxlength="32" placeholder="CRM-XXXX-XXXX" />
            <button class="secondary-button" type="button" data-redeem-invite>코드 확인</button>
            <p class="provider-status" data-invite-status role="status"></p>
            <span class="field-label">백업</span>
            <p class="field-note">대화, 기억, 배운 방법, 설정을 고른 폴더에 파일 하나로 저장합니다. API 키와 로그인 정보는 넣지 않습니다.</p>
            <button class="secondary-button" type="button" data-backup>백업 파일 만들기</button>
            <p class="provider-status" data-backup-status role="status"></p>
          </section>

          <section class="settings-section" aria-labelledby="ai-title">
            <h3 id="ai-title">AI 연결</h3>
            <details class="settings-group" data-group="provider">
              <summary>Provider</summary>
              <div class="settings-group-body">
                <label for="provider-select">사용할 Provider</label>
                <select id="provider-select"></select>
                <div data-provider-section></div>
              </div>
            </details>
            <details class="settings-group" data-group="model">
              <summary>모델 선택</summary>
              <div class="settings-group-body">
                <label for="model-select">모델</label>
                <select id="model-select"></select>
                <label for="reasoning-select">추론 강도</label>
                <select id="reasoning-select">
                  ${REASONING_LEVELS.map((level) => `<option value="${level.value}">${level.label}</option>`).join("")}
                </select>
                <p class="field-note" data-model-note></p>
              </div>
            </details>
          </section>

          <section class="settings-section" aria-labelledby="media-title">
            <h3 id="media-title">부가 기능 연동</h3>
            <div data-media-section></div>
          </section>

          <section class="settings-section" aria-labelledby="persona-title">
            <h3 id="persona-title">페르소나</h3>
            <p class="field-note">에이전트가 누구이고 어떻게 말할지 정하는 글(SOUL.md)입니다. 어떤 모델을 쓰든 이 글만 에이전트의 정체성이 됩니다. 저장하면 다음 메시지부터 적용됩니다.</p>
            <textarea id="persona-text" class="persona-text" rows="10" spellcheck="false" aria-label="페르소나 (SOUL.md)"></textarea>
            <button class="primary-button" type="button" data-save-persona disabled>저장</button>
            <p class="provider-status" data-persona-status role="status"></p>
          </section>

          <section class="settings-section" aria-labelledby="appearance-title">
            <h3 id="appearance-title">모양</h3>
            <details class="settings-group" data-group="fonts">
              <summary>폰트 및 배경</summary>
              <div class="settings-group-body">
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
              </div>
            </details>
            <details class="settings-group" data-group="theme">
              <summary>테마</summary>
              <div class="settings-group-body">
                ${segmented("theme", "테마", THEMES)}
              </div>
            </details>
          </section>

          <section class="settings-section" aria-labelledby="input-title">
            <h3 id="input-title">입력</h3>
            <label class="check-row"><input id="spellcheck-toggle" type="checkbox" /> 입력할 때 맞춤법 검사</label>
            <label class="check-row"><input id="suggest-toggle" type="checkbox" /> 다음 입력 예상</label>
            <p class="field-note" data-suggest-note></p>
            <div class="voice-controls" data-voice-controls hidden>
              <label class="check-row"><input id="voice-toggle" type="checkbox" /> 음성 입력 사용</label>
              <button class="secondary-button" type="button" data-voice-settings>음성 입력 설정 열기</button>
              <p class="provider-status" data-voice-status role="status"></p>
            </div>
          </section>

        </div>`;
      shell.append(panel);
      dropdowns = [...panel.querySelectorAll("select")].map(enhanceSelect);
      panel.querySelector("#provider-select").addEventListener("change", (event) => {
        if (event.target.value === "auto") {
          Object.assign(connection, { auto: true, provider: "", model: "", fast: false });
          renderModelOptions();
          notifyConnection({ reconnect: false });
          return;
        }
        // Another Provider: its model of the same name when it has one, else its first.
        const group = catalog.find((item) => item.key === event.target.value);
        const model = group?.models.find((item) => item.name === connection.model) || group?.models[0];
        if (model) chooseModel({ model, fast: false });
      });
      panel.querySelector("#model-select").addEventListener("change", (event) => {
        const choice = modelChoices[Number(event.target.value)];
        if (choice) chooseModel(choice);
      });
      providerSection = createProviderSection({
        host,
        getStatus: () => providerStatus(providers, authKinds),
        onChanged: onProvidersChanged,
        // The sign-up guide takes over the chat, so settings step aside.
        onGuide(providerId) {
          close();
          onGuide(providerId);
        },
      });
      panel.querySelector("[data-provider-section]").replaceWith(providerSection.element);
      mediaSection = createMediaSection({
        host,
        getConnected: () => new Set(providers.map((provider) => provider.id)),
        onUpdate: () => updateSummaries(),
        // A key saved in a card connects a Provider: the list is read again.
        onConnected: onProvidersChanged,
        onChange(plan) {
          updateSummaries();
          onMediaChange(plan);
        },
        // The AI setup guide takes over the chat, so settings step aside.
        onGuide(id) {
          close();
          onGuide(id);
        },
      });
      panel.querySelector("[data-media-section]").replaceWith(mediaSection.element);
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
      panel.querySelector("#voice-toggle").addEventListener("change", (event) => {
        updateAppearance({ ...current, voice: event.target.checked });
      });
      // Thock's own settings, in a window of their own.
      panel.querySelector("[data-voice-settings]").addEventListener("click", async () => {
        const status = panel.querySelector("[data-voice-status]");
        status.textContent = "";
        try {
          await onOpenVoiceSettings();
        } catch (error) {
          status.textContent = error?.userMessage || "음성 입력 설정을 열지 못했습니다.";
        }
      });
      panel.querySelector("[data-reset-appearance]").addEventListener("click", () =>
        // Resets only the current mode's type; the other mode, theme and input settings stay.
        updateAppearance({ ...current, ...PRESETS[current.preset] }),
      );

      panel.querySelector("[data-sign-out]").addEventListener("click", () => onSignOut());
      panel.querySelector("[data-redeem-invite]").addEventListener("click", async (event) => {
        const button = event.currentTarget;
        const input = panel.querySelector("#invite-code");
        const status = panel.querySelector("[data-invite-status]");
        if (!input.value.trim()) return;
        button.disabled = true;
        status.textContent = "확인하는 중…";
        try {
          await onRedeemInvite(input.value.trim());
          input.value = "";
          status.textContent = "초대 코드를 적용했습니다.";
        } catch (error) {
          status.textContent = error?.userMessage || "초대 코드를 확인하지 못했습니다.";
        } finally {
          button.disabled = false;
        }
      });
      // Memory itself is handled in the chat ("이거 기억해", "뭐 기억하고 있어?", "잊어 줘"); the backup stays here.
      panel.querySelector("[data-backup]").addEventListener("click", async (event) => {
        const button = event.currentTarget;
        const status = panel.querySelector("[data-backup-status]");
        const folder = await host.pickFolder("백업을 저장할 폴더");
        if (!folder) return;
        const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
        const output = `${folder}${folder.includes("/") ? "/" : "\\"}crema-backup-${stamp}.zip`;
        button.disabled = true;
        status.textContent = "백업하고 있습니다…";
        try {
          const result = await host.hermesAdmin("POST", "/api/crema/backup", { output });
          if (!result?.ok) throw new Error();
          status.textContent = `백업했습니다: ${output}`;
        } catch {
          status.textContent = "백업하지 못했습니다.";
        } finally {
          button.disabled = false;
        }
      });
      panel.querySelector("[data-save-persona]").addEventListener("click", savePersona);
      personaText().addEventListener("input", () => {
        if (!savingPersona) personaStatus("");
        syncPersonaSave();
      });
      panel.querySelector("[data-close-settings]").addEventListener("click", close);
      panel.addEventListener("keydown", (event) => {
        if (event.key === "Escape") close();
      });

      syncAppearanceControls();
      renderModelOptions();
    },
  };
}
