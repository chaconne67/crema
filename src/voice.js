import { enhanceSelect } from "./dropdown.js";

function escapeHtml(value) {
  return String(value).replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]);
}

// Thock's own words for its settings (thock/settings.html), shown with Crema's controls.
const HOTKEYS = [["capslock", "CapsLock"], ["scrolllock", "ScrollLock"]];
const POLISH_HINTS = {
  verbatim: "단어는 들린 그대로 두고 문장부호와 띄어쓰기만 고칩니다.",
  clean: "음·어 같은 망설임 말과 끊긴 말 조각을 빼고, 잘못 들린 말과 용어 표기를 고칩니다.",
  smooth: "군더더기를 빼고, 되풀이한 말과 고쳐 말한 구절을 정리해 읽기 좋게 문장을 나눕니다.",
};
const NOTE_STATES = { auto: "자동으로 바꿈", on: "적용 중", seen: "한 번 고침" };
const SAVED = "저장했습니다. 바로 적용됩니다.";

function hotkeyHint(hotkey, mode) {
  const key = hotkey === "capslock" ? "CapsLock" : "ScrollLock";
  const message = mode === "hold" ? `${key}을 누르는 동안 말하고, 떼면 끝납니다.` : `${key}을 한 번 눌러 시작하고, 다시 누르면 끝납니다.`;
  return message + (key === "CapsLock" ? " 대문자 고정은 Shift+CapsLock입니다." : "");
}

function segmented(name, label, options, value) {
  return `
    <div class="segmented" role="group" aria-label="${label}" data-voice-segment="${name}">
      ${options.map(([key, text]) => `<button type="button" data-value="${escapeHtml(key)}" aria-pressed="${key === value}">${escapeHtml(text)}</button>`).join("")}
    </div>`;
}

const options = (entries, value) =>
  entries.map(([key, text]) => `<option value="${escapeHtml(key)}"${key === value ? " selected" : ""}>${escapeHtml(text)}</option>`).join("");

const termsOf = (text) => text.split("\n").map((term) => term.trim()).filter(Boolean);

/**
 * Settings "음성 입력": the running Thock's settings — the one built into Crema, or the Thock the user runs on
 * its own — read and changed through its local API (host.thockApi, the calls Thock's own settings page makes)
 * and drawn with Crema's controls. A choice applies at once; the term list saves with its button.
 * host: thockApi, thockSound, confirm. onUpdate() runs after Thock's settings are read again.
 */
