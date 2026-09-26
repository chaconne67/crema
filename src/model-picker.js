import { CHECK_ICON } from "./commands.js";

// Lucide (ISC) "zap": marks the fast (priority processing) variant of a model.
export const ZAP_ICON =
  '<svg class="zap" viewBox="0 0 24 24" aria-label="빠른 속도"><path d="M15.914 4a1.5 1.5 0 00-2.474-1.561l-9 9A1.5 1.5 0 005.5 14h4.002a.5.5 0 01.471.666L8.086 20a1.5 1.5 0 002.475 1.56l9-9A1.5 1.5 0 0018.5 10h-3.997a.5.5 0 01-.472-.667z"/></svg>';

// Lucide (ISC) "chevron-right"; turned down while its Provider is open.
export const PROVIDER_CHEVRON = '<svg class="menu-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>';

function escapeHtml(value) {
  return String(value).replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]);
}

/**
 * The model menu as one list: every signed-in Provider as a collapsible row, with only `openKey`'s
 * models shown under it — each fast-capable model followed by its ⚡ variant. Shared by the settings
 * picker and the /model command menu. `selection` = { key, name, fast } of the saved choice.
 */
export const AUTO_LABEL = "자동 (무료 AI)";
// Told wherever the automatic choice is made: its judging sends the request's start to Crema's site.
export const AUTO_NOTE = "알맞은 모델을 고르려고 질문 앞부분(최대 2,000자)을 Crema 서버에 보내 판정하며, 저장하지 않습니다.";

// `auto`: offer "자동 (무료 AI)" first (some free Provider is connected); `selection.auto` marks it chosen.
export function modelMenuRows(catalog, selection, openKey, auto = false) {
  const first = auto ? [{ kind: "auto", label: AUTO_LABEL, selected: Boolean(selection.auto) }] : [];
  return first.concat(catalog.flatMap((group) => [
    { kind: "provider", key: group.key, label: group.provider, open: group.key === openKey },
    ...(group.key !== openKey
      ? []
      : group.models.flatMap((model) =>
          [false, ...(model.fast ? [true] : [])].map((fast) => ({
            kind: "model",
            model,
            fast,
            label: model.name,
            selected: group.key === selection.key && model.name === selection.name && fast === Boolean(selection.fast),
          })),
        )),
  ]));
}

/**
 * Settings model chooser: opens with the current model's Provider expanded and that model highlighted;
 * clicking another Provider opens it instead. getSelection() → { key, provider, name, fast }.
 * onOpen() reloads the models (the engine refreshes each Provider's list in the background), and the
 * open list is redrawn from them.
 */
export function createModelPicker({ getCatalog, getSelection, onChoose, offerAuto = () => false, onOpen = async () => {} }) {
  const wrapper = document.createElement("div");
  wrapper.className = "dropdown model-picker";
  wrapper.innerHTML = `
    <button type="button" class="dropdown-button" id="model-picker-button" aria-haspopup="listbox" aria-expanded="false">
      <span class="model-name"></span><span class="model-provider"></span>
    </button>
    <div class="dropdown-list" role="listbox" hidden></div>`;
  const button = wrapper.querySelector("button");
  const list = wrapper.querySelector(".dropdown-list");
  let openKey = null;
  let rows = [];
  let active = 0;

  function refresh() {
    const selected = getSelection();
    button.querySelector(".model-name").innerHTML = `${escapeHtml(selected.name)}${selected.fast ? ZAP_ICON : ""}`;
    button.querySelector(".model-provider").textContent = selected.provider || "";
  }

  function render() {
    const catalog = getCatalog();
    rows = modelMenuRows(catalog, getSelection(), openKey, offerAuto());
    active = Math.min(Math.max(active, 0), Math.max(rows.length - 1, 0));
    list.innerHTML = catalog.length
      ? rows
          .map((row, index) => {
            const kind = row.kind === "provider" ? `menu-parent${row.open ? " open" : ""}` : "menu-child";
            const icon = row.kind === "provider" ? PROVIDER_CHEVRON : row.selected ? CHECK_ICON : "";
            return `
          <button type="button" class="menu-item ${kind}${index === active ? " active" : ""}" role="option" data-index="${index}" aria-selected="${Boolean(row.selected)}"${row.kind === "provider" ? ` aria-expanded="${row.open}"` : ""}>
            <span class="menu-icon">${icon}</span>
            <span class="menu-label">${escapeHtml(row.label)}${row.fast ? ZAP_ICON : ""}</span>
            <span class="menu-hint"></span>
          </button>`;
          })
          .join("")
      : `<div class="menu-title">연결되면 모델 목록을 불러옵니다.</div>`;
    list.querySelector(".menu-item.active")?.scrollIntoView?.({ block: "nearest" });
  }

  function close() {
    list.hidden = true;
    button.setAttribute("aria-expanded", "false");
  }

  function open() {
    list.hidden = false;
    button.setAttribute("aria-expanded", "true");
    const room = (button.closest(".settings-body") || document.body).getBoundingClientRect().bottom - button.getBoundingClientRect().bottom;
    wrapper.classList.toggle("up", room < 300);
    openKey = getSelection().key;
    rows = modelMenuRows(getCatalog(), getSelection(), openKey, offerAuto());
    active = Math.max(0, rows.findIndex((row) => row.selected));
    render();
    onOpen()
      .then(() => {
        if (!list.hidden) render();
      })
      .catch(() => {});
  }

  function pick(index) {
    const row = rows[index];
    if (!row) return;
    if (row.kind === "provider") {
      // One Provider open at a time; clicking the open one folds it.
      openKey = row.open ? null : row.key;
      active = index;
      render();
      return;
    }
    close();
    button.focus();
    onChoose(row.kind === "auto" ? { auto: true } : { model: row.model, fast: row.fast });
    refresh();
  }

  button.addEventListener("click", () => (list.hidden ? open() : close()));
  list.addEventListener("mousedown", (event) => event.preventDefault());
  list.addEventListener("click", (event) => {
    const item = event.target.closest("[data-index]");
    if (item) pick(Number(item.dataset.index));
  });
  button.addEventListener("keydown", (event) => {
    if (list.hidden) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
        event.preventDefault();
        open();
      }
      return;
    }
    const count = rows.length || 1;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      active = (active + (event.key === "ArrowDown" ? 1 : count - 1)) % count;
      render();
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      pick(active);
    } else if (event.key === "Escape" || event.key === "Tab") {
      if (event.key === "Escape") event.preventDefault();
      close();
    }
  });
  document.addEventListener("mousedown", (event) => {
    if (!list.hidden && !wrapper.contains(event.target)) close();
  });

  return { element: wrapper, refresh };
}
