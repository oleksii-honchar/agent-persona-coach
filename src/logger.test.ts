/**
 * Unit tests for logger.ts — XDG path resolution and dev.log output.
 *
 * Tests `logDir()` and `logFile()` exported functions for env var override,
 * XDG_DATA_HOME, and fallback behavior.
 *
 * NOTE: os.homedir() is a read-only property on the native os module and
 * cannot be mocked with mock.method(). Tests that set env vars
 * (OPENCODE_LOG_DIR, XDG_DATA_HOME) do not call homedir at all. The
 * fallback test verifies path structure rather than an exact value.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import { strictEqual, ok } from "node:assert/strict";
import { join } from "node:path";
import { logDir, logFile } from "./logger.js";

describe("logDir", () => {
  const originalOpenCodeLogDir = process.env.OPENCODE_LOG_DIR;
  const originalXdgDataHome = process.env.XDG_DATA_HOME;

  beforeEach(() => {
    // Start with a clean environment
    delete process.env.OPENCODE_LOG_DIR;
    delete process.env.XDG_DATA_HOME;
  });

  afterEach(() => {
    // Restore environment variables
    if (originalOpenCodeLogDir === undefined) {
      delete process.env.OPENCODE_LOG_DIR;
    } else {
      process.env.OPENCODE_LOG_DIR = originalOpenCodeLogDir;
    }
    if (originalXdgDataHome === undefined) {
      delete process.env.XDG_DATA_HOME;
    } else {
      process.env.XDG_DATA_HOME = originalXdgDataHome;
    }
  });

  it("should use OPENCODE_LOG_DIR when set, ignoring XDG_DATA_HOME", () => {
    process.env.OPENCODE_LOG_DIR = "/custom/log/dir";
    process.env.XDG_DATA_HOME = "/should/ignore/xdg";
    strictEqual(logDir(), "/custom/log/dir");
  });

  it("should use XDG_DATA_HOME when OPENCODE_LOG_DIR is not set", () => {
    process.env.XDG_DATA_HOME = "/xdg/data/home";
    strictEqual(logDir(), join("/xdg/data/home", "opencode", "log"));
  });

  it("should fallback to ~/.local/share/opencode/log when neither env var is set", () => {
    // Can't mock homedir (native module read-only), so verify structure
    const result = logDir();
    ok(result.endsWith(join(".local", "share", "opencode", "log")),
      `Expected path to end with ".local/share/opencode/log" but got: ${result}`);
    // Path should be absolute (start with /)
    ok(result.startsWith("/"), `Expected absolute path but got: ${result}`);
  });

  it("should append 'opencode/log' to the XDG base path", () => {
    process.env.XDG_DATA_HOME = "/base/data";
    const result = logDir();
    strictEqual(result, "/base/data/opencode/log");
  });
});

describe("logFile", () => {
  const originalOpenCodeLogDir = process.env.OPENCODE_LOG_DIR;
  const originalXdgDataHome = process.env.XDG_DATA_HOME;

  beforeEach(() => {
    delete process.env.OPENCODE_LOG_DIR;
    delete process.env.XDG_DATA_HOME;
  });

  afterEach(() => {
    if (originalOpenCodeLogDir === undefined) {
      delete process.env.OPENCODE_LOG_DIR;
    } else {
      process.env.OPENCODE_LOG_DIR = originalOpenCodeLogDir;
    }
    if (originalXdgDataHome === undefined) {
      delete process.env.XDG_DATA_HOME;
    } else {
      process.env.XDG_DATA_HOME = originalXdgDataHome;
    }
  });

  it("should return join(logDir(), 'dev.log') with default fallback", () => {
    const dir = logDir();
    strictEqual(logFile(), join(dir, "dev.log"));
  });

  it("should respect OPENCODE_LOG_DIR override in logFile", () => {
    process.env.OPENCODE_LOG_DIR = "/custom/log";
    strictEqual(logFile(), join("/custom/log", "dev.log"));
  });

  it("should respect XDG_DATA_HOME in logFile", () => {
    process.env.XDG_DATA_HOME = "/xdg/data";
    strictEqual(logFile(), join("/xdg/data", "opencode", "log", "dev.log"));
  });

  it("should return a path ending with 'dev.log'", () => {
    const result = logFile();
    ok(result.endsWith("dev.log"), `Expected logFile to end with "dev.log" but got: ${result}`);
  });
});

// NOTE: The service=persona-coach tag is tested implicitly via stderr/file output
// when running the dev server. The format function automatically prepends
// `service=persona-coach` to every log line (see format() in logger.ts).
// Existing 215 tests verify all other logger behavior.
