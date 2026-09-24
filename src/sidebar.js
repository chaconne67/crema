import { FOLDER_ICON } from "./app.js";

// Lucide (ISC): square-pen, plus, x, trash-2, pin, pin-off, archive.
const NEW_CHAT_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z"></path></svg>`;
const PLUS_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"></path><path d="M12 5v14"></path></svg>`;
const X_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg>`;
const TRASH_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 11v6"></path><path d="M14 11v6"></path><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"></path><path d="M3 6h18"></path><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`;
const PIN_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 17v5"></path><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"></path></svg>`;
const PIN_OFF_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 17v5"></path><path d="M15 9.34V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H7.89"></path><path d="m2 2 20 20"></path><path d="M9 9v1.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h11"></path></svg>`;
const ARCHIVE_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><rect width="20" height="5" x="2" y="3" rx="1"></rect><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"></path><path d="M10 12h4"></path></svg>`;

// Folder colors a project can take (the popup under its folder icon); "" is the default ink.
export const FOLDER_COLORS = [
  ["", "기본"],
  ["#ef4444", "빨강"],
  ["#f97316", "주황"],
  ["#eab308", "노랑"],
  ["#22c55e", "초록"],
  ["#14b8a6", "청록"],
  ["#3b82f6", "파랑"],
  ["#a855f7", "보라"],
  ["#ec4899", "분홍"],
];

// Sidebar width (px): dragged or ←/→ on its right edge; double-click goes back to the default.
export const SIDEBAR_WIDTH = { min: 200, default: 264, max: 480, step: 16 };

function escapeHtml(value) {
  return String(value).replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]);
}

/** A reply in progress shows a spinner; one finished while the chat was not open shows a blue dot until opened. */
function chatStatus(chat, running) {
  if (running.has(chat.id)) return '<span class="row-status row-spinner" role="img" aria-label="답변 작성 중"></span>';
  if (chat.unread) return '<span class="row-status row-unread" role="img" aria-label="새 답변"></span>';
  return "";
}

function chatRow(chat, activeChatId, nested, running) {
  const active = chat.id === activeChatId;
  const title = escapeHtml(chat.title);
  const pin = chat.pinned
    ? `<button type="button" class="row-action" data-pin-chat="${chat.id}" aria-pressed="true" aria-label="${title} 고정 해제" title="고정 해제">${PIN_OFF_ICON}</button>`
    : `<button type="button" class="row-action" data-pin-chat="${chat.id}" aria-pressed="false" aria-label="${title} 고정" title="고정">${PIN_ICON}</button>`;
  return `
    <li class="sidebar-row chat-row${nested ? " nested" : ""}${active ? " active" : ""}">
      <button type="button" class="row-main" data-open-chat="${chat.id}"${active ? ' aria-current="true"' : ""}>
        <span class="row-label">${title}</span>${chatStatus(chat, running)}
      </button>
      <span class="row-actions">${pin}<button type="button" class="row-action" data-archive-chat="${chat.id}" aria-label="${title} 보관" title="보관">${ARCHIVE_ICON}</button></span>
    </li>`;
}

/** Archived chats: opening one takes it out of the archive; deleting here is for good. */
function archivedRow(chat, running) {
  const title = escapeHtml(chat.title);
  return `
    <li class="sidebar-row chat-row archived-row">
      <button type="button" class="row-main" data-restore-chat="${chat.id}" title="꺼내서 열기">
        <span class="row-label">${title}</span>${chatStatus(chat, running)}
      </button>
      <span class="row-actions"><button type="button" class="row-action" data-delete-chat="${chat.id}" aria-label="${title} 영구 삭제" title="영구 삭제">${TRASH_ICON}</button></span>
    </li>`;
}

