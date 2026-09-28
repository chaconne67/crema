// Crema's own chats run in the engine as agent-client-<chat id> (desktop.js hermesSessionId).
const CHAT_PREFIX = "agent-client-";

const GROUPS = [
  ["profile", "나에 대해"],
  ["memory", "에이전트 메모"],
  ["skill", "배운 방법"],
];

// The knowledge notebook's kinds of page (the slug prefix), as the user reads them.
const KINDS = [
  ["project", "하는 일"],
  ["incident", "겪은 문제와 해결"],
  ["feedback", "내가 고쳐 준 점"],
  ["reference", "찾아 둔 자료"],
  ["decision", "결정과 이유"],
];
const STATUS_LABEL = { needs_review: "확인 필요", superseded: "지난 내용" };
const MODES = [
  ["light", "가볍게 (AI 호출 없음)"],
  ["balanced", "균형"],
  ["thorough", "꼼꼼히"],
];

function escapeHtml(value) {
  return String(value).replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]);
}

// The engine marks a search hit as >>>word<<<.
const highlight = (snippet) => escapeHtml(snippet).replace(/&gt;&gt;&gt;(.*?)&lt;&lt;&lt;/g, "<mark>$1</mark>");

const day = (seconds) => (seconds ? new Date(seconds * 1000).toLocaleDateString("ko-KR") : "");

/**
 * Settings "기억": what the agent remembers about the user (USER.md) and has noted for itself
 * (MEMORY.md), the skills it learned, and the knowledge notebook of what it learned working with the
 * user (its pages by kind, how it searches, the daily tidy-up) — each to read, correct or delete — the
 * past chats to search, and a backup of it all without API keys or sign-in tokens. host: hermesAdmin,
 * confirm, pickFolder. onOpenChat(sessionId) opens a found chat; onUpdate() runs when the summary changes.
 */
