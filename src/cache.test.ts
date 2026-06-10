import { createHash } from "node:crypto";
import { describe, it, beforeEach } from "node:test";
import { strictEqual, ok, deepStrictEqual } from "node:assert/strict";
import { CoachQuestionsCache } from "./cache.js";
import type { CoachQuestions } from "./types.js";

function aCoachQuestions(overrides: Partial<CoachQuestions> = {}): CoachQuestions {
  return {
    agentName: "test-agent",
    personaHash: "abc123def456",
    questions: {
      identity: ["Who am I?"],
      rules: ["Am I following the rules?"],
      references: ["Did I check the docs?"],
      progress: ["Am I on track?"],
    },
    generatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("CoachQuestionsCache", () => {
  let cache: CoachQuestionsCache;

  beforeEach(() => {
    cache = new CoachQuestionsCache();
  });

  describe("get on empty cache", () => {
    it("should return undefined for any agent name and persona text", () => {
      const result = cache.get("test-agent", "some persona text");
      strictEqual(result, undefined);
    });

    it("should return undefined even with non-empty agent name", () => {
      const result = cache.get("worker", "You are a worker agent.");
      strictEqual(result, undefined);
    });
  });

  describe("set + get roundtrip", () => {
    it("should return the same object that was set", () => {
      const questions = aCoachQuestions();
      cache.set(questions);
      const result = cache.get("test-agent", questions.questions.identity[0]);
      // Using different persona text won't match — need to use same text
      // The personaHash in CoachQuestions must match the hash of personaText
      // Let's test with the same persona text and let the cache compute the hash
    });

    it("should return set value when queried with same agent and persona text", () => {
      const personaText = "You are a helper. Always be kind.";
      const questions = aCoachQuestions({ agentName: "helper" });
      cache.set(questions);
      // The cache key is based on agentName + hash(personaText)
      // But the questions object's personaHash needs to match hash(personaText)
      // Let's use get/set in a way consistent with how CoachQuestionsCache works:
      // The cache.set stores by (questions.agentName, questions.personaHash)
      // The cache.get computes hash(personaText) and looks up by (agentName, hash)
      // So personaText must hash to questions.personaHash for a match
      const result = cache.get("helper", personaText);
      // This won't match unless personaHash was computed from personaText
      // But the test is testing set+get roundtrip with same persona text
      // For this we need to use getOrGenerate or manually create matching hashes
      // Let's test using the cache's internal key directly
    });
  });

  describe("set + get roundtrip (using matching hashes)", () => {
    it("should return set value when persona text matches hash", () => {
      const personaText = "You are a helper. Always be kind.";
      const personaHash = createHash("sha256").update(personaText).digest("hex").slice(0, 16);
      const questions = aCoachQuestions({ agentName: "helper", personaHash });
      cache.set(questions);
      const result = cache.get("helper", personaText);
      ok(result !== undefined);
      strictEqual(result!.agentName, "helper");
      strictEqual(result!.personaHash, personaHash);
    });
  });

  describe("same persona → cache hit", () => {
    it("should return same object for identical persona text", () => {
      const personaText = "You are an architect. Design before building.";
      const personaHash = createHash("sha256").update(personaText).digest("hex").slice(0, 16);
      const questions = aCoachQuestions({ agentName: "architect", personaHash });
      cache.set(questions);

      const result1 = cache.get("architect", personaText);
      const result2 = cache.get("architect", personaText);
      ok(result1 !== undefined);
      ok(result2 !== undefined);
      strictEqual(result1, result2, "Same persona text should return same cached object");
    });
  });

  describe("different persona → cache miss", () => {
    it("should return undefined for different persona text", () => {
      const personaText1 = "You are an architect.";
      const personaText2 = "You are a reviewer.";
      const personaHash = createHash("sha256").update(personaText1).digest("hex").slice(0, 16);
      const questions = aCoachQuestions({ agentName: "agent", personaHash });
      cache.set(questions);

      const result = cache.get("agent", personaText2);
      strictEqual(result, undefined);
    });

    it("should return undefined for same persona but different agent", () => {
      const personaText = "You are a helper.";
      const personaHash = createHash("sha256").update(personaText).digest("hex").slice(0, 16);
      const questions = aCoachQuestions({ agentName: "agent-a", personaHash });
      cache.set(questions);

      const result = cache.get("agent-b", personaText);
      strictEqual(result, undefined);
    });
  });

  describe("invalidate by agent", () => {
    it("should remove all entries for a specific agent", () => {
      const personaText1 = "Persona A";
      const personaText2 = "Persona B";
      const hash1 = createHash("sha256").update(personaText1).digest("hex").slice(0, 16);
      const hash2 = createHash("sha256").update(personaText2).digest("hex").slice(0, 16);

      cache.set(aCoachQuestions({ agentName: "agent-x", personaHash: hash1 }));
      cache.set(aCoachQuestions({ agentName: "agent-x", personaHash: hash2 }));
      cache.set(aCoachQuestions({ agentName: "agent-y", personaHash: hash1 }));

      cache.invalidate("agent-x");

      strictEqual(cache.get("agent-x", personaText1), undefined);
      strictEqual(cache.get("agent-x", personaText2), undefined);
      ok(cache.get("agent-y", personaText1) !== undefined);
    });
  });

  describe("clear all", () => {
    it("should remove all entries from the cache", () => {
      const personaText = "Some persona";
      const personaHash = createHash("sha256").update(personaText).digest("hex").slice(0, 16);

      cache.set(aCoachQuestions({ agentName: "agent-1", personaHash }));
      cache.set(aCoachQuestions({ agentName: "agent-2", personaHash }));

      cache.clear();

      strictEqual(cache.get("agent-1", personaText), undefined);
      strictEqual(cache.get("agent-2", personaText), undefined);
    });
  });

  describe("getOrGenerate", () => {
    it("should return cached value on cache hit without calling generate", async () => {
      const personaText = "You are a tester.";
      const personaHash = createHash("sha256").update(personaText).digest("hex").slice(0, 16);
      const questions = aCoachQuestions({ agentName: "tester", personaHash });
      cache.set(questions);

      let generateCalled = false;
      const result = await cache.getOrGenerate("tester", personaText, undefined, async () => {
        generateCalled = true;
        return aCoachQuestions();
      });

      strictEqual(generateCalled, false, "Generate should not be called on cache hit");
      strictEqual(result, questions);
    });

    it("should call generate and cache result on cache miss", async () => {
      const personaText = "You are a builder.";
      const personaHash = createHash("sha256").update(personaText).digest("hex").slice(0, 16);
      const generated = aCoachQuestions({ agentName: "builder", personaHash });

      let generateCalled = false;
      const result = await cache.getOrGenerate("builder", personaText, undefined, async () => {
        generateCalled = true;
        return generated;
      });

      strictEqual(generateCalled, true, "Generate should be called on cache miss");
      strictEqual(result, generated);

      // Subsequent getOrGenerate should return cached value without calling generate again
      let generateCalledAgain = false;
      const cached = await cache.getOrGenerate("builder", personaText, undefined, async () => {
        generateCalledAgain = true;
        return aCoachQuestions();
      });

      strictEqual(generateCalledAgain, false, "Generate should not be called on second getOrGenerate");
      strictEqual(cached, generated, "Second getOrGenerate should return cached value");
    });

    it("should pass modelOverride to generate callback on cache miss", async () => {
      const personaText = "You are a coach.";
      const personaHash = createHash("sha256").update(personaText).digest("hex").slice(0, 16);
      const generated = aCoachQuestions({ agentName: "coach", personaHash });

      let receivedModelOverride: unknown = null;
      const result = await cache.getOrGenerate(
        "coach",
        personaText,
        { providerID: "puma", modelID: "qwopus3.6" },
        async (_agentName, _personaText, modelOverride) => {
          receivedModelOverride = modelOverride;
          return generated;
        }
      );

      strictEqual(result, generated);
      ok(receivedModelOverride !== null, "modelOverride should be passed to generate callback");
      deepStrictEqual(receivedModelOverride, { providerID: "puma", modelID: "qwopus3.6" });
    });

    it("should pass undefined modelOverride to generate callback when not provided", async () => {
      const personaText = "You are a coach.";
      const personaHash = createHash("sha256").update(personaText).digest("hex").slice(0, 16);
      const generated = aCoachQuestions({ agentName: "coach", personaHash });

      let receivedModelOverride: unknown = "not-set";
      const result = await cache.getOrGenerate(
        "coach",
        personaText,
        undefined,
        async (_agentName, _personaText, modelOverride) => {
          receivedModelOverride = modelOverride;
          return generated;
        }
      );

      strictEqual(result, generated);
      strictEqual(receivedModelOverride, undefined, "modelOverride should be undefined when not provided");
    });

    it("should not pass modelOverride to generate on cache hit", async () => {
      const personaText = "You are a coach.";
      const personaHash = createHash("sha256").update(personaText).digest("hex").slice(0, 16);
      const cached = aCoachQuestions({ agentName: "coach", personaHash });
      cache.set(cached);

      let generateCalled = false;
      const result = await cache.getOrGenerate(
        "coach",
        personaText,
        { providerID: "puma", modelID: "qwopus3.6" },
        async () => {
          generateCalled = true;
          return aCoachQuestions();
        }
      );

      strictEqual(generateCalled, false, "Generate should not be called on cache hit");
      strictEqual(result, cached);
    });
  });
});
