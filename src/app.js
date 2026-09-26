import { blobToDataUrl, fileName, imageTypeOf, requestContent } from "./attachments.js";
import { renderMarkdown } from "./markdown.js";
import { ZAP_ICON } from "./model-picker.js";
import { BACK_ICON, CHECK_ICON, COMMAND_GROUPS, MENU_ICON, filterCommands, parseCommand } from "./commands.js";
import { loadMessages, saveMessages } from "./storage.js";

const COPY_ICON = `
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <rect x="8" y="8" width="11" height="11" rx="2"></rect>
    <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"></path>
  </svg>`;

function createId() {
  return crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function formatTime(timestamp) {
  return new Intl.DateTimeFormat("ko-KR", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

async function copyText(value) {
  if (navigator.clipboard?.writeText && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch {
      // Some WebViews expose Clipboard API but deny writes; use the legacy fallback.
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();
  let copied = false;
  try {
    copied = document.execCommand("copy");
  } finally {
    textarea.remove();
  }

  if (!copied) {
    throw new Error("클립보드에 복사하지 못했습니다.");
  }
}

function createCopyButton(messageId, label) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "message-copy-button";
  button.dataset.copyMessage = messageId;
  button.setAttribute("aria-label", label);
  button.innerHTML = COPY_ICON;
  return button;
}

const SETTINGS_ICON = `
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M4 7h10M18 7h2M4 17h4M12 17h8"></path>
    <circle cx="16" cy="7" r="2"></circle>
    <circle cx="10" cy="17" r="2"></circle>
  </svg>`;

// Lucide (ISC): square-pen, panel-left, folder.
const NEW_CHAT_ICON = `
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
    <path d="M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z"></path>
  </svg>`;

const PANEL_ICON = `
  <svg viewBox="0 0 24 24" aria-hidden="true"><rect width="18" height="18" x="3" y="3" rx="2"></rect><path d="M9 3v18"></path></svg>`;

// Lucide (ISC) composer marks: plus, mic, shield, git-branch, laptop, server, chevron-down, file, x.
const icon = (body) => `<svg viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;
const PLUS_ICON = icon('<path d="M5 12h14"/><path d="M12 5v14"/>');
const MIC_ICON = icon('<path d="M12 19v3"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><rect x="9" y="2" width="6" height="13" rx="3"/>');
const SHIELD_ICON = icon('<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>');
const BRANCH_ICON = icon('<line x1="6" x2="6" y1="3" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>');
const LAPTOP_ICON = icon('<path d="M18 5a2 2 0 0 1 2 2v8.526a2 2 0 0 0 .212.897l1.068 2.127a1 1 0 0 1-.9 1.45H3.62a1 1 0 0 1-.9-1.45l1.068-2.127A2 2 0 0 0 4 15.526V7a2 2 0 0 1 2-2z"/><path d="M20.054 15.987H3.946"/>');
const CHEVRON_DOWN = `<svg class="chip-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>`;
const FILE_ICON = icon('<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>');
const X_ICON = icon('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>');

// Hermes approval modes (config `approvals.mode`) as shown next to the attach button.
const ACCESS_LABELS = { off: "승인 없이 실행", manual: "승인 요청", smart: "자동 승인" };

export const FOLDER_ICON = `
  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"></path></svg>`;

export function createChatApp({
  client,
  host,
  onOpenSettings = () => {},
  onNewChat = () => {},
  onToggleSidebar = () => {},
  onConversationUpdate = () => {},
  onNewSession = () => {},
  sessionFor = (id) => id,
  onCommand = () => {},
  onContextMenu = () => {},
  canTranscribe = () => false,
  suggestNext = null,
  answerApproval = null,
  onRenameChat = () => {},
  // (conversationId, {provider, model} that answered) → the line under an answer another Provider gave, or "".
  describeServed = () => "",
}) {
  let messages = [];
  let chatId = null;
  const elements = new Map();
  let root;
  let conversation;
  let scrollArea;
  let composer;
  let textarea;
  let sendButton;
  let stopButton;
  let emptyState;
  let liveRegion;
  // Replies in progress by chat: a reply keeps going (and saving to its chat) while another chat is open.
  const runs = new Map();
  let statusLabel;
  let statusDot;
  let newChatButton;
  let connectButton;
  let projectChip;
  let emptyTitle;
  let project = null;
  // Composer draft extra: attachments to send with the next turn.
  let attachments = [];
  // Turns typed during a reply, by chat; `queue` is the open chat's.
  const queues = new Map();
  let queue = [];
  let recorder = null;
  let mentionTimer = 0;
  // Next-input prediction: shown as the empty draft's grey text until typed over or taken.
  let suggestion = "";
  let suggestionRun = null;
  const PLACEHOLDER = "무엇이든 요청하세요";
  let menu;
  let menuButton;
  // Open menu: { mode: "commands" | "picker", items, active, onSelect }.
  let menuState = null;
  let returnMenu = null;

  function announce(message) {
    liveRegion.textContent = "";
    window.setTimeout(() => {
      liveRegion.textContent = message;
    }, 0);
  }

  function isNearBottom() {
    return scrollArea.scrollHeight - scrollArea.scrollTop - scrollArea.clientHeight < 120;
  }

  function scrollToBottom(force = false) {
    if (!force && !isNearBottom()) return;
    scrollArea.scrollTo({
      top: scrollArea.scrollHeight,
      behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ? "auto" : "smooth",
    });
  }

  function hideEmptyState() {
    emptyState.hidden = messages.length > 0;
    newChatButton.disabled = messages.length === 0 || runs.has(chatId);
  }

  function renderUserMessage(message) {
    const turn = document.createElement("section");
    turn.className = "turn turn-user";
    turn.dataset.messageId = message.id;

    const stack = document.createElement("div");
    stack.className = "user-message-stack";

    const bubble = document.createElement("article");
    bubble.className = "user-message markdown";
    bubble.setAttribute("aria-label", "내 질문");
    renderMarkdown(bubble, message.content);
    bubble.hidden = !message.content;

    const meta = document.createElement("div");
    meta.className = "message-meta";
    const time = document.createElement("time");
    time.dateTime = new Date(message.createdAt).toISOString();
    time.textContent = formatTime(message.createdAt);
    meta.append(time, createCopyButton(message.id, "질문 복사"));

    stack.append(bubble);
    if (message.attachments?.length) {
      const files = document.createElement("div");
      files.className = "message-attachments";
      files.innerHTML = message.attachments
        .map((item) => `<span class="attachment-chip">${FILE_ICON}<span>${escapeHtml(item.name)}</span></span>`)
        .join("");
      stack.append(files);
    }
    stack.append(meta);
    turn.append(stack);
    return turn;
  }

  // Images Hermes produced (`MEDIA:<path>` in a reply), read once per path: a streaming reply re-renders often.
  const mediaUrls = new Map();

  function renderMedia(path) {
    const figure = document.createElement("figure");
    figure.className = "media-image";
    const note = (text) => {
      const caption = document.createElement("figcaption");
      caption.textContent = `${text}: ${path}`;
      figure.replaceChildren(caption);
    };
    const type = imageTypeOf(path);
    if (!type) {
      note("Crema가 만든 파일");
      return figure;
    }
    if (!mediaUrls.has(path)) {
      mediaUrls.set(path, host.readFile(path).then((bytes) => URL.createObjectURL(new Blob([bytes], { type }))));
    }
    const image = document.createElement("img");
    image.alt = "Crema가 만든 그림";
    figure.append(image);
    mediaUrls
      .get(path)
      .then((url) => (image.src = url))
      .catch(() => note("그림 파일을 열지 못했습니다"));
    return figure;
  }

  function renderAssistantMessage(message) {
    const turn = document.createElement("section");
    turn.className = "turn turn-assistant";
    turn.dataset.messageId = message.id;

    const article = document.createElement("article");
    article.className = "assistant-message";
    article.setAttribute("aria-label", "Crema 답변");

    const status = document.createElement("div");
    status.className = "work-status";
    status.hidden = message.status !== "streaming";
    status.dataset.state = "thinking";
    status.innerHTML = `<div class="work-line"><span class="work-dot" aria-hidden="true"></span><span data-work-label>생각 중</span><span class="work-time" data-work-time></span></div><div class="work-divider"></div>`;

    const content = document.createElement("div");
    content.className = "assistant-content markdown";
    renderMarkdown(content, message.content, { media: renderMedia });

    const error = document.createElement("p");
    error.className = "message-error";
    error.hidden = message.status !== "error";
    error.textContent = "답변을 받지 못했습니다. 잠시 후 다시 시도해 주세요.";

    const footer = document.createElement("div");
    footer.className = "assistant-footer";
    footer.hidden = message.status === "streaming" || !message.content;
    const note = document.createElement("span");
    note.className = "assistant-note";
    note.textContent = message.note || "";
    footer.append(createCopyButton(message.id, "답변 복사"), note);

    article.append(status, content, error, footer);
    turn.append(article);
    elements.set(message.id, { turn, status, content, error, footer, note });
    return turn;
  }

  /** In-reply card for a command Hermes holds until the user allows or denies it. */
  function renderApproval(request, onDone) {
    const card = document.createElement("div");
    card.className = "approval-card";
    card.setAttribute("role", "group");
    card.setAttribute("aria-label", "명령 실행 승인");
    card.innerHTML = `
      <p class="approval-title">이 명령을 실행할까요?</p>
      ${request.description ? `<p class="approval-reason">${escapeHtml(request.description)}</p>` : ""}
      ${request.command ? `<pre class="approval-command"><code>${escapeHtml(request.command)}</code></pre>` : ""}
      <div class="approval-actions">
        <button type="button" class="approval-deny" data-approval="deny">거부</button>
        <button type="button" class="approval-allow" data-approval="allow">허용</button>
      </div>`;
    card.addEventListener("click", async (event) => {
      const button = event.target.closest("[data-approval]");
      if (!button) return;
      const allow = button.dataset.approval === "allow";
      card.querySelectorAll("button").forEach((item) => (item.disabled = true));
      try {
        await answerApproval(request, allow);
        onDone();
        announce(allow ? "명령 실행을 허용했습니다." : "명령 실행을 거부했습니다.");
      } catch {
        onDone();
        showNotice({ title: "명령 실행 승인", text: "이미 끝났거나 시간이 지난 요청입니다.", tone: "error" });
      }
    });
    return card;
  }

  function renderSessionDivider(message) {
    const divider = document.createElement("div");
    divider.className = "session-divider";
    divider.setAttribute("role", "separator");
    divider.innerHTML = `<span>새 세션 · ${formatTime(message.createdAt)}</span>`;
    return divider;
  }

  function renderMessage(message) {
    const render = { user: renderUserMessage, session: renderSessionDivider }[message.role] || renderAssistantMessage;
    const element = render(message);
    conversation.append(element);
    return element;
  }

  function updateAssistant(message) {
    const refs = elements.get(message.id);
    if (!refs) return;

    const shouldFollow = isNearBottom();
    renderMarkdown(refs.content, message.content, { media: renderMedia });
    refs.status.hidden = message.status !== "streaming";
    refs.error.hidden = message.status !== "error";
    refs.error.textContent = message.errorMessage || "응답을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.";
    refs.footer.hidden = message.status === "streaming" || !message.content;
    refs.note.textContent = message.note || "";
    if (shouldFollow) scrollToBottom(true);
  }

  function setRunning(running) {
    sendButton.hidden = running;
    stopButton.hidden = !running;
    newChatButton.disabled = running || messages.length === 0;
    textarea.setAttribute("aria-busy", String(running));
  }

  function resizeComposer() {
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 168)}px`;
    // A scrollbar only past the cap; sub-pixel line heights would otherwise show one on a single line.
    textarea.style.overflowY = textarea.scrollHeight > 168 ? "auto" : "hidden";
    // Muted send button until there is something to send.
    composer.classList.toggle("is-empty", !textarea.value.trim());
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]);
  }

  function closeMenu() {
    menuState = null;
    menu.hidden = true;
    root.querySelectorAll('[aria-expanded="true"][data-menu-button], [aria-expanded="true"][data-menu-owner]').forEach((button) =>
      button.setAttribute("aria-expanded", "false"),
    );
  }

  function menuRows() {
    const { items, active } = menuState;
    let group = null;
    return items
      .map((item, index) => {
        const heading = item.group && item.group !== group ? `<div class="menu-heading">${escapeHtml(item.group)}</div>` : "";
        group = item.group;
        const classes = ["menu-item", item.className, item.description && "has-description", index === active && "active"].filter(Boolean).join(" ");
        return `${heading}
        <button type="button" class="${classes}" data-menu-index="${index}" role="option" aria-selected="${index === active}"${item.disabled ? " disabled" : ""}>
          <span class="menu-icon">${item.icon || (item.selected ? CHECK_ICON : "")}</span>
          <span class="menu-label">${escapeHtml(item.label)}${item.badge || ""}${item.description ? `<span class="menu-description">${escapeHtml(item.description)}</span>` : ""}</span>
          <span class="menu-hint">${escapeHtml(item.hint || "")}</span>
        </button>`;
      })
      .join("");
  }

  function renderRows() {
    menu.querySelector("[data-menu-rows]").innerHTML = menuState.items.length
      ? menuRows()
      : `<p class="menu-empty">${escapeHtml(menuState.empty || "항목이 없습니다.")}</p>`;
    menu.querySelector(".menu-item.active")?.scrollIntoView?.({ block: "nearest" });
  }

  function renderMenu() {
    const { items, title, search, note } = menuState;
    const heading = menuState.back
      ? `<button type="button" class="menu-title menu-back" data-menu-back aria-label="이전 메뉴로">${BACK_ICON}<span>${escapeHtml(title)}</span></button>`
      : title
        ? `<div class="menu-title">${escapeHtml(title)}</div>`
        : "";
    menu.innerHTML = `${heading}${
      search ? `<input class="menu-search" data-menu-search type="text" spellcheck="false" autocomplete="off" placeholder="${escapeHtml(search.placeholder)}" />` : ""
    }<div class="menu-rows" data-menu-rows></div>${note ? `<p class="menu-note">${escapeHtml(note)}</p>` : ""}`;
    renderRows();
    menu.hidden = items.length === 0 && !title;
    placeMenu();
    // Only once visible and placed can the highlighted row (e.g. the model in use) scroll into view.
    menu.querySelector(".menu-item.active")?.scrollIntoView?.({ block: "nearest" });
    menu.querySelector("[data-menu-search]")?.focus();
  }

  /** Opens just above whatever opened it: the chip that owns it, else the composer. */
  function placeMenu() {
    const shell = menu.parentElement.getBoundingClientRect();
    const anchor = (menuState.owner && root.querySelector(`[data-menu-owner="${menuState.owner}"]`)) || composer;
    const box = anchor.getBoundingClientRect();
    menu.style.bottom = `${shell.bottom - box.top + 6}px`;
    if (menuState.owner === "model") {
      menu.style.left = "auto";
      menu.style.right = `${shell.right - box.right}px`;
    } else {
      menu.style.right = "auto";
      menu.style.left = `${box.left - shell.left}px`;
    }
  }

  function filterMenu(query) {
    const { search, allItems } = menuState;
    const needle = query.trim().toLowerCase();
    menuState.items = [...allItems.filter((item) => item.label.toLowerCase().includes(needle)), ...(search.extra?.(query.trim()) || [])];
    menuState.active = Math.max(0, menuState.items.findIndex((item) => !item.disabled));
    renderRows();
  }

  function moveActive(step) {
    const count = menuState.items.length;
    if (!count) return;
    let next = menuState.active;
    for (let tries = 0; tries < count; tries += 1) {
      next = (next + step + count) % count;
      if (!menuState.items[next].disabled) break;
    }
    menuState.active = next;
    renderRows();
  }

  /** A chip-owned menu (project, branch, model) opens under its chip's side and marks that chip. */
  function openMenu(state) {
    menuState = { active: 0, ...state };
    if (state.search) menuState.allItems = state.items;
    root.querySelectorAll("[data-menu-button], [data-menu-owner]").forEach((button) => button.setAttribute("aria-expanded", "false"));
    const owner = state.owner ? root.querySelector(`[data-menu-owner="${state.owner}"]`) : menuButton;
    owner?.setAttribute("aria-expanded", "true");
    menu.dataset.owner = state.owner || "";
    renderMenu();
  }

  function commandItems(query) {
    const commands = filterCommands(query);
    return COMMAND_GROUPS.flatMap((group) => commands.filter((command) => command.group === group)).map((command) => ({
      ...command,
      hint: `/${command.id}`,
      run: () => runCommand(command, ""),
    }));
  }

  /** Typing a slash filters the command menu; anything else closes it. */
  function updateSlashMenu() {
    const text = textarea.value;
    if (text.startsWith("/") && !/\s/.test(text)) openMenu({ mode: "commands", items: commandItems(text) });
    else if (menuState?.mode === "commands") closeMenu();
  }

  /** `@name` before the caret lists matching project files; picking one inserts its relative path. */
  function updateMentionMenu() {
    const before = textarea.value.slice(0, textarea.selectionStart);
    const match = /(?:^|\s)@([^\s@]*)$/.exec(before);
    window.clearTimeout(mentionTimer);
    if (!match || !project?.path) {
      if (menuState?.mode === "files") closeMenu();
      return;
    }
    mentionTimer = window.setTimeout(async () => {
      const paths = await host.listProjectFiles?.(project.path, match[1]);
      if (!paths?.length) {
        if (menuState?.mode === "files") closeMenu();
        return;
      }
      openMenu({
        mode: "files",
        title: `${project.name} 파일`,
        items: paths.map((path) => ({ label: path, icon: FILE_ICON, path })),
        onSelect(item) {
          const start = textarea.selectionStart - match[1].length - 1;
          textarea.setRangeText(`@${item.path} `, start, textarea.selectionStart, "end");
          resizeComposer();
          textarea.focus();
        },
      });
    }, 120);
  }

  function goBack() {
    const back = menuState?.back;
    if (back) openMenu(back);
  }

  function selectMenuItem(index) {
    const item = menuState?.items[index];
    if (!item || item.disabled) return;
    const onSelect = menuState.onSelect;
    // A picker opened from here (e.g. 모델 선택) can come back to this list.
    returnMenu = menuState.mode === "commands" ? { ...menuState, active: index } : null;
    closeMenu();
    if (item.run) item.run();
    else onSelect?.(item);
  }

  function renderAttachments() {
    const box = root.querySelector("[data-attachments]");
    box.hidden = !attachments.length;
    box.innerHTML = attachments
      .map(
        (item) => `
        <span class="draft-attachment${item.kind === "image" ? " is-image" : ""}" title="${escapeHtml(item.name)}">
          ${item.kind === "image" ? `<img src="${item.dataUrl}" alt="" />` : `${FILE_ICON}<span>${escapeHtml(item.name)}</span>`}
          <button type="button" class="draft-remove" data-remove-attachment="${item.id}" aria-label="${escapeHtml(item.name)} 빼기">${X_ICON}</button>
        </span>`,
      )
      .join("");
    resizeComposer();
  }

  /** Files by path (+ button, drop): images go inline, anything else as a document for Hermes to read. */
  async function addPaths(paths) {
    for (const path of paths) {
      const name = fileName(path);
      const type = imageTypeOf(name);
      try {
        if (type) {
          const bytes = await host.readFile(path);
          attachments.push({ id: createId(), kind: "image", name, dataUrl: await blobToDataUrl(new Blob([bytes], { type })) });
        } else {
          attachments.push({ id: createId(), kind: "file", name, path });
        }
      } catch (error) {
        showNotice({ title: "첨부", text: `${name}: ${error?.userMessage || "파일을 읽지 못했습니다."}`, tone: "error" });
      }
    }
    renderAttachments();
  }

  async function addPastedImages(files) {
    for (const file of files) {
      attachments.push({ id: createId(), kind: "image", name: file.name || "붙여넣은 이미지", dataUrl: await blobToDataUrl(file) });
    }
    renderAttachments();
  }

  function renderQueue() {
    const box = root.querySelector("[data-queue]");
    box.hidden = !queue.length;
    box.innerHTML = queue
      .map(
        (item, index) => `
        <div class="queued-turn">
          <span class="queued-label">대기 중</span>
          <span class="queued-text">${escapeHtml(item.text || item.attachments.map((file) => file.name).join(", "))}</span>
          <button type="button" class="draft-remove" data-remove-queued="${index}" aria-label="대기 중인 질문 빼기">${X_ICON}</button>
        </div>`,
      )
      .join("");
  }

  async function toggleRecording() {
    const button = root.querySelector("[data-mic]");
    if (recorder) {
      recorder.stop();
      return;
    }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      showNotice({ title: "음성 입력", text: "마이크를 쓸 수 없습니다. Windows 설정에서 마이크 권한을 확인해 주세요.", tone: "error" });
      return;
    }
    const chunks = [];
    recorder = new MediaRecorder(stream);
    recorder.addEventListener("dataavailable", (event) => chunks.push(event.data));
    recorder.addEventListener("stop", async () => {
      stream.getTracks().forEach((track) => track.stop());
      const type = recorder.mimeType || "audio/webm";
      recorder = null;
      button.dataset.state = "busy";
      button.setAttribute("aria-label", "음성 인식 중");
      try {
        const text = await host.transcribe(await blobToDataUrl(new Blob(chunks, { type })), type);
        if (text) {
          const spacer = textarea.value && !/\s$/.test(textarea.value) ? " " : "";
          textarea.setRangeText(`${spacer}${text}`, textarea.selectionStart, textarea.selectionEnd, "end");
          resizeComposer();
        } else {
          showNotice({ title: "음성 입력", text: "음성을 인식하지 못했습니다. 다시 말씀해 주세요." });
        }
      } catch (error) {
        showNotice({ title: "음성 입력", text: error?.userMessage || "음성을 글자로 바꾸지 못했습니다.", tone: "error" });
      } finally {
        delete button.dataset.state;
        button.setAttribute("aria-label", "음성 입력");
        textarea.focus();
      }
    });
    recorder.start();
    button.dataset.state = "recording";
    button.setAttribute("aria-label", "녹음 끝내기");
    const clock = root.querySelector("[data-recording-time]");
    const startedAt = Date.now();
    const tick = () => {
      const seconds = Math.floor((Date.now() - startedAt) / 1000);
      clock.textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
    };
    tick();
    clock.hidden = false;
    const timer = window.setInterval(tick, 500);
    recorder.addEventListener("stop", () => {
      window.clearInterval(timer);
      clock.hidden = true;
    });
  }

  function openAttachMenu(ui) {
    ui.picker({
      title: "추가",
      items: [
        {
          label: "파일 첨부",
          description: "문서·이미지를 첨부합니다",
          action: "files",
        },
        // Only with a project folder to search.
        ...(project
          ? [{ label: "프로젝트 파일 선택", description: `${project.name}의 파일을 골라 질문에 넣습니다`, hint: "@", action: "mention" }]
          : []),
      ],
      async onSelect(item) {
        if (item.action === "files") addPaths(await host.pickFiles());
        else {
          const spacer = textarea.value && !/\s$/.test(textarea.value) ? " " : "";
          textarea.setRangeText(`${spacer}@`, textarea.selectionStart, textarea.selectionEnd, "end");
          textarea.focus();
          updateMentionMenu();
        }
      },
    });
  }

  /** Pickers opened from the chips above and inside the composer (project, branch, model). */
  function contextUi() {
    return { notice: showNotice, picker: (state) => openMenu({ mode: "picker", back: null, ...state }), back: null };
  }

  function clearSuggestion() {
    suggestionRun?.abort();
    suggestionRun = null;
    suggestion = "";
    textarea.placeholder = PLACEHOLDER;
    root.querySelector("[data-suggest-hint]").hidden = true;
  }

  /** After a finished answer, asks for the likely next input without blocking anything. */
  async function predictNext(runChatId, turns) {
    if (!suggestNext || runChatId !== chatId || textarea.value || queue.length) return;
    clearSuggestion();
    const controller = new AbortController();
    suggestionRun = controller;
    try {
      const text = await suggestNext(turns, controller.signal);
      if (controller.signal.aborted || !text || textarea.value || runChatId !== chatId) return;
      suggestion = text;
      textarea.placeholder = text;
      root.querySelector("[data-suggest-hint]").hidden = false;
    } catch {
      // A missing prediction is not worth a message.
    } finally {
      if (suggestionRun === controller) suggestionRun = null;
    }
  }

  function takeSuggestion() {
    const text = suggestion;
    clearSuggestion();
    textarea.value = text;
    textarea.setSelectionRange(text.length, text.length);
    resizeComposer();
  }

  /** Short-lived result card in the conversation; not saved to the chat. */
  function showNotice({ title, rows = [], text = "", tone = "" }) {
    const card = document.createElement("section");
    card.className = `notice-card${tone ? ` ${tone}` : ""}`;
    card.setAttribute("role", "status");
    card.innerHTML = `
      <div class="notice-title">${escapeHtml(title)}</div>
      ${rows.length ? `<dl>${rows.map(([key, value]) => `<dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value)}</dd>`).join("")}</dl>` : ""}
      ${text ? `<p>${escapeHtml(text)}</p>` : ""}`;
    conversation.append(card);
    emptyState.hidden = true;
    scrollToBottom(true);
    return card;
  }

  function clearComposer() {
    textarea.value = "";
    resizeComposer();
    closeMenu();
  }

  /** Runs a menu or slash command; the app handles chat-local ones, main handles the rest. */
  function runCommand(command, arg) {
    clearComposer();
    if (runs.has(chatId) && !command.whileRunning) {
      showNotice({ title: command.label, text: "답변이 끝난 뒤에 실행할 수 있습니다." });
      return;
    }
    const all = commandItems("");
    const back = returnMenu || { mode: "commands", items: all, active: Math.max(0, all.findIndex((item) => item.id === command.id)) };
    returnMenu = null;
    // `back` lets a handler chain pickers (e.g. models → sign-ins → this command list).
    const ui = { notice: showNotice, picker: (state) => openMenu({ mode: "picker", back, ...state }), back };
    switch (command.id) {
      case "new":
        startNewSession();
        break;
      case "clear":
        clearConversation();
        break;
      case "retry": {
        const last = [...messages].reverse().find((message) => message.role === "user");
        if (!last) showNotice({ title: "다시 시도", text: "다시 보낼 질문이 없습니다." });
        else {
          textarea.value = last.content;
          submitPrompt();
        }
        break;
      }
      case "stop":
        if (runs.has(chatId)) stopResponse();
        else showNotice({ title: "응답 중지", text: "진행 중인 답변이 없습니다." });
        break;
      case "help":
        showNotice({
          title: "명령어",
          rows: commandItems("").map((item) => [`/${item.id} · /${item.alias}`, item.label]),
          text: "입력창 왼쪽 메뉴 버튼으로도 실행할 수 있습니다.",
        });
        break;
      default:
        onCommand(command.id, arg, ui);
    }
    textarea.focus();
  }

  /** `/clear`: empty this window and continue in a fresh Hermes session. */
  function clearConversation() {
    if (!messages.length) {
      showNotice({ title: "화면 지우기", text: "이미 비어 있습니다." });
      return;
    }
    onNewSession(chatId);
    messages = [];
    elements.clear();
    conversation.replaceChildren();
    saveMessages(chatId, messages);
    onConversationUpdate(chatId, messages);
    hideEmptyState();
    announce("화면을 비우고 새 세션을 시작했습니다.");
  }

  /** `/new`: same chat window, fresh Hermes session; earlier turns stay visible but unremembered. */
  function startNewSession() {
    if (!messages.length || messages.at(-1).role === "session") {
      showNotice({ title: "새 세션", text: "이미 새 세션입니다." });
      return;
    }
    onNewSession(chatId);
    const marker = { id: createId(), role: "session", content: "", createdAt: Date.now(), status: "complete" };
    messages.push(marker);
    renderMessage(marker);
    saveMessages(chatId, messages);
    onConversationUpdate(chatId, messages);
    scrollToBottom(true);
    announce("새 세션을 시작했습니다. 이전 대화는 기억하지 않습니다.");
  }

  async function submitPrompt() {
    const text = textarea.value.trim();
    const parsed = parseCommand(text);
    if (parsed) {
      runCommand(parsed.command, parsed.arg);
      return;
    }
    if (!text && !attachments.length) return;
    closeMenu();
    const turn = { text, attachments };
    attachments = [];
    textarea.value = "";
    renderAttachments();
    if (runs.has(chatId)) {
      // Sent in order once the current reply ends.
      queue.push(turn);
      renderQueue();
      return;
    }
    await sendTurn(turn);
  }

  /** Sends a turn in `runChatId` — the open chat, or a chat in the background sending its next queued turn. */
  async function sendTurn({ text, attachments: files }, runChatId = chatId) {
    if (runChatId === chatId) clearSuggestion();
    let request;
    try {
      const staged = [];
      for (const item of files) staged.push(item.kind === "file" ? { ...item, stagedPath: await host.stageDocument(item.path) } : item);
      request = requestContent(text, staged);
    } catch (error) {
      showNotice({ title: "첨부", text: error?.userMessage || "첨부 파일을 준비하지 못했습니다.", tone: "error" });
      return;
    }

    const userMessage = {
      id: createId(),
      role: "user",
      content: text,
      ...(files.length ? { attachments: files.map(({ kind, name }) => ({ kind, name })) } : {}),
      createdAt: Date.now(),
      status: "complete",
    };
    const assistantMessage = {
      id: createId(),
      role: "assistant",
      content: "",
      createdAt: Date.now(),
      status: "streaming",
    };
    // A run keeps writing to its own chat even if the view switches away.
    const runMessages = runChatId === chatId ? messages : loadMessages(runChatId);
    runMessages.push(userMessage, assistantMessage);
    if (runChatId === chatId) {
      renderMessage(userMessage);
      renderMessage(assistantMessage);
      hideEmptyState();
      resizeComposer();
      scrollToBottom(true);
    }
    saveMessages(runChatId, runMessages);
    onConversationUpdate(runChatId, runMessages);

    const controller = new AbortController();
    const startedAt = Date.now();
    let activeTool = null;
    // `approvalCard`: the card Hermes is waiting on; any later progress means it was answered or timed out.
    const run = { controller, message: assistantMessage, messages: runMessages, approvalCard: null, discarded: false };
    const settleApproval = () => {
      run.approvalCard?.remove();
      run.approvalCard = null;
    };
    // What the reply is doing now: its dot and word change with the state, the time runs beside them.
    const showWork = () => {
      const status = elements.get(assistantMessage.id)?.status;
      if (!status) return;
      const [state, word] = run.approvalCard
        ? ["waiting", "승인 기다리는 중"]
        : activeTool
          ? ["tool", `${activeTool} 실행 중`]
          : assistantMessage.content
            ? ["writing", "답변 쓰는 중"]
            : ["thinking", "생각 중"];
      status.dataset.state = state;
      status.querySelector("[data-work-label]").textContent = word;
      status.querySelector("[data-work-time]").textContent = `${Math.max(1, Math.floor((Date.now() - startedAt) / 1000))}초`;
    };
    const timer = window.setInterval(showWork, 1000);

    runs.set(runChatId, run);
    if (runChatId === chatId) setRunning(true);
    announce("Crema가 답변을 작성하고 있습니다.");

    try {
      const conversationId = sessionFor(runChatId);
      const requestMessages = [{ role: "user", content: request }];

      for await (const chunk of client.streamReply({
        messages: requestMessages,
        conversationId,
        signal: controller.signal,
        onActivity(activity) {
          settleApproval();
          activeTool = activity.status === "running" ? activity.tool || "도구" : null;
          showWork();
        },
        onServed(runtime) {
          const note = describeServed(conversationId, runtime);
          if (note) assistantMessage.note = note;
        },
        onApproval(request) {
          settleApproval();
          if (!answerApproval) return;
          run.approvalCard = renderApproval(request, settleApproval);
          showWork();
          // Shown now if this chat is open, else when it is reopened.
          const refs = elements.get(assistantMessage.id);
          if (!refs) return;
          refs.content.after(run.approvalCard);
          announce("명령 실행 승인이 필요합니다.");
          scrollToBottom(true);
        },
      })) {
        settleApproval();
        assistantMessage.content += chunk;
        updateAssistant(assistantMessage);
        showWork();
      }

      assistantMessage.status = "complete";
      announce("답변이 끝났습니다.");
    } catch (error) {
      if (error?.name === "AbortError") {
        assistantMessage.status = "stopped";
        announce("답변을 멈췄습니다.");
      } else {
        assistantMessage.status = "error";
        assistantMessage.errorMessage = error?.userMessage || "응답을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.";
        console.error(error);
        announce("답변을 받지 못했습니다.");
      }
    } finally {
      window.clearInterval(timer);
      settleApproval();
      runs.delete(runChatId);
      if (run.discarded) return;
      if (runChatId === chatId) setRunning(false);
      updateAssistant(assistantMessage);
      saveMessages(runChatId, runMessages);
      onConversationUpdate(runChatId, runMessages);
      textarea.focus();
      const pending = queues.get(runChatId);
      if (pending?.length) {
        const next = pending.shift();
        if (runChatId === chatId) renderQueue();
        sendTurn(next, runChatId);
      } else if (assistantMessage.status === "complete") {
        predictNext(runChatId, runMessages);
      }
    }
  }

  function stopResponse() {
    runs.get(chatId)?.controller.abort();
  }

  async function handleConversationClick(event) {
    const codeButton = event.target.closest("[data-copy-code]");
    if (codeButton) {
      const source = codeButton.closest(".code-block")?.querySelector("pre code")?.textContent || "";
      await copyText(source);
      announce("코드를 복사했습니다.");
      return;
    }

    const messageButton = event.target.closest("[data-copy-message]");
    if (messageButton) {
      const message = messages.find(({ id }) => id === messageButton.dataset.copyMessage);
      if (message) {
        await copyText(message.content);
        announce("메시지를 복사했습니다.");
      }
      return;
    }

    const link = event.target.closest("a[href]");
    if (link) {
      event.preventDefault();
      host.openLink(link.href);
    }
  }

  /** The open chat's project on the chip; its folder takes the project's sidebar color. */
  function setProject(nextProject) {
    project = nextProject;
    projectChip.querySelector("[data-project-name]").textContent = project?.name || "프로젝트 없음";
    projectChip.title = project?.path || "프로젝트를 고르면 Crema가 그 폴더에서 일합니다";
    projectChip.classList.toggle("is-empty", !project);
    projectChip.querySelector("svg").style.color = project?.color || "";
  }

  return {
    /** Puts a card (e.g. the sign-up guide's) at the end of the open chat; it is not saved with it. */
    showCard(card) {
      conversation.append(card);
      emptyState.hidden = true;
      scrollToBottom(true);
    },

    /** Shows a stored chat; an in-flight reply is stopped and saved to its own chat. */
    showConversation(id, { project: nextProject = null } = {}) {
      closeMenu();
      chatId = id;
      // A reply still coming in keeps its live message list, so it goes on updating on screen.
      const run = runs.get(id);
      messages = run?.messages ?? loadMessages(id);
      elements.clear();
      conversation.replaceChildren();
      for (const message of messages) renderMessage(message);
      if (run?.approvalCard) elements.get(run.message.id)?.content.after(run.approvalCard);
      setRunning(Boolean(run));
      clearSuggestion();
      setProject(nextProject);
      root.querySelector("[data-branch-chip]").hidden = true;
      queue = queues.get(id) ?? [];
      queues.set(id, queue);
      renderQueue();
      emptyTitle.textContent = project ? `${project.name}에서 무엇을 할까요?` : "무엇을 도와드릴까요?";
      hideEmptyState();
      resizeComposer();
      // Jump, not the smooth scroll: an opened chat starts at its last reply (a smooth scroll stopped short).
      scrollArea.scrollTop = scrollArea.scrollHeight;
      textarea.focus();
    },

    setProject,

    hasMessages() {
      return messages.length > 0;
    },

    /** The open chat's name, shown at the top left (click or Ctrl+Alt+R renames it). */
    setTitle(title) {
      root.querySelector("[data-chat-title]").textContent = title;
    },

    /** Stops a chat's reply for good (the chat is being deleted): nothing of it is saved afterwards. */
    discardReply(id) {
      queues.delete(id);
      const run = runs.get(id);
      if (!run) return;
      run.discarded = true;
      run.controller.abort();
    },

    /** state: "connected" | "checking" | "offline" | "error"; label goes on the connection chip. */
    setStatus(state, label) {
      root.dataset.connection = state;
      statusLabel.textContent = label;
      connectButton.hidden = state === "connected" || state === "checking";
      root.querySelector("[data-mic]").hidden = !canTranscribe();
    },

    /** The project folder's Git branch, or null outside a Git work tree. */
    setBranch(info) {
      const chip = root.querySelector("[data-branch-chip]");
      chip.hidden = !info?.branch;
      chip.querySelector("[data-branch-name]").textContent = info?.branch || "";
    },

    /** Model chip: model name, then reasoning effort in a quieter tone. */
    setModel({ name, detail = "", fast = false }) {
      root.querySelector("[data-model-name]").textContent = name;
      root.querySelector("[data-model-fast]").hidden = !fast;
      root.querySelector("[data-model-detail]").textContent = detail;
    },

    /** Hermes' approval mode ("off" = runs commands without asking); null hides it. */
    setAccess(mode) {
      const chip = root.querySelector("[data-access]");
      chip.hidden = !ACCESS_LABELS[mode];
      chip.dataset.mode = mode || "";
      chip.querySelector("span").textContent = ACCESS_LABELS[mode] || "";
    },

    addFiles: (paths) => addPaths(paths),

    mount(target) {
      root = target;
      root.innerHTML = `
        <div class="app-shell">
          <header class="app-bar">
            <div class="app-bar-start">
              <button class="icon-button" type="button" data-toggle-sidebar aria-label="사이드바" title="사이드바">${PANEL_ICON}</button>
              <button class="chat-title" type="button" data-chat-title title="대화 이름 바꾸기 (Ctrl+Alt+R)"></button>
            </div>
            <div class="app-bar-actions">
              <button class="icon-button" type="button" data-new-chat aria-label="새 대화" title="새 대화">${NEW_CHAT_ICON}</button>
              <button class="icon-button" type="button" data-open-settings aria-label="설정" title="설정">${SETTINGS_ICON}</button>
            </div>
          </header>
          <main class="conversation-scroll" aria-label="대화 내용">
            <div class="conversation-content" data-conversation></div>
            <div class="empty-state" data-empty-state>
              <p data-empty-title>무엇을 도와드릴까요?</p>
              <button class="text-button" type="button" data-connect hidden>Crema 엔진 연결하기</button>
            </div>
          </main>
          <footer class="composer-shell">
            <div class="command-menu" data-command-menu role="listbox" aria-label="명령" hidden></div>
            <div class="composer-context">
              <button class="context-chip" type="button" data-project-chip data-menu-owner="project" aria-label="프로젝트 바꾸기" title="프로젝트 바꾸기">${FOLDER_ICON}<span data-project-name>프로젝트 없음</span>${CHEVRON_DOWN}</button>
              <button class="context-chip" type="button" data-connection-chip data-menu-owner="location" aria-label="연결 설정" title="연결 설정"><span class="chip-icon">${LAPTOP_ICON}</span><span data-status-label>연결 확인 중</span><span class="status-dot" aria-hidden="true"></span>${CHEVRON_DOWN}</button>
              <button class="context-chip" type="button" data-branch-chip data-menu-owner="branch" aria-label="브랜치 바꾸기" title="브랜치 바꾸기" hidden>${BRANCH_ICON}<span data-branch-name></span>${CHEVRON_DOWN}</button>
            </div>
            <form class="composer" data-composer>
              <div class="composer-attachments" data-attachments hidden></div>
              <div class="composer-queue" data-queue hidden></div>
              <label class="sr-only" for="prompt">메시지 입력</label>
              <textarea
                id="prompt"
                name="prompt"
                rows="1"
                maxlength="12000"
                placeholder="무엇이든 요청하세요"
                autocomplete="off"
              ></textarea>
              <div class="composer-toolbar">
                <button class="tool-button" type="button" data-menu-button aria-label="명령 메뉴" title="명령 메뉴 (/)" aria-expanded="false">${MENU_ICON}</button>
                <button class="tool-button" type="button" data-attach data-menu-owner="attach" aria-label="파일 추가" title="파일 추가">${PLUS_ICON}</button>
                <button class="access-chip" type="button" data-access data-menu-owner="access" aria-label="명령 실행 승인" title="명령 실행 승인" hidden>${SHIELD_ICON}<span></span></button>
                <span class="suggest-hint" data-suggest-hint hidden><kbd>Tab</kbd> 예상 입력 사용</span>
                <span class="toolbar-spacer"></span>
                <button class="tool-chip" type="button" data-model-chip data-menu-owner="model" aria-label="모델 선택" title="모델 선택"><span class="model-chip-name" data-model-name></span><span class="model-chip-fast" data-model-fast hidden>${ZAP_ICON}</span><span class="model-chip-detail" data-model-detail></span>${CHEVRON_DOWN}</button>
                <span class="recording-time" data-recording-time hidden></span>
                <button class="tool-button mic-button" type="button" data-mic aria-label="음성 입력" title="음성 입력" hidden>${MIC_ICON}</button>
                <button class="composer-action send-button" type="submit" aria-label="보내기" title="보내기 (Enter)">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 7-7 7 7"></path><path d="M12 19V5"></path></svg>
                </button>
                <button class="composer-action stop-button" type="button" aria-label="답변 멈추기" hidden>
                  <span aria-hidden="true"></span>
                </button>
              </div>
            </form>
          </footer>
          <div class="sr-only" role="status" aria-live="polite" data-live-region></div>
          <dialog class="rename-dialog" data-rename-dialog aria-labelledby="rename-dialog-title">
            <form method="dialog">
              <h2 id="rename-dialog-title">대화 이름 바꾸기</h2>
              <input type="text" maxlength="40" autocomplete="off" aria-label="대화 이름" />
              <div class="rename-actions">
                <button type="button" data-rename-cancel>취소</button>
                <button type="submit" class="rename-save">저장</button>
              </div>
            </form>
          </dialog>
        </div>`;

      conversation = root.querySelector("[data-conversation]");
      scrollArea = root.querySelector(".conversation-scroll");
      composer = root.querySelector("[data-composer]");
      textarea = root.querySelector("#prompt");
      sendButton = root.querySelector(".send-button");
      stopButton = root.querySelector(".stop-button");
      emptyState = root.querySelector("[data-empty-state]");
      liveRegion = root.querySelector("[data-live-region]");
      statusLabel = root.querySelector("[data-status-label]");
      newChatButton = root.querySelector("[data-new-chat]");
      connectButton = root.querySelector("[data-connect]");

      projectChip = root.querySelector("[data-project-chip]");
      emptyTitle = root.querySelector("[data-empty-title]");
      newChatButton.addEventListener("click", () => onNewChat());
      root.querySelector("[data-toggle-sidebar]").addEventListener("click", () => onToggleSidebar());

      // Rename dialog: Enter or 저장 saves (the only submit button), Esc or 취소 closes.
      const titleButton = root.querySelector("[data-chat-title]");
      const renameDialog = root.querySelector("[data-rename-dialog]");
      const renameInput = renameDialog.querySelector("input");
      const openRename = () => {
        if (!chatId || renameDialog.open) return;
        renameInput.value = titleButton.textContent;
        renameDialog.showModal();
        renameInput.select();
      };
      titleButton.addEventListener("click", openRename);
      document.addEventListener("keydown", (event) => {
        if (event.ctrlKey && event.altKey && event.code === "KeyR") {
          event.preventDefault();
          openRename();
        }
      });
      renameDialog.querySelector("[data-rename-cancel]").addEventListener("click", () => renameDialog.close());
      renameDialog.querySelector("form").addEventListener("submit", () => {
        const title = renameInput.value.replace(/\s+/g, " ").trim();
        if (title && title !== titleButton.textContent) onRenameChat(title);
      });
      root.querySelector("[data-open-settings]").addEventListener("click", onOpenSettings);
      connectButton.addEventListener("click", onOpenSettings);
      // Buttons that own a menu toggle it; it opens just above the button.
      for (const chip of root.querySelectorAll("[data-menu-owner]")) {
        chip.addEventListener("click", () => {
          const kind = chip.dataset.menuOwner;
          if (menuState?.owner === kind) {
            closeMenu();
            return;
          }
          const ui = { ...contextUi(), picker: (state) => openMenu({ mode: "picker", back: null, owner: kind, ...state }) };
          if (kind === "attach") openAttachMenu(ui);
          else onContextMenu(kind, ui, project);
        });
      }
      root.querySelector("[data-mic]").addEventListener("click", toggleRecording);
      root.querySelector("[data-attachments]").addEventListener("click", (event) => {
        const button = event.target.closest("[data-remove-attachment]");
        if (!button) return;
        attachments = attachments.filter((item) => item.id !== button.dataset.removeAttachment);
        renderAttachments();
        textarea.focus();
      });
      root.querySelector("[data-queue]").addEventListener("click", (event) => {
        const button = event.target.closest("[data-remove-queued]");
        if (!button) return;
        queue.splice(Number(button.dataset.removeQueued), 1);
        renderQueue();
      });
      textarea.addEventListener("paste", (event) => {
        const images = [...(event.clipboardData?.files || [])].filter((file) => file.type.startsWith("image/"));
        if (!images.length) return;
        event.preventDefault();
        addPastedImages(images);
      });

      hideEmptyState();

      composer.addEventListener("submit", (event) => {
        event.preventDefault();
        submitPrompt();
      });
      stopButton.addEventListener("click", stopResponse);
      menu = root.querySelector("[data-command-menu]");
      menuButton = root.querySelector("[data-menu-button]");
      menuButton.addEventListener("click", () => {
        if (menuState) closeMenu();
        else openMenu({ mode: "commands", items: commandItems("") });
        textarea.focus();
      });
      menu.addEventListener("mousedown", (event) => {
        if (!event.target.closest("[data-menu-search]")) event.preventDefault();
      });
      menu.addEventListener("mousemove", (event) => {
        const row = event.target.closest("[data-menu-index]");
        if (!row || row.disabled || Number(row.dataset.menuIndex) === menuState?.active) return;
        menuState.active = Number(row.dataset.menuIndex);
        menu.querySelectorAll(".menu-item.active").forEach((item) => item.classList.remove("active"));
        row.classList.add("active");
      });
      menu.addEventListener("input", (event) => {
        if (event.target.matches("[data-menu-search]")) filterMenu(event.target.value);
      });
      menu.addEventListener("keydown", (event) => {
        if (!event.target.matches("[data-menu-search]") || event.isComposing) return;
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          moveActive(event.key === "ArrowDown" ? 1 : -1);
        } else if (event.key === "Enter") {
          event.preventDefault();
          selectMenuItem(menuState.active);
          textarea.focus();
        } else if (event.key === "Escape") {
          event.preventDefault();
          closeMenu();
          textarea.focus();
        }
      });
      menu.addEventListener("click", (event) => {
        if (event.target.closest("[data-menu-back]")) {
          goBack();
          return;
        }
        const row = event.target.closest("[data-menu-index]");
        if (row) selectMenuItem(Number(row.dataset.menuIndex));
      });
      textarea.addEventListener("input", () => {
        if (suggestion) clearSuggestion();
        resizeComposer();
        updateSlashMenu();
        updateMentionMenu();
      });
      // Close on a click anywhere outside the menu, the buttons that own one, and the draft.
      document.addEventListener("mousedown", (event) => {
        if (menuState && !event.target.closest("[data-command-menu], [data-menu-button], [data-menu-owner], #prompt")) closeMenu();
      });
      textarea.addEventListener("keydown", (event) => {
        if (event.isComposing) return;
        if (menuState?.items.length) {
          const count = menuState.items.length;
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            moveActive(event.key === "ArrowDown" ? 1 : -1);
            return;
          }
          // Enter picks the highlighted row unless a complete command (maybe with an argument) was typed.
          if ((event.key === "Enter" && !event.shiftKey && !parseCommand(textarea.value)) || event.key === "Tab") {
            event.preventDefault();
            selectMenuItem(menuState.active);
            return;
          }
        }
        // An empty draft with a prediction: Tab (or →) takes it, as in Claude Code.
        if (suggestion && !menuState && !textarea.value && (event.key === "Tab" || event.key === "ArrowRight")) {
          event.preventDefault();
          takeSuggestion();
          return;
        }
        // Esc (or ← with an empty draft) steps back from a picker before closing.
        if (menuState?.back && (event.key === "Escape" || (event.key === "ArrowLeft" && !textarea.value))) {
          event.preventDefault();
          goBack();
          return;
        }
        if (event.key === "Escape" && menuState) {
          event.preventDefault();
          closeMenu();
          return;
        }
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          submitPrompt();
        }
      });
      conversation.addEventListener("click", (event) => {
        handleConversationClick(event).catch(() => announce("복사하지 못했습니다."));
      });
      resizeComposer();
      // Width changes (sidebar, settings panel, window) change how many lines the draft needs.
      window.addEventListener("resize", resizeComposer);
      document.fonts?.ready.then(resizeComposer);
    },
  };
}

