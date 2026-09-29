import { describe, expect, it, vi } from "vitest";

import { createMemorySection } from "../src/memory.js";

const GRAPH = {
  nodes: [
    { id: "tax-filing", label: "tax-filing", kind: "skill", useCount: 3 },
    { id: "memory:memory:0", label: "세무 일은 매달 20일", kind: "memory", memorySource: "memory" },
    { id: "memory:profile:1", label: "이름은 김주인", kind: "memory", memorySource: "profile" },
  ],
  memory: [
    { source: "memory", title: "세무 일은 매달 20일", body: "세무 일은 매달 20일에 확인" },
    { source: "profile", title: "이름은 김주인", body: "이름은 김주인" },
  ],
};

const ON = { memory: { memory_enabled: true, user_profile_enabled: true } };

const KNOWLEDGE = {
  pages: [
    { slug: "incident/세금계산서-오류", type: "incident", title: "세금계산서 발행 오류", status: "active", confirmed: "2026-09-28", tags: [] },
    { slug: "reference/옛-주소", type: "reference", title: "옛 사이트 주소", status: "needs_review", confirmed: "2026-06-01", tags: [] },
  ],
  last_daily: { at: 1790000000, needs_review: 1, distilled: 2 },
  meaning: { on: true, chunks: 4, vectors: 1 },
};
const PAGE = { slug: "incident/세금계산서-오류", title: "세금계산서 발행 오류", body: "사업자번호 누락이 원인.",
  timeline: [{ date: "2026-10-02", summary: "다시 발생, 같은 방법으로 해결" }] };

