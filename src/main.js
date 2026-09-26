import "./fonts.css";
import "./styles.css";

import { createChatApp } from "./app.js";
import { createChatClient, readResponseBody } from "./chat-client.js";
import {
  REASONING_LEVELS,
  createDesktopHost,
  hermesSessionId,
  loadConnection,
  loadCooling,
  parseModelChoice,
  saveConnection,
  saveCooling,
  supportsFast,
  usableProviders,
} from "./desktop.js";
import { applyAppearance, loadAppearance, saveAppearance } from "./settings.js";
import { AUTO_LABEL, AUTO_NOTE, PROVIDER_CHEVRON, ZAP_ICON, modelMenuRows } from "./model-picker.js";

// Lucide (ISC) "gauge": the reasoning-effort row in the model menu.
const REASONING_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/></svg>';
import {
  COOL_MS,
  autoRoute,
  buildCatalog,
  freeChain,
  isFree,
  locate,
  pickRoute,
  providerOf,
  setFreeCatalog,
  suggestionRoute,
  turnNeeds,
  turnRoute,
} from "./providers.js";
import { createSettingsPanel } from "./settings-panel.js";
import { createSignIn } from "./sign-in.js";
import { FOLDER_COLORS, createSidebar } from "./sidebar.js";
import {
  NEW_CHAT_TITLE,
  chatSessions,
  chatTitle,
  createChat,
  createProject,
  deleteMessages,
  hermesSessionKey,
  loadAccount,
  loadWorkspace,
  onStorageError,
  saveAccount,
  saveWorkspace,
  startNewSession,
} from "./storage.js";

let appearance = loadAppearance();
applyAppearance(appearance);

// Keyboard focus rings only while moving by keyboard: Chromium also shows them when any key
// (even Shift, or a screenshot shortcut) is pressed after a mouse click.
document.addEventListener("pointerdown", () => (document.documentElement.dataset.pointer = ""), true);
document.addEventListener("keydown", (event) => {
  if (event.key === "Tab") delete document.documentElement.dataset.pointer;
}, true);
window.matchMedia?.("(prefers-color-scheme: dark)")?.addEventListener?.("change", () => applyAppearance(appearance));

const host = createDesktopHost();
const connection = loadConnection();
let connected = false;
let providers = [];
let authChannels = {};

function reasoningLabel(value = connection.reasoning) {
  return REASONING_LEVELS.find((level) => level.value === (value || ""))?.label || value;
}

let hermesAccess = null;

/** Connection chip text once connected (the engine runs on this PC); the model sits on the model chip. */
function connectedLabel() {
  return "이 PC";
}

function syncModelChip() {
  app.setModel({ name: connection.auto ? AUTO_LABEL : connection.model || "Hermes 기본 모델", detail: connection.reasoning ? reasoningLabel() : "", fast: Boolean(connection.fast) });
}

/** Branch of the open chat's project folder (hidden outside Git). */
async function refreshBranch() {
  const project = activeProject();
  app.setBranch(project ? await host.gitInfo(project.path) : null);
}

/** The engine's approval mode. */
function refreshAccess() {
  host
    .hermesAdmin("GET", "/api/config")
    .then((config) => {
      hermesAccess = config?.approvals?.mode ?? null;
      app.setAccess(hermesAccess);
    })
    .catch(() => app.setAccess(null));
}

// Free Providers that failed a turn sit out COOL_MS: the engine would otherwise try them first every turn.
const cooling = loadCooling();
// What each conversation's last turn asked for: { route, asked, why } (why: "cooling" | "resume" | "").
const sentTurns = new Map();
// The engine's fallback_providers as last read or written (JSON); null until first read.
let syncedChain = null;

/** Sits a free Provider out; a paid one is left as chosen. Returns whether it now sits out. */
function coolOff(providerId) {
  if (!isFree(providerId)) return false;
  cooling[providerId] = Date.now() + COOL_MS;
  saveCooling(cooling);
  return true;
}

/** Keeps the engine's failover chain on the connected free Providers not cooling off (never emptied). */
async function syncFallback() {
  const chain = JSON.stringify(freeChain(providers, cooling));
  if (syncedChain === null) syncedChain = JSON.stringify((await host.hermesAdmin("GET", "/api/config"))?.fallback_providers || []);
  if (chain === "[]" || chain === syncedChain) return;
  await host.hermesAdmin("PUT", "/api/config", { config: { fallback_providers: JSON.parse(chain) } });
  syncedChain = chain;
}

const providerName = (id) => (id ? providerOf(id, providers.find((item) => item.id === id)?.name).name : "기본 모델");