export function createVoiceSection({ host, onUpdate = () => {} }) {
  const element = document.createElement("div");
  element.className = "voice-section";
  let settings = null; // Thock's /api/settings
  let unavailable = null; // why Thock could not be read
  let notice = null; // { text, tone }
  let terms = null; // the term list being edited, before 저장
  let customStyle = false; // "직접 적기" chosen, its line not applied yet
  let preview = null; // { audio, url } while a keyboard sound plays
  let profileTimer = null;
  const opened = new Set(["dictation"]);
  let dropdowns = [];

  async function load() {
    try {
      settings = await host.thockApi("/api/settings");
      unavailable = null;
    } catch (error) {
      settings = null;
      unavailable = error?.userMessage || "음성 입력 설정을 불러오지 못했습니다.";
    }
    render();
    onUpdate();
  }

  /** A change to Thock; its answer is shown, a refusal is said under the section. */
  async function send(path, body, done = SAVED) {
    try {
      const result = await host.thockApi(path, { ...body, personal_key: settings?.personal_key ?? null });
      notice = done ? { text: done } : null;
      return result;
    } catch (error) {
      notice = { text: error?.userMessage || "처리하지 못했습니다. 잠시 뒤 다시 시도해 주세요.", tone: "error" };
      return null;
    }
  }

  async function change(body, done) {
    const result = await send("/api/settings", body, done);
    if (result) settings = result;
    render();
  }

  function watchProfile() {
    clearTimeout(profileTimer);
    if (settings?.profile?.building) {
      profileTimer = setTimeout(async () => {
        try {
          settings = await host.thockApi("/api/settings");
        } catch {
          return;
        }
        render();
      }, 1500);
    }
  }

  function group(key, title, body) {
    return `
      <details class="settings-group" data-voice-group="${key}"${opened.has(key) ? " open" : ""}>
        <summary>${title}</summary>
        <div class="settings-group-body">${body}</div>
      </details>`;
  }

  function dictationHtml(s) {
    const off = !s.polish;
    const mics = [["", "자동 (Windows 기본 마이크)"], ...s.microphones.map((name) => [name, name])];
    if (s.microphone && !s.microphones.includes(s.microphone)) mics.push([s.microphone, `${s.microphone} (연결 안 됨)`]);
    const style = customStyle ? "custom" : s.style;
    return group("dictation", "받아쓰기", `
      <label for="voice-input-mode">입력 방식</label>
      <select id="voice-input-mode" data-voice-setting="input_mode">${options(Object.entries(s.input_modes), s.input_mode)}</select>
      <span class="field-label">단축키</span>
      ${segmented("hotkey", "단축키", HOTKEYS, s.hotkey)}
      <p class="feature-hint">${hotkeyHint(s.hotkey, s.input_mode)}</p>
      <label for="voice-microphone">마이크</label>
      <select id="voice-microphone" data-voice-setting="microphone">${options(mics, s.microphone || "")}</select>
      <p class="feature-hint">자동은 Windows 기본 마이크를 씁니다. 다음 받아쓰기부터 바뀝니다.</p>
      <label class="check-row"><input type="checkbox" data-voice-flag="polish"${s.polish ? " checked" : ""} /> 문장 다듬기</label>
      <p class="feature-hint">문맥을 보고 문장부호와 띄어쓰기를 고치고, 고른 정도만큼 말을 다듬습니다. 끄면 들린 그대로 문장부호 없이 넣습니다.</p>
      <label for="voice-polish-level">다듬는 정도</label>
      <select id="voice-polish-level" data-voice-setting="polish_level"${off ? " disabled" : ""}>${options(Object.entries(s.polish_levels), s.polish_level)}</select>
      <p class="feature-hint">${POLISH_HINTS[s.polish_level] || ""}</p>
      <label for="voice-style">문체 바꾸기 (고급)</label>
      <select id="voice-style" data-voice-setting="style"${off ? " disabled" : ""}>${options(Object.entries(s.styles), style)}</select>
      <p class="feature-hint">말한 내용을 고른 문체로 다시 씁니다. 말하는 동안은 들린 대로 적고, 키를 뗀 뒤 한 번에 바꿉니다.</p>
      ${style === "custom" ? `
        <form class="memory-search" data-voice-style-form>
          <input type="text" data-voice-style-custom maxlength="200" value="${escapeHtml(s.style_custom)}" placeholder="예: 회의록처럼 짧게, 사극 말투로" aria-label="원하는 문체"${off ? " disabled" : ""} />
          <button class="secondary-button" type="submit"${off ? " disabled" : ""}>적용</button>
        </form>` : ""}
      <span class="field-label">표시 위치</span>
      <p class="feature-hint">작업 표시줄 위의 작은 막대를 끌어서 옮길 수 있습니다.</p>
      <div class="feature-actions"><button class="secondary-button" type="button" data-voice-position>처음 위치로</button></div>`);
  }

  function soundsHtml(s) {
    return group("sounds", "타건음", `
      <label for="voice-keyboard">키보드</label>
      <select id="voice-keyboard" data-voice-setting="sound_keyboard">${options(Object.entries(s.sound_keyboards), s.sound_keyboard)}</select>
      <p class="feature-hint">기종마다 다른 실제 연속 타건음이 들립니다.</p>
      <div class="feature-actions">
        <button class="secondary-button" type="button" data-voice-preview aria-pressed="${Boolean(preview)}">${preview ? "스탑" : "미리듣기"}</button>
      </div>
      <label class="check-row"><input type="checkbox" data-voice-flag="sound_processing"${s.sound_processing ? " checked" : ""} /> 타건음 켜기</label>
      <p class="feature-hint">글자가 입력되는 동안 타건음이 납니다. 스피커를 쓰면 소리가 마이크에 섞일 수 있습니다.</p>`);
  }

  function learningHtml(s) {
    const ready = s.personal_ready;
    const text = terms ?? s.terms.join("\n");
    const notes = s.notes.length
      ? `<ul class="memory-list">${s.notes.map((note) => `
          <li class="memory-item">
            <p class="memory-text">${escapeHtml(note.old)} → ${escapeHtml(note.new)} <span class="memory-badge">${NOTE_STATES[note.state] || ""}</span></p>
            <div class="memory-actions"><button class="text-button danger" type="button" data-voice-note-delete="${escapeHtml(note.old)}" aria-label="${escapeHtml(`${note.old} → ${note.new} 삭제`)}">지우기</button></div>
          </li>`).join("")}</ul>`
      : '<p class="feature-hint">아직 없습니다. 붙여 넣은 글에서 틀린 단어를 고치면 여기에 쌓이고, 같은 단어를 두 번 고치면 다음부터 맞게 적습니다.</p>';
    const p = s.profile || {};
    const me = p.domain
      ? `<p class="memory-text">${escapeHtml(p.domain)}</p>
         ${(p.topics || []).length ? `<p class="feature-hint">${escapeHtml(p.topics.join(" · "))}</p>` : ""}
         <p class="voice-terms" aria-label="자주 쓰는 말">${(p.terms || []).slice(0, 40).map((term) => `<span class="memory-badge">${escapeHtml(term)}</span>`).join("")}</p>
         <p class="feature-hint">자주 쓰는 말 ${(p.terms || []).length}개 · ${escapeHtml(p.updated || "")}에 파악</p>`
      : '<p class="feature-hint">받아쓰기가 쌓이면 분야와 자주 쓰는 말을 스스로 파악합니다.</p>';
    const off = ready ? "" : " disabled";
    return group("learning", "용어 사전과 배우기", `
      <label for="voice-terms">잘 틀리는 이름이나 전문용어 · 한 줄에 하나씩</label>
      <textarea id="voice-terms" class="persona-text" rows="6" spellcheck="false" data-voice-terms${off}>${escapeHtml(text)}</textarea>
      <p class="feature-hint" data-voice-terms-count>${termsOf(text).length}개</p>
      <div class="feature-actions"><button class="primary-button" type="button" data-voice-terms-save${terms === null || !ready ? " disabled" : ""}>저장</button></div>
      <label class="check-row"><input type="checkbox" data-voice-flag="learn"${s.learn ? " checked" : ""} /> 자동으로 배우기</label>
      <p class="feature-hint">붙여 넣은 뒤 직접 고친 단어와 자주 쓰는 말을 배워 다음부터 더 정확하게 적습니다. 학습 기록은 이 Windows 사용자에게 보호되어 최대 30일·최근 1,000건 보관됩니다. 끄면 새 글을 학습 기록에 저장하지 않습니다.</p>
      <span class="field-label">오타 노트</span>
      ${notes}
      <form class="memory-search" data-voice-note-form>
        <input type="text" data-voice-note-old placeholder="틀린 표기" aria-label="틀린 표기" spellcheck="false"${off} />
        <span aria-hidden="true">→</span>
        <input type="text" data-voice-note-new placeholder="바른 표기" aria-label="바른 표기" spellcheck="false"${off} />
        <button class="secondary-button" type="submit"${off}>추가</button>
      </form>
      <span class="field-label">Thock이 아는 나</span>
      ${me}
      ${p.error ? `<p class="provider-status" data-tone="error">${escapeHtml(p.error)}</p>` : ""}
      <div class="memory-actions">
        <button class="text-button" type="button" data-voice-profile="rebuild"${p.building || !ready ? " disabled" : ""}>${p.building ? "파악하는 중…" : "다시 파악하기"}</button>
        <button class="text-button" type="button" data-voice-profile="reset"${off}>지우기</button>
      </div>
      <p class="feature-hint">배운 표현·프로필·학습 기록을 함께 지웁니다. 직접 등록한 용어는 남습니다. 이전 버전의 원본 자료는 별도로 보존됩니다.</p>
      <div class="memory-actions"><button class="text-button danger" type="button" data-voice-forget${off}>학습 자료 모두 지우기</button></div>`);
  }

  function moreHtml(s) {
    const account = s.account || {};
    const connected = account.state === "signed_in" || account.state === "offline";
    // A Thock the user runs on its own keeps its own sign-in; the one built into Crema uses Crema's.
    const own = !s.embedded && account.email ? `<p class="feature-hint">따로 설치한 Thock을 씁니다 · ${escapeHtml(account.email)}</p>` : "";
    return group("more", "기타", `
      <label class="check-row"><input type="checkbox" data-voice-reports${account.error_reports?.enabled ? " checked" : ""}${connected ? "" : " disabled"} /> 오류 정보 보내기</label>
      <p class="feature-hint">문제가 생기면 앱 버전, 실패한 단계, 입력하던 프로그램 이름 같은 정보만 AI Shift로 보냅니다. 말한 내용과 음성은 보내지 않습니다.</p>
      <label class="check-row"><input type="checkbox" data-voice-flag="keep_audio"${s.keep_audio ? " checked" : ""} /> 녹음 보관 (문제 해결용)</label>
      <p class="feature-hint">최근 받아쓰기 30건의 녹음을 이 PC에만 보호해 보관합니다. 인식이 이상할 때 원인을 찾는 데 씁니다. 서버로 보내지 않습니다.</p>
      <span class="field-label">글 복구</span>
      <p class="feature-hint">입력하지 못했거나 입력 여부를 확인하지 못한 글을 최근 5건까지 보호해 보관합니다.</p>
      <div class="feature-actions"><button class="secondary-button" type="button" data-voice-recovery>보관한 글 열기</button></div>
      ${own}
      <p class="feature-hint">Thock ${escapeHtml(s.version)}</p>`);
  }

  const status = () =>
    notice ? `<p class="provider-status" data-tone="${notice.tone || ""}" role="status">${escapeHtml(notice.text)}</p>` : "";

  function render() {
    if (!settings) {
      element.innerHTML = `
        <p class="feature-hint">${escapeHtml(unavailable || "음성 입력 설정을 불러오고 있습니다…")}</p>
        ${unavailable ? '<div class="feature-actions"><button class="secondary-button" type="button" data-voice-retry>다시 확인</button></div>' : ""}`;
      dropdowns = [];
      return;
    }
    element.innerHTML = dictationHtml(settings) + soundsHtml(settings) + learningHtml(settings) + moreHtml(settings) + status();
    dropdowns = [...element.querySelectorAll("select")].map(enhanceSelect);
    watchProfile();
  }

  function stopPreview() {
    if (!preview) return;
    preview.audio.pause();
    URL.revokeObjectURL(preview.url);
    preview = null;
  }

  async function togglePreview() {
    if (preview) {
      stopPreview();
      render();
      return;
    }
    try {
      const sound = await host.thockSound(settings.sound_keyboard);
      const url = URL.createObjectURL(new Blob([sound], { type: "audio/wav" }));
      const audio = new Audio(url);
      preview = { audio, url };
      audio.addEventListener("ended", () => {
        if (preview?.audio === audio) {
          stopPreview();
          render();
        }
      }, { once: true });
      render();
      await audio.play();
    } catch {
      stopPreview();
      notice = { text: "소리를 재생하지 못했습니다.", tone: "error" };
      render();
    }
  }

  element.addEventListener("toggle", (event) => {
    const key = event.target.dataset?.voiceGroup;
    if (key) event.target.open ? opened.add(key) : opened.delete(key);
  }, true);

  element.addEventListener("click", async (event) => {
    const target = event.target.closest("button");
    if (!target || target.disabled) return;
    const segment = target.closest("[data-voice-segment]");
    if (segment) return change({ [segment.dataset.voiceSegment]: target.dataset.value });
    if (target.matches("[data-voice-retry]")) return load();
    if (target.matches("[data-voice-position]")) {
      await send("/api/settings", { position: null }, "표시를 처음 위치로 옮겼습니다.");
      return render();
    }
    if (target.matches("[data-voice-preview]")) return togglePreview();
    if (target.matches("[data-voice-terms-save]")) {
      const done = await send("/api/settings", { terms: termsOf(terms ?? "") });
      if (done) {
        settings = done;
        terms = null;
      }
      return render();
    }
    if (target.dataset.voiceNoteDelete !== undefined) {
      const notes = await send("/api/notes", { action: "delete", old: target.dataset.voiceNoteDelete }, null);
      if (notes) settings.notes = notes;
      return render();
    }
    if (target.dataset.voiceProfile) {
      const reset = target.dataset.voiceProfile === "reset";
      const result = await send("/api/profile", { action: target.dataset.voiceProfile },
        reset ? "파악한 내용을 지웠습니다. 받아쓰기가 50번 더 쌓이면 다시 파악합니다." : null);
      if (result) settings = result;
      return render();
    }
    if (target.matches("[data-voice-forget]")) {
      if (!(await host.confirm("배운 표현과 학습 기록을 모두 지울까요? 직접 등록한 용어는 남습니다.", "지우기"))) return;
      const result = await send("/api/forget-learning", {}, "학습 자료를 지웠습니다.");
      if (result) settings = result;
      return render();
    }
    if (target.matches("[data-voice-recovery]")) {
      await send("/api/window", { name: "recovery" }, null);
      return render();
    }
  });

  element.addEventListener("change", (event) => {
    const target = event.target;
    if (target.dataset.voiceSetting === "style" && target.value === "custom" && !settings.style_custom) {
      customStyle = true; // applied with its line (Thock keeps "직접 적기" only with one)
      return render();
    }
    if (target.dataset.voiceSetting) {
      if (target.dataset.voiceSetting === "sound_keyboard") stopPreview();
      customStyle = false;
      return change({ [target.dataset.voiceSetting]: target.dataset.voiceSetting === "microphone" ? target.value || null : target.value });
    }
    if (target.dataset.voiceFlag) return change({ [target.dataset.voiceFlag]: target.checked });
    if (target.matches("[data-voice-reports]")) return change({ error_reports: target.checked });
  });

  element.addEventListener("input", (event) => {
    if (!event.target.matches("[data-voice-terms]")) return;
    terms = event.target.value;
    element.querySelector("[data-voice-terms-count]").textContent = `${termsOf(terms).length}개`;
    element.querySelector("[data-voice-terms-save]").disabled = false;
  });

  element.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (event.target.matches("[data-voice-style-form]")) {
      const line = element.querySelector("[data-voice-style-custom]").value.trim();
      if (!line) return;
      customStyle = false;
      return change({ style_custom: line, style: "custom" });
    }
    if (event.target.matches("[data-voice-note-form]")) {
      const old = element.querySelector("[data-voice-note-old]").value.trim();
      const neu = element.querySelector("[data-voice-note-new]").value.trim();
      if (!old || !neu || old === neu) {
        notice = { text: "틀린 표기와 바른 표기를 서로 다르게 적어 주세요.", tone: "error" };
        return render();
      }
      const notes = await send("/api/notes", { action: "add", old, new: neu }, "오타 노트에 추가했습니다. 다음 받아쓰기부터 바로 바꿔 적습니다.");
      if (notes) settings.notes = notes;
      render();
      element.querySelector("[data-voice-note-old]")?.focus();
    }
  });

  render();
  return { element, load };
}
