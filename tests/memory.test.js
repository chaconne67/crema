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

function setup(config = ON) {
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
    expect(section.summary()).toBe("기억 2개 · 배운 방법 1개");
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
});
