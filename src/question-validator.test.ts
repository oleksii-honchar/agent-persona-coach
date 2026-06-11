import { describe, it } from "node:test";
import { strictEqual, deepStrictEqual, ok } from "node:assert/strict";
import { validateQuestions } from "./question-validator.js";

describe("validateQuestions", () => {
  describe("passthrough — questions never truncated", () => {
    it("should pass through short questions unchanged", () => {
      const input = {
        identity: ["Who am I?"],
        rules: ["Am I following the rules?"],
        references: ["Did I check the docs?"],
        progress: ["Am I on track?"],
      };

      const result = validateQuestions(input);

      deepStrictEqual(result, input);
    });

    it("should pass through questions of exactly 80 characters unchanged", () => {
      const exactly80 = "12345678901234567890123456789012345678901234567890123456789012345678901234567890";

      const input = {
        identity: [exactly80],
        rules: [],
        references: [],
        progress: [],
      };

      const result = validateQuestions(input);

      strictEqual(result.identity[0], exactly80);
      strictEqual(result.identity[0].length, 80);
    });

    it("should pass through questions longer than 80 characters unchanged", () => {
      const longQuestion =
        "This is a very long question that definitely exceeds eighty characters and should NOT be truncated by the validator under any circumstances whatsoever.";

      const input = {
        identity: [longQuestion],
        rules: [],
        references: [],
        progress: [],
      };

      const result = validateQuestions(input);

      strictEqual(result.identity[0], longQuestion);
      strictEqual(result.identity[0].length, longQuestion.length);
      ok(longQuestion.length > 80);
    });

    it("should pass through extremely long questions (500+ chars) unchanged", () => {
      const veryLongQuestion = "x".repeat(500);

      const input = {
        identity: [veryLongQuestion],
        rules: [],
        references: [],
        progress: [],
      };

      const result = validateQuestions(input);

      strictEqual(result.identity[0], veryLongQuestion);
      strictEqual(result.identity[0].length, 500);
    });

    it("should pass through mixed long/short questions unchanged", () => {
      const longQuestion = "x".repeat(200);

      const input = {
        identity: ["Short?", longQuestion, "Also short?"],
        rules: ["Another short question"],
        references: [longQuestion],
        progress: [],
      };

      const result = validateQuestions(input);

      strictEqual(result.identity[0], "Short?");
      strictEqual(result.identity[1], longQuestion);
      strictEqual(result.identity[2], "Also short?");
      strictEqual(result.rules[0], "Another short question");
      strictEqual(result.references[0], longQuestion);
    });

    it("should pass through multi-byte (fullwidth) questions unchanged regardless of length", () => {
      const multibyte81 = "ｘ".repeat(81); // 81 fullwidth characters

      const input = {
        identity: [multibyte81],
        rules: [],
        references: [],
        progress: [],
      };

      const result = validateQuestions(input);

      strictEqual(result.identity[0], multibyte81);
      strictEqual(result.identity[0].length, 81);
    });

    it("should pass through emoji questions unchanged regardless of length", () => {
      const emoji81 = "👋".repeat(41) + "a"; // 82 JS characters

      const input = {
        identity: [emoji81],
        rules: [],
        references: [],
        progress: [],
      };

      const result = validateQuestions(input);

      strictEqual(result.identity[0], emoji81);
      strictEqual(result.identity[0].length, emoji81.length);
    });

    it("should pass through empty strings in arrays unchanged", () => {
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

  describe("structure validation — null/non-array categories replaced with empty arrays", () => {
    it("should replace null category with empty array", () => {
      const input = {
        identity: null as unknown as string[],
        rules: ["Valid question"],
        references: [],
        progress: [],
      };

      const result = validateQuestions(input);

      deepStrictEqual(result.identity, []);
      strictEqual(result.rules[0], "Valid question");
    });

    it("should replace undefined category with empty array", () => {
      const input = {
        identity: undefined as unknown as string[],
        rules: [],
        references: [],
        progress: [],
      };

      const result = validateQuestions(input);

      deepStrictEqual(result.identity, []);
    });

    it("should replace non-array category (string) with empty array", () => {
      const input = {
        identity: "not an array" as unknown as string[],
        rules: [],
        references: [],
        progress: [],
      };

      const result = validateQuestions(input);

      deepStrictEqual(result.identity, []);
    });

    it("should replace non-array category (number) with empty array", () => {
      const input = {
        identity: 42 as unknown as string[],
        rules: [],
        references: [],
        progress: [],
      };

      const result = validateQuestions(input);

      deepStrictEqual(result.identity, []);
    });

    it("should replace all null categories with empty arrays", () => {
      const input = {
        identity: null as unknown as string[],
        rules: null as unknown as string[],
        references: null as unknown as string[],
        progress: null as unknown as string[],
      };

      const result = validateQuestions(input);

      deepStrictEqual(result, {
        identity: [],
        rules: [],
        references: [],
        progress: [],
      });
    });

    it("should preserve valid empty arrays", () => {
      const input = {
        identity: [],
        rules: [],
        references: [],
        progress: [],
      };

      const result = validateQuestions(input);

      deepStrictEqual(result, input);
    });

    it("should handle mix of valid and invalid categories", () => {
      const input = {
        identity: ["Valid question"],
        rules: null as unknown as string[],
        references: ["Another valid"],
        progress: undefined as unknown as string[],
      };

      const result = validateQuestions(input);

      strictEqual(result.identity[0], "Valid question");
      deepStrictEqual(result.rules, []);
      strictEqual(result.references[0], "Another valid");
      deepStrictEqual(result.progress, []);
    });
  });

  describe("immutability", () => {
    it("should not mutate the input object", () => {
      const input = {
        identity: ["x".repeat(200)],
        rules: [],
        references: ["Short?"],
        progress: [],
      };

      const inputCopy = {
        identity: [...input.identity],
        rules: [...input.rules],
        references: [...input.references],
        progress: [...input.progress],
      };

      validateQuestions(input);

      deepStrictEqual(input, inputCopy);
    });

    it("should return a new object (not the same reference)", () => {
      const input = {
        identity: ["Who am I?"],
        rules: [],
        references: [],
        progress: [],
      };

      const result = validateQuestions(input);

      ok(result !== input);
    });

    it("should return new array references for each category", () => {
      const input = {
        identity: ["Who am I?"],
        rules: ["Am I following rules?"],
        references: [],
        progress: [],
      };

      const result = validateQuestions(input);

      ok(result.identity !== input.identity);
      ok(result.rules !== input.rules);
      ok(result.references !== input.references);
      ok(result.progress !== input.progress);
    });
  });

  describe("no logging side effects", () => {
    it("should not produce any warning logs for long questions", () => {
      // Capture stderr to verify no WARN output
      const captured: string[] = [];
      const originalWrite = process.stderr.write.bind(process.stderr);
      process.stderr.write = (chunk: string | Buffer) => {
        const text = typeof chunk === "string" ? chunk : chunk.toString();
        for (const line of text.split("\n").filter(Boolean)) {
          captured.push(line);
        }
        return originalWrite(chunk);
      };

      try {
        validateQuestions({
          identity: ["x".repeat(200)],
          rules: ["x".repeat(300)],
          references: [],
          progress: [],
        });

        const warnings = captured.filter((c) => /WARN/.test(c));
        strictEqual(warnings.length, 0);
      } finally {
        process.stderr.write = originalWrite;
      }
    });
  });
});
