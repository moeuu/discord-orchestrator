import fs from "node:fs";

export type CodexTargetTransport = "local" | "bridge";

export type CodexTarget = {
  id: string;
  displayName: string;
  transport: CodexTargetTransport;
  bridgeBaseUrl?: string;
  sshHost?: string;
  sshUser?: string;
  workspaceRoot?: string;
  codexBin?: string;
  aliases: string[];
};

export function loadCodexTargets(configPath: string): CodexTarget[] {
  const raw = fs.readFileSync(configPath, "utf8");
  return parseCodexTargets(raw);
}

export function parseCodexTargets(raw: string): CodexTarget[] {
  const records: Array<Record<string, string | string[]>> = [];
  const lines = raw.split(/\r?\n/);
  let inTargets = false;
  let current: Record<string, string | string[]> | null = null;

  for (const rawLine of lines) {
    const sanitized = stripComment(rawLine);
    if (!sanitized.trim()) {
      continue;
    }

    if (!inTargets) {
      if (sanitized.trim() === "targets:") {
        inTargets = true;
        continue;
      }

      continue;
    }

    const trimmed = sanitized.trim();
    if (trimmed.startsWith("- ")) {
      if (current) {
        records.push(current);
      }

      current = {};
      parseKeyValue(trimmed.slice(2), current);
      continue;
    }

    if (!current) {
      throw new Error("Invalid targets config: missing target list item");
    }

    parseKeyValue(trimmed, current);
  }

  if (current) {
    records.push(current);
  }

  return records.map(normalizeTarget);
}

export function resolveCodexTarget(
  targets: CodexTarget[],
  value: string | null | undefined,
): CodexTarget | null {
  if (!value) {
    return null;
  }

  const normalized = normalizeAlias(value);
  return targets.find((target) =>
    target.id === normalized || target.aliases.includes(normalized)
  ) ?? null;
}

function normalizeTarget(record: Record<string, string | string[]>): CodexTarget {
  const id = String(record.id ?? record.name ?? "").trim().toLowerCase();
  if (!id) {
    throw new Error("Invalid targets config: target id is required");
  }

  const rawTransport = String(record.transport ?? record.type ?? "local")
    .trim()
    .toLowerCase();
  const transport: CodexTargetTransport =
    rawTransport === "bridge" || rawTransport === "ssh"
      ? "bridge"
      : "local";

  const displayName = String(record.displayName ?? record.display_name ?? id).trim();
  const aliases = new Set<string>([id]);
  const rawAliases = record.aliases;
  if (Array.isArray(rawAliases)) {
    for (const alias of rawAliases) {
      aliases.add(normalizeAlias(alias));
    }
  } else if (typeof rawAliases === "string" && rawAliases.trim()) {
    aliases.add(normalizeAlias(rawAliases));
  }

  return {
    id,
    displayName,
    transport,
    bridgeBaseUrl: readString(record.bridgeBaseUrl),
    sshHost: readString(record.sshHost),
    sshUser: readString(record.sshUser),
    workspaceRoot: readString(record.workspaceRoot),
    codexBin: readString(record.codexBin),
    aliases: [...aliases].filter(Boolean),
  };
}

function parseKeyValue(
  line: string,
  target: Record<string, string | string[]>,
): void {
  const separator = line.indexOf(":");
  if (separator === -1) {
    throw new Error(`Invalid targets config line: ${line}`);
  }

  const key = line.slice(0, separator).trim();
  const rawValue = line.slice(separator + 1).trim();
  target[key] = parseScalar(rawValue);
}

function parseScalar(value: string): string | string[] {
  if (!value) {
    return "";
  }

  if (value.startsWith("[") && value.endsWith("]")) {
    return value
      .slice(1, -1)
      .split(",")
      .map((entry) => unquote(entry.trim()))
      .filter(Boolean);
  }

  return unquote(value);
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}

function stripComment(value: string): string {
  const hashIndex = value.indexOf("#");
  return hashIndex === -1 ? value : value.slice(0, hashIndex);
}

function normalizeAlias(value: string): string {
  return value.trim().toLowerCase();
}

function readString(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