/** The line under an answer another Provider gave; a free Provider the engine failed over from sits out. */
function describeServed(conversationId, runtime) {
  const turn = sentTurns.get(conversationId);
  if (!turn) return "";
  if (runtime?.model && turn.route.model && runtime.model !== turn.route.model) {
    const rest = coolOff(turn.route.provider) ? ", 15분 쉼" : "";
    return `대신 답한 AI: ${providerName(runtime.provider)} · ${runtime.model} — ${providerName(turn.route.provider)} 한도 초과 또는 응답 없음${rest}`;
  }
  if (turn.why === "auto") return `자동 선택: ${providerName(turn.route.provider)} · ${turn.route.model}${turn.eased ? ` — ${EASED[turn.eased]}` : ""}`;
  const reason = { cooling: "쉬는 중", resume: `연결 끊김${turn.asked.provider in cooling ? ", 15분 쉼" : ""}` }[turn.why];
  return reason ? `대신 답한 AI: ${providerName(turn.route.provider)} · ${turn.route.model} — ${providerName(turn.asked.provider)} ${reason}` : "";
}

// Where the site's free catalog is served; the bundled copy stands when it cannot be read.
const FREE_CATALOG_URL = "https://crema-agent.site/api/free-catalog";

// A request this short is answered as easy without asking the site; a judgment later than this is not waited for.
const JUDGE_MIN_CHARS = 20;
const JUDGE_WAIT_MS = 1500;

/** The site's judgment of an automatic turn's request text, or null (short, signed out, slow, failed). */
function judge(content) {
  const text = typeof content === "string" ? content : content.filter((part) => part.type === "text").map((part) => part.text).join("\n");
  if (text.trim().length < JUDGE_MIN_CHARS) return null;
  return Promise.race([host.judge(text.slice(0, 2000)), new Promise((resolve) => setTimeout(resolve, JUDGE_WAIT_MS, null))]);
}

const EASED = {
  difficulty: "오늘 쓸 수 있는 더 나은 무료 모델이 없어 가벼운 모델로 답함",
  private: "개인정보가 있지만 입력을 학습에 쓰지 않는 무료 AI가 연결되어 있지 않음",
};

const hermesClient = createChatClient({
  async transport(args) {
    try {
      if (!connected) await host.connect();
    } catch (error) {
      connected = false;
      app.setStatus("error", "연결 안 됨");
      throw error;
    }
    connected = true;
    app.setStatus("connected", connectedLabel());
    const project = activeProject();
    // A reply cut off midway goes to the next free Provider; with none left the cut-off stands.
    const last = sentTurns.get(args.conversationId)?.route;
    const automatic = connection.auto && !args.resume;
    const needs = automatic ? turnNeeds(args.content, await judge(args.content)) : null;
    const { eased = "", ...picked } = (automatic && autoRoute(providers, cooling, needs, last)) || {};
    const asked = { ...((args.resume && last) || connection), ...(picked.provider ? { ...picked, reasoning: "", fast: false } : {}) };
    if (args.resume) coolOff(asked.provider);
    const route = turnRoute(asked, freeChain(providers, cooling), args.resume ? { ...cooling, [asked.provider]: Infinity } : cooling);
    if (args.resume && route === asked) throw args.resume;
    sentTurns.set(args.conversationId, { route, asked, eased, why: args.resume ? "resume" : route !== asked ? "cooling" : picked.provider ? "auto" : "" });
    await syncFallback().catch(() => {});
    // Stopped while the turn was being judged or the chain synced: no run starts.
    if (args.signal?.aborted) throw new DOMException("응답 생성이 중지되었습니다.", "AbortError");
    return host.streamHermes({
      connection: route,
      ...args,
      workdir: project?.path,
      // conversationId is the chat's current Hermes session; the scope key stays per chat/project.
      sessionKey: hermesSessionKey(project, activeChat()?.id ?? args.conversationId),
    });
  },
});

// Chats live only in this PC's app storage: a read or save that fails is said once, not skipped.
let storageWarned = false;
onStorageError(() => {
  if (storageWarned) return;
  storageWarned = true;
  host.warn("대화 기록을 읽거나 저장하지 못했습니다.\n디스크 공간과 권한을 확인해 주세요. 지금 앱을 닫으면 최근 변경이 사라질 수 있습니다.");
});

let workspace = loadWorkspace();

function activeChat() {
  return workspace.chats.find((chat) => chat.id === workspace.activeChatId) || null;
}

function activeProject() {
  const projectId = activeChat()?.projectId;
  return workspace.projects.find((project) => project.id === projectId) || null;
}

// Chats with a reply in progress (sidebar spinner); follows each chat's last message status.
const runningChats = new Set();

function persistWorkspace() {
  saveWorkspace(workspace);
  sidebar.render(workspace, runningChats);
  app.setTitle(activeChat()?.title || NEW_CHAT_TITLE);
}

/** Drops the chat being left if nothing was ever asked in it. */
function discardEmptyActiveChat() {
  const chat = activeChat();
  if (chat && !app.hasMessages()) {
    workspace.chats = workspace.chats.filter((item) => item.id !== chat.id);
    deleteMessages(chat.id);
  }
}

