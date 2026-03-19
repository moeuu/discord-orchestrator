export function extractChatShellCommand(
  content: string,
  botUserId?: string,
  botRoleIds: string[] = [],
): string | null {
  const normalized = stripMention(content, botUserId, botRoleIds).trim();
  if (!normalized || !normalized.includes("実行")) {
    return null;
  }

  const fenced = matchFirst(normalized, /```(?:sh|bash|zsh|shell)?\n([\s\S]+?)```/i);
  if (fenced) {
    return fenced;
  }

  const backtick = matchFirst(normalized, /`([^`\n]+)`/);
  if (backtick) {
    return backtick;
  }

  const japaneseQuote = matchFirst(
    normalized,
    /「([^」]+)」(?:っていう)?(?:コマンド)?を実行して/,
  );
  if (japaneseQuote) {
    return japaneseQuote;
  }

  const doubleQuote = matchFirst(
    normalized,
    /"([^"\n]+)"(?:\s*っていう)?(?:\s*コマンド)?を実行して/,
  );
  if (doubleQuote) {
    return doubleQuote;
  }

  const plainText = matchFirst(
    normalized,
    /^(.+?)(?:\s*っていう)?(?:\s*コマンド)?を実行して[。.!！?？]*$/s,
  );
  if (plainText) {
    return plainText;
  }

  return null;
}

function stripMention(
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

function matchFirst(content: string, pattern: RegExp): string | null {
  const match = content.match(pattern);
  return match?.[1]?.trim() || null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
