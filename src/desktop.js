import { Channel, invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { confirm as confirmDialog, message as messageDialog, open as openDialog } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";

const STORAGE_KEY = "agent-client:connection:v2";

// No model or provider: the engine answers with its own default until one is picked.
export const DEFAULT_CONNECTION = {
  provider: "",
  model: "",
};

const ERROR_MESSAGES = {
  engine_start: "Crema 엔진을 시작하지 못했습니다. 앱을 다시 시작해 주세요.",
  auth: "Crema 엔진이 요청을 거부했습니다. 앱을 다시 시작해 주세요.",
  unreachable: "Crema 엔진이 응답하지 않습니다. 잠시 후 다시 시도해 주세요.",
  server: "Crema 엔진이 요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.",
  interrupted: "응답이 중간에 끊겼습니다. 다시 시도해 주세요.",
  keyring: "Windows 자격 증명 관리자에 접근하지 못했습니다.",
  sign_in: "로그인하지 못했습니다. 다시 시도해 주세요.",
  sign_in_timeout: "5분 안에 로그인이 끝나지 않았습니다. 다시 시도해 주세요.",
  account_unreachable: "crema-agent.site에 연결하지 못했습니다. 인터넷 연결을 확인해 주세요.",
  file_read: "파일을 읽지 못했습니다.",
  file_too_large: "20MB보다 큰 이미지는 첨부할 수 없습니다.",
  git_dirty: "커밋하지 않은 변경이 있어 브랜치를 바꾸지 않았습니다. 커밋하거나 되돌린 뒤 다시 시도해 주세요.",
  git_switch: "브랜치를 바꾸지 못했습니다.",
  git_branch_name: "브랜치 이름으로 쓸 수 없는 글자가 있습니다.",
};

export function errorMessage(code) {
  return ERROR_MESSAGES[code] || "알 수 없는 오류가 발생했습니다.";
}

function desktopError(code) {
  const error = new Error(code);
  error.code = code;
  error.userMessage = errorMessage(code);
  return error;
}

export function loadConnection() {
  try {
    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "{}");
    return { ...DEFAULT_CONNECTION, ...stored };
  } catch {
    return { ...DEFAULT_CONNECTION };
  }
}

export function saveConnection(connection) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(connection));
  } catch {
    // Connection details fall back to defaults on the next launch.
  }
}

const COOLING_KEY = "agent-client:cooling:v1";

/** Free Providers left out after failing a turn: { providerId: until (ms) }. */
export function loadCooling() {
  try {
    return JSON.parse(window.localStorage.getItem(COOLING_KEY) || "{}");
  } catch {
    return {};
  }
}

export function saveCooling(cooling) {
  try {
    window.localStorage.setItem(COOLING_KEY, JSON.stringify(cooling));
  } catch {
    // Forgotten on the next launch: that Provider is tried again once.
  }
}

async function call(command, args) {
  try {
    return await invoke(command, args);
  } catch (code) {
    throw desktopError(typeof code === "string" ? code : "unknown");
  }
}

export function hermesSessionId(sessionId) {
  return `agent-client-${sessionId}`;
}

