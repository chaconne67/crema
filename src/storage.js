const WORKSPACE_KEY = "agent-client:workspace:v1";
const LEGACY_CONVERSATION_KEY = "agent-client:conversation:v1";
const chatKey = (chatId) => `agent-client:chat:${chatId}`;

export const NEW_CHAT_TITLE = "새 대화";

function createId() {
  return crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function isStoredMessage(value) {
  return (
    value &&
    typeof value.id === "string" &&
    (value.role === "user" || value.role === "assistant" || value.role === "session") &&
    typeof value.content === "string" &&
    typeof value.createdAt === "number"
  );
}

function readJson(key, fallback) {
  try {
    return JSON.parse(window.localStorage.getItem(key) || "null") ?? fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage can be unavailable; the session keeps working in memory.
  }
}

function parseMessages(value) {
  if (!Array.isArray(value)) return [];
  return value.filter(isStoredMessage).map((message) => ({
    ...message,
    status: message.status === "streaming" ? "stopped" : message.status || "complete",
  }));
}

export function loadMessages(chatId) {
  return parseMessages(readJson(chatKey(chatId), []));
}

export function saveMessages(chatId, messages) {
  writeJson(
    chatKey(chatId),
    // Attachments are kept by name and kind only; their data is never stored.
    messages.map(({ id, role, content, createdAt, status, attachments }) => ({
      id,
      role,
      content,
      createdAt,
      status,
      ...(attachments?.length ? { attachments: attachments.map(({ kind, name }) => ({ kind, name })) } : {}),
    })),
  );
}

export function deleteMessages(chatId) {
  try {
    window.localStorage.removeItem(chatKey(chatId));
  } catch {
    // Nothing to clean up when storage is unavailable.
  }
}

export function createChat(workspace, projectId = null) {
  const now = Date.now();
  const id = createId();
  const chat = { id, projectId, title: NEW_CHAT_TITLE, createdAt: now, updatedAt: now, sessions: [id] };
  workspace.chats.unshift(chat);
  return chat;
}

export function createProject(workspace, path) {
  const existing = workspace.projects.find((project) => project.path === path);
  if (existing) return existing;
  const name = path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || path;
  const project = { id: createId(), name, path };
  workspace.projects.push(project);
  return project;
}

/** Hermes sessions a chat has used, oldest first; the last one receives new requests. */
export function chatSessions(chat) {
  return chat.sessions?.length ? chat.sessions : [chat.id];
}

/** `/new`: later requests go to a fresh Hermes session; earlier ones stay for deletion. */
export function startNewSession(chat) {
  const id = createId();
  chat.sessions = [...chatSessions(chat), id];
  return id;
}

/**
 * Hermes' conversation scope (memory, model override, terminal session). Chats in one project
 * share their project's scope; a chat outside any project has its own.
 */
export function hermesSessionKey(project, chatId) {
  return project ? `agent-client:project:${project.id}` : `agent-client:chat:${chatId}`;
}

/** Title from the first request, trimmed for the sidebar. */
export function chatTitle(messages) {
  const first = messages.find((message) => message.role === "user")?.content.trim().replace(/\s+/g, " ");
  if (!first) return NEW_CHAT_TITLE;
  return first.length > 40 ? `${first.slice(0, 40)}…` : first;
}

export function loadWorkspace() {
  const stored = readJson(WORKSPACE_KEY, null);
  if (stored && Array.isArray(stored.projects) && Array.isArray(stored.chats)) {
    return { collapsed: {}, sidebarHidden: false, ...stored };
  }

  const workspace = { projects: [], chats: [], activeChatId: null, collapsed: {}, sidebarHidden: false };
  // Keeps the single conversation from before projects existed.
  const legacy = parseMessages(readJson(LEGACY_CONVERSATION_KEY, []));
  if (legacy.length) {
    const chat = createChat(workspace);
    // The old Hermes session id was the first request's id; reuse it so Hermes keeps the context.
    chat.id = legacy.find((message) => message.role === "user")?.id || chat.id;
    chat.sessions = [chat.id];
    chat.title = "이전 대화";
    chat.updatedAt = legacy.at(-1).createdAt;
    saveMessages(chat.id, legacy);
    workspace.activeChatId = chat.id;
  }
  return workspace;
}

export function saveWorkspace(workspace) {
  writeJson(WORKSPACE_KEY, workspace);
}
