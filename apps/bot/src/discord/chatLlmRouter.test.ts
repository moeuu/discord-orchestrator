import { describe, expect, it } from "vitest";

import {
  buildChatExecArgs,
  buildChatResumeArgs,
  extractThreadId,
  parseChatMentionAction,
  shouldResetChatSession,
} from "./chatLlmRouter.js";

describe("parseChatMentionAction", () => {
  it("parses a plain json response", () => {
    expect(
      parseChatMentionAction(
        JSON.stringify({
          action: "shell",
          message: "実行します。",
          shell_command: "ls -a",
          codex_prompt: "",
          rationale: "explicit_command_request",
        }),
      ),
    ).toEqual({
      action: "shell",
      message: "実行します。",
      shell_command: "ls -a",
      codex_prompt: "",
      rationale: "explicit_command_request",
    });
  });

  it("parses fenced json responses", () => {
    expect(
      parseChatMentionAction(
        "```json\n{\"action\":\"reply\",\"message\":\"hi\",\"shell_command\":\"\",\"codex_prompt\":\"\",\"rationale\":\"chat\"}\n```",
      ),
    ).toEqual({
      action: "reply",
      message: "hi",
      shell_command: "",
      codex_prompt: "",
      rationale: "chat",
    });
  });

  it("builds codex exec args with output schema", () => {
    expect(
      buildChatExecArgs(
        "gpt-5.4",
        "/tmp/out.json",
        "hello",
      ),
    ).toEqual([
      "exec",
      "--json",
      "--model",
      "gpt-5.4",
      "--sandbox",
      "read-only",
      "--output-last-message",
      "/tmp/out.json",
      expect.stringContaining("hello"),
    ]);
  });

  it("accepts role mention text in router prompt input", () => {
    const args = buildChatExecArgs(
      "gpt-5.4",
      "/tmp/out.json",
      "このmacbookの他のディレクトリも編集できる？",
    );

    expect(args.at(-1)).toContain("このmacbookの他のディレクトリも編集できる？");
  });

  it("builds resume args with existing thread id", () => {
    expect(
      buildChatResumeArgs(
        "thread-123",
        "gpt-5.4",
        "/tmp/out.json",
        "continue",
      ),
    ).toEqual([
      "exec",
      "resume",
      "thread-123",
      "--json",
      "--model",
      "gpt-5.4",
      "--output-last-message",
      "/tmp/out.json",
      expect.stringContaining("continue"),
    ]);
  });

  it("extracts thread ids from codex json output", () => {
    expect(
      extractThreadId('{"type":"thread.started","thread_id":"abc-123"}\n{"type":"turn.completed"}'),
    ).toBe("abc-123");
  });

  it("detects explicit reset phrases", () => {
    expect(shouldResetChatSession("新しいセッションで続けて")).toBe(true);
    expect(shouldResetChatSession("このまま続けて")).toBe(false);
  });
});
