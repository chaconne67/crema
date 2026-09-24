import { beforeEach, describe, expect, it } from "vitest";

import {
  chatSessions,
  chatTitle,
  createChat,
  createProject,
  hermesSessionKey,
  loadMessages,
  loadWorkspace,
  saveMessages,
  startNewSession,
} from "../src/storage.js";

describe("workspace storage", () => {
  beforeEach(() => window.localStorage.clear());

  it("moves the single pre-project conversation into a chat that keeps its Hermes session", () => {
    const legacy = [
      { id: "first-user-id", role: "user", content: "안녕", createdAt: 1, status: "complete" },
      { id: "a1", role: "assistant", content: "반가워요", createdAt: 2, status: "complete" },
    ];
    window.localStorage.setItem("agent-client:conversation:v1", JSON.stringify(legacy));

    const workspace = loadWorkspace();
    expect(workspace.chats).toHaveLength(1);
    expect(workspace.chats[0]).toMatchObject({ id: "first-user-id", title: "이전 대화", projectId: null });
    expect(workspace.activeChatId).toBe("first-user-id");
    expect(loadMessages("first-user-id")).toHaveLength(2);
  });

  it("names projects after their folder and does not add the same folder twice", () => {
    const workspace = loadWorkspace();
    const project = createProject(workspace, "C:\\Users\\me\\controlroom\\agent-client\\");
    expect(project.name).toBe("agent-client");
    expect(createProject(workspace, "C:\\Users\\me\\controlroom\\agent-client\\")).toBe(project);
    expect(workspace.projects).toHaveLength(1);

    const chat = createChat(workspace, project.id);
    expect(chat).toMatchObject({ projectId: project.id, title: "새 대화" });
  });

  it("gives each project its own Hermes session scope and each loose chat its own", () => {
    const a = { id: "project-a" };
    const b = { id: "project-b" };
    expect(hermesSessionKey(a, "chat-1")).toBe(hermesSessionKey(a, "chat-2"));
    expect(hermesSessionKey(a, "chat-1")).not.toBe(hermesSessionKey(b, "chat-1"));
    expect(hermesSessionKey(null, "chat-1")).not.toBe(hermesSessionKey(null, "chat-2"));
    expect(hermesSessionKey(null, "chat-1")).not.toBe(hermesSessionKey(a, "chat-1"));
  });

  it("keeps every session a chat used so deleting the chat can remove them all", () => {
    const workspace = loadWorkspace();
    const chat = createChat(workspace);
    expect(chatSessions(chat)).toEqual([chat.id]);
    const next = startNewSession(chat);
    expect(chatSessions(chat)).toEqual([chat.id, next]);
    expect(chatSessions({ id: "older-chat" })).toEqual(["older-chat"]);
  });

  it("keeps a request's attachments by name and kind, never their data", () => {
    saveMessages("chat-1", [
      {
        id: "m1",
        role: "user",
        content: "확인해줘",
        createdAt: 1,
        status: "complete",
        attachments: [
          { kind: "image", name: "shot.png", dataUrl: "data:image/png;base64,AAAA" },
          { kind: "file", name: "보고서.pdf", path: "C:\work\보고서.pdf" },
        ],
      },
    ]);
    expect(loadMessages("chat-1")[0].attachments).toEqual([
      { kind: "image", name: "shot.png" },
      { kind: "file", name: "보고서.pdf" },
    ]);
  });

  it("titles a chat from its first request", () => {
    expect(chatTitle([{ role: "user", content: "  폴더   구조를\n정리해줘 " }])).toBe("폴더 구조를 정리해줘");
    expect(chatTitle([{ role: "user", content: "가".repeat(50) }])).toBe(`${"가".repeat(40)}…`);
    expect(chatTitle([])).toBe("새 대화");
  });
});
