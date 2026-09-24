import { enhanceSelect } from "./dropdown.js";
import { METHOD_LABELS, addableProviders } from "./providers.js";

function escapeHtml(value) {
  return String(value).replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]);
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Settings "Provider" section: the Providers signed in now, and adding one. Adding picks a Provider,
 * then its sign-in method (asked only when it has more than one), then runs that sign-in through
 * local Hermes. Model choice and speed live in the AI section; nothing here touches them.
 * getStatus() → providerStatus() rows; onChanged() reloads them after a sign-in.
 */
export function createProviderSection({ host, getConnection, getStatus, onChanged }) {
  const element = document.createElement("div");
  element.className = "provider-section";
  element.innerHTML = `
    <ul class="provider-list" data-provider-list></ul>
    <p class="field-note" data-provider-note></p>
    <button class="secondary-button add-button" type="button" data-provider-add>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>Provider 추가
    </button>
    <div class="provider-add" data-provider-form hidden>
      <p class="provider-status" data-provider-loading role="status"></p>
      <div class="field-group" data-provider-fields hidden>
        <label for="provider-select">Provider</label>
        <select id="provider-select"></select>
        <div class="field-group" data-method-field hidden>
          <label for="method-select">인증 방식</label>
          <select id="method-select"></select>
        </div>
        <div class="provider-step" data-provider-step></div>
      </div>
      <button class="text-button" type="button" data-provider-cancel>취소</button>
    </div>`;
  const $ = (selector) => element.querySelector(selector);
  const providerSelect = $("#provider-select");
  const methodSelect = $("#method-select");
  const dropdowns = [enhanceSelect(providerSelect), enhanceSelect(methodSelect)];
  let addable = [];
  let pending = null; // cancels a running device-code wait

  const isLocal = () => getConnection().mode === "local";

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
    $("[data-provider-note]").textContent = !isLocal()
      ? "메인서버 Hermes의 Provider는 서버에서 관리합니다."
      : rows.length
        ? ""
        : "연결되면 사용할 수 있는 Provider를 불러옵니다.";
    $("[data-provider-add]").hidden = !isLocal() || !$("[data-provider-form]").hidden;
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
    const name = providerSelect.selectedOptions[0]?.textContent || "Provider";
    closeForm();
    $("[data-provider-note]").textContent = `${name}을(를) 연결했습니다. 이제 모델 목록에서 고를 수 있습니다.`;
  }

  const currentMethod = () => addable[providerSelect.selectedIndex]?.methods[Number(methodSelect.value) || 0];

  function showMethods() {
    const methods = addable[providerSelect.selectedIndex]?.methods || [];
    methodSelect.innerHTML = methods.map((method, index) => `<option value="${index}">${METHOD_LABELS[method.kind]}</option>`).join("");
    // Only a choice when there is one.
    $("[data-method-field]").hidden = methods.length < 2;
    dropdowns.forEach((dropdown) => dropdown.refresh());
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
      step.innerHTML = `
        <label for="provider-key">API 키</label>
        <input id="provider-key" type="password" autocomplete="off" spellcheck="false" placeholder="키를 붙여넣으세요" />
        <p class="field-note">Hermes 설정에 저장됩니다.${method.url ? ' <button class="link-button" type="button" data-key-page>키 발급 페이지</button>' : ""}</p>
        <button class="primary-button" type="button" data-save-key>확인하고 저장</button>`;
      step.querySelector("[data-key-page]")?.addEventListener("click", () => host.openLink(method.url));
      step.querySelector("[data-save-key]").addEventListener("click", () => saveKey(method));
    } else if (method.flow === "device_code") {
      step.innerHTML = `
        <button class="primary-button" type="button" data-start-login>로그인 시작</button>
        <div class="device-login" data-device hidden>
          <p class="field-note">로그인 페이지에 아래 코드를 입력하세요.</p>
          <div class="device-code" data-device-code></div>
          <button class="secondary-button" type="button" data-open-login>로그인 페이지 열기</button>
        </div>`;
      step.querySelector("[data-start-login]").addEventListener("click", (event) => deviceLogin(method, event.currentTarget));
    } else {
      step.innerHTML = `
        <p class="field-note">이 Provider는 터미널에서 직접 로그인합니다. 터미널 창의 안내를 따른 뒤 완료 확인을 눌러 주세요.</p>
        <button class="primary-button" type="button" data-open-terminal>터미널에서 로그인</button>
        <button class="secondary-button" type="button" data-check-login>로그인 완료 확인</button>`;
      step.querySelector("[data-open-terminal]").addEventListener("click", () =>
        host.openLoginTerminal(method.command).catch(() => setStatus("터미널을 열지 못했습니다.", "error")),
      );
      step.querySelector("[data-check-login]").addEventListener("click", () => checkConnected());
    }
    step.insertAdjacentHTML("beforeend", '<p class="provider-status" data-step-status role="status"></p>');
  }

  async function saveKey(method) {
    const input = $("#provider-key");
    const value = input.value.trim();
    if (!value) {
      setStatus("API 키를 입력해 주세요.", "error");
      return;
    }
    setStatus("키를 확인하고 있습니다…");
    try {
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

  async function checkConnected() {
    const key = addable[providerSelect.selectedIndex]?.key;
    setStatus("확인하고 있습니다…");
    await onChanged();
    if (getStatus().some((row) => row.key === key)) await finish();
    else setStatus("아직 로그인이 확인되지 않았습니다. 터미널에서 로그인을 마친 뒤 다시 눌러 주세요.", "error");
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
      addable = addableProviders(accounts.providers || [], env || {}, new Set(getStatus().map((row) => row.key)));
      providerSelect.innerHTML = addable.map((group, index) => `<option value="${index}">${escapeHtml(group.name)}</option>`).join("");
      loading.textContent = addable.length ? "" : "추가할 수 있는 Provider가 없습니다.";
      $("[data-provider-fields]").hidden = !addable.length;
      showMethods();
    } catch (error) {
      loading.dataset.tone = "error";
      loading.textContent = error.userMessage;
    }
  }

  $("[data-provider-add]").addEventListener("click", openForm);
  $("[data-provider-cancel]").addEventListener("click", closeForm);
  providerSelect.addEventListener("change", showMethods);
  methodSelect.addEventListener("change", showStep);

  return { element, render };
}
