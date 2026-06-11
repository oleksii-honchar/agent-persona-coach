/**
 * Structured logger for the persona-coach plugin.
 *
 * Writes to the opencode log file so logs appear in `--server-logs`
 * output, not in the TUI. Uses the same format as
 * @opencode-ai/core/util/log so the log file remains parseable.
 *
 * The log directory follows XDG Base Directory conventions:
 *   1. $OPENCODE_LOG_DIR (override for testing / debugging)
 *   2. $XDG_DATA_HOME + "/opencode/log"
 *   3. ~/.local/share/opencode/log (XDG fallback)
 * The log file is always dev.log.
 */

import { createWriteStream } from "node:fs";
import { mkdir, access } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

const SERVICE = "persona-coach";

type Level = "DEBUG" | "INFO" | "WARN" | "ERROR";

const levelPriority: Record<Level, number> = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
};

/**
 * Resolve the initial log level from the environment.
 *
 * OPENCODE_LOG_LEVEL — align with opencode's --log-level setting.
 * Falls back to INFO (matching production default).
 */
export function resolveInitialLevel(): Level {
  const envLevel = process.env.OPENCODE_LOG_LEVEL?.toUpperCase();
  if (envLevel && envLevel in levelPriority) {
    return envLevel as Level;
  }
  return "INFO";
}

let currentLevel: Level = resolveInitialLevel();

export function setLevel(level: Level): void {
  currentLevel = level;
}

function shouldLog(level: Level): boolean {
  return levelPriority[level] >= levelPriority[currentLevel];
}

/**
 * Resolve the opencode log directory using XDG Base Directory conventions.
 *
 * Resolution order:
 *   1. $OPENCODE_LOG_DIR — explicit override (primarily for testing)
 *   2. $XDG_DATA_HOME + "/opencode/log" — XDG standard
 *   3. $HOME/.local/share/opencode/log — XDG fallback
 *
 * This matches the path from @opencode-ai/core/src/global.ts:
 *   log: path.join(xdgData, "opencode", "log")
 */
export function logDir(): string {
  const envDir = process.env.OPENCODE_LOG_DIR;
  if (envDir) return envDir;

  const xdgData = process.env.XDG_DATA_HOME || join(homedir(), ".local", "share");
  return join(xdgData, "opencode", "log");
}

/**
 * Resolve the current log file path.
 *
 * Always returns `dev.log` inside the log directory. The dev server
 * (started via start-dev.sh) tails dev.log for --server-logs output.
 */
export function logFile(): string {
  return join(logDir(), "dev.log");
}

let stream: ReturnType<typeof createWriteStream> | null = null;
let initPromise: Promise<void> | null = null;

async function ensureStream(): Promise<void> {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const dir = logDir();
    try {
      await access(dir);
    } catch {
      await mkdir(dir, { recursive: true });
    }
    stream = createWriteStream(logFile(), { flags: "a" });
  })();
  return initPromise;
}

function format(
  level: Level,
  message: string,
  extra?: Record<string, unknown>
): string {
  const now = new Date();
  const timestamp = now.toISOString().split(".")[0];

  const tags: string[] = [];
  // Always include the service tag so every log line is filterable
  tags.push(`service=${SERVICE}`);
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
  const line = format(level, message, extra);

  // Best-effort: if the stream isn't ready yet, write to stderr as fallback
  if (stream) {
    stream.write(line);
  } else {
    // Stream not ready yet (first call before init), write to stderr
    process.stderr.write(line);
    // Start the stream in the background
    void ensureStream();
  }
}

/**
 * Structured logger instance for the persona-coach plugin.
 * Writes to the opencode log file so logs appear in `--server-logs`.
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
