import fs from "node:fs/promises";
import path from "node:path";

type ChatSessionRecord = {
  key: string;
  threadId: string;
  updatedAt: string;
};

export type ChatSessionStore = {
  get(key: string): Promise<ChatSessionRecord | null>;
  set(key: string, threadId: string): Promise<ChatSessionRecord>;
  clear(key: string): Promise<void>;
};

export function createChatSessionStore(dataDir: string): ChatSessionStore {
  const sessionsFile = path.join(dataDir, "chat-sessions.json");
  let operationChain = Promise.resolve();

  async function ensureStore(): Promise<void> {
    await fs.mkdir(dataDir, { recursive: true });

    try {
      await fs.access(sessionsFile);
    } catch {
      await fs.writeFile(sessionsFile, "{}\n", "utf8");
    }
  }

  async function readSessions(): Promise<Record<string, ChatSessionRecord>> {
    await ensureStore();
    const raw = await fs.readFile(sessionsFile, "utf8");

    if (!raw.trim()) {
      return {};
    }

    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`Invalid chat session store format: ${sessionsFile}`);
    }

    return parsed as Record<string, ChatSessionRecord>;
  }

  async function writeSessions(
    sessions: Record<string, ChatSessionRecord>,
  ): Promise<void> {
    await ensureStore();
    const tempFile = `${sessionsFile}.tmp`;
    await fs.writeFile(tempFile, `${JSON.stringify(sessions, null, 2)}\n`, "utf8");
    await fs.rename(tempFile, sessionsFile);
  }

  async function runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const next = operationChain.then(operation, operation);
    operationChain = next.then(
      () => undefined,
      () => undefined,
    );
    return await next;
  }

  return {
    async get(key) {
      return await runExclusive(async () => {
        const sessions = await readSessions();
        return sessions[key] ?? null;
      });
    },
    async set(key, threadId) {
      return await runExclusive(async () => {
        const sessions = await readSessions();
        const record: ChatSessionRecord = {
          key,
          threadId,
          updatedAt: new Date().toISOString(),
        };
        sessions[key] = record;
        await writeSessions(sessions);
        return record;
      });
    },
    async clear(key) {
      return await runExclusive(async () => {
        const sessions = await readSessions();
        delete sessions[key];
        await writeSessions(sessions);
      });
    },
  };
}
