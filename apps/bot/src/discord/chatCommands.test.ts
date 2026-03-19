import { describe, expect, it } from "vitest";

import {
  extractChatShellCommand,
  stripBotMention,
} from "./chatCommands.js";

describe("extractChatShellCommand", () => {
  it("extracts a backticked command from a mention message", () => {
    expect(
      extractChatShellCommand(
        "<@123> `ls -la` っていうコマンドを実行して",
        "123",
      ),
    ).toBe("ls -la");
  });

  it("extracts a fenced shell command", () => {
    expect(
      extractChatShellCommand("これを実行して\n```bash\npwd\n```"),
    ).toBe("pwd");
  });

  it("extracts a plain text command from a mention message", () => {
    expect(
      extractChatShellCommand(
        "<@123> ls -a っていうコマンドを実行して",
        "123",
      ),
    ).toBe("ls -a");
  });

  it("extracts a command when the bot is mentioned via role", () => {
    expect(
      extractChatShellCommand(
        "<@&999> ls っていうコマンドを実行して",
        undefined,
        ["999"],
      ),
    ).toBe("ls");
  });

  it("ignores unrelated messages", () => {
    expect(extractChatShellCommand("今日は何する？", "123")).toBeNull();
  });

  it("strips user and role mentions from prompt text", () => {
    expect(stripBotMention("<@123> README を直して", "123")).toBe("README を直して");
    expect(stripBotMention("<@&999> fix tests", undefined, ["999"])).toBe("fix tests");
  });
});
