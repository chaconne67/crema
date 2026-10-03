// One quiet line for whatever Crema tells the user (docs/Crema-자동작업-알림-원칙-2026-10-03.md, 주인님
// 2026-10-03 "최대한 모든 알림은 조용하게 한 줄로"): an icon, what happened, what it was about, and at the end
// an icon or a few small words to undo or choose. No box, no background.

// Lucide (ISC) marks.
const mark = (body) => `<svg viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;
export const NOTE_ICONS = {
  pencil: mark('<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>'),
  trash: mark('<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>'),
  done: mark('<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>'),
  refresh: mark('<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>'),
  swap: mark('<path d="m16 3 4 4-4 4"/><path d="M20 7H4"/><path d="m8 21-4-4 4-4"/><path d="M4 17h16"/>'),
  play: mark('<polygon points="6 3 20 12 6 21 6 3"/>'),
  ask: mark('<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>'),
  wait: mark('<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>'),
  shield: mark('<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>'),
  tool: mark('<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>'),
  tidy: mark('<path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/><path d="M13 6h8"/><path d="M13 12h8"/><path d="M13 18h8"/>'),
  adjust: mark('<line x1="21" x2="14" y1="4" y2="4"/><line x1="10" x2="3" y1="4" y2="4"/><line x1="21" x2="12" y1="12" y2="12"/><line x1="8" x2="3" y1="12" y2="12"/><line x1="21" x2="16" y1="20" y2="20"/><line x1="12" x2="3" y1="20" y2="20"/><line x1="14" x2="14" y1="2" y2="6"/><line x1="8" x2="8" y1="10" y2="14"/><line x1="16" x2="16" y1="18" y2="22"/>'),
  info: mark('<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>'),
  alert: mark('<circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/>'),
};

function part(className, text) {
  const span = document.createElement("span");
  span.className = className;
  span.textContent = text;
  return span;
}

function iconPart(name) {
  const span = document.createElement("span");
  span.className = "auto-note-icon";
  span.innerHTML = NOTE_ICONS[name] || NOTE_ICONS.info;
  return span;
}

/** The line once its action is done: a check and the words for what was done. */
export function settleNote(line, words) {
  delete line.dataset.tone;
  line.replaceChildren(iconPart("done"), part("auto-note-what", words));
}

/**
 * `actions`: [{ icon, title, run }] (an icon alone, `title` its name) or [{ text, run }] (small words).
 * `run()` may return words: the line is then done and says them. A throw keeps the line and says it did
 * not work, so the user can press again.
 */
export function noteLine({ icon = "info", label = "", what = "", tone = "", actions = [] }) {
  const line = document.createElement("div");
  line.className = "auto-note";
  line.setAttribute("role", "status");
  if (tone) line.dataset.tone = tone;
  line.append(iconPart(icon));
  if (label) line.append(part("auto-note-label", label));
  const whatPart = part("auto-note-what", what);
  whatPart.title = what;
  if (what) line.append(whatPart);
  const buttons = actions.map(({ icon: name, text, title, run }) => {
    const button = Object.assign(document.createElement("button"), { type: "button", className: "auto-note-action" });
    if (name) {
      button.innerHTML = NOTE_ICONS[name] || "";
      button.title = title;
      button.setAttribute("aria-label", title);
    } else {
      button.classList.add("is-text");
      button.textContent = text;
    }
    button.addEventListener("click", async () => {
      for (const item of buttons) item.disabled = true;
      try {
        const words = await run();
        if (typeof words === "string") settleNote(line, words);
        else for (const item of buttons) item.disabled = false;
      } catch {
        whatPart.textContent = "처리하지 못했어요. 다시 눌러 주세요.";
        if (!whatPart.isConnected) line.insertBefore(whatPart, buttons[0]);
        line.dataset.tone = "error";
        for (const item of buttons) item.disabled = false;
      }
    });
    return button;
  });
  line.append(...buttons);
  return line;
}
