import { describe, expect, it } from "vitest";

import { COMMANDS, filterCommands, parseCommand } from "../src/commands.js";

describe("slash commands", () => {
  it("accepts English names and Korean aliases, with an optional argument", () => {
    expect(parseCommand("/status").command.id).toBe("status");
    expect(parseCommand("/상태").command.id).toBe("status");
    expect(parseCommand("/MODEL gpt-6-luna")).toMatchObject({ command: { id: "model" }, arg: "gpt-6-luna" });
    expect(parseCommand("/추론 높음")).toMatchObject({ command: { id: "reasoning" }, arg: "높음" });
    expect(parseCommand("/unknown")).toBeNull();
    expect(parseCommand("평범한 질문")).toBeNull();
  });

  it("filters the menu by what follows the slash", () => {
    expect(filterCommands("/").length).toBe(COMMANDS.length);
    expect(filterCommands("/re").map((command) => command.id)).toEqual(["retry", "reasoning", "restart"]);
    expect(filterCommands("/모").map((command) => command.id)).toEqual(["model"]);
  });

  it("gives every command a Korean label and an icon", () => {
    for (const command of COMMANDS) {
      expect(command.label).toMatch(/[가-힣]/);
      expect(command.icon).toContain("<svg");
    }
  });
});