export function createMemorySection({ host, onOpenChat = () => {}, onUpdate = () => {} }) {
  const element = document.createElement("div");
  element.className = "memory-section";
  let enabled = true;
  let items = []; // { id, group, label, body, uses }
  let editing = null; // { id, content }
  let notice = null; // { text, tone }
  let results = null; // past-chat search hits; null before a search
  let query = "";
  let pages = []; // knowledge notebook pages (list rows)
  let opened = null; // the page shown in full: { slug, page, editing }
  let mode = "balanced";
  let daily = true;
  let lastDaily = null;
  let meaning = null; // { on, chunks, vectors }: meaning search, from the engine's knowledge list

  async function load() {
    try {
      const [config, graph, knowledge] = await Promise.all([
        host.hermesAdmin("GET", "/api/config"),
        host.hermesAdmin("GET", "/api/learning/graph"),
        host.hermesAdmin("GET", "/api/crema/knowledge"),
      ]);
      const memory = config?.memory || {};
      enabled = memory.memory_enabled !== false || memory.user_profile_enabled !== false;
      mode = config?.knowledge?.search_mode || "balanced";
      daily = config?.knowledge?.nightly !== false;
      pages = knowledge?.pages || [];
      lastDaily = knowledge?.last_daily || null;
      meaning = knowledge?.meaning || null;
      if (opened && !pages.some((page) => page.slug === opened.slug)) opened = null;
      // A memory node memory:<source>:<i> is graph.memory[i].
      items = (graph?.nodes || []).map((node) =>
        node.kind === "memory"
          ? { id: node.id, group: node.memorySource, label: node.label, body: graph.memory?.[Number(node.id.split(":")[2])]?.body || node.label }
          : { id: node.id, group: "skill", label: node.label, uses: node.useCount || 0 });
    } catch (error) {
      notice = { text: error?.userMessage || "기억을 불러오지 못했습니다.", tone: "error" };
    }
    render();
    onUpdate();
  }

  const status = () =>
    notice
      ? `<p class="provider-status" data-tone="${notice.tone || ""}" role="status">${escapeHtml(notice.text)}${
          notice.undo ? ` <button class="text-button" type="button" data-page-undo data-slug="${escapeHtml(notice.undo)}">되돌리기</button>` : ""
        }</p>`
      : "";

  function pageHtml(row) {
    const badge = STATUS_LABEL[row.status] ? ` <span class="memory-badge">${STATUS_LABEL[row.status]}</span>` : "";
    const head = `
      <button class="memory-page-title" type="button" data-page-open aria-expanded="${opened?.slug === row.slug}">
        ${escapeHtml(row.title)}${badge}
        <span class="feature-hint">${escapeHtml(row.confirmed)} 확인</span>
      </button>`;
    if (opened?.slug !== row.slug || !opened.page) return `<li class="memory-item" data-slug="${escapeHtml(row.slug)}">${head}</li>`;
    const page = opened.page;
    const body = opened.editing
      ? `<textarea class="persona-text memory-edit" rows="8" aria-label="${escapeHtml(page.title)} 고치기">${escapeHtml(page.body)}</textarea>
         <div class="feature-actions">
           <button class="primary-button" type="button" data-page-save>저장</button>
           <button class="secondary-button" type="button" data-page-cancel>취소</button>
         </div>`
      : `<p class="memory-text">${escapeHtml(page.body)}</p>
         ${page.timeline.length ? `<ul class="memory-timeline">${page.timeline.map((t) => `<li><span class="feature-hint">${escapeHtml(t.date)}</span> ${escapeHtml(t.summary)}</li>`).join("")}</ul>` : ""}
         <div class="memory-actions">
           <button class="text-button" type="button" data-page-edit>고치기</button>
           <button class="text-button danger" type="button" data-page-delete>지우기</button>
         </div>`;
    return `<li class="memory-item" data-slug="${escapeHtml(row.slug)}">${head}${body}</li>`;
  }

  function knowledgeHtml() {
    const kinds = KINDS.map(([key, label]) => {
      const list = pages.filter((page) => page.type === key);
      return list.length ? `<p class="field-label">${label}</p><ul class="memory-list">${list.map(pageHtml).join("")}</ul>` : "";
    }).join("");
    const last = lastDaily?.at
      ? `마지막 정리 ${day(lastDaily.at)} · 확인 필요로 바꾼 것 ${lastDaily.needs_review || 0} · 정리한 대화 ${lastDaily.distilled || 0}`
      : "아직 정리하지 않았습니다.";
    const found = !meaning ? ""
      : !meaning.on ? "지금은 같은 낱말이 있어야 찾습니다."
      : meaning.vectors < meaning.chunks ? `다른 말로 물어도 찾도록 준비하는 중 (${Math.floor((meaning.vectors / meaning.chunks) * 100)}%)`
      : "다른 말로 물어도 뜻이 같으면 찾습니다.";
    return `
      <details class="settings-group" data-group="knowledge"${pages.length ? " open" : ""}>
        <summary>일하며 배운 지식<span class="feature-hint">${pages.length}</span></summary>
        <div class="settings-group-body">
          ${kinds || '<p class="feature-hint">아직 없습니다. 함께 일한 대화가 조용해지면 배운 것을 여기에 남깁니다.</p>'}
          <label for="knowledge-mode">찾는 방식</label>
          <select id="knowledge-mode" data-mode>${MODES.map(([value, label]) => `<option value="${value}"${value === mode ? " selected" : ""}>${label}</option>`).join("")}</select>
          ${found ? `<p class="feature-hint" data-meaning>${found}</p>` : ""}
          <label class="check-row"><input type="checkbox" data-daily${daily ? " checked" : ""} /> 하루 한 번 정리하기</label>
          <p class="feature-hint">${escapeHtml(last)}</p>
        </div>
      </details>`;
  }

  function itemHtml(item) {
    if (editing?.id === item.id) {
      return `
        <li class="memory-item" data-id="${escapeHtml(item.id)}">
          <textarea class="persona-text memory-edit" rows="${item.group === "skill" ? 10 : 3}" aria-label="${escapeHtml(item.label)} 고치기">${escapeHtml(editing.content)}</textarea>
          <div class="feature-actions">
            <button class="primary-button" type="button" data-save>저장</button>
            <button class="secondary-button" type="button" data-cancel>취소</button>
          </div>
        </li>`;
    }
    return `
      <li class="memory-item" data-id="${escapeHtml(item.id)}">
        <p class="memory-text">${escapeHtml(item.group === "skill" ? item.label : item.body)}</p>
        ${item.group === "skill" ? `<span class="feature-hint">${item.uses}번 씀</span>` : ""}
        <div class="memory-actions">
          <button class="text-button" type="button" data-edit>고치기</button>
          <button class="text-button danger" type="button" data-delete>지우기</button>
        </div>
      </li>`;
  }

  function groupHtml([key, label]) {
    const list = items.filter((item) => item.group === key);
    return `
      <details class="settings-group" data-group="${key}"${list.length ? " open" : ""}>
        <summary>${label}<span class="feature-hint">${list.length}</span></summary>
        <div class="settings-group-body">
          ${list.length ? `<ul class="memory-list">${list.map(itemHtml).join("")}</ul>` : '<p class="feature-hint">아직 없습니다.</p>'}
        </div>
      </details>`;
  }

  function resultHtml(hit) {
    const sid = hit.session_id || "";
    const chatId = sid.startsWith(CHAT_PREFIX) ? sid.slice(CHAT_PREFIX.length) : "";
    const when = day(hit.last_active || hit.session_started || hit.started_at);
    return `
      <li>
        <button class="memory-hit" type="button" data-chat="${escapeHtml(chatId)}"${chatId ? "" : " disabled"}>
          <span class="memory-hit-title">${escapeHtml(hit.title || "제목 없는 대화")}${when ? ` <span class="feature-hint">${when}</span>` : ""}</span>
          <span class="memory-hit-snippet">${highlight(hit.snippet || hit.preview || "")}</span>
        </button>
      </li>`;
  }

  function render() {
    element.innerHTML = `
      <label class="check-row"><input type="checkbox" data-enabled${enabled ? " checked" : ""} /> 대화에서 배운 것을 기억하기</label>
      ${GROUPS.map(groupHtml).join("")}
      ${knowledgeHtml()}
      <details class="settings-group" data-group="search"${results ? " open" : ""}>
        <summary>지난 대화 찾기</summary>
        <div class="settings-group-body">
          <form class="memory-search" data-search>
            <input type="search" data-query value="${escapeHtml(query)}" placeholder="찾을 말" aria-label="지난 대화에서 찾을 말" />
            <button class="secondary-button" type="submit">찾기</button>
          </form>
          ${results === null ? "" : results.length ? `<ul class="memory-hits">${results.map(resultHtml).join("")}</ul>` : '<p class="feature-hint">찾은 대화가 없습니다.</p>'}
        </div>
      </details>
      <details class="settings-group" data-group="backup">
        <summary>백업</summary>
        <div class="settings-group-body">
          <p class="feature-hint">대화, 기억, 배운 방법, 설정을 고른 폴더에 파일 하나로 저장합니다. API 키와 로그인 정보는 넣지 않습니다.</p>
          <div class="feature-actions"><button class="secondary-button" type="button" data-backup>백업 파일 만들기</button></div>
        </div>
      </details>
      ${status()}`;
  }

  async function run(work, done, failed = "처리하지 못했습니다.") {
    try {
      await work();
      notice = done ? { text: done } : null;
    } catch (error) {
      notice = { text: error?.userMessage || failed, tone: "error" };
    }
  }

  async function edit(id) {
    await run(async () => {
      const node = await host.hermesAdmin("GET", `/api/learning/node?id=${encodeURIComponent(id)}`);
      editing = { id, content: node.content };
    });
    render();
    element.querySelector(".memory-edit")?.focus();
  }

  async function save() {
    const content = element.querySelector(".memory-edit").value;
    await run(() => host.hermesAdmin("PUT", "/api/learning/node", { id: editing.id, content }), "고쳤습니다.");
    editing = null;
    await load();
  }

  async function remove(id) {
    const item = items.find((entry) => entry.id === id);
    const what = item?.group === "skill" ? "이 방법을 지울까요?" : "이 기억을 지울까요?";
    if (!(await host.confirm(what, "지우기"))) return;
    await run(() => host.hermesAdmin("DELETE", "/api/learning/node", { id }), "지웠습니다.");
    await load();
  }

  async function search() {
    query = element.querySelector("[data-query]").value.trim();
    if (!query) return;
    await run(async () => {
      results = (await host.hermesAdmin("GET", `/api/sessions/search?q=${encodeURIComponent(query)}&limit=20`))?.results || [];
    });
    render();
  }

  async function backup() {
    const folder = await host.pickFolder("백업을 저장할 폴더");
    if (!folder) return;
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
    const output = `${folder}${folder.includes("/") ? "/" : "\\"}crema-backup-${stamp}.zip`;
    notice = { text: "백업하고 있습니다…" };
    render();
    await run(async () => {
      const result = await host.hermesAdmin("POST", "/api/crema/backup", { output });
      if (!result?.ok) throw new Error();
    }, `백업했습니다: ${output}`, "백업하지 못했습니다.");
    render();
  }

  // Off stops both: remembering (memory, profile) and learning new ways of working (the skill review
  // every 10 steps, the engine default when on).
  async function setEnabled(on) {
    const config = { memory: { memory_enabled: on, user_profile_enabled: on }, skills: { creation_nudge_interval: on ? 10 : 0 } };
    await run(async () => {
      await host.hermesAdmin("PUT", "/api/config", { config });
      enabled = on;
    }, on ? "다음 대화부터 기억합니다." : "이제 새로 기억하지 않습니다. 이미 기억한 것은 그대로 있습니다.");
    render();
    onUpdate();
  }

  // The knowledge notebook: open a page, correct it (the user's word), delete it with an undo.
  async function openPage(slug) {
    if (opened?.slug === slug) {
      opened = null;
      return render();
    }
    await run(async () => {
      opened = { slug, page: await host.hermesAdmin("GET", `/api/crema/knowledge/page?slug=${encodeURIComponent(slug)}`) };
    });
    render();
  }

  async function savePage() {
    const body = element.querySelector(".memory-edit").value;
    await run(() => host.hermesAdmin("PUT", "/api/crema/knowledge/page", { slug: opened.slug, body }), "고쳤습니다.");
    const slug = opened.slug;
    opened = null;
    await load();
    await openPage(slug);
  }

  async function deletePage() {
    const slug = opened.slug;
    if (!(await host.confirm("이 지식을 지울까요? 사흘 안에는 되돌릴 수 있습니다.", "지우기"))) return;
    await run(() => host.hermesAdmin("DELETE", "/api/crema/knowledge/page", { slug }), "지웠습니다.");
    if (notice && !notice.tone) notice.undo = slug;
    opened = null;
    await load();
  }

  async function undoPage(slug) {
    await run(() => host.hermesAdmin("POST", "/api/crema/knowledge/undo", { slug }), "되돌렸습니다.");
    await load();
  }

  async function setKnowledge(change, done) {
    await run(() => host.hermesAdmin("PUT", "/api/config", { config: { knowledge: change } }), done);
    mode = change.search_mode ?? mode;
    daily = change.nightly ?? daily;
    render();
  }

  element.addEventListener("change", (event) => {
    if (event.target.matches("[data-enabled]")) setEnabled(event.target.checked);
    else if (event.target.matches("[data-mode]")) setKnowledge({ search_mode: event.target.value }, "찾는 방식을 바꿨습니다.");
    else if (event.target.matches("[data-daily]")) {
      setKnowledge({ nightly: event.target.checked }, event.target.checked ? "하루 한 번 정리합니다." : "정리하지 않습니다.");
    }
  });

  element.addEventListener("submit", (event) => {
    event.preventDefault();
    search();
  });

  element.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    const id = button.closest("[data-id]")?.dataset.id;
    if (button.matches("[data-edit]")) edit(id);
    else if (button.matches("[data-delete]")) remove(id);
    else if (button.matches("[data-save]")) save();
    else if (button.matches("[data-cancel]")) {
      editing = null;
      render();
    } else if (button.matches("[data-chat]") && button.dataset.chat) onOpenChat(button.dataset.chat);
    else if (button.matches("[data-backup]")) backup();
    else if (button.matches("[data-page-open]")) openPage(button.closest("[data-slug]").dataset.slug);
    else if (button.matches("[data-page-edit]")) {
      opened.editing = true;
      render();
      element.querySelector(".memory-edit")?.focus();
    } else if (button.matches("[data-page-cancel]")) {
      opened.editing = false;
      render();
    } else if (button.matches("[data-page-save]")) savePage();
    else if (button.matches("[data-page-delete]")) deletePage();
    else if (button.matches("[data-page-undo]")) undoPage(button.dataset.slug);
  });

  render();

  return {
    element,
    /** Reads the memory again (each time Settings opens: the agent may have learned something). */
    load,
    summary: () => {
      if (!enabled) return "꺼짐";
      const memories = items.filter((item) => item.group !== "skill").length;
      const skills = items.length - memories;
      return `기억 ${memories}개 · 지식 ${pages.length}쪽 · 배운 방법 ${skills}개`;
    },
  };
}
