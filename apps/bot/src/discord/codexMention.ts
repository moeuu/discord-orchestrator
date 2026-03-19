import type { CodexTarget } from "../targets.js";
import { resolveCodexTarget } from "../targets.js";

export type MentionCodexRequest = {
  targetId: string;
  prompt: string;
};

export function stripBotMention(
  content: string,
  botUserId?: string,
  botRoleIds: string[] = [],
): string {
  let normalized = content;

  if (botUserId) {
    normalized = normalized.replace(
      new RegExp(`<@!?${escapeRegExp(botUserId)}>`, "g"),
      "",
    );
  }

  for (const roleId of botRoleIds) {
    normalized = normalized.replace(
      new RegExp(`<@&${escapeRegExp(roleId)}>`, "g"),
      "",
    );
  }

  return normalized.trim();
}

export function extractMentionCodexRequest(
  content: string,
  targets: CodexTarget[],
  defaultTargetId: string,
  botUserId?: string,
  botRoleIds: string[] = [],
  options: {
    fallbackToDefault?: boolean;
  } = {},
): MentionCodexRequest | null {
  const stripped = stripBotMention(content, botUserId, botRoleIds);
  if (!stripped) {
    return null;
  }

  const explicit =
    matchExplicitTarget(stripped, targets) ??
    matchJapaneseTarget(stripped, targets);
  if (explicit) {
    return explicit;
  }

  if (options.fallbackToDefault) {
    return {
      targetId: defaultTargetId,
      prompt: stripped,
    };
  }

  return null;
}

function matchExplicitTarget(
  prompt: string,
  targets: CodexTarget[],
): MentionCodexRequest | null {
  const direct = prompt.match(/^([A-Za-z0-9_-]+)\s*:\s*([\s\S]+)$/);
  if (direct) {
    const target = resolveCodexTarget(targets, direct[1]);
    if (target) {
      return { targetId: target.id, prompt: direct[2].trim() };
    }
  }

  const onTarget = prompt.match(/^on\s+([A-Za-z0-9_-]+)\s+([\s\S]+)$/i);
  if (onTarget) {
    const target = resolveCodexTarget(targets, onTarget[1]);
    if (target) {
      return { targetId: target.id, prompt: onTarget[2].trim() };
    }
  }

  return null;
}

function matchJapaneseTarget(
  prompt: string,
  targets: CodexTarget[],
): MentionCodexRequest | null {
  for (const target of targets) {
    for (const alias of target.aliases) {
      const pattern = new RegExp(`^${escapeRegExp(alias)}で\\s*([\\s\\S]+)$`, "i");
      const matched = prompt.match(pattern);
      if (matched) {
        return {
          targetId: target.id,
          prompt: matched[1].trim(),
        };
      }
    }
  }

  return null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