function openChat(chatId) {
  if (chatId === workspace.activeChatId) return;
  discardEmptyActiveChat();
  workspace.activeChatId = chatId;
  const chat = activeChat();
  // Opening a chat reads its new reply.
  if (chat) delete chat.unread;
  if (chat?.projectId) workspace.collapsed[chat.projectId] = false;
  app.showConversation(chatId, { project: activeProject() });
  refreshBranch();
  persistWorkspace();
}

function newChat(projectId = activeChat()?.projectId ?? null) {
  const current = activeChat();
  if (current && !app.hasMessages() && current.projectId === projectId) {
    app.showConversation(current.id, { project: activeProject() });
    refreshBranch();
    return;
  }
  discardEmptyActiveChat();
  const chat = createChat(workspace, projectId);
  workspace.activeChatId = null;
  openChat(chat.id);
}

async function addProject() {
  const path = await host.pickFolder().catch(() => null);
  if (!path) return;
  // A new folder gets one of the colors (not the default ink) at random.
  const colors = FOLDER_COLORS.slice(1);
  const project = createProject(workspace, path, colors[Math.floor(Math.random() * colors.length)][0]);
  workspace.collapsed[project.id] = false;
  newChat(project.id);
}

const sidebar = createSidebar({
  onNewChat: (projectId) => newChat(projectId),
  onOpenChat: openChat,
  onAddProject: addProject,
  async onRemoveProject(projectId) {
    const project = workspace.projects.find((item) => item.id === projectId);
    const message = `'${project?.name}'을 목록에서 뺄까요?\n폴더와 파일은 그대로 두고, 이 프로젝트의 대화 기록과 Hermes 세션을 지웁니다.`;
    if (!project || !(await host.confirm(message, "목록에서 빼기"))) return;
    const removed = workspace.chats.filter((chat) => chat.projectId === projectId);
    workspace.projects = workspace.projects.filter((item) => item.id !== projectId);
    workspace.chats = workspace.chats.filter((chat) => chat.projectId !== projectId);
    for (const chat of removed) {
      app.discardReply(chat.id);
      runningChats.delete(chat.id);
      deleteMessages(chat.id);
    }
    host.deleteSessions(removed.flatMap(chatSessions));
    if (removed.some((chat) => chat.id === workspace.activeChatId)) {
      workspace.activeChatId = null;
      newChat(null);
    }
    persistWorkspace();
  },
  async onDeleteChat(chatId) {
    const chat = workspace.chats.find((item) => item.id === chatId);
    const message = `'${chat?.title}' 대화를 영구 삭제할까요?\nHermes에 저장된 이 대화의 세션도 함께 지웁니다.`;
    if (!chat || !(await host.confirm(message, "삭제"))) return;
    workspace.chats = workspace.chats.filter((item) => item.id !== chatId);
    app.discardReply(chatId);
    runningChats.delete(chatId);
    deleteMessages(chatId);
    host.deleteSessions(chatSessions(chat));
    if (chatId === workspace.activeChatId) {
      workspace.activeChatId = null;
      newChat(chat.projectId);
    }
    persistWorkspace();
  },
  onPinChat(chatId) {
    const chat = workspace.chats.find((item) => item.id === chatId);
    if (!chat) return;
    if (chat.pinned) delete chat.pinned;
    else chat.pinned = true;
    persistWorkspace();
  },
  /** Hides the chat in the archive; its messages and Hermes sessions stay, and a reply in progress still finishes. */
  onArchiveChat(chatId) {
    const chat = workspace.chats.find((item) => item.id === chatId);
    if (!chat) return;
    chat.archived = true;
    delete chat.pinned;
    if (chatId === workspace.activeChatId) {
      workspace.activeChatId = null;
      newChat(chat.projectId);
    }
    persistWorkspace();
  },
  onRestoreChat(chatId) {
    const chat = workspace.chats.find((item) => item.id === chatId);
    if (!chat) return;
    delete chat.archived;
    openChat(chatId);
  },
  onResize(width) {
    workspace.sidebarWidth = width;
    saveWorkspace(workspace);
  },
  onProjectColor(projectId, color) {
    const project = workspace.projects.find((item) => item.id === projectId);
    if (!project) return;
    if (color) project.color = color;
    else delete project.color;
    if (project === activeProject()) app.setProject(project);
    persistWorkspace();
  },
  onToggleProject(projectId) {
    workspace.collapsed[projectId] = !workspace.collapsed[projectId];
    persistWorkspace();
  },
});

async function connect() {
  app.setStatus("checking", "연결 확인 중");
  connected = false;
  try {
    await host.connect();
    connected = true;
    app.setStatus("connected", connectedLabel());
    refreshModels().catch(() => {});
    refreshAccess();
    fetch(FREE_CATALOG_URL)
      .then((response) => (response.ok ? response.json() : null))
      .then(setFreeCatalog)
      .catch(() => {});
    return { state: "connected", message: "Crema 엔진이 켜져 있습니다." };
  } catch (error) {
    app.setStatus("error", "연결 안 됨");
    return { state: "error", message: error.userMessage, code: error.code };
  }
}

