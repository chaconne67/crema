import { beforeEach, describe, expect, it, vi } from "vitest";

import { createSidebar } from "../src/sidebar.js";

describe("sidebar", () => {
  let handlers;
  let sidebar;
  const workspace = {
    projects: [{ id: "p1", name: "exdigm", path: "C:\\exdigm", color: "#a855f7" }],
    chats: [
      { id: "c1", projectId: "p1", title: "작업 중인 대화", updatedAt: 3 },
      { id: "c2", projectId: "p1", title: "끝난 대화", updatedAt: 2, unread: true },
      { id: "c3", projectId: null, title: "평범한 대화", updatedAt: 1 },
    ],
    activeChatId: "c3",
    collapsed: {},
  };

  beforeEach(() => {
    document.body.innerHTML = '<div id="workspace"></div>';
    handlers = {
      onNewChat: vi.fn(),
      onOpenChat: vi.fn(),
      onAddProject: vi.fn(),
      onRemoveProject: vi.fn(),
      onDeleteChat: vi.fn(),
      onPinChat: vi.fn(),
      onArchiveChat: vi.fn(),
      onRestoreChat: vi.fn(),
      onToggleProject: vi.fn(),
      onProjectColor: vi.fn(),
      onResize: vi.fn(),
    };
    sidebar = createSidebar(handlers);
    sidebar.mount(document.querySelector("#workspace"));
    sidebar.render(workspace, new Set(["c1"]));
  });

  it("marks a reply in progress with a spinner and an unseen finished one with a dot", () => {
    const row = (id) => document.querySelector(`[data-open-chat="${id}"]`);
    expect(row("c1").querySelector(".row-spinner")).not.toBeNull();
    expect(row("c2").querySelector(".row-unread")).not.toBeNull();
    expect(row("c3").querySelector(".row-status")).toBeNull();
  });

  it("toggles a project from its row without a chevron", () => {
    expect(document.querySelector(".row-chevron")).toBeNull();
    document.querySelector('[data-toggle-project="p1"]').click();
    expect(handlers.onToggleProject).toHaveBeenCalledWith("p1");
  });

  it("resizes from its right edge within bounds and returns to the default on double-click", () => {
    const workspaceElement = document.querySelector("#workspace");
    const handle = document.querySelector(".sidebar-resizer");
    const aside = document.querySelector(".sidebar");
    let width = 264;
    aside.getBoundingClientRect = () => ({ left: 0, width });
    window.innerWidth = 1400;

    handle.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(handlers.onResize).toHaveBeenLastCalledWith(280);
    expect(workspaceElement.style.getPropertyValue("--sidebar-width")).toBe("280px");

    width = 470;
    handle.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(handlers.onResize).toHaveBeenLastCalledWith(480);

    expect(sidebar.setWidth(120)).toBe(200);
    handle.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(handlers.onResize).toHaveBeenLastCalledWith(264);
    expect(workspaceElement.style.getPropertyValue("--sidebar-width")).toBe("264px");
  });

  it("colors a project's folder from the popup under its icon", () => {
    const icon = document.querySelector('[data-folder-color-for="p1"]');
    expect(icon.style.color).toBe("rgb(168, 85, 247)");
    icon.click();
    const popup = document.querySelector(".folder-color-popup");
    expect(popup.hidden).toBe(false);
    expect(popup.querySelector(".selected").dataset.folderColor).toBe("#a855f7");
    popup.querySelector('[data-folder-color="#3b82f6"]').click();
    expect(handlers.onProjectColor).toHaveBeenCalledWith("p1", "#3b82f6");
    expect(popup.hidden).toBe(true);
    expect(handlers.onToggleProject).not.toHaveBeenCalled();
  });

  it("offers pin and archive on a chat row, with no delete outside the archive", () => {
    const row = document.querySelector('[data-open-chat="c3"]').closest(".chat-row");
    row.querySelector('[data-pin-chat="c3"]').click();
    row.querySelector('[data-archive-chat="c3"]').click();
    expect(handlers.onPinChat).toHaveBeenCalledWith("c3");
    expect(handlers.onArchiveChat).toHaveBeenCalledWith("c3");
    expect(document.querySelector("[data-delete-chat]")).toBeNull();
  });

  it("lists pinned chats on top and archived chats in a closed archive", () => {
    sidebar.render({
      ...workspace,
      chats: [
        { id: "c1", projectId: "p1", title: "고정한 대화", updatedAt: 3, pinned: true },
        { id: "c2", projectId: "p1", title: "보관한 대화", updatedAt: 2, archived: true },
        { id: "c3", projectId: null, title: "평범한 대화", updatedAt: 1 },
      ],
    });
    const pinned = document.querySelector(".sidebar-pinned");
    expect(pinned.textContent).toContain("고정한 대화");
    expect(pinned.querySelector('[data-pin-chat="c1"]').getAttribute("aria-pressed")).toBe("true");
    expect(document.querySelectorAll('[data-open-chat="c1"]')).toHaveLength(1);

    const archive = document.querySelector(".sidebar-archive");
    expect(archive.open).toBe(false);
    expect(document.querySelector('[data-open-chat="c2"]')).toBeNull();
    archive.querySelector('[data-restore-chat="c2"]').click();
    archive.querySelector('[data-delete-chat="c2"]').click();
    expect(handlers.onRestoreChat).toHaveBeenCalledWith("c2");
    expect(handlers.onDeleteChat).toHaveBeenCalledWith("c2");
  });

  it("keeps the archive open across renders once opened", () => {
    const chats = [{ id: "c2", projectId: null, title: "보관한 대화", updatedAt: 2, archived: true }];
    sidebar.render({ ...workspace, chats });
    const archive = document.querySelector(".sidebar-archive");
    archive.open = true;
    archive.dispatchEvent(new Event("toggle"));
    sidebar.render({ ...workspace, chats });
    expect(document.querySelector(".sidebar-archive").open).toBe(true);
  });
});
