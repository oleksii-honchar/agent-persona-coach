import { describe, it, beforeEach, afterEach } from "node:test";
import { strictEqual, ok, deepStrictEqual } from "node:assert/strict";
import { CoachGenerator } from "./generator.js";
import { DEFAULT_CONFIG } from "./types.js";
import { aMockChatClient } from "./test-utils.js";
import * as loggerModule from "./logger.js";

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
      const result = await generator.generate("test-agent", "You are a helper.", DEFAULT_CONFIG.coachPrompt);

      strictEqual(result.agentName, "test-agent");
      ok(result.personaHash.length > 0);
      deepStrictEqual(result.questions.identity, ["Who am I?"]);
      deepStrictEqual(result.questions.rules, ["Am I following the rules?"]);
      deepStrictEqual(result.questions.references, ["Did I check the docs?"]);
      deepStrictEqual(result.questions.progress, ["Am I on track?"]);
      ok(result.generatedAt.length > 0);
    });

    it("should call the chat client with correct model and prompt", async () => {
      await generator.generate("test-agent", "You are a helper.", DEFAULT_CONFIG.coachPrompt);

      strictEqual(mockClient.calls.length, 1);
      strictEqual(mockClient.calls[0].model, "default");
      strictEqual(mockClient.calls[0].messages.length, 1);
      strictEqual(mockClient.calls[0].messages[0].role, "user");
      ok(mockClient.calls[0].messages[0].content.includes("You are a helper."));
    });

    it("should fill missing categories with empty arrays", async () => {
      mockClient = aMockChatClient(JSON.stringify({ identity: ["Who am I?"] }));
      generator = new CoachGenerator(mockClient);

      const result = await generator.generate("test-agent", "You are a helper.", DEFAULT_CONFIG.coachPrompt);

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

      const result = await generator.generate("test-agent", "You are a helper.", DEFAULT_CONFIG.coachPrompt);

      deepStrictEqual(result.questions.identity, ["Who am I?"]);
      deepStrictEqual(result.questions.rules, ["Am I following the rules?"]);
    });

    it("should extract JSON from ``` ... ``` blocks without language specifier", async () => {
      mockClient = aMockChatClient(MARKDOWN_WRAPPED_JSON_NO_LANG);
      generator = new CoachGenerator(mockClient);

      const result = await generator.generate("test-agent", "You are a helper.", DEFAULT_CONFIG.coachPrompt);

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

      const result = await generator.generate("test-agent", "You are a helper.", DEFAULT_CONFIG.coachPrompt);

      deepStrictEqual(result.questions.identity, ["Who am I?"]);
    });
  });

  describe("generate with invalid JSON fallback", () => {
    it("should return empty questions when JSON parse fails", async () => {
      mockClient = aMockChatClient(INVALID_JSON_RESPONSE);
      generator = new CoachGenerator(mockClient);

      const result = await generator.generate("test-agent", "You are a helper.", DEFAULT_CONFIG.coachPrompt);

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
      const result = await generator.generate("test-agent", "You are a helper.", DEFAULT_CONFIG.coachPrompt);
      ok(result !== undefined);
      deepStrictEqual(result.questions.identity, []);
    });
  });

  describe("generate with empty persona text", () => {
    it("should return empty questions for empty string", async () => {
      const result = await generator.generate("test-agent", EMPTY_PERSONA, DEFAULT_CONFIG.coachPrompt);

      strictEqual(result.agentName, "test-agent");
      ok(result.personaHash.length > 0);
      deepStrictEqual(result.questions.identity, []);
      deepStrictEqual(result.questions.rules, []);
      deepStrictEqual(result.questions.references, []);
      deepStrictEqual(result.questions.progress, []);
    });

    it("should return empty questions for whitespace-only persona", async () => {
      const result = await generator.generate("test-agent", WHITESPACE_PERSONA, DEFAULT_CONFIG.coachPrompt);

      deepStrictEqual(result.questions.identity, []);
      deepStrictEqual(result.questions.rules, []);
    });

    it("should not call the chat client when persona is empty", async () => {
      await generator.generate("test-agent", EMPTY_PERSONA, DEFAULT_CONFIG.coachPrompt);

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

      const result = await generator.generate("test-agent", "You are a helper.", DEFAULT_CONFIG.coachPrompt);

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
      const result = await generator.generate("test-agent", "You are a helper.", DEFAULT_CONFIG.coachPrompt);
      ok(result !== undefined);
    });
  });

 describe("modelOverride support", () => {
    it("should capture modelOverride in mock calls when provided", async () => {
      mockClient = aMockChatClient(VALID_JSON_RESPONSE);
      generator = new CoachGenerator(mockClient);

      const result = await generator.generate("test-agent", "You are a helper.", DEFAULT_CONFIG.coachPrompt, {
        providerID: "puma",
        modelID: "qwopus3.6",
      });

      ok(result.questions.identity.length > 0);
      strictEqual(mockClient.calls.length, 1);
      ok(mockClient.calls[0].modelOverride !== undefined);
      strictEqual(mockClient.calls[0].modelOverride!.providerID, "puma");
      strictEqual(mockClient.calls[0].modelOverride!.modelID, "qwopus3.6");
    });

    it("should capture undefined modelOverride when not provided", async () => {
      mockClient = aMockChatClient(VALID_JSON_RESPONSE);
      generator = new CoachGenerator(mockClient);

      await generator.generate("test-agent", "You are a helper.", DEFAULT_CONFIG.coachPrompt);

      strictEqual(mockClient.calls.length, 1);
      strictEqual(mockClient.calls[0].modelOverride, undefined);
    });

    it("should pass modelOverride through to createCompletion", async () => {
      mockClient = aMockChatClient(VALID_JSON_RESPONSE);
      generator = new CoachGenerator(mockClient);

      await generator.generate("test-agent", "You are a helper.", DEFAULT_CONFIG.coachPrompt, {
        providerID: "puma",
        modelID: "qwopus3.6",
      });

      strictEqual(mockClient.calls.length, 1);
      ok(mockClient.calls[0].modelOverride !== undefined, "modelOverride should be passed to createCompletion");
      strictEqual(mockClient.calls[0].modelOverride!.providerID, "puma");
      strictEqual(mockClient.calls[0].modelOverride!.modelID, "qwopus3.6");
    });

    it("should not include modelOverride in createCompletion when not provided", async () => {
      mockClient = aMockChatClient(VALID_JSON_RESPONSE);
      generator = new CoachGenerator(mockClient);

      await generator.generate("test-agent", "You are a helper.", DEFAULT_CONFIG.coachPrompt);

      strictEqual(mockClient.calls.length, 1);
      strictEqual(mockClient.calls[0].modelOverride, undefined, "modelOverride should be undefined when not provided");
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

    it("should pass through long questions unchanged after generation", async () => {
      const longQuestion = "A".repeat(81);
      const jsonWithLongQuestion = JSON.stringify({
        identity: [longQuestion, "Short?"],
        rules: [],
        references: [],
        progress: [],
      });

      mockClient = aMockChatClient(jsonWithLongQuestion);
      generator = new CoachGenerator(mockClient);

      const result = await generator.generate("test-agent", "You are a helper.", DEFAULT_CONFIG.coachPrompt);

      strictEqual(result.questions.identity.length, 2);
      // Long question passes through unchanged
      strictEqual(result.questions.identity[0], longQuestion);
      strictEqual(result.questions.identity[0].length, 81);
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

      const result = await generator.generate("test-agent", "You are a helper.", DEFAULT_CONFIG.coachPrompt);

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

      const result = await generator.generate("test-agent", "You are a helper.", DEFAULT_CONFIG.coachPrompt);

      strictEqual(result.questions.identity.length, 1);
      deepStrictEqual(result.questions.rules, []);
      deepStrictEqual(result.questions.references, []);
      deepStrictEqual(result.questions.progress, []);
    });

    it("should NOT log a warning when questions are long (no truncation)", async () => {
      const longQuestion = "A".repeat(81);
      const jsonWithLongQuestion = JSON.stringify({
        identity: [longQuestion],
        rules: [],
        references: [],
        progress: [],
      });

      mockClient = aMockChatClient(jsonWithLongQuestion);
      generator = new CoachGenerator(mockClient);

      await generator.generate("test-agent", "You are a helper.", DEFAULT_CONFIG.coachPrompt);

      const truncationWarnings = capturedWarnings.filter((w) => /truncated/i.test(w));
      strictEqual(truncationWarnings.length, 0);
    });

    it("should pass through mixed long/short questions across all categories unchanged", async () => {
      const long = "A".repeat(81);
      const json = JSON.stringify({
        identity: [long, "Who am I?"],
        rules: [long],
        references: ["Short ref?"],
        progress: [long, long],
      });

      mockClient = aMockChatClient(json);
      generator = new CoachGenerator(mockClient);

      const result = await generator.generate("test-agent", "You are a helper.", DEFAULT_CONFIG.coachPrompt);

      // identity: both pass through unchanged
      strictEqual(result.questions.identity[0], long);
      strictEqual(result.questions.identity[0].length, 81);
      strictEqual(result.questions.identity[1], "Who am I?");

      // rules: passes through unchanged
      strictEqual(result.questions.rules[0], long);
      strictEqual(result.questions.rules[0].length, 81);

      // references: passes through
      strictEqual(result.questions.references[0], "Short ref?");

      // progress: both pass through unchanged
      strictEqual(result.questions.progress[0], long);
      strictEqual(result.questions.progress[1], long);
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

      await generator.generate("test-agent", "You are a helper.", DEFAULT_CONFIG.coachPrompt);

      // There might be other warnings (from empty persona edge cases — none here)
      // Check that no truncation warnings were logged
      const truncationWarnings = capturedWarnings.filter((w) => /truncated/i.test(w));
      strictEqual(truncationWarnings.length, 0);
    });

    it("should pass through extremely long questions (e.g., 500 chars) unchanged", async () => {
      const veryLong = "X".repeat(500);
      const json = JSON.stringify({
        identity: [veryLong],
        rules: [],
        references: [],
        progress: [],
      });

      mockClient = aMockChatClient(json);
      generator = new CoachGenerator(mockClient);

      const result = await generator.generate("test-agent", "You are a helper.", DEFAULT_CONFIG.coachPrompt);

      strictEqual(result.questions.identity[0], veryLong);
      strictEqual(result.questions.identity[0].length, 500);
    });
  });

  describe("generated questions log (Task 4)", () => {
    let infoCalls: Array<{ message: string; extra?: Record<string, unknown> }> = [];

    beforeEach(() => {
      infoCalls = [];
      const originalInfo = loggerModule.log.info;
      loggerModule.log.info = (message: string, extra?: Record<string, unknown>) => {
        infoCalls.push({ message, extra });
        originalInfo(message, extra);
      };
    });

    afterEach(() => {
      // Restore original log.info
      // The logger module exports a const object, so we need to restore the method
      const originalInfo = loggerModule.log.info;
      // Reset to original by reassigning — but since it's a const object,
      // we need to use Object.defineProperty or re-import. For test simplicity,
      // we'll just clear our spy side-effect.
      // Actually, we can't easily restore a const object property.
      // Let's use a different approach: spy via stderr capture.
    });

    it("should emit INFO log after successful generation with correct data", async () => {
      mockClient = aMockChatClient(VALID_JSON_RESPONSE);
      generator = new CoachGenerator(mockClient);

      const result = await generator.generate("vault-keeper", "You are a keeper.", DEFAULT_CONFIG.coachPrompt);

      // The result should be correct
      ok(result.questions.identity.length > 0);

      // Look for the "Generated" log message
      const generatedLog = infoCalls.find((c) => c.message.includes("Generated"));
      ok(generatedLog, "Expected a 'Generated' log entry");
      ok(generatedLog.message.includes("4 question(s)"), `Expected '4 question(s)' in log message, got: ${generatedLog.message}`);
      ok(generatedLog.message.includes("vault-keeper"), `Expected 'vault-keeper' in log message, got: ${generatedLog.message}`);

      const extra = generatedLog.extra!;
      strictEqual(extra.agentName, "vault-keeper");
      ok(extra.personaHash, "Expected personaHash in extra");
      ok(extra.categories, "Expected categories in extra");
      strictEqual((extra.categories as any).identity, 1);
      strictEqual((extra.categories as any).rules, 1);
      strictEqual((extra.categories as any).references, 1);
      strictEqual((extra.categories as any).progress, 1);
    });

    it("should NOT emit INFO log on error/fallback path", async () => {
      const erroringClient = aMockChatClient("");
      erroringClient.createCompletion = async () => {
        throw new Error("Model timeout");
      };

      generator = new CoachGenerator(erroringClient);

      const result = await generator.generate("test-agent", "You are a helper.", DEFAULT_CONFIG.coachPrompt);

      // Should return empty questions
      deepStrictEqual(result.questions.identity, []);

      // Should NOT have a "Generated" log
      const generatedLog = infoCalls.find((c) => c.message.includes("Generated"));
      ok(!generatedLog, `Expected no 'Generated' log on error path, but found: ${generatedLog?.message}`);
    });

    it("should NOT emit INFO log for empty persona", async () => {
      generator = new CoachGenerator(mockClient);

      const result = await generator.generate("test-agent", "", DEFAULT_CONFIG.coachPrompt);

      // Should return empty questions
      deepStrictEqual(result.questions.identity, []);

      // Should NOT have a "Generated" log
      const generatedLog = infoCalls.find((c) => c.message.includes("Generated"));
      ok(!generatedLog, `Expected no 'Generated' log for empty persona, but found: ${generatedLog?.message}`);

      // Should NOT call the chat client
      strictEqual(mockClient.calls.length, 0);
    });

    it("should show correct per-category breakdown with mixed question counts", async () => {
      const mixedJson = JSON.stringify({
        identity: ["Who am I?", "What's my role?"],
        rules: ["Follow the rules"],
        references: [],
        progress: ["On track?", "Making progress?", "Almost done?"],
      });

      mockClient = aMockChatClient(mixedJson);
      generator = new CoachGenerator(mockClient);

      const result = await generator.generate("test-agent", "You are a helper.", DEFAULT_CONFIG.coachPrompt);

      // 2 + 1 + 0 + 3 = 6 total
      const generatedLog = infoCalls.find((c) => c.message.includes("Generated"));
      ok(generatedLog, "Expected a 'Generated' log entry");
      ok(generatedLog.message.includes("6 question(s)"), `Expected '6 question(s)' in log, got: ${generatedLog.message}`);

      const extra = generatedLog.extra!;
      strictEqual((extra.categories as any).identity, 2);
      strictEqual((extra.categories as any).rules, 1);
      strictEqual((extra.categories as any).references, 0);
      strictEqual((extra.categories as any).progress, 3);
    });
  });
});
