// Icons: Lucide (ISC).
const svg = (body) => `<svg viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;
const ICONS = {
  new: svg('<path d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z"/><path d="M12 8v6"/><path d="M9 11h6"/>'),
  clear: svg('<path d="M21 21H8a2 2 0 0 1-1.42-.587l-3.994-3.999a2 2 0 0 1 0-2.828l10-10a2 2 0 0 1 2.829 0l5.999 6a2 2 0 0 1 0 2.828L12.834 21"/><path d="m5.082 11.09 8.828 8.828"/>'),
  retry: svg('<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>'),
  stop: svg('<rect width="18" height="18" x="3" y="3" rx="2"/>'),
  title: svg('<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>'),
  model: svg('<path d="M12 20v2"/><path d="M12 2v2"/><path d="M17 20v2"/><path d="M17 2v2"/><path d="M2 12h2"/><path d="M2 17h2"/><path d="M2 7h2"/><path d="M20 12h2"/><path d="M20 17h2"/><path d="M20 7h2"/><path d="M7 20v2"/><path d="M7 2v2"/><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="8" y="8" width="8" height="8" rx="1"/>'),
  reasoning: svg('<path d="M12 18V5"/><path d="M15 13a4.17 4.17 0 0 1-3-4 4.17 4.17 0 0 1-3 4"/><path d="M17.598 6.5A3 3 0 1 0 12 5a3 3 0 1 0-5.598 1.5"/><path d="M17.997 5.125a4 4 0 0 1 2.526 5.77"/><path d="M18 18a4 4 0 0 0 2-7.464"/><path d="M19.967 17.483A4 4 0 1 1 12 18a4 4 0 1 1-7.967-.517"/><path d="M6 18a4 4 0 0 1-2-7.464"/><path d="M6.003 5.125a4 4 0 0 0-2.526 5.77"/>'),
  fast: svg('<path d="M15.914 4a1.5 1.5 0 00-2.474-1.561l-9 9A1.5 1.5 0 005.5 14h4.002a.5.5 0 01.471.666L8.086 20a1.5 1.5 0 002.475 1.56l9-9A1.5 1.5 0 0018.5 10h-3.997a.5.5 0 01-.472-.667z"/>'),
  status: svg('<path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/>'),
  usage: svg('<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>'),
  restart: svg('<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>'),
  help: svg('<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>'),
};

export const MENU_ICON = svg('<rect width="18" height="18" x="3" y="3" rx="2"/><line x1="9" x2="15" y1="15" y2="9"/>');
export const CHECK_ICON = svg('<path d="M20 6 9 17l-5-5"/>');
export const BACK_ICON = svg('<path d="m15 18-6-6 6-6"/>');

/** `whileRunning`: may run while a reply is streaming. */
export const COMMANDS = [
  { id: "new", alias: "새세션", label: "새 세션", hint: "이전 내용 없이 새로 시작", group: "대화" },
  { id: "clear", alias: "지우기", label: "화면 지우기", hint: "화면을 비우고 새로 시작", group: "대화" },
  { id: "retry", alias: "다시", label: "다시 시도", hint: "마지막 질문 다시 보내기", group: "대화" },
  { id: "stop", alias: "중지", label: "답변 멈추기", hint: "진행 중인 답변 멈추기", group: "대화", whileRunning: true },
  { id: "title", alias: "이름", label: "대화 이름 바꾸기", hint: "/title 새 이름", group: "대화", whileRunning: true },
  { id: "model", alias: "모델", label: "모델 선택", hint: "다음 질문부터 적용", group: "모델", whileRunning: true },
  { id: "reasoning", alias: "추론", label: "추론 강도", hint: "낮음 · 보통 · 높음 · 매우 높음", group: "모델", whileRunning: true },
  { id: "fast", alias: "빠르게", label: "빠른 속도", hint: "지원 모델에서 빠른 속도 켜기/끄기", group: "모델", whileRunning: true },
  { id: "status", alias: "상태", label: "상태 보기", hint: "연결 · 모델 · 세션 정보", group: "Hermes", whileRunning: true },
  { id: "usage", alias: "사용량", label: "사용량 보기", hint: "이 대화의 토큰 사용량", group: "Hermes", whileRunning: true },
  { id: "restart", alias: "재시작", label: "Hermes 재시작", hint: "이 PC의 Hermes를 다시 시작", group: "Hermes" },
  { id: "help", alias: "도움말", label: "명령어 도움말", hint: "사용할 수 있는 명령 목록", group: "Hermes", whileRunning: true },
].map((command) => ({ ...command, icon: ICONS[command.id] }));

export const COMMAND_GROUPS = ["대화", "모델", "Hermes"];

/** `/model gpt-6-luna` → { command, arg: "gpt-6-luna" }; English names and Korean aliases both work. */
export function parseCommand(text) {
  const match = /^\/(\S+)(?:\s+([\s\S]*))?$/.exec(text.trim());
  if (!match) return null;
  const name = match[1].toLowerCase();
  const command = COMMANDS.find((item) => item.id === name || item.alias === name);
  return command ? { command, arg: (match[2] || "").trim() } : null;
}

/** Commands whose name, alias, or label starts with what follows the slash. */
export function filterCommands(query) {
  const needle = query.replace(/^\//, "").trim().toLowerCase();
  if (!needle) return COMMANDS;
  return COMMANDS.filter(
    (item) => item.id.startsWith(needle) || item.alias.startsWith(needle) || item.label.replace(/\s/g, "").startsWith(needle),
  );
}
