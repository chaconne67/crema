import { enhanceSelect } from "./dropdown.js";
import { METHOD_LABELS, addCategories, addableProviders, freeProviders } from "./providers.js";

function escapeHtml(value) {
  return String(value).replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]);
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// A GitHub token is not called an API key.
const methodLabel = (method) => (method.kind === "api_key" && method.envVar?.endsWith("_TOKEN") ? "토큰" : METHOD_LABELS[method.kind]);

/**
 * Settings "Provider" section: the Providers signed in now, and adding one. Adding picks a Provider
 * from a searchable, folded list, then its sign-in method (asked only when it has more than one), then
 * runs that sign-in through Crema's engine. Model choice and speed live in the AI section; nothing here touches them.
 * getStatus() → providerStatus() rows; onChanged() reloads them after a sign-in.
 */
export function createProviderSection({ host, getStatus, onChanged, onGuide = () => {} }) {
  const element = document.createElement("div");
  element.className = "provider-section";
  element.innerHTML = `
    <ul class="provider-list" data-provider-list></ul>
    <p class="field-note" data-provider-note></p>
    <button class="secondary-button add-button" type="button" data-provider-add>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>Provider 추가
    </button>
    <div class="provider-add" data-provider-form hidden>
      <button class="provider-add-head" type="button" data-provider-cancel aria-expanded="true" aria-label="Provider 추가 닫기">
        <span class="field-label">Provider 추가</span>
      </button>
      <p class="provider-status" data-provider-loading role="status"></p>
      <div class="field-group" data-provider-fields hidden>
        <div class="provider-picker" data-provider-picker>
          <input type="search" data-provider-search placeholder="AI 이름으로 찾기" aria-label="AI 이름으로 찾기" autocomplete="off" spellcheck="false" />
          <div data-provider-groups></div>
        </div>
        <div class="provider-chosen" data-provider-chosen hidden>
          <span class="provider-chosen-name" data-chosen-name></span>
          <button class="text-button" type="button" data-provider-repick>다른 AI 고르기</button>
        </div>
        <div class="field-group" data-method-field hidden>
          <label for="method-select">인증 방식</label>
          <select id="method-select"></select>
        </div>
        <div class="provider-step" data-provider-step></div>
      </div>
    </div>`;
  const $ = (selector) => element.querySelector(selector);
  const methodSelect = $("#method-select");
  const methodDropdown = enhanceSelect(methodSelect);
  let categories = [];
  let chosen = null; // the Provider picked from the list
  let pending = null; // cancels a running device-code wait

  function render() {
    const rows = getStatus();
    $("[data-provider-list]").innerHTML = rows
      .map(
        (row) =>
          `<li><span class="provider-name">${escapeHtml(row.name)}<span class="provider-on">ON</span></span><span class="provider-method">${row.methods
            .map((method) => METHOD_LABELS[method])
            .join(" · ")}</span></li>`,
      )
      .join("");
    $("[data-provider-note]").textContent = rows.length ? "" : "연결되면 사용할 수 있는 Provider를 불러옵니다.";
    $("[data-provider-add]").hidden = !$("[data-provider-form]").hidden;
  }

  const setStatus = (text, tone = "") => {
    const status = $("[data-step-status]");
    if (!status) return;
    status.textContent = text;
    status.dataset.tone = tone;
  };

  function closeForm() {
    pending?.();
    pending = null;
    $("[data-provider-form]").hidden = true;
    render();
  }

  async function finish() {
    await onChanged();
    const name = chosen?.name || "Provider";
    closeForm();
    $("[data-provider-note]").textContent = `${name}을(를) 연결했습니다. 이제 모델 목록에서 고를 수 있습니다.`;
  }

  const currentMethod = () => chosen?.methods[Number(methodSelect.value) || 0];

  /** The folded list; a search opens every category with a match and leaves the others out. */
  function showGroups(query = "") {
    const words = query.trim().toLowerCase();
    const matches = (group) => !words || `${group.name} ${group.key}`.toLowerCase().includes(words);
    const choice = (group) =>
      `<li><button type="button" class="provider-choice" data-choose="${escapeHtml(group.key)}"><span>${escapeHtml(group.name)}</span><span class="provider-method">${group.methods.map(methodLabel).join(" · ")}</span></button></li>`;
    const shown = categories
      .map((category) => ({ ...category, items: category.items.filter(matches) }))
      .filter((category) => category.items.length);
    $("[data-provider-groups]").innerHTML = shown.length
      ? shown
          .map(
            (category) => `
              <details class="settings-group provider-group"${category.open || words ? " open" : ""}>
                <summary>${escapeHtml(category.label)}<span class="provider-count">${category.items.length}</span></summary>
                <ul class="provider-choices">${category.items.map(choice).join("")}</ul>
              </details>`,
          )
          .join("")
      : `<p class="field-note">찾는 AI가 없습니다.</p>`;
  }

  function choose(key) {
    chosen = categories.flatMap((category) => category.items).find((group) => group.key === key) || null;
    if (!chosen) return;
    $("[data-provider-picker]").hidden = true;
    $("[data-provider-chosen]").hidden = false;
    $("[data-chosen-name]").textContent = chosen.name;
    showMethods();
  }

  function repick() {
    chosen = null;
    $("[data-provider-picker]").hidden = false;
    $("[data-provider-chosen]").hidden = true;
    showMethods();
  }

  function showMethods() {
    const methods = chosen?.methods || [];
    methodSelect.innerHTML = methods.map((method, index) => `<option value="${index}">${methodLabel(method)}</option>`).join("");
    // Only a choice when there is one.
    $("[data-method-field]").hidden = methods.length < 2;
    methodDropdown.refresh();
    showStep();
  }

  function showStep() {
    pending?.();
    pending = null;
    const method = currentMethod();
    const step = $("[data-provider-step]");
    if (!method) {
      step.innerHTML = "";
      return;
    }
    if (method.kind === "api_key") {
      const guided = freeProviders().some((item) => item.id === method.id && item.signup);
      step.innerHTML = `
        ${guided ? '<button class="primary-button" type="button" data-guide-signup>Crema에서 안내받으며 가입</button><p class="field-note">가입 화면을 옆에 열고 어디를 누를지 표시해 드려요. 키가 이미 있으면 아래에 붙여넣으세요.</p>' : ""}
        <label for="provider-key">${methodLabel(method)}</label>
        <input id="provider-key" type="password" autocomplete="off" spellcheck="false" placeholder="붙여넣으세요" />
        <p class="field-note">이 PC의 Crema 엔진에만 저장됩니다.${method.url ? ' <button class="link-button" type="button" data-key-page>키 발급 페이지</button>' : ""}</p>
        <button class="primary-button" type="button" data-save-key>확인하고 저장</button>`;
      step.querySelector("[data-key-page]")?.addEventListener("click", () => host.openLink(method.url));
      step.querySelector("[data-guide-signup]")?.addEventListener("click", () => {
        closeForm();
        onGuide(method.id);
      });
      step.querySelector("[data-save-key]").addEventListener("click", () => saveKey(method));
    } else {
      step.innerHTML = `
        <button class="primary-button" type="button" data-start-login>로그인 시작</button>
        <div class="device-login" data-device hidden>
          <p class="field-note">로그인 페이지에 아래 코드를 입력하세요.</p>
          <div class="device-code" data-device-code></div>
          <button class="secondary-button" type="button" data-open-login>로그인 페이지 열기</button>
        </div>`;
      step.querySelector("[data-start-login]").addEventListener("click", (event) => deviceLogin(method, event.currentTarget));
    }
    step.insertAdjacentHTML("beforeend", '<p class="provider-status" data-step-status role="status"></p>');
  }

  async function saveKey(method) {
    const input = $("#provider-key");
    const value = input.value.trim();
    if (!value) {
      setStatus(`${methodLabel(method)}를 입력해 주세요.`, "error");
      return;
    }
    setStatus("키를 확인하고 있습니다…");
    try {
      if (method.endpoint) {
        await saveEndpoint(method.id, method.endpoint, value);
        input.value = "";
        await finish();
        return;
      }
      const check = await host.hermesAdmin("POST", "/api/providers/validate", { key: method.envVar, value });
      if (!check.ok && check.reachable) {
        setStatus("Provider가 이 키를 받아들이지 않았습니다. 키를 다시 확인해 주세요.", "error");
        return;
      }
      await host.hermesAdmin("PUT", "/api/env", { key: method.envVar, value });
      input.value = "";
      await finish();
    } catch (error) {
      setStatus(error.userMessage, "error");
    }
  }

  /** A Provider the engine does not carry (Groq, Mistral): its key, then its OpenAI-compatible endpoint. */
  async function saveEndpoint(id, { name, base_url, key_env, model }, value) {
    await host.hermesAdmin("PUT", "/api/env", { key: key_env, value });
    const config = { providers: { [id]: { name, base_url, key_env, api_mode: "chat_completions", model } } };
    // The engine resolves a named endpoint only once some Provider is set up: the first one becomes its default.
    if (!getStatus().length) config.model = { provider: id, default: model };
    await host.hermesAdmin("PUT", "/api/config", { config });
  }

  async function deviceLogin(method, button) {
    button.disabled = true;
    setStatus("로그인을 준비하고 있습니다…");
    let cancelled = false;
    pending = () => {
      cancelled = true;
    };
    try {
      const session = await host.hermesAdmin("POST", `/api/providers/oauth/${method.id}/start`);
      $("[data-device-code]").textContent = session.user_code;
      $("[data-device]").hidden = false;
      button.hidden = true;
      $("[data-open-login]").addEventListener("click", () => host.openLink(session.verification_url));
      host.openLink(session.verification_url);
      setStatus("로그인 페이지에서 승인을 기다리고 있습니다…");
      const interval = Math.max(2, Number(session.poll_interval) || 5) * 1000;
      while (!cancelled) {
        await wait(interval);
        if (cancelled) return;
        const poll = await host.hermesAdmin("GET", `/api/providers/oauth/${method.id}/poll/${session.session_id}`);
        if (poll.status === "approved") {
          await finish();
          return;
        }
        if (poll.status !== "pending") {
          setStatus(poll.status === "expired" ? "코드가 만료되었습니다. 다시 시작해 주세요." : "로그인하지 못했습니다. 다시 시작해 주세요.", "error");
          showStep();
          return;
        }
      }
    } catch (error) {
      if (!cancelled) {
        setStatus(error.userMessage, "error");
        button.disabled = false;
      }
    }
  }

  async function openForm() {
    $("[data-provider-add]").hidden = true;
    $("[data-provider-form]").hidden = false;
    $("[data-provider-fields]").hidden = true;
    const loading = $("[data-provider-loading]");
    loading.dataset.tone = "";
    loading.textContent = "Provider 목록을 불러오고 있습니다… 처음에는 20초쯤 걸립니다.";
    try {
      const [accounts, env] = await Promise.all([
        host.hermesAdmin("GET", "/api/providers/oauth"),
        host.hermesAdmin("GET", "/api/env"),
      ]);
      if ($("[data-provider-form]").hidden) return;
      categories = addCategories(addableProviders(accounts.providers || [], env || {}, new Set(getStatus().map((row) => row.key))));
      loading.textContent = categories.length ? "" : "추가할 수 있는 Provider가 없습니다.";
      $("[data-provider-fields]").hidden = !categories.length;
      $("[data-provider-search]").value = "";
      showGroups();
      repick();
    } catch (error) {
      loading.dataset.tone = "error";
      loading.textContent = error.userMessage;
    }
  }

  $("[data-provider-add]").addEventListener("click", openForm);
  $("[data-provider-cancel]").addEventListener("click", closeForm);
  $("[data-provider-search]").addEventListener("input", (event) => showGroups(event.target.value));
  $("[data-provider-groups]").addEventListener("click", (event) => {
    const button = event.target.closest("[data-choose]");
    if (button) choose(button.dataset.choose);
  });
  $("[data-provider-repick]").addEventListener("click", repick);
  methodSelect.addEventListener("change", showStep);

  return { element, render };
}
