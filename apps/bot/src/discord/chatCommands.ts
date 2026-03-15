export function extractChatShellCommand(
  content: string,
  botUserId?: string,
): string | null {
  const normalized = stripMention(content, botUserId).trim();
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

  return null;
}

function stripMention(content: string, botUserId?: string): string {
  if (!botUserId) {
    return content;
  }

  return content
    .replace(new RegExp(`<@!?${escapeRegExp(botUserId)}>`, "g"), "")
    .trim();
}

function matchFirst(content: string, pattern: RegExp): string | null {
  const match = content.match(pattern);
  return match?.[1]?.trim() || null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
