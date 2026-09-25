import { beforeEach, describe, expect, it, vi } from "vitest";

import { createSignIn } from "../src/sign-in.js";

describe("first-run sign-in", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("covers the app until the browser sign-in comes back, then resolves with the account", async () => {
    const host = { signIn: vi.fn(async () => ({ email: "me@example.com", name: "주인" })) };
    const done = createSignIn({ host }).show();
    const gate = document.querySelector(".sign-in");
    expect(gate).not.toBeNull();

    gate.querySelector("[data-sign-in]").click();
    expect(gate.querySelector("[data-sign-in]").disabled).toBe(true);
    await expect(done).resolves.toEqual({ email: "me@example.com", name: "주인" });
    expect(document.querySelector(".sign-in")).toBeNull();
  });

  it("says why sign-in failed and lets the user try again", async () => {
    const failure = Object.assign(new Error("sign_in_timeout"), { userMessage: "5분 안에 로그인이 끝나지 않았습니다." });
    const host = { signIn: vi.fn().mockRejectedValueOnce(failure).mockResolvedValueOnce({ email: "me@example.com", name: "" }) };
    const done = createSignIn({ host }).show();
    const button = document.querySelector("[data-sign-in]");

    button.click();
    await vi.waitFor(() => expect(document.querySelector("[data-sign-in-status]").textContent).toBe("5분 안에 로그인이 끝나지 않았습니다."));
    expect(button.disabled).toBe(false);

    button.click();
    await expect(done).resolves.toMatchObject({ email: "me@example.com" });
    expect(host.signIn).toHaveBeenCalledTimes(2);
  });
});