const panel = createSettingsPanel({
  appearance,
  connection,
  host,
  onAppearanceChange(next) {
    appearance = next;
    describeSuggestModel();
    applyAppearance(appearance);
    saveAppearance(appearance);
  },
  onConnectionChange(next, { reconnect }) {
    saveConnection(next);
    if (reconnect) connected = false;
    else if (connected) app.setStatus("connected", connectedLabel());
    syncModelChip();
  },
  onConnect: connect,
  onProvidersChanged: () => refreshModels().catch(() => {}),
  async onSignOut() {
    const message = "Crema에서 로그아웃할까요?\n다시 쓰려면 구글 계정으로 다시 로그인해야 합니다. 대화 기록은 이 PC에 그대로 남습니다.";
    if (!(await host.confirm(message, "로그아웃"))) return;
    await host.signOut().catch(() => {});
    saveAccount(null);
    panel.setAccount(null);
    await ensureSignedIn();
  },
});

const formatNumber = (value) => Number(value || 0).toLocaleString("ko-KR");

function saveModelChoice() {
  saveConnection(connection);
  panel.syncModel();
  syncModelChip();
}

/** Reloads the signed-in Providers and their models (after connecting or adding a Provider). */
async function refreshModels() {
  authChannels = await host.authKinds();
  panel.setAuthKinds(authChannels);
  providers = usableProviders(await host.modelOptions());
  panel.setProviders(providers);
  describeSuggestModel();
}

// Next-input prediction: one short extra Hermes turn after each answer, in a throwaway session.
// Checked on varied endings (answered question, agent asking a choice, leftover work, risky next step,
// small talk, English): predicts only a grounded next step, otherwise "-".
const SUGGEST_INSTRUCTION = [
  "너는 채팅 앱의 입력 예측기다. 사용자와 AI 에이전트의 대화 끝부분([대화])을 보고, 사용자가 다음에 입력창에 칠 메시지를 예측한다. 에이전트로서 답하는 것이 아니다.",
  "",
  "예측 문장은 비어 있는 입력창에 흐린 글씨로 표시되고, 사용자가 Tab 한 번으로 받아 그대로 보낼 수 있다. 그래서:",
  "- 사용자의 메시지는 에이전트에게 보내는 요청·질문·대답이다. 코드 조각이나 결과물, 에이전트가 할 설명을 대신 쓰지 않는다.",
  "- 에이전트의 마지막 답에서 실제로 이어지는 다음 행동을 고른다. 에이전트가 사용자에게 선택이나 확인을 물었다면 그 대답이 가장 유력하다. 에이전트가 하지 않았다고 밝힌 일이나 제안한 일이 그다음이다.",
  "- 질문에 대한 답이 끝났고 에이전트가 남긴 일이나 물은 것이 없거나, 인사·잡담으로 대화가 끝났으면 예측하지 않는다. 대화 내용과 상관없이 아무 데나 붙는 문장(\"다른 방법도 알려줘\", \"고마워\")도 예측이 아니다. 틀린 예측보다 빈 입력창이 낫다.",
  "- 배포, 삭제, 결제, 외부 발송처럼 되돌리기 어려운 일은 사용자가 대화에서 이미 그 일을 요청한 경우에만 예측한다. 한 번의 Tab으로 사용자가 원하지 않은 일을 시키게 될 수 있기 때문이다.",
  "",
  "출력 형식:",
  "- 예측하면: 사용자가 직접 쓴 메시지의 언어와 어미를 그대로 따른 짧은 한 문장만 출력한다(사용자가 '고쳐줘'처럼 반말로 썼으면 '~해줘', 존댓말로 썼으면 '~해 주세요'). 입력창 한 줄에 들어가야 한다. 따옴표, 부연, 에이전트의 호칭(예: 주인님)·인사는 넣지 않는다.",
  "- 예측하지 않으면: 하이픈 한 글자(-)만 출력한다. 빈 답은 앱이 오류로 처리한다.",
  "",
  "이 턴은 예측만 하는 턴이다. 도구를 쓰거나 파일·명령을 실행하지 말고 텍스트로만 답한다.",
].join("\n");

function describeSuggestModel() {
  const route = suggestionRoute(buildCatalog(providers, authChannels));
  panel.setSuggestModel(
    !appearance.suggest
      ? ""
      : route
        ? `${route.modelId}(${route.provider} ${route.subscription ? "구독" : "API 키"})로 예상합니다.`
        : "예상에 쓸 수 있는 모델이 연결되어 있지 않습니다.",
  );
}

/**
 * One quick turn on the next-input model (next-input prediction, chat titles) in a throwaway session;
 * returns its first line, "" when no such model is connected.
 */
