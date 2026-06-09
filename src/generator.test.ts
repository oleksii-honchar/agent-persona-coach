import { describe, it, beforeEach, afterEach } from "node:test";
import { strictEqual, ok, deepStrictEqual } from "node:assert/strict";
import { CoachGenerator } from "./generator.js";
import { aMockChatClient } from "./test-utils.js";

const VALID_JSON_RESPONSE = JSON.stringify({
  identity: ["Who am I?"],
  rules: ["Am I following the rules?"],
  references: ["Did I check the docs?"],
  progress: ["Am I on track?"],
});

const MARKDOWN_WRAPPED_JSON = `\`\`\`json
${VALID_JSON_RESPONSE}
\`\`\``;

const MARKDOWN_WRAPPED_JSON_NO_LANG = `\`\`\`
${VALID_JSON_RESPONSE}
\`\`\``;

const INVALID_JSON_RESPONSE = "not valid json {{{";

const EMPTY_PERSONA = "";
const WHITESPACE_PERSONA = "   \n  ";

describe("CoachGenerator", () => {
  let generator: CoachGenerator;
  let mockClient: ReturnType<typeof aMockChatClient>;

  beforeEach(() => {
    mockClient = aMockChatClient(VALID_JSON_RESPONSE);
    generator = new CoachGenerator(mockClient);
  });

  describe("generate with valid JSON", () => {
    it("should return parsed questions on successful generation", async () => {
      const result = await generator.generate("test-agent", "You are a helper.");

      strictEqual(result.agentName, "test-agent");
      ok(result.personaHash.length > 0);
      deepStrictEqual(result.questions.identity, ["Who am I?"]);
      deepStrictEqual(result.questions.rules, ["Am I following the rules?"]);
      deepStrictEqual(result.questions.references, ["Did I check the docs?"]);
      deepStrictEqual(result.questions.progress, ["Am I on track?"]);
      ok(result.generatedAt.length > 0);
    });

    it("should call the chat client with correct model and prompt", async () => {
      await generator.generate("test-agent", "You are a helper.");

      strictEqual(mockClient.calls.length, 1);
      strictEqual(mockClient.calls[0].model, "default");
      strictEqual(mockClient.calls[0].messages.length, 1);
      strictEqual(mockClient.calls[0].messages[0].role, "user");
      ok(mockClient.calls[0].messages[0].content.includes("You are a helper."));
    });

    it("should fill missing categories with empty arrays", async () => {
      mockClient = aMockChatClient(JSON.stringify({ identity: ["Who am I?"] }));
      generator = new CoachGenerator(mockClient);

      const result = await generator.generate("test-agent", "You are a helper.");

      deepStrictEqual(result.questions.identity, ["Who am I?"]);
      deepStrictEqual(result.questions.rules, []);
      deepStrictEqual(result.questions.references, []);
      deepStrictEqual(result.questions.progress, []);
    });
  });

  describe("generate with markdown-wrapped JSON", () => {
    it("should extract JSON from ```json ... ``` blocks", async () => {
      mockClient = aMockChatClient(MARKDOWN_WRAPPED_JSON);
      generator = new CoachGenerator(mockClient);

      const result = await generator.generate("test-agent", "You are a helper.");

      deepStrictEqual(result.questions.identity, ["Who am I?"]);
      deepStrictEqual(result.questions.rules, ["Am I following the rules?"]);
    });

    it("should extract JSON from ``` ... ``` blocks without language specifier", async () => {
      mockClient = aMockChatClient(MARKDOWN_WRAPPED_JSON_NO_LANG);
      generator = new CoachGenerator(mockClient);

      const result = await generator.generate("test-agent", "You are a helper.");

      deepStrictEqual(result.questions.identity, ["Who am I?"]);
    });

    it("should handle JSON with surrounding text before and after code block", async () => {
      const responseWithText = `Here are the questions:

\`\`\`json
${VALID_JSON_RESPONSE}
\`\`\`

Hope this helps!`;

      mockClient = aMockChatClient(responseWithText);
      generator = new CoachGenerator(mockClient);

      const result = await generator.generate("test-agent", "You are a helper.");

      deepStrictEqual(result.questions.identity, ["Who am I?"]);
    });
  });

  describe("generate with invalid JSON fallback", () => {
    it("should return empty questions when JSON parse fails", async () => {
      mockClient = aMockChatClient(INVALID_JSON_RESPONSE);
      generator = new CoachGenerator(mockClient);

      const result = await generator.generate("test-agent", "You are a helper.");

      strictEqual(result.agentName, "test-agent");
      ok(result.personaHash.length > 0);
      deepStrictEqual(result.questions.identity, []);
      deepStrictEqual(result.questions.rules, []);
      deepStrictEqual(result.questions.references, []);
      deepStrictEqual(result.questions.progress, []);
    });

    it("should not crash when JSON parse fails (graceful fallback)", async () => {
      mockClient = aMockChatClient("undefined");
      generator = new CoachGenerator(mockClient);

      // Should not throw
      const result = await generator.generate("test-agent", "You are a helper.");
      ok(result !== undefined);
      deepStrictEqual(result.questions.identity, []);
    });
  });

  describe("generate with empty persona text", () => {
    it("should return empty questions for empty string", async () => {
      const result = await generator.generate("test-agent", EMPTY_PERSONA);

      strictEqual(result.agentName, "test-agent");
      ok(result.personaHash.length > 0);
      deepStrictEqual(result.questions.identity, []);
      deepStrictEqual(result.questions.rules, []);
      deepStrictEqual(result.questions.references, []);
      deepStrictEqual(result.questions.progress, []);
    });

    it("should return empty questions for whitespace-only persona", async () => {
      const result = await generator.generate("test-agent", WHITESPACE_PERSONA);

      deepStrictEqual(result.questions.identity, []);
      deepStrictEqual(result.questions.rules, []);
    });

    it("should not call the chat client when persona is empty", async () => {
      await generator.generate("test-agent", EMPTY_PERSONA);

      strictEqual(mockClient.calls.length, 0);
    });
  });

  describe("generate with model errors", () => {
    it("should return empty questions when chat client throws", async () => {
      const erroringClient = aMockChatClient("");
      erroringClient.createCompletion = async () => {
        throw new Error("Model timeout");
      };

      generator = new CoachGenerator(erroringClient);

      const result = await generator.generate("test-agent", "You are a helper.");

      strictEqual(result.agentName, "test-agent");
      deepStrictEqual(result.questions.identity, []);
      deepStrictEqual(result.questions.rules, []);
    });

    it("should not crash on model error (graceful fallback)", async () => {
      const erroringClient = aMockChatClient("");
      erroringClient.createCompletion = async () => {
        throw new Error("Network error");
      };

      generator = new CoachGenerator(erroringClient);

      // Should not throw
      const result = await generator.generate("test-agent", "You are a helper.");
      ok(result !== undefined);
    });
  });

  describe("question validation (Task 4)", () => {
    let capturedWarnings: string[] = [];
    let originalStderrWrite: typeof process.stderr.write;

    beforeEach(() => {
      capturedWarnings = [];
      originalStderrWrite = process.stderr.write.bind(process.stderr);
      process.stderr.write = (chunk: string | Buffer) => {
        const text = typeof chunk === "string" ? chunk : chunk.toString();
        for (const line of text.split("\n").filter(Boolean)) {
          capturedWarnings.push(line);
        }
        return originalStderrWrite(chunk);
      };
    });

    afterEach(() => {
      process.stderr.write = originalStderrWrite;
    });

    it("should truncate questions exceeding 80 characters after generation", async () => {
      const longQuestion = "A".repeat(81);
      const jsonWithLongQuestion = JSON.stringify({
        identity: [longQuestion, "Short?"],
        rules: [],
        references: [],
        progress: [],
      });

      mockClient = aMockChatClient(jsonWithLongQuestion);
      generator = new CoachGenerator(mockClient);

      const result = await generator.generate("test-agent", "You are a helper.");

      strictEqual(result.questions.identity.length, 2);
      // First question should be truncated to 80 chars ending with "…"
      strictEqual(result.questions.identity[0].length, 80);
      ok(result.questions.identity[0].endsWith("\u2026"));
      // Second question passes through unchanged
      strictEqual(result.questions.identity[1], "Short?");
    });

    it("should pass through all-valid questions unchanged after generation", async () => {
      const validJson = JSON.stringify({
        identity: ["Who am I?"],
        rules: ["Am I following the rules?"],
        references: ["Did I check the docs?"],
        progress: ["Am I on track?"],
      });

      mockClient = aMockChatClient(validJson);
      generator = new CoachGenerator(mockClient);

      const result = await generator.generate("test-agent", "You are a helper.");

      deepStrictEqual(result.questions.identity, ["Who am I?"]);
      deepStrictEqual(result.questions.rules, ["Am I following the rules?"]);
      deepStrictEqual(result.questions.references, ["Did I check the docs?"]);
      deepStrictEqual(result.questions.progress, ["Am I on track?"]);
    });

    it("should preserve empty arrays after generation", async () => {
      const jsonWithEmpty = JSON.stringify({
        identity: ["Who am I?"],
        rules: [],
        references: [],
        progress: [],
      });

      mockClient = aMockChatClient(jsonWithEmpty);
      generator = new CoachGenerator(mockClient);

      const result = await generator.generate("test-agent", "You are a helper.");

      strictEqual(result.questions.identity.length, 1);
      deepStrictEqual(result.questions.rules, []);
      deepStrictEqual(result.questions.references, []);
      deepStrictEqual(result.questions.progress, []);
    });

    it("should log a warning when questions are truncated during generation", async () => {
      const longQuestion = "A".repeat(81);
      const jsonWithLongQuestion = JSON.stringify({
        identity: [longQuestion],
        rules: [],
        references: [],
        progress: [],
      });

      mockClient = aMockChatClient(jsonWithLongQuestion);
      generator = new CoachGenerator(mockClient);

      await generator.generate("test-agent", "You are a helper.");

      ok(capturedWarnings.length >= 1);
      ok(capturedWarnings.some((w) => /truncated/i.test(w)));
    });

    it("should handle mixed long/short questions across all categories", async () => {
      const long = "A".repeat(81);
      const json = JSON.stringify({
        identity: [long, "Who am I?"],
        rules: [long],
        references: ["Short ref?"],
        progress: [long, long],
      });

      mockClient = aMockChatClient(json);
      generator = new CoachGenerator(mockClient);

      const result = await generator.generate("test-agent", "You are a helper.");

      // identity: first truncated, second passes
      strictEqual(result.questions.identity[0].length, 80);
      ok(result.questions.identity[0].endsWith("\u2026"));
      strictEqual(result.questions.identity[1], "Who am I?");

      // rules: truncated
      strictEqual(result.questions.rules[0].length, 80);
      ok(result.questions.rules[0].endsWith("\u2026"));

      // references: passes through
      strictEqual(result.questions.references[0], "Short ref?");

      // progress: both truncated
      strictEqual(result.questions.progress[0].length, 80);
      strictEqual(result.questions.progress[1].length, 80);
    });

    it("should NOT log warnings when all questions are valid (no truncation)", async () => {
      const validJson = JSON.stringify({
        identity: ["Who am I?"],
        rules: [],
        references: [],
        progress: [],
      });

      mockClient = aMockChatClient(validJson);
      generator = new CoachGenerator(mockClient);

      await generator.generate("test-agent", "You are a helper.");

      // There might be other warnings (from empty persona edge cases — none here)
      // Check that no truncation warnings were logged
      const truncationWarnings = capturedWarnings.filter((w) => /truncated/i.test(w));
      strictEqual(truncationWarnings.length, 0);
    });

    it("should truncate extremely long questions (e.g., 500 chars) correctly", async () => {
      const veryLong = "X".repeat(500);
      const json = JSON.stringify({
        identity: [veryLong],
        rules: [],
        references: [],
        progress: [],
      });

      mockClient = aMockChatClient(json);
      generator = new CoachGenerator(mockClient);

      const result = await generator.generate("test-agent", "You are a helper.");

      strictEqual(result.questions.identity[0].length, 80);
      ok(result.questions.identity[0].endsWith("\u2026"));
    });
  });
});