function setup(config = ON, knowledge = KNOWLEDGE) {
  const calls = [];
  const host = {
    hermesAdmin: vi.fn(async (method, path, body) => {
      calls.push([method, path, body]);
      if (path === "/api/config" && method === "GET") return config;
      if (path === "/api/learning/graph") return GRAPH;
      if (path.startsWith("/api/learning/node?")) return { ok: true, content: "세무 일은 매달 20일에 확인" };
      if (path.startsWith("/api/sessions/search")) {
        return { results: [
          { session_id: "agent-client-chat1", title: "세금 신고", snippet: "이번 달 >>>세금<<< 신고", last_active: 1790000000 },
          { session_id: "cron_abc", title: null, snippet: "예약 작업 >>>세금<<<" },
        ] };
      }
      if (path === "/api/crema/backup") return { ok: true, path: body.output };
      if (path === "/api/crema/knowledge") return knowledge;
      if (path.startsWith("/api/crema/knowledge/page?")) return PAGE;
      return { ok: true };
    }),
    confirm: vi.fn(async () => true),
    pickFolder: vi.fn(async () => "C:\\Users\\me\\Backups"),
  };
  const onOpenChat = vi.fn();
  const onUpdate = vi.fn();
  const section = createMemorySection({ host, onOpenChat, onUpdate });
  document.body.replaceChildren(section.element);
  return { section, host, calls, onOpenChat, onUpdate, el: section.element };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("Settings → 기억", () => {
  it("shows what the agent remembers and the skills it learned, in their groups", async () => {
    const { section, el, onUpdate } = setup();
    await section.load();
    expect(el.querySelector('[data-group="profile"]').textContent).toContain("이름은 김주인");
    expect(el.querySelector('[data-group="memory"]').textContent).toContain("세무 일은 매달 20일에 확인");
    expect(el.querySelector('[data-group="skill"]').textContent).toContain("tax-filing");
    expect(el.querySelector('[data-group="skill"]').textContent).toContain("3번 씀");
    expect(section.summary()).toBe("기억 2개 · 지식 2쪽 · 배운 방법 1개");
    expect(onUpdate).toHaveBeenCalled();
  });

  it("corrects a memory in place and deletes one after asking", async () => {
    const { section, el, calls, host } = setup();
    await section.load();
    el.querySelector('[data-id="memory:memory:0"] [data-edit]').click();
    await flush();
    const box = el.querySelector(".memory-edit");
    expect(box.value).toBe("세무 일은 매달 20일에 확인");
    box.value = "세무 일은 매달 21일에 확인";
    el.querySelector("[data-save]").click();
    await flush();
    expect(calls).toContainEqual(["PUT", "/api/learning/node", { id: "memory:memory:0", content: "세무 일은 매달 21일에 확인" }]);

    el.querySelector('[data-id="memory:profile:1"] [data-delete]').click();
    await flush();
    expect(host.confirm).toHaveBeenCalled();
    expect(calls).toContainEqual(["DELETE", "/api/learning/node", { id: "memory:profile:1" }]);
  });

  it("keeps a memory when the delete is not confirmed", async () => {
    const { section, el, calls, host } = setup();
    host.confirm.mockResolvedValueOnce(false);
    await section.load();
    el.querySelector('[data-id="memory:profile:1"] [data-delete]').click();
    await flush();
    expect(calls.some(([method]) => method === "DELETE")).toBe(false);
  });

  it("finds past chats and opens Crema's own, not the engine's other sessions", async () => {
    const { section, el, onOpenChat } = setup();
    await section.load();
    el.querySelector("[data-query]").value = "세금";
    el.querySelector("[data-search]").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await flush();
    const hits = el.querySelectorAll(".memory-hit");
    expect(hits).toHaveLength(2);
    expect(hits[0].querySelector("mark").textContent).toBe("세금");
    hits[0].click();
    expect(onOpenChat).toHaveBeenCalledWith("chat1");
    expect(hits[1].disabled).toBe(true);
  });

  it("backs up into the chosen folder without credentials, and says where", async () => {
    const { section, el, calls } = setup();
    await section.load();
    el.querySelector("[data-backup]").click();
    await flush();
    await flush();
    const [, , body] = calls.find(([, path]) => path === "/api/crema/backup");
    expect(body.output).toMatch(/^C:\\Users\\me\\Backups\\crema-backup-\d{12}\.zip$/);
    expect(el.querySelector(".provider-status").textContent).toContain("백업했습니다");
  });

  it("turns remembering off and on through the engine config", async () => {
    const { section, el, calls } = setup();
    await section.load();
    const box = el.querySelector("[data-enabled]");
    box.checked = false;
    box.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();
    expect(calls).toContainEqual(["PUT", "/api/config", {
      config: { memory: { memory_enabled: false, user_profile_enabled: false }, skills: { creation_nudge_interval: 0 } },
    }]);
    expect(section.summary()).toBe("꺼짐");
  });

  it("shows the knowledge notebook by kind, with pages to review marked", async () => {
    const { section, el } = setup();
    await section.load();
    const group = el.querySelector('[data-group="knowledge"]');
    expect(group.textContent).toContain("겪은 문제와 해결");
    expect(group.textContent).toContain("세금계산서 발행 오류");
    expect(group.querySelector('[data-slug="reference/옛-주소"] .memory-badge').textContent).toBe("확인 필요");
    expect(group.textContent).toContain("정리한 대화 2");
    expect(group.querySelector("[data-meaning]").textContent).toBe("다른 말로 물어도 찾도록 준비하는 중 (25%)");
    expect(group.textContent).not.toContain("지운 지식");
  });

  it("on the free plan says nothing new is learned and search is by words", async () => {
    const { section, el } = setup({ ...ON, crema: { free: true } });
    await section.load();
    expect(el.querySelector("[data-free]").textContent).toContain("새로 배우지 않습니다");
    expect(el.querySelector("[data-meaning]").textContent).toBe("무료 플랜에서는 같은 낱말이 있어야 찾습니다.");
  });

  it("says whether a question in other words is found", async () => {
    for (const [state, text] of [
      [{ on: true, chunks: 4, vectors: 4 }, "다른 말로 물어도 뜻이 같으면 찾습니다."],
      [{ on: false, chunks: 4, vectors: 0 }, "지금은 같은 낱말이 있어야 찾습니다."],
    ]) {
      KNOWLEDGE.meaning = state;
      const { section, el } = setup();
      await section.load();
      expect(el.querySelector("[data-meaning]").textContent).toBe(text);
    }
    KNOWLEDGE.meaning = { on: true, chunks: 4, vectors: 1 };
  });

  it("opens a page, corrects it as the user's word, and deletes it with an undo", async () => {
    const { section, el, calls } = setup();
    await section.load();
    el.querySelector('[data-slug="incident/세금계산서-오류"] [data-page-open]').click();
    await flush();
    expect(el.textContent).toContain("다시 발생, 같은 방법으로 해결");
    el.querySelector("[data-page-edit]").click();
    el.querySelector(".memory-edit").value = "사업자번호 누락이 원인. 거래처 정보 수정으로 해결.";
    el.querySelector("[data-page-save]").click();
    await flush();
    await flush();
    expect(calls).toContainEqual(["PUT", "/api/crema/knowledge/page", { slug: "incident/세금계산서-오류", body: "사업자번호 누락이 원인. 거래처 정보 수정으로 해결." }]);
    el.querySelector("[data-page-delete]").click();
    await flush();
    await flush();
    expect(calls).toContainEqual(["DELETE", "/api/crema/knowledge/page", { slug: "incident/세금계산서-오류" }]);
    el.querySelector("[data-page-undo]").click();
    expect([...el.querySelectorAll("[data-page-undo]")].every((undo) => undo.disabled)).toBe(true);
    await flush();
    expect(calls).toContainEqual(["POST", "/api/crema/knowledge/undo", { slug: "incident/세금계산서-오류" }]);
  });

  it("lists what the user deleted in the last three days and brings one back once", async () => {
    const until = 1790259200;
    const { section, el, calls } = setup(ON, { ...KNOWLEDGE, pages: [], deleted: [
      { slug: "feedback/보고서-말투", type: "feedback", title: "보고서는 존댓말로", restorable_until: until },
    ] });
    await section.load();
    const group = el.querySelector('[data-group="knowledge"]');
    expect(group.open).toBe(true);
    expect(group.textContent).toContain("지운 지식");
    const row = group.querySelector('[data-slug="feedback/보고서-말투"]');
    expect(row.textContent).toContain("보고서는 존댓말로");
    expect(row.textContent).toContain(`내가 고쳐 준 점 · ${new Date(until * 1000).toLocaleDateString("ko-KR")}까지 되돌릴 수 있음`);
    const undo = row.querySelector("[data-page-undo]");
    undo.click();
    undo.click();
    await flush();
    expect(calls.filter(([, path]) => path === "/api/crema/knowledge/undo"))
      .toEqual([["POST", "/api/crema/knowledge/undo", { slug: "feedback/보고서-말투" }]]);
  });

  it("sets how the notebook is searched and the daily tidy-up in the engine config", async () => {
    const { section, el, calls } = setup();
    await section.load();
    const select = el.querySelector("[data-mode]");
    select.value = "light";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();
    const box = el.querySelector("[data-daily]");
    box.checked = false;
    box.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();
    expect(calls).toContainEqual(["PUT", "/api/config", { config: { knowledge: { search_mode: "light" } } }]);
    expect(calls).toContainEqual(["PUT", "/api/config", { config: { knowledge: { nightly: false } } }]);
  });
});