export function createSidebar({
  onNewChat,
  onOpenChat,
  onAddProject,
  onRemoveProject,
  onDeleteChat,
  onPinChat,
  onArchiveChat,
  onRestoreChat,
  onToggleProject,
  onProjectColor,
  onResize,
}) {
  let element;
  let popup;
  let workspaceElement;
  let resizer;
  // The archive starts closed each launch and stays as the user left it between renders.
  let archiveOpen = false;

  /** Applies a width within bounds (at most half the window) and returns it. */
  function setWidth(value) {
    const max = Math.min(SIDEBAR_WIDTH.max, Math.floor(window.innerWidth / 2));
    const width = Math.round(Math.min(max, Math.max(SIDEBAR_WIDTH.min, value)));
    workspaceElement.style.setProperty("--sidebar-width", `${width}px`);
    resizer.setAttribute("aria-valuenow", String(width));
    return width;
  }

  function mountResizer() {
    resizer = document.createElement("div");
    resizer.className = "sidebar-resizer";
    resizer.tabIndex = 0;
    resizer.title = "끌어서 너비 조절 · 두 번 누르면 기본 너비";
    for (const [name, value] of Object.entries({
      role: "separator",
      "aria-orientation": "vertical",
      "aria-label": "사이드바 너비",
      "aria-valuemin": String(SIDEBAR_WIDTH.min),
      "aria-valuemax": String(SIDEBAR_WIDTH.max),
    })) {
      resizer.setAttribute(name, value);
    }
    workspaceElement.append(resizer);
    resizer.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      resizer.setPointerCapture(event.pointerId);
      workspaceElement.classList.add("sidebar-resizing");
    });
    resizer.addEventListener("pointermove", (event) => {
      if (resizer.hasPointerCapture(event.pointerId)) setWidth(event.clientX - element.getBoundingClientRect().left);
    });
    resizer.addEventListener("pointerup", (event) => {
      if (!resizer.hasPointerCapture(event.pointerId)) return;
      resizer.releasePointerCapture(event.pointerId);
      workspaceElement.classList.remove("sidebar-resizing");
      onResize(setWidth(element.getBoundingClientRect().width));
    });
    resizer.addEventListener("dblclick", () => onResize(setWidth(SIDEBAR_WIDTH.default)));
    resizer.addEventListener("keydown", (event) => {
      const direction = { ArrowLeft: -1, ArrowRight: 1 }[event.key];
      if (!direction) return;
      event.preventDefault();
      onResize(setWidth(element.getBoundingClientRect().width + direction * SIDEBAR_WIDTH.step));
    });
  }

  function closeColorPopup() {
    popup.hidden = true;
  }

  /** Color choices under a project's folder icon. */
  function openColorPopup(projectId, anchor, current) {
    popup.dataset.project = projectId;
    popup.innerHTML = `
      <p class="folder-color-title">폴더 색</p>
      <div class="folder-color-swatches">
        ${FOLDER_COLORS.map(
          ([color, name]) =>
            `<button type="button" class="folder-swatch${color === (current || "") ? " selected" : ""}" data-folder-color="${color}" style="--swatch: ${color || "var(--muted)"}" aria-label="${name}" title="${name}"></button>`,
        ).join("")}
      </div>`;
    const box = anchor.getBoundingClientRect();
    popup.style.left = `${box.left}px`;
    popup.style.top = `${box.bottom + 6}px`;
    popup.hidden = false;
    popup.querySelector(".selected")?.focus();
  }

  return {
    mount(target) {
      workspaceElement = target;
      element = document.createElement("aside");
      element.className = "sidebar";
      element.setAttribute("aria-label", "프로젝트와 대화");
      workspaceElement.prepend(element);

      popup = document.createElement("div");
      popup.className = "folder-color-popup";
      popup.setAttribute("role", "dialog");
      popup.setAttribute("aria-label", "폴더 색");
      popup.hidden = true;
      element.after(popup);
      mountResizer();
      popup.addEventListener("click", (event) => {
        const swatch = event.target.closest("[data-folder-color]");
        if (!swatch) return;
        onProjectColor(popup.dataset.project, swatch.dataset.folderColor);
        closeColorPopup();
      });
      document.addEventListener("pointerdown", (event) => {
        if (!popup.hidden && !popup.contains(event.target) && !event.target.closest("[data-folder-color-for]")) closeColorPopup();
      });
      document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && !popup.hidden) closeColorPopup();
      });

      element.addEventListener("click", (event) => {
        const target = event.target.closest("button");
        if (!target) return;
        const { newChat, openChat, deleteChat, pinChat, archiveChat, restoreChat, removeProject, toggleProject, projectChat, folderColorFor } =
          target.dataset;
        if (folderColorFor) {
          if (!popup.hidden && popup.dataset.project === folderColorFor) closeColorPopup();
          else openColorPopup(folderColorFor, target, target.dataset.color);
          return;
        }
        if (newChat !== undefined) onNewChat(null);
        else if (target.hasAttribute("data-add-project")) onAddProject();
        else if (projectChat) onNewChat(projectChat);
        else if (openChat) onOpenChat(openChat);
        else if (deleteChat) onDeleteChat(deleteChat);
        else if (pinChat) onPinChat(pinChat);
        else if (archiveChat) onArchiveChat(archiveChat);
        else if (restoreChat) onRestoreChat(restoreChat);
        else if (removeProject) onRemoveProject(removeProject);
        else if (toggleProject) onToggleProject(toggleProject);
      });
      // `toggle` does not bubble; capture it from the archive's <details>.
      element.addEventListener(
        "toggle",
        (event) => {
          if (event.target.classList?.contains("sidebar-archive")) archiveOpen = event.target.open;
        },
        true,
      );
    },

    setWidth,

    /** `running`: ids of chats with a reply in progress. */
    render(workspace, running = new Set()) {
      const all = [...workspace.chats].sort((a, b) => b.updatedAt - a.updatedAt);
      const archived = all.filter((chat) => chat.archived);
      const pinned = all.filter((chat) => !chat.archived && chat.pinned);
      // Pinned chats show only in their own section on top.
      const sorted = all.filter((chat) => !chat.archived && !chat.pinned);
      const projects = workspace.projects
        .map((project) => {
          const open = !workspace.collapsed[project.id];
          const chats = sorted.filter((chat) => chat.projectId === project.id);
          return `
            <li class="project-group">
              <div class="sidebar-row project-row">
                <button type="button" class="row-icon folder-color-button" data-folder-color-for="${project.id}" data-color="${project.color || ""}"${project.color ? ` style="color: ${project.color}"` : ""} aria-label="${escapeHtml(project.name)} 폴더 색 바꾸기" title="폴더 색">${FOLDER_ICON}</button>
                <button type="button" class="row-main" data-toggle-project="${project.id}" aria-expanded="${open}" title="${escapeHtml(project.path)}">
                  <span class="row-label">${escapeHtml(project.name)}</span>
                </button>
                <button type="button" class="row-action" data-project-chat="${project.id}" aria-label="${escapeHtml(project.name)}에서 새 대화" title="이 프로젝트에서 새 대화">${PLUS_ICON}</button>
                <button type="button" class="row-action" data-remove-project="${project.id}" aria-label="${escapeHtml(project.name)} 목록에서 제거" title="목록에서 제거 (폴더는 그대로)">${X_ICON}</button>
              </div>
              ${open && chats.length ? `<ul class="sidebar-list">${chats.map((chat) => chatRow(chat, workspace.activeChatId, true, running)).join("")}</ul>` : ""}
            </li>`;
        })
        .join("");
      const looseChats = sorted.filter((chat) => !chat.projectId);

      element.innerHTML = `
        <div class="sidebar-top">
          <button type="button" class="sidebar-row sidebar-command" data-new-chat>
            <span class="row-icon">${NEW_CHAT_ICON}</span><span class="row-label">새 대화</span>
          </button>
        </div>
        <nav class="sidebar-scroll">
          ${
            pinned.length
              ? `<div class="sidebar-heading"><span>고정됨</span></div>
          <ul class="sidebar-list sidebar-pinned">${pinned.map((chat) => chatRow(chat, workspace.activeChatId, false, running)).join("")}</ul>`
              : ""
          }
          <div class="sidebar-heading">
            <span>프로젝트</span>
            <button type="button" class="row-action visible" data-add-project aria-label="프로젝트 폴더 추가" title="프로젝트 폴더 추가">${PLUS_ICON}</button>
          </div>
          ${projects ? `<ul class="sidebar-list">${projects}</ul>` : `<p class="sidebar-empty">+를 눌러 작업할 폴더를 추가하세요.</p>`}
          <div class="sidebar-heading"><span>대화</span></div>
          ${looseChats.length ? `<ul class="sidebar-list">${looseChats.map((chat) => chatRow(chat, workspace.activeChatId, false, running)).join("")}</ul>` : ""}
          ${
            archived.length
              ? `<details class="sidebar-archive"${archiveOpen ? " open" : ""}>
            <summary class="sidebar-heading"><span>보관함 ${archived.length}</span></summary>
            <ul class="sidebar-list">${archived.map((chat) => archivedRow(chat, running)).join("")}</ul>
          </details>`
              : ""
          }
        </nav>`;
    },
  };
}
