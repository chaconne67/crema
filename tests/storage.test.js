import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  chatSessions,
  chatTitle,
  createChat,
  createProject,
  hermesSessionKey,
  loadMessages,
  loadAccount,
  loadWorkspace,
  onStorageError,
  saveAccount,
  saveMessages,
  saveWorkspace,
  startNewSession,
} from "../src/storage.js";

describe("workspace storage", () => {
  beforeEach(() => window.localStorage.clear());

  it("reports saved chats it cannot read and changes it cannot save instead of skipping them", () => {
    const reported = vi.fn();
    onStorageError(reported);
    window.localStorage.setItem("agent-client:workspace:v1", "{not json");
    expect(loadWorkspace().projects).toEqual([]);
    expect(reported).toHaveBeenCalledTimes(1);

    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    saveWorkspace({ projects: [], chats: [] });
    saveMessages("chat-1", []);
    expect(reported).toHaveBeenCalledTimes(3);
    setItem.mockRestore();
    onStorageError(() => {});
  });

  it("names projects after their folder and does not add the same folder twice", () => {
    const workspace = loadWorkspace();
    const project = createProject(workspace, "C:\\Users\\me\\controlroom\\agent-client\\");
    expect(project.name).toBe("agent-client");
    expect(createProject(workspace, "C:\\Users\\me\\controlroom\\agent-client\\")).toBe(project);
    expect(workspace.projects).toHaveLength(1);
    expect(project.color).toBeUndefined();

    // A new project takes the color it is made with; adding the same folder again keeps its own.
    const colored = createProject(workspace, "C:\\work\\moka", "#a855f7");
    expect(colored.color).toBe("#a855f7");
    expect(createProject(workspace, "C:\\work\\moka", "#ef4444").color).toBe("#a855f7");

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

  it("remembers the signed-in account for offline use and forgets it on sign-out", () => {
    expect(loadAccount()).toBeNull();
    saveAccount({ email: "me@example.com", name: "주인", token: "never-stored" });
    expect(loadAccount()).toEqual({ email: "me@example.com", name: "주인" });
    saveAccount(null);
    expect(loadAccount()).toBeNull();
  });
});
