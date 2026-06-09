import { describe, it, beforeEach } from "node:test";
import { strictEqual, ok, deepStrictEqual } from "node:assert/strict";
import { AgentPersonaCoachPlugin } from "./index.js";
import { aMockChatClient } from "./test-utils.js";

const VALID_JSON_RESPONSE = JSON.stringify({
  identity: ["Who am I in my role?", "Am I staying in my lane?"],
  rules: ["Am I following my constraints?"],
  references: ["Did I read the reference files?"],
  progress: ["Am I making progress?"],
});

const AGENT_NAME = "test-agent";
const SESSION_ID = "session-1";
const AGENT_INFO_V1 = { prompt: "You are a helpful assistant. Always be concise." };
const AGENT_INFO_V2 = { system: "You are a code reviewer." };

describe("AgentPersonaCoachPlugin", () => {
  let plugin: AgentPersonaCoachPlugin;
  let mockClient: ReturnType<typeof aMockChatClient>;

  beforeEach(() => {
    mockClient = aMockChatClient(VALID_JSON_RESPONSE);
    plugin = new AgentPersonaCoachPlugin();
    plugin.setChatClient(mockClient);
  });

  describe("initializeSession", () => {
    it("should set up cache with generated questions", async () => {
      await plugin.initializeSession(AGENT_NAME, AGENT_INFO_V1);

      strictEqual(mockClient.calls.length, 1);
      // Verify the prompt contains the persona text
      ok(mockClient.calls[0].messages[0].content.includes("You are a helpful assistant."));
    });

    it("should skip initialization when no persona text found", async () => {
      await plugin.initializeSession(AGENT_NAME, { name: "no-persona" });

      strictEqual(mockClient.calls.length, 0);
    });

    it("should work with V2 agent info (system field)", async () => {
      await plugin.initializeSession(AGENT_NAME, AGENT_INFO_V2);

      strictEqual(mockClient.calls.length, 1);
      ok(mockClient.calls[0].messages[0].content.includes("You are a code reviewer."));
    });
  });

  describe("onToolAfter — cadence checks", () => {
    beforeEach(async () => {
      await plugin.initializeSession(AGENT_NAME, AGENT_INFO_V1);
    });

    it("should inject reference check at call 2 (before identity cadence at 4)", () => {
      // Call 1: no injection yet
      const result1 = plugin.onToolAfter(SESSION_ID, "read", {}, AGENT_NAME, AGENT_INFO_V1);
      strictEqual(result1.length, 0);

      // Call 2: reference check triggers (afterCalls: 2)
      const result2 = plugin.onToolAfter(SESSION_ID, "read", {}, AGENT_NAME, AGENT_INFO_V1);
      ok(result2.length > 0);
      ok(result2[0].includes("Reference Check"));

      // Call 3: no injection (reference already injected, identity not yet at 4)
      const result3 = plugin.onToolAfter(SESSION_ID, "read", {}, AGENT_NAME, AGENT_INFO_V1);
      strictEqual(result3.length, 0);
    });

    it("should inject identity check at call 4", () => {
      for (let i = 0; i < 3; i++) {
        plugin.onToolAfter(SESSION_ID, "read", {}, AGENT_NAME, AGENT_INFO_V1);
      }
      const result = plugin.onToolAfter(SESSION_ID, "read", {}, AGENT_NAME, AGENT_INFO_V1);

      ok(result.length > 0);
      ok(result[0].includes("Identity Check"));
      ok(result[0].includes("Who am I in my role?"));
    });

    it("should inject both identity and progress at call 8", () => {
      // Calls 1-7: reference fires at call 2, identity at call 4
      for (let i = 0; i < 7; i++) {
        plugin.onToolAfter(SESSION_ID, "read", {}, AGENT_NAME, AGENT_INFO_V1);
      }
      // Call 8: both identity (cadence 4) and progress (cadence 8) fire
      const result = plugin.onToolAfter(SESSION_ID, "read", {}, AGENT_NAME, AGENT_INFO_V1);

      ok(result.length >= 2, `Expected at least 2 nudges (identity + progress), got ${result.length}`);
      ok(result.some(n => n.includes("Identity Check")), "Missing Identity Check nudge");
      ok(result.some(n => n.includes("Progress Check")), "Missing Progress Check nudge");
    });

    it("should inject reference check after 2 calls", () => {
      plugin.onToolAfter(SESSION_ID, "read", {}, AGENT_NAME, AGENT_INFO_V1);
      const result = plugin.onToolAfter(SESSION_ID, "read", {}, AGENT_NAME, AGENT_INFO_V1);

      ok(result.length > 0);
      ok(result[0].includes("Reference Check"));
    });

    it("should inject progress check at call 8 alongside identity", () => {
      for (let i = 0; i < 7; i++) {
        plugin.onToolAfter(SESSION_ID, "read", {}, AGENT_NAME, AGENT_INFO_V1);
      }
      const result = plugin.onToolAfter(SESSION_ID, "read", {}, AGENT_NAME, AGENT_INFO_V1);

      // At call 8, both identity and progress are due — both should fire.
      ok(result.length >= 2);
      ok(result.some(n => n.includes("Identity Check")));
      ok(result.some(n => n.includes("Progress Check")));
    });

    it("should not inject reference check again after it was injected", () => {
      // First 2 calls — reference check injected at call 2
      plugin.onToolAfter(SESSION_ID, "read", {}, AGENT_NAME, AGENT_INFO_V1);
      plugin.onToolAfter(SESSION_ID, "read", {}, AGENT_NAME, AGENT_INFO_V1);

      // Call 3 — no reference check
      const result = plugin.onToolAfter(SESSION_ID, "read", {}, AGENT_NAME, AGENT_INFO_V1);
      strictEqual(result.length, 0);
    });
  });

  describe("onToolBefore — rule compliance", () => {
    beforeEach(async () => {
      await plugin.initializeSession(AGENT_NAME, AGENT_INFO_V1);
    });

    it("should inject rules nudge for critical tool (write permission)", () => {
      const result = plugin.onToolBefore(SESSION_ID, "write", { requiresPermission: "write" }, AGENT_NAME, AGENT_INFO_V1);

      ok(result !== null);
      ok(result!.includes("Rule Compliance"));
      ok(result!.includes("Am I following my constraints?"));
    });

    it("should inject rules nudge for bash permission", () => {
      const result = plugin.onToolBefore(SESSION_ID, "bash", { requiresPermission: "bash" }, AGENT_NAME, AGENT_INFO_V1);

      ok(result !== null);
      ok(result!.includes("Rule Compliance"));
    });

    it("should return null for non-critical tool", () => {
      const result = plugin.onToolBefore(SESSION_ID, "read", { requiresPermission: "read" }, AGENT_NAME, AGENT_INFO_V1);

      strictEqual(result, null);
    });

    it("should return null for tool without critical permission metadata", () => {
      const result = plugin.onToolBefore(SESSION_ID, "someTool", {}, AGENT_NAME, AGENT_INFO_V1);

      strictEqual(result, null);
    });
  });

  describe("updateSystemPrompt", () => {
    it("should inject nudge into system prompt when nudge is provided", () => {
      const systemPrompt = "You are a helpful assistant.";
      const nudge = "Identity Check reminder";
      const result = plugin.updateSystemPrompt(systemPrompt, nudge);

      ok(result.includes(systemPrompt));
      ok(result.includes(nudge));
    });

    it("should inject multiple nudges into system prompt", () => {
      const systemPrompt = "You are a helpful assistant.";
      const nudges = ["Identity Check reminder", "Progress Check reminder"];
      const result = plugin.updateSystemPrompt(systemPrompt, nudges);

      ok(result.includes(systemPrompt));
      ok(result.includes("Identity Check reminder"));
      ok(result.includes("Progress Check reminder"));
    });

    it("should return original prompt when nudge is null", () => {
      const systemPrompt = "You are a helpful assistant.";
      const result = plugin.updateSystemPrompt(systemPrompt, null);

      strictEqual(result, systemPrompt);
    });
  });

  describe("invalidateCache", () => {
    beforeEach(async () => {
      await plugin.initializeSession(AGENT_NAME, AGENT_INFO_V1);
    });

    it("should clear cached questions for an agent", async () => {
      // Invalidate the cache
      plugin.invalidateCache(AGENT_NAME);

      // Re-initialize should trigger a new model call
      await plugin.initializeSession(AGENT_NAME, AGENT_INFO_V1);

      strictEqual(mockClient.calls.length, 2, "Should have made a second call after invalidation");
    });
  });

  describe("clearSession", () => {
    beforeEach(async () => {
      await plugin.initializeSession(AGENT_NAME, AGENT_INFO_V1);
    });

    it("should reset session state", () => {
      // Make some tool calls
      plugin.onToolAfter(SESSION_ID, "read", {}, AGENT_NAME, AGENT_INFO_V1);
      plugin.onToolAfter(SESSION_ID, "read", {}, AGENT_NAME, AGENT_INFO_V1);

      // Clear the session
      plugin.clearSession(SESSION_ID);

      // After clearing, reference check should trigger again at call 2
      plugin.onToolAfter(SESSION_ID, "read", {}, AGENT_NAME, AGENT_INFO_V1);
      const result = plugin.onToolAfter(SESSION_ID, "read", {}, AGENT_NAME, AGENT_INFO_V1);

      ok(result.length > 0, "Reference check should trigger again after clear");
      ok(result[0].includes("Reference Check"));
    });
  });
});