// Sent with every chat turn: Hermes' built-in hint for API clients assumes plain text ("no markdown")
// and tells it to avoid MEDIA: tags, but this app renders Markdown and shows MEDIA: images in place.
export const REPLY_FORMAT_INSTRUCTION = [
  "[Crema 표시 안내]",
  "이 대화는 Crema 데스크톱 앱에 표시된다. 앱은 답변을 마크다운(GFM)으로 렌더링한다. 그래서 API 서버 안내 중 '렌더링을 알 수 없으니 일반 텍스트로 쓰고 마크다운을 쓰지 말라'는 부분과 'MEDIA: 태그 대신 파일 경로를 적으라'는 부분은 이 대화에 해당하지 않는다. 이 안내를 따른다.",
  "",
  "사용자가 답을 훑어보고 핵심을 바로 찾을 수 있게 마크다운으로 구조를 잡는다.",
  "- 결론과 꼭 알아야 할 내용(결과, 원인, 해야 할 일, 주의할 점)은 **굵게** 표시한다. 한 문단에 한두 곳만 굵게 한다. 많이 굵게 하면 무엇이 중요한지 오히려 흐려진다.",
  "- 나란한 항목이 셋 이상이면 목록으로, 순서가 있으면 번호 목록으로 쓴다.",
  "- 여러 대상을 비교하거나 같은 속성을 나열할 때는 표로 쓴다.",
  "- 답이 길고 주제가 여럿이면 ## 또는 ### 제목으로 구역을 나눈다.",
  "- 코드, 명령, 파일 경로, 설정 이름은 `인라인 코드`로, 여러 줄 코드는 언어를 적은 코드 블록으로 쓴다.",
  "- 한두 문장으로 끝나는 답이나 가벼운 대화에는 제목·목록·굵게를 억지로 넣지 않는다. 서식은 읽기 쉽게 하려는 것이지 꾸미려는 것이 아니다.",
  "",
  "그림 파일을 보여 줄 때는 `MEDIA:<절대 경로>`를 한 줄로 넣는다. 앱이 그 자리에 그림을 띄운다.",
].join("\n");

/** Per-request instruction that anchors Hermes' commands and file work in the project folder. */
export function projectInstruction(path) {
  if (!path) return "";
  return `현재 프로젝트 작업 폴더: ${path}\n터미널 명령과 파일 작업은 별도 지시가 없으면 이 폴더를 기준(workdir)으로 실행한다. 상대 경로도 이 폴더 기준이다.`;
}

export const REASONING_LEVELS = [
  { value: "", label: "Hermes 기본값" },
  { value: "low", label: "낮음" },
  { value: "medium", label: "보통" },
  { value: "high", label: "높음" },
  { value: "xhigh", label: "매우 높음" },
];

/** Hermes `model_options`: reasoning effort and priority ("fast") processing. */
export function modelOptionsFor(connection) {
  const options = {};
  if (connection.reasoning) options.reasoning = { effort: connection.reasoning };
  if (connection.fast) options.service_tier = "priority";
  return options;
}

/** Providers that are signed in and have models, in Hermes' own order. */
export function usableProviders(options) {
  return (options?.providers || [])
    .filter((provider) => provider.authenticated && provider.models?.length)
    .map((provider) => ({
      id: provider.slug,
      name: provider.name,
      models: provider.models,
      capabilities: provider.capabilities || {},
    }));
}

const FAST_SUFFIX = "#fast";

export function supportsFast(providers, providerId, model) {
  return Boolean(providers.find((provider) => provider.id === providerId)?.capabilities?.[model]?.fast);
}

export function parseModelChoice(value) {
  const fast = value.endsWith(FAST_SUFFIX);
  return { model: fast ? value.slice(0, -FAST_SUFFIX.length) : value, fast };
}

