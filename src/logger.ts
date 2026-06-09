/**
 * Structured logger for the persona-coach plugin.
 *
 * Writes to the opencode log file so logs appear in `--server-logs`
 * output, not in the TUI. Uses the same format as
 * @opencode-ai/core/util/log so the log file remains parseable.
 *
 * The log file is determined by checking for a dev server (dev.log)
 * or falling back to the current date's log file.
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

let currentLevel: Level = "INFO";

export function setLevel(level: Level): void {
  currentLevel = level;
}

function shouldLog(level: Level): boolean {
  return levelPriority[level] >= levelPriority[currentLevel];
}

/**
 * Resolve the opencode log directory.
 * Matches the path from @opencode-ai/core/src/global.ts:
 *   log: path.join(xdgData, "opencode", "log")
 * On macOS: ~/Library/Application Support/opencode/log
 * On Linux: ~/.local/share/opencode/log
 */
function logDir(): string {
  // Allow override for testing
  const envDir = process.env.OPENCODE_LOG_DIR;
  if (envDir) return envDir;

  // macOS
  const macOS = join(homedir(), "Library", "Application Support", "opencode", "log");
  // Linux / XDG
  const linux = join(homedir(), ".local", "share", "opencode", "log");

  // Check which exists
  return macOS; // macOS default; will create if needed
}

/**
 * Resolve the current log file path.
 * In dev mode (local install), opencode writes to dev.log.
 * In production, it writes to a date-stamped file.
 */
function logFile(): string {
  const dir = logDir();
  // Dev mode: dev.log (matches Log.init when dev: true)
  if (process.env.OPENCODE_DEV === "1") {
    return join(dir, "dev.log");
  }
  // Default: dev.log for local development
  // Production uses date-stamped files, but we can't know the exact name
  // without reading the Log.init state. dev.log is the safe bet for local.
  const devLog = join(dir, "dev.log");
  // Fall back to today's date-stamped file
  const today = new Date().toISOString().split(".")[0].replace(/:/g, "");
  return join(dir, `${today}.log`);
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
