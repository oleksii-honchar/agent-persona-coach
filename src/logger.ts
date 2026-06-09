/**
 * Lightweight structured logger for the persona-coach plugin.
 *
 * Writes to stderr so output bypasses the TUI and goes to the
 * standard log pipe (opencode's log file captures stderr when
 * print: false, which is the default).
 *
 * Uses the same structured format as @opencode-ai/core/util/log
 * so the log file remains parseable.
 */

const SERVICE = "persona-coach";

type Level = "DEBUG" | "INFO" | "WARN" | "ERROR";

const levelPriority: Record<Level, number> = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
};

let currentLevel: Level = "INFO";

export function setLevel(level: Level): void {
  currentLevel = level;
}

function shouldLog(level: Level): boolean {
  return levelPriority[level] >= levelPriority[currentLevel];
}

function format(
  level: Level,
  message: string,
  extra?: Record<string, unknown>
): string {
  const now = new Date();
  const timestamp = now.toISOString().split(".")[0];

  const tags: string[] = [];
  if (extra) {
    for (const [key, value] of Object.entries(extra)) {
      if (value === undefined || value === null) continue;
      if (value instanceof Error) {
        tags.push(`${key}=${value.message}`);
      } else if (typeof value === "object") {
        tags.push(`${key}=${JSON.stringify(value)}`);
      } else {
        tags.push(`${key}=${value}`);
      }
    }
  }

  const paddedLevel =
    level === "INFO" ? "INFO  " : level === "WARN" ? "WARN  " : level;

  const parts = [paddedLevel, timestamp];
  if (tags.length > 0) parts.push(tags.join(" "));
  parts.push(message);

  return parts.join(" ") + "\n";
}

function write(level: Level, message: string, extra?: Record<string, unknown>): void {
  if (!shouldLog(level)) return;
  process.stderr.write(format(level, message, extra));
}

/**
 * Structured logger instance for the persona-coach plugin.
 * Writes to stderr so opencode routes it to the log file, not the TUI.
 */
export const log = {
  debug(message: string, extra?: Record<string, unknown>): void {
    write("DEBUG", message, extra);
  },
  info(message: string, extra?: Record<string, unknown>): void {
    write("INFO", message, extra);
  },
  warn(message: string, extra?: Record<string, unknown>): void {
    write("WARN", message, extra);
  },
  error(message: string, extra?: Record<string, unknown>): void {
    write("ERROR", message, extra);
  },
};