async function askQuickModel({ system, content, signal }) {
  const route = connected ? suggestionRoute(buildCatalog(providers, authChannels)) : null;
  if (!route) return "";
  const id = `aux-${crypto.randomUUID()}`;
  try {
    const response = await host.streamHermes({
      connection: { ...connection, provider: route.providerId, model: route.modelId, reasoning: "", fast: false },
      content,
      conversationId: id,
      signal,
      sessionKey: "agent-client:aux",
      system,
      // Titles are unique in Hermes; a named session is never auto-titled (which would outlive the delete below).
      sessionTitle: `Crema 보조 ${id}`,
    });
    let text = "";
    for await (const chunk of readResponseBody(response)) text += chunk;
    const line = text.trim().split("\n")[0].replace(/^["'“”‘’]+|["'“”‘’]+$/g, "").trim();
    // A line starting with ⚠ is Hermes reporting a failed turn.
    return line.startsWith("⚠") ? "" : line;
  } finally {
    host.deleteSessions([id]);
  }
}

async function suggestNext(turns, signal) {
  if (!appearance.suggest) return "";
  const recent = turns
    .filter((message) => message.role === "user" || message.role === "assistant")
    .slice(-4)
    .map((message) => `${message.role === "user" ? "사용자" : "에이전트"}: ${message.content.slice(-1500)}`)
    .join("\n\n");
  const line = await askQuickModel({
    system: SUGGEST_INSTRUCTION,
    content: `[대화]\n${recent}\n\n[사용자가 이어서 입력할 다음 메시지]`,
    signal,
  });
  // "-" is the instruction's "nothing to predict".
  return line === "-" ? "" : line.slice(0, 60);
}

// Chat title: the first request summed up by the next-input model, replacing the first-line stand-in.
const TITLE_INSTRUCTION = [
  "너는 채팅 앱의 대화 제목 작성기다. [요청]은 사용자가 AI 에이전트에게 보낸 첫 메시지다. 이 대화를 사이드바 목록에서 한눈에 알아보게 할 제목을 쓴다. 요청에 답하거나 요청을 수행하지 않는다.",
  "",
  "- 요청의 주제나 할 일을 담은 짧은 명사구로 쓴다(예: '로그인 버튼 버그 수정', '모던 인테리어 이미지 생성').",
  "- 제목은 [요청]과 같은 언어로 쓴다. 영어로 쓴 요청이면 영어 제목이다. 사용자가 목록에서 자기가 쓴 말로 대화를 찾기 때문이다.",
  "- 목록 한 줄에 들어가도록 20자 안팎으로 쓴다. 따옴표, 마침표, 이모지, 호칭(예: 주인님)은 넣지 않는다.",
  "- 인사·잡담처럼 요약할 주제가 없으면 사용자가 쓴 말을 그대로 제목으로 쓴다(예: '안녕' → '안녕'). 말을 덧붙이거나 지어내지 않는다.",
  "- 제목 한 줄만 출력한다.",
  "",
  "이 턴은 제목만 쓰는 턴이다. 도구를 쓰거나 파일·명령을 실행하지 말고 텍스트로만 답한다.",
].join("\n");

async function autoTitle(chat, request) {
  const title = (await askQuickModel({ system: TITLE_INSTRUCTION, content: `[요청]\n${request.slice(0, 1500)}` }).catch(() => ""))
    .replace(/\s+/g, " ")
    .slice(0, 40);
  // A name the user gave meanwhile, or a chat deleted meanwhile, stays as it is.
  if (!title || chat.titleEdited || !workspace.chats.includes(chat)) return;
  chat.title = title;
  persistWorkspace();
}

/** A name the user gives a chat (/title, the title dialog); auto titling never replaces it. */
function renameChat(chat, title) {
  chat.title = title;
  chat.titleEdited = true;
  persistWorkspace();
}

async function loadProviders() {
  if (!providers.length) {
    providers = usableProviders(await host.modelOptions());
    panel.setProviders(providers);
  }
  return providers;
}

const REASONING_WORDS = {
  기본: "", 기본값: "", default: "",
  낮음: "low", low: "low",
  보통: "medium", 중간: "medium", medium: "medium",
  높음: "high", high: "high",
  매우높음: "xhigh", 최고: "xhigh", xhigh: "xhigh",
};

/** Slash/menu commands that need Hermes or app-wide state; chat-local ones live in app.js. */
const commandHandlers = {
  async model(arg, ui) {
    try {
      await loadProviders();
    } catch (error) {
      ui.notice({ title: "모델 선택", text: error.userMessage, tone: "error" });
      return;
    }
    const catalog = buildCatalog(providers, authChannels);
    const choose = (model, fast) => {
      const route = pickRoute(model, fast, connection.provider);
      Object.assign(connection, { auto: false, provider: route.providerId, model: route.modelId, fast });
      saveModelChoice();
      if (!ui.quiet) ui.notice({ title: "모델 선택", text: `다음 질문부터 ${route.modelId}${fast ? " · 빠른 속도" : ""}을 사용합니다.` });
    };
    const offerAuto = Boolean(connection.auto) || freeChain(providers).length > 0;
    const chooseAuto = () => {
      Object.assign(connection, { auto: true, provider: "", model: "", fast: false });
      saveModelChoice();
      if (!ui.quiet) ui.notice({ title: "모델 선택", text: `다음 질문부터 연결된 무료 AI 중에서 알맞은 모델을 골라 답합니다. ${AUTO_NOTE}` });
    };
    if (arg === "자동" && offerAuto) {
      chooseAuto();
      return;
    }
    if (arg) {
      const { model: name, fast } = parseModelChoice(arg.replace(/\s*(⚡|·\s*빠른\s*속도)$/, "#fast"));
      const current = locate(catalog, connection.provider, connection.model);
      // The current Provider's model first, then any Provider's.
      const groups = [...catalog].sort((a, b) => Number(b.key === current?.key) - Number(a.key === current?.key));
      const model = groups.flatMap((group) => group.models).find((item) => item.name === name && (!fast || item.fast));
      if (model) choose(model, fast);
      else ui.notice({ title: "모델 선택", text: `'${arg}' 모델을 찾지 못했습니다. 메뉴의 ‘모델 선택’에서 고를 수 있습니다.`, tone: "error" });
      return;
    }
    if (!catalog.length) {
      ui.notice({ title: "모델 선택", text: "사용할 수 있는 모델이 없습니다. 설정의 Provider에서 Provider를 추가해 주세요.", tone: "error" });
      return;
    }
    // The Providers folded, the current model's one open with that model highlighted (as in settings).
    const current = locate(catalog, connection.provider, connection.model);
    const selection = { key: current?.key, name: connection.model, fast: connection.fast, auto: connection.auto };
    const show = (openKey, focusIndex) => {
      // Reasoning effort first (one row, opens its levels), then the Providers.
      const rows = [{ kind: "reasoning", label: "추론 강도", hint: reasoningLabel() }, ...modelMenuRows(catalog, selection, openKey, offerAuto)];
      const state = {
        title: "모델 선택",
        back: ui.back,
        items: rows.map((row) =>
          row.kind === "reasoning"
            ? { ...row, icon: REASONING_ICON, className: "menu-parent" }
            : row.kind === "provider"
              ? { ...row, icon: PROVIDER_CHEVRON, className: `menu-parent${row.open ? " open" : ""}` }
              : { ...row, className: "menu-child", badge: row.fast ? ZAP_ICON : "", hint: row.selected ? "사용 중" : "" },
        ),
        active: focusIndex ?? Math.max(0, rows.findIndex((row) => row.selected)),
        onSelect: (item) => {
          if (item.kind === "auto") chooseAuto();
          else if (item.kind === "model") choose(item.model, item.fast);
          else if (item.kind === "reasoning") {
            ui.picker({
              title: "추론 강도",
              back: { mode: "picker", ...state },
              items: REASONING_LEVELS.map((level) => ({ ...level, selected: level.value === (connection.reasoning || "") })),
              active: Math.max(0, REASONING_LEVELS.findIndex((level) => level.value === (connection.reasoning || ""))),
              onSelect: (level) => {
                connection.reasoning = level.value;
                saveModelChoice();
                show(openKey, 0);
              },
            });
          } else show(item.open ? null : item.key, rows.indexOf(rows.find((row) => row.key === item.key && row.kind === "provider")));
        },
      };
      ui.picker(state);
    };
    show(current?.key ?? catalog[0].key);
  },

  reasoning(arg, ui) {
    const setLevel = (value) => {
      connection.reasoning = value;
      saveModelChoice();
      ui.notice({ title: "추론 강도", text: `다음 질문부터 추론 강도 ‘${reasoningLabel(value)}’로 답합니다.` });
    };
    if (arg) {
      const value = REASONING_WORDS[arg.replace(/\s/g, "").toLowerCase()];
      if (value === undefined) ui.notice({ title: "추론 강도", text: "낮음 · 보통 · 높음 · 매우높음 · 기본 중에서 고르세요.", tone: "error" });
      else setLevel(value);
      return;
    }
    ui.picker({
      title: "추론 강도",
      items: REASONING_LEVELS.map((level) => ({ ...level, selected: level.value === (connection.reasoning || ""), hint: level.value || "" })),
      active: Math.max(0, REASONING_LEVELS.findIndex((level) => level.value === (connection.reasoning || ""))),
      onSelect: (item) => setLevel(item.value),
    });
  },

  fast(arg, ui) {
    if (!supportsFast(providers, connection.provider, connection.model)) {
      ui.notice({ title: "빠른 속도", text: `${connection.model}은(는) 빠른 속도를 지원하지 않습니다.`, tone: "error" });
      return;
    }
    const word = arg.toLowerCase();
    connection.fast = ["on", "켜기", "켬"].includes(word) ? true : ["off", "끄기", "끔"].includes(word) ? false : !connection.fast;
    saveModelChoice();
    ui.notice({
      title: "빠른 속도",
      text: connection.fast
        ? "빠른 속도로 바꿨습니다. 답이 빨라지는 대신 구독 사용량이 더 들 수 있습니다."
        : "기본 속도로 바꿨습니다.",
    });
  },

  async status(arg, ui) {
    const chat = activeChat();
    const project = activeProject();
    const sessions = chat ? chatSessions(chat) : [];
    const current = sessions.at(-1);
    let info = null;
    let error = "";
    try {
      info = await host.info(current ? [current] : []);
    } catch (failure) {
      error = failure.userMessage;
    }
    const session = info?.sessions?.[0];
    const providerName = providers.find((item) => item.id === connection.provider)?.name || connection.provider;
    ui.notice({
      title: "상태",
      tone: error ? "error" : "",
      rows: [
        ["연결", `Crema 엔진 · ${info ? "연결됨" : "연결 안 됨"}${info?.health?.version ? ` · Hermes v${info.health.version}` : ""}`],
        ["모델", connection.auto ? AUTO_LABEL : `${connection.model} · ${providerName}`],
        ["추론 강도", reasoningLabel()],
        ["속도", connection.fast ? "빠른 속도" : "기본"],
        ["프로젝트", project ? `${project.name} — ${project.path}` : "없음 (일반 대화)"],
        ["세션", current ? `${hermesSessionId(current)} · 이 대화의 ${sessions.length}번째 세션` : "-"],
        ["이번 세션", session
          ? `메시지 ${formatNumber(session.message_count)}개 · 입력 ${formatNumber(session.input_tokens)} · 출력 ${formatNumber(session.output_tokens)} 토큰`
          : "아직 Hermes에 기록이 없습니다"],
      ],
      text: error,
    });
  },

  async usage(arg, ui) {
    const chat = activeChat();
    const sessions = chat ? chatSessions(chat) : [];
    let info;
    try {
      info = await host.info(sessions);
    } catch (failure) {
      ui.notice({ title: "사용량", text: failure.userMessage, tone: "error" });
      return;
    }
    const sum = (key) => info.sessions.reduce((total, session) => total + Number(session?.[key] || 0), 0);
    const cost = sum("estimated_cost_usd");
    ui.notice({
      title: "사용량 · 이 대화",
      rows: [
        ["세션", `${formatNumber(info.sessions.length)}개`],
        ["모델 호출", `${formatNumber(sum("api_call_count"))}회`],
        ["입력 토큰", formatNumber(sum("input_tokens"))],
        ["출력 토큰", formatNumber(sum("output_tokens"))],
        ["추론 토큰", formatNumber(sum("reasoning_tokens"))],
        ["캐시 재사용", formatNumber(sum("cache_read_tokens"))],
        ...(cost ? [["예상 비용", `$${cost.toFixed(4)}`]] : []),
      ],
      text: "구독의 남은 한도는 Hermes API에서 제공하지 않아 표시하지 않습니다.",
    });
  },

  title(arg, ui) {
    const chat = activeChat();
    const title = arg.replace(/\s+/g, " ").slice(0, 40);
    if (!chat || !title) {
      ui.notice({ title: "대화 이름 바꾸기", text: "사용법: /title 새 이름  (또는 /이름 새 이름)" });
      return;
    }
    renameChat(chat, title);
    ui.notice({ title: "대화 이름 바꾸기", text: `이 대화의 이름을 ‘${title}’(으)로 바꿨습니다.` });
  },
};

const app = createChatApp({
  client: hermesClient,
  host,
  onOpenSettings: (event) => panel.open(event?.currentTarget),
  onNewChat: () => newChat(),
  onToggleSidebar() {
    workspace.sidebarHidden = !workspace.sidebarHidden;
    root.classList.toggle("sidebar-hidden", workspace.sidebarHidden);
    saveWorkspace(workspace);
  },
  sessionFor(chatId) {
    const chat = workspace.chats.find((item) => item.id === chatId);
    return chat ? chatSessions(chat).at(-1) : chatId;
  },
  onNewSession(chatId) {
    const chat = workspace.chats.find((item) => item.id === chatId);
    if (chat) startNewSession(chat);
  },
  suggestNext,
  onRenameChat(title) {
    const chat = activeChat();
    if (chat) renameChat(chat, title);
  },
  answerApproval: (request, allow) => host.answerApproval(request, allow),
  describeServed,
  canTranscribe: () => connected,
  onContextMenu(kind, ui, project) {
    if (kind === "model") {
      commandHandlers.model("", { ...ui, quiet: true });
      return;
    }
    if (kind === "location") {
      panel.open();
      return;
    }
    if (kind === "access") {
      // Hermes' approval policy (config `approvals.mode`); "승인 요청" asks in the reply through the run's approval card.
      const items = [
        { label: "승인 요청", description: "위험할 수 있는 명령은 실행 전에 묻습니다", mode: "manual" },
        { label: "승인 없이 실행", description: "묻지 않고 모든 명령을 실행합니다", mode: "off" },
      ].map((item) => ({ ...item, selected: item.mode === hermesAccess }));
      ui.picker({
        title: "명령 실행 승인",
        items,
        active: Math.max(0, items.findIndex((item) => item.selected)),
        onSelect(item) {
          if (item.mode === hermesAccess) return;
          host
            .hermesAdmin("PUT", "/api/config", { config: { approvals: { mode: item.mode } } })
            .then(refreshAccess)
            .catch((error) =>
              ui.notice({ title: "명령 실행 승인", text: error?.userMessage || "설정을 바꾸지 못했습니다.", tone: "error" }),
            );
        },
      });
      return;
    }
    if (kind === "project") {
      const current = project ? workspace.projects.find((item) => item.path === project.path) : null;
      const items = [
        ...workspace.projects.map((item) => ({ label: item.name, description: item.path, selected: item.id === current?.id, id: item.id })),
        { label: "프로젝트 추가…", description: "작업할 폴더를 고릅니다", action: "add" },
        ...(current ? [{ label: "프로젝트 없이 대화", description: "폴더 없이 새 대화를 시작합니다", action: "none" }] : []),
      ];
      ui.picker({
        title: "프로젝트",
        items,
        active: Math.max(0, items.findIndex((item) => item.selected)),
        onSelect(item) {
          if (item.action === "add") addProject();
          else if (item.action === "none") newChat(null);
          else if (item.id !== current?.id) newChat(item.id);
        },
      });
      return;
    }
    if (kind === "branch" && project) {
      host.gitInfo(project.path).then((info) => {
        if (!info) return;
        ui.picker({
          title: "브랜치",
          search: {
            placeholder: "브랜치 검색 또는 새 브랜치 이름",
            // A name that is not a branch yet can be created from here, as in Codex.
            extra: (name) =>
              name && !info.branches.includes(name)
                ? [{ label: `새 브랜치 '${name}' 만들기`, description: "지금 브랜치에서 만들어 바로 전환합니다. 커밋하지 않은 변경도 함께 옮겨집니다", create: name }]
                : [],
          },
          items: info.branches.map((name) => ({ label: name, selected: name === info.branch, disabled: info.dirty && name !== info.branch })),
          active: Math.max(0, info.branches.indexOf(info.branch)),
          note: info.dirty ? "커밋하지 않은 변경이 있어 다른 브랜치로 바꿀 수 없습니다. 새 브랜치는 만들 수 있습니다." : "",
          async onSelect(item) {
            if (!item.create && item.label === info.branch) return;
            try {
              if (item.create) await host.gitCreateBranch(project.path, item.create);
              else await host.gitSwitch(project.path, item.label);
            } catch (error) {
              ui.notice({ title: "브랜치", text: error.userMessage, tone: "error" });
            }
            refreshBranch();
          },
        });
      });
    }
  },
  onCommand(id, arg, ui) {
    Promise.resolve(commandHandlers[id]?.(arg, ui)).catch((error) =>
      ui.notice({ title: "명령 실행", text: error?.userMessage || "명령을 실행하지 못했습니다.", tone: "error" }),
    );
  },
  onConversationUpdate(chatId, messages) {
    const chat = workspace.chats.find((item) => item.id === chatId);
    if (!chat) return;
    const status = messages.at(-1)?.status;
    if (status === "streaming") runningChats.add(chatId);
    // A reply finished while its chat was not open waits as unread (blue dot) until the chat is opened.
    else if (runningChats.delete(chatId) && status === "complete" && chatId !== workspace.activeChatId) chat.unread = true;
    // Hermes may switch branches while it works.
    if (chatId === workspace.activeChatId && messages.at(-1)?.status !== "streaming") refreshBranch();
    if (chat.title === NEW_CHAT_TITLE) {
      chat.title = chatTitle(messages);
      const request = messages.find((message) => message.role === "user")?.content.trim();
      if (request) autoTitle(chat, request);
    }
    chat.updatedAt = Date.now();
    persistWorkspace();
  },
});

const root = document.querySelector("#app");
root.classList.add("workspace");
root.classList.toggle("sidebar-hidden", Boolean(workspace.sidebarHidden));
app.mount(root);
sidebar.mount(root);
if (workspace.sidebarWidth) sidebar.setWidth(workspace.sidebarWidth);
panel.mount(root.querySelector(".app-shell"));
syncModelChip();
host.onFileDrop((paths) => app.addFiles(paths));
window.addEventListener("focus", () => refreshBranch());
if (activeChat()) {
  app.showConversation(workspace.activeChatId, { project: activeProject() });
  refreshBranch();
  persistWorkspace();
} else {
  workspace.activeChatId = null;
  newChat(null);
}
const signIn = createSignIn({ host });

/**
 * Crema starts signed in to crema-agent.site: first run (or after signing out) asks for Google first.
 * Once signed in, an unreachable site does not block the app.
 */
async function ensureSignedIn() {
  const status = await host.accountStatus().catch(() => ({ state: "offline" }));
  if (status.state === "signed_in") saveAccount(status);
  if (status.state === "signed_out") saveAccount(await signIn.show());
  panel.setAccount(loadAccount());
}

ensureSignedIn()
  .then(connect)
  .then((result) => panel.showConnection(result));
