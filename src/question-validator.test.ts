import { describe, it, beforeEach, afterEach } from "node:test";
import { strictEqual, deepStrictEqual, ok } from "node:assert/strict";
import { validateQuestions } from "./question-validator.js";

interface LoggerCall {
  message: string;
}

function captureConsoleWarn(): { calls: LoggerCall[]; restore: () => void } {
  const calls: LoggerCall[] = [];
  const original = console.warn;
  console.warn = (message: string) => {
    calls.push({ message });
  };
  return {
    calls,
    restore: () => {
      console.warn = original;
    },
  };
}

const EXACTLY_80_CHARS = "12345678901234567890123456789012345678901234567890123456789012345678901234567890";
const EIGHTY_ONE_CHARS = EXACTLY_80_CHARS + "1";
const TRUNCATED_80 = EXACTLY_80_CHARS.slice(0, 79) + "\u2026"; // 79 chars + "…" = 80 chars
const SHORT_QUESTION = "Who am I?";
const MULTIBYTE_80 = "ｘ".repeat(80); // fullwidth x (U+FF58) — 80 chars
const MULTIBYTE_81 = MULTIBYTE_80 + "ｘ"; // 81 chars

describe("validateQuestions", () => {
  let logger: ReturnType<typeof captureConsoleWarn>;

  beforeEach(() => {
    logger = captureConsoleWarn();
  });

  afterEach(() => {
    logger.restore();
  });

  describe("truncation", () => {
    it("should truncate questions exceeding 80 characters with '…' suffix", () => {
      const input = {
        identity: [EIGHTY_ONE_CHARS],
        rules: [],
        references: [],
        progress: [],
      };

      const result = validateQuestions(input);

      strictEqual(result.identity.length, 1);
      strictEqual(result.identity[0].length, 80);
      strictEqual(result.identity[0], TRUNCATED_80);
      ok(result.identity[0].endsWith("\u2026"));
    });

    it("should pass through questions of exactly 80 characters unchanged", () => {
      const input = {
        identity: [EXACTLY_80_CHARS],
        rules: [],
        references: [],
        progress: [],
      };

      const result = validateQuestions(input);

      strictEqual(result.identity.length, 1);
      strictEqual(result.identity[0], EXACTLY_80_CHARS);
    });

    it("should pass through questions under 80 characters unchanged", () => {
      const input = {
        identity: [SHORT_QUESTION],
        rules: ["Am I following the rules?"],
        references: ["Did I check the docs?"],
        progress: ["Am I on track?"],
      };

      const result = validateQuestions(input);

      deepStrictEqual(result, input);
    });

    it("should truncate only the questions that exceed 80 chars in a mixed array", () => {
      const input = {
        identity: [SHORT_QUESTION, EIGHTY_ONE_CHARS, "Also short?"],
        rules: [SHORT_QUESTION],
        references: [EIGHTY_ONE_CHARS],
        progress: [],
      };

      const result = validateQuestions(input);

      strictEqual(result.identity.length, 3);
      strictEqual(result.identity[0], SHORT_QUESTION);
      strictEqual(result.identity[1], TRUNCATED_80);
      strictEqual(result.identity[2], "Also short?");
      strictEqual(result.rules[0], SHORT_QUESTION);
      strictEqual(result.references[0], TRUNCATED_80);
    });

    it("should handle exactly 80-char boundary precisely (80 passes, 81 truncates)", () => {
      const input = {
        identity: [EXACTLY_80_CHARS, EIGHTY_ONE_CHARS],
        rules: [],
        references: [],
        progress: [],
      };

      const result = validateQuestions(input);

      strictEqual(result.identity[0], EXACTLY_80_CHARS);
      strictEqual(result.identity[0].length, 80);
      strictEqual(result.identity[1], TRUNCATED_80);
      strictEqual(result.identity[1].length, 80);
    });
  });

  describe("empty arrays", () => {
    it("should preserve completely empty categories", () => {
      const input = {
        identity: [],
        rules: [],
        references: [],
        progress: [],
      };

      const result = validateQuestions(input);

      deepStrictEqual(result, input);
    });

    it("should preserve some empty and some populated categories", () => {
      const input = {
        identity: [SHORT_QUESTION],
        rules: [],
        references: [],
        progress: [SHORT_QUESTION],
      };

      const result = validateQuestions(input);

      strictEqual(result.identity.length, 1);
      strictEqual(result.rules.length, 0);
      strictEqual(result.references.length, 0);
      strictEqual(result.progress.length, 1);
    });

    it("should preserve empty strings in arrays (treat as valid under-80)", () => {
      const input = {
        identity: [""],
        rules: [],
        references: [],
        progress: [],
      };

      const result = validateQuestions(input);

      deepStrictEqual(result.identity, [""]);
      deepStrictEqual(result.rules, []);
    });
  });

  describe("warning logging", () => {
    it("should log a warning when a question is truncated", () => {
      validateQuestions({
        identity: [EIGHTY_ONE_CHARS],
        rules: [],
        references: [],
        progress: [],
      });

      ok(logger.calls.length >= 1);
      ok(logger.calls.some((c) => c.message.includes("[persona-coach]")));
      ok(logger.calls.some((c) => /truncated/i.test(c.message)));
    });

    it("should log a single warning with the count of truncated questions", () => {
      validateQuestions({
        identity: [EIGHTY_ONE_CHARS, EIGHTY_ONE_CHARS],
        rules: [EIGHTY_ONE_CHARS],
        references: [],
        progress: [EIGHTY_ONE_CHARS],
      });

      const truncationWarnings = logger.calls.filter(
        (c) => /truncated/i.test(c.message)
      );
      strictEqual(truncationWarnings.length, 1);
      ok(truncationWarnings[0].message.includes("4"));
    });

    it("should NOT log a warning when no truncation occurs", () => {
      validateQuestions({
        identity: [SHORT_QUESTION],
        rules: [],
        references: [],
        progress: [],
      });

      const truncationWarnings = logger.calls.filter(
        (c) => /truncated/i.test(c.message)
      );
      strictEqual(truncationWarnings.length, 0);
    });
  });

  describe("multi-byte characters", () => {
    it("should handle full-width characters (count by character, not byte)", () => {
      // 80 fullwidth characters — should pass through
      const input = {
        identity: [MULTIBYTE_80],
        rules: [],
        references: [],
        progress: [],
      };

      const result = validateQuestions(input);

      strictEqual(result.identity[0], MULTIBYTE_80);
      strictEqual(result.identity[0].length, 80);
    });

    it("should truncate full-width characters at the 80-char boundary", () => {
      // 81 fullwidth characters — should truncate
      const input = {
        identity: [MULTIBYTE_81],
        rules: [],
        references: [],
        progress: [],
      };

      const result = validateQuestions(input);

      strictEqual(result.identity[0].length, 80);
      ok(result.identity[0].endsWith("\u2026"));
    });

    it("should handle emoji (multi-codepoint) at boundary correctly", () => {
      // Emoji like 👋 take 2 JS chars (surrogate pair), but length still counts correctly
      const base = "👋".repeat(40); // 80 JS characters
      const over = base + "a"; // 81 JS characters

      const result = validateQuestions({
        identity: [base, over],
        rules: [],
        references: [],
        progress: [],
      });

      strictEqual(result.identity[0], base);
      strictEqual(result.identity[0].length, 80);
      strictEqual(result.identity[1].length, 80);
      ok(result.identity[1].endsWith("\u2026"));
    });
  });

  describe("immutability", () => {
    it("should not mutate the input object", () => {
      const input = {
        identity: [EIGHTY_ONE_CHARS],
        rules: [],
        references: [SHORT_QUESTION],
        progress: [],
      };

      const inputCopy = {
        identity: [...input.identity],
        rules: [...input.rules],
        references: [...input.references],
        progress: [...input.progress],
      };

      validateQuestions(input);

      // Input should be unchanged
      deepStrictEqual(input, inputCopy);
    });

    it("should return a new object (not the same reference)", () => {
      const input = {
        identity: [SHORT_QUESTION],
        rules: [],
        references: [],
        progress: [],
      };

      const result = validateQuestions(input);

      ok(result !== input);
    });
  });
});
