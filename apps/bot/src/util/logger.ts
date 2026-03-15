export type LogLevel = "debug" | "info" | "warn" | "error";

export type Logger = {
  debug(message: string, meta?: unknown): void;
  info(message: string, meta?: unknown): void;
  warn(message: string, meta?: unknown): void;
  error(message: string, meta?: unknown): void;
};

const levelOrder: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export function createLogger(level: LogLevel): Logger {
  function write(target: LogLevel, message: string, meta?: unknown): void {
    if (levelOrder[target] < levelOrder[level]) {
      return;
    }

    const line = {
      level: target,
      message,
      meta,
      timestamp: new Date().toISOString(),
    };

    console.log(JSON.stringify(line));
  }

  return {
    debug: (message, meta) => write("debug", message, meta),
    info: (message, meta) => write("info", message, meta),
    warn: (message, meta) => write("warn", message, meta),
    error: (message, meta) => write("error", message, meta),
  };
}