export function createDesktopHost() {
  return {
    /** Crema account: Google sign-in in the browser, kept in Windows Credential Manager. */
    signIn: () => call("sign_in"),
    accountStatus: () => call("account_status"),
    signOut: () => call("sign_out"),
    /** How hard an automatic free-AI request is (crema-agent.site with Jev); null when it cannot say. */
    judge: (text) => call("judge_request", { text }).catch(() => null),
    warn: (text) => messageDialog(text, { title: "Crema", kind: "error" }).catch(() => {}),

    /** Starts Crema's engine if needed and checks it answers. */
    connect: () => call("check_connection"),

    /** Removes the given sessions from the engine; failures are left for its own cleanup. */
    async deleteSessions(sessionIds) {
      for (const id of sessionIds) {
        await call("delete_session", { sessionId: hermesSessionId(id) }).catch(() => {});
      }
    },

    info: (sessionIds) => call("hermes_info", { sessionIds: sessionIds.map(hermesSessionId) }),

    /** Channel credential kinds and re-login needs, from the engine's own records. */
    authKinds: () => call("auth_kinds").catch(() => ({})),

    modelOptions: () => call("model_options"),

    /** The engine's settings API (Provider sign-ins, API keys, approval mode). */
    hermesAdmin: (method, path, body) => call("hermes_admin", { method, path, body: body ?? null }),

    openLoginTerminal: (command) => call("open_login_terminal", { command }),

    async pickFiles() {
      const paths = await openDialog({ multiple: true, title: "첨부할 파일" }).catch(() => null);
      return Array.isArray(paths) ? paths : paths ? [paths] : [];
    },

    /** Raw bytes of a picked image (ArrayBuffer). */
    readFile: (path) => call("read_file", { path }),

    /** Copies a non-image attachment into the engine's document cache; returns the agent's path. */
    stageDocument: (path) => call("stage_document", { path }),

    gitInfo: (path) => call("git_info", { path }).catch(() => null),
    gitSwitch: (path, branch) => call("git_switch", { path, branch }),
    gitCreateBranch: (path, name) => call("git_create_branch", { path, name }),
    listProjectFiles: (path, query) => call("list_project_files", { path, query }).catch(() => []),

    /** Speech to text through the engine's STT provider (a cloud one when its key is saved). */
    async transcribe(dataUrl, mimeType) {
      const result = await call("hermes_admin", {
        method: "POST",
        path: "/api/audio/transcribe",
        body: { data_url: dataUrl, mime_type: mimeType },
      });
      return result?.transcript || "";
    },

    /** Files dropped onto the window, as paths (the WebView itself does not receive them). */
    onFileDrop(callback) {
      getCurrentWebview()
        .onDragDropEvent((event) => {
          if (event.payload.type === "drop" && event.payload.paths?.length) callback(event.payload.paths);
        })
        .catch(() => {});
    },

    /** Native yes/no box; inside Tauri window.confirm returns a Promise, which always reads as "yes". */
    confirm(message, okLabel) {
      return confirmDialog(message, { title: "Crema", kind: "warning", okLabel, cancelLabel: "취소" }).catch(
        () => false,
      );
    },

    async pickFolder() {
      const path = await openDialog({ directory: true, multiple: false, title: "프로젝트 폴더 선택" });
      return typeof path === "string" ? path : null;
    },

    /** Returns the Hermes run's event stream as a Response so the shared reader parses it. */
    streamHermes({ connection, content, conversationId, signal, workdir, sessionKey, system, sessionTitle }) {
      const runId = crypto.randomUUID();
      const encoder = new TextEncoder();
      const channel = new Channel();

      const body = new ReadableStream({
        start(controller) {
          channel.onmessage = (event) => {
            if (event.data !== undefined) controller.enqueue(encoder.encode(event.data));
            if (event.end) controller.close();
          };
          signal?.addEventListener(
            "abort",
            () => {
              invoke("cancel_chat", { runId });
              controller.error(new DOMException("응답 생성이 중지되었습니다.", "AbortError"));
            },
            { once: true },
          );
          call("chat_stream", {
            runId,
            sessionId: hermesSessionId(conversationId),
            sessionKey,
            content,
            model: connection.model || "",
            provider: connection.provider || "",
            system: system ?? [REPLY_FORMAT_INSTRUCTION, projectInstruction(workdir)].filter(Boolean).join("\n\n"),
            modelOptions: modelOptionsFor(connection),
            sessionTitle: sessionTitle ?? "",
            onEvent: channel,
          }).catch((error) => {
            if (error.code !== "cancelled") controller.error(error);
          });
        },
      });

      return new Response(body);
    },

    /** Allows or denies the command a running reply is waiting on (its `approval.request` event). */
    answerApproval: (request, allow) =>
      call("run_approval", {
        hermesRun: request.run_id,
        requestId: request.request_id ?? null,
        choice: allow ? "once" : "deny",
      }),

    openLink(url) {
      openUrl(url).catch(() => {});
    },
  };
}
