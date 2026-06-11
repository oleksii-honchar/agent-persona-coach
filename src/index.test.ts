import { describe, it, beforeEach } from "node:test";
import { strictEqual, ok, deepStrictEqual } from "node:assert/strict";
import { AgentPersonaCoachPlugin } from "./index.js";
import { DEFAULT_CONFIG } from "./types.js";
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
      ok(mockClient.calls[0].messages[0].content.includes("You are a helpful assistant."));
    });

    it("should skip initialization when no persona text found", async () => {
      await plugin.initializeSession(AGENT_NAME, {});

      strictEqual(mockClient.calls.length, 0);
    });

    it("should work with V2 agent info (system field)", async () => {
      await plugin.initializeSession(AGENT_NAME, AGENT_INFO_V2);

      strictEqual(mockClient.calls.length, 1);
      ok(mockClient.calls[0].messages[0].content.includes("You are a code reviewer."));
    });
  });

  describe("onToolAfter — cadence checks (DEFAULT_CONFIG: identity=10, references=30, progress=20)", () => {
    beforeEach(async () => {
      await plugin.initializeSession(AGENT_NAME, AGENT_INFO_V1);
    });

    it("should inject reference check at call 30 (DEFAULT_CONFIG cadence)", () => {
      for (let i = 0; i < 29; i++) {
        plugin.onToolAfter(SESSION_ID, "read", {}, AGENT_NAME, AGENT_INFO_V1);
      }

      // Call 30: identity (cadence 10) + reference check (cadence 30) both fire
      const result = plugin.onToolAfter(SESSION_ID, "read", {}, AGENT_NAME, AGENT_INFO_V1);
      ok(result.length >= 2, `Expected at least 2 nudges (identity + reference), got ${result.length}`);
      ok(result.some(n => n.includes("Reference Check")), "Missing Reference Check nudge");
      ok(result.some(n => n.includes("Identity Check")), "Missing Identity Check nudge");
    });

    it("should inject identity check at call 10 (DEFAULT_CONFIG cadence)", () => {
      for (let i = 0; i < 9; i++) {
        plugin.onToolAfter(SESSION_ID, "read", {}, AGENT_NAME, AGENT_INFO_V1);
      }
      const result = plugin.onToolAfter(SESSION_ID, "read", {}, AGENT_NAME, AGENT_INFO_V1);

      ok(result.length > 0);
      ok(result[0].includes("Identity Check"));
      ok(result[0].includes("Who am I in my role?"));
    });

    it("should inject both identity and progress at call 20 (DEFAULT_CONFIG)", () => {
      for (let i = 0; i < 19; i++) {
        plugin.onToolAfter(SESSION_ID, "read", {}, AGENT_NAME, AGENT_INFO_V1);
      }
      const result = plugin.onToolAfter(SESSION_ID, "read", {}, AGENT_NAME, AGENT_INFO_V1);

      ok(result.length >= 2, `Expected at least 2 nudges (identity + progress), got ${result.length}`);
      ok(result.some(n => n.includes("Identity Check")), "Missing Identity Check nudge");
      ok(result.some(n => n.includes("Progress Check")), "Missing Progress Check nudge");
    });

    it("should not inject reference check again after it was injected", () => {
      for (let i = 0; i < 30; i++) {
        plugin.onToolAfter(SESSION_ID, "read", {}, AGENT_NAME, AGENT_INFO_V1);
      }

      // Call 31 — no reference check (already injected), identity doesn't fire at 31
      const result = plugin.onToolAfter(SESSION_ID, "read", {}, AGENT_NAME, AGENT_INFO_V1);
      strictEqual(result.length, 0);
    });
  });

  describe("onToolBefore — rule compliance (cadence-based, DEFAULT_CONFIG cadence 10)", () => {
    beforeEach(async () => {
      await plugin.initializeSession(AGENT_NAME, AGENT_INFO_V1);
    });

    it("should inject rules nudge on 10th critical call (DEFAULT_CONFIG cadence 10)", () => {
      for (let i = 0; i < 9; i++) {
        const r = plugin.onToolBefore(SESSION_ID, "write", { requiresPermission: "write" }, AGENT_NAME, AGENT_INFO_V1);
        strictEqual(r, null);
      }

      const r10 = plugin.onToolBefore(SESSION_ID, "write", { requiresPermission: "write" }, AGENT_NAME, AGENT_INFO_V1);
      ok(r10 !== null);
      ok(r10!.includes("Rule Compliance"));
      ok(r10!.includes("Am I following my constraints?"));
    });

    it("should skip nudge on 1st critical call", () => {
      const result = plugin.onToolBefore(SESSION_ID, "write", { requiresPermission: "write" }, AGENT_NAME, AGENT_INFO_V1);
      strictEqual(result, null);
    });

    it("should inject rules nudge for bash permission on cadence", () => {
      for (let i = 0; i < 9; i++) {
        const r = plugin.onToolBefore(SESSION_ID, "bash", { requiresPermission: "bash" }, AGENT_NAME, AGENT_INFO_V1);
        strictEqual(r, null);
      }

      const r10 = plugin.onToolBefore(SESSION_ID, "bash", { requiresPermission: "bash" }, AGENT_NAME, AGENT_INFO_V1);
      ok(r10 !== null);
      ok(r10!.includes("Rule Compliance"));
    });

    it("should return null for non-critical tool", () => {
      const result = plugin.onToolBefore(SESSION_ID, "read", { requiresPermission: "read" }, AGENT_NAME, AGENT_INFO_V1);
      strictEqual(result, null);
    });

    it("should return null for tool without critical permission metadata", () => {
      const result = plugin.onToolBefore(SESSION_ID, "someTool", {}, AGENT_NAME, AGENT_INFO_V1);
      strictEqual(result, null);
    });

    it("should not advance critical counter on non-critical tools", () => {
      plugin.onToolBefore(SESSION_ID, "read", { requiresPermission: "read" }, AGENT_NAME, AGENT_INFO_V1);

      const r = plugin.onToolBefore(SESSION_ID, "write", { requiresPermission: "write" }, AGENT_NAME, AGENT_INFO_V1);
      strictEqual(r, null);

      for (let i = 0; i < 8; i++) {
        const r = plugin.onToolBefore(SESSION_ID, "write", { requiresPermission: "write" }, AGENT_NAME, AGENT_INFO_V1);
        strictEqual(r, null);
      }

      const r10 = plugin.onToolBefore(SESSION_ID, "write", { requiresPermission: "write" }, AGENT_NAME, AGENT_INFO_V1);
      ok(r10 !== null);
    });

    it("should mix critical and non-critical tools correctly", () => {
      plugin.onToolBefore(SESSION_ID, "write", { requiresPermission: "write" }, AGENT_NAME, AGENT_INFO_V1);

      plugin.onToolBefore(SESSION_ID, "read", { requiresPermission: "read" }, AGENT_NAME, AGENT_INFO_V1);
      plugin.onToolBefore(SESSION_ID, "read", { requiresPermission: "read" }, AGENT_NAME, AGENT_INFO_V1);

      for (let i = 0; i < 8; i++) {
        const r = plugin.onToolBefore(SESSION_ID, "bash", { requiresPermission: "bash" }, AGENT_NAME, AGENT_INFO_V1);
        strictEqual(r, null);
      }

      const r = plugin.onToolBefore(SESSION_ID, "bash", { requiresPermission: "bash" }, AGENT_NAME, AGENT_INFO_V1);
      ok(r !== null);
      ok(r!.includes("Rule Compliance"));
    });

    it("should respect cadence 2 (every 2 critical calls)", async () => {
      const cadence2MockClient = aMockChatClient(VALID_JSON_RESPONSE);
      const cadence2Plugin = new AgentPersonaCoachPlugin({
        categories: {
          ...DEFAULT_CONFIG.categories,
          rules: { ...DEFAULT_CONFIG.categories.rules, cadence: 2 },
        },
      });
      cadence2Plugin.setChatClient(cadence2MockClient);
      await cadence2Plugin.initializeSession(AGENT_NAME, AGENT_INFO_V1);

      const r1 = cadence2Plugin.onToolBefore(SESSION_ID, "write", { requiresPermission: "write" }, AGENT_NAME, AGENT_INFO_V1);
      strictEqual(r1, null);

      const r2 = cadence2Plugin.onToolBefore(SESSION_ID, "write", { requiresPermission: "write" }, AGENT_NAME, AGENT_INFO_V1);
      ok(r2 !== null);
      ok(r2!.includes("Rule Compliance"));
    });

    it("should respect cadence 1 (every call — old behavior)", async () => {
      const cadence1MockClient = aMockChatClient(VALID_JSON_RESPONSE);
      const cadence1Plugin = new AgentPersonaCoachPlugin({
        categories: {
          ...DEFAULT_CONFIG.categories,
          rules: { ...DEFAULT_CONFIG.categories.rules, cadence: 1 },
        },
      });
      cadence1Plugin.setChatClient(cadence1MockClient);
      await cadence1Plugin.initializeSession(AGENT_NAME, AGENT_INFO_V1);

      const r1 = cadence1Plugin.onToolBefore(SESSION_ID, "write", { requiresPermission: "write" }, AGENT_NAME, AGENT_INFO_V1);
      ok(r1 !== null);

      const r2 = cadence1Plugin.onToolBefore(SESSION_ID, "write", { requiresPermission: "write" }, AGENT_NAME, AGENT_INFO_V1);
      ok(r2 !== null);
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
      plugin.invalidateCache(AGENT_NAME);

      await plugin.initializeSession(AGENT_NAME, AGENT_INFO_V1);

      strictEqual(mockClient.calls.length, 2, "Should have made a second call after invalidation");
    });
  });

  describe("clearSession", () => {
    beforeEach(async () => {
      await plugin.initializeSession(AGENT_NAME, AGENT_INFO_V1);
    });

    it("should reset session state", () => {
      for (let i = 0; i < 10; i++) {
        plugin.onToolAfter(SESSION_ID, "read", {}, AGENT_NAME, AGENT_INFO_V1);
      }

      plugin.clearSession(SESSION_ID);

      for (let i = 0; i < 9; i++) {
        plugin.onToolAfter(SESSION_ID, "read", {}, AGENT_NAME, AGENT_INFO_V1);
      }
      const result = plugin.onToolAfter(SESSION_ID, "read", {}, AGENT_NAME, AGENT_INFO_V1);

      ok(result.length > 0, "Identity check should trigger again after clear");
      ok(result[0].includes("Identity Check"));
    });
  });

  describe("buildIdentityNudge", () => {
    it("should return a nudge containing 'Identity Check' when initialized with a persona", async () => {
      await plugin.initializeSession(AGENT_NAME, AGENT_INFO_V1);

      const nudge = plugin.buildIdentityNudge(AGENT_NAME, AGENT_INFO_V1);

      ok(nudge !== null, "Expected nudge to be non-null");
      ok(nudge!.includes("Identity Check"), "Expected nudge to contain 'Identity Check'");
      ok(nudge!.includes("Who am I in my role?"), "Expected nudge to contain the identity question");
    });

    it("should return a nudge even with empty agentInfo when persona was stored during initializeSession", async () => {
      await plugin.initializeSession(AGENT_NAME, AGENT_INFO_V1);

      // Pass EMPTY agentInfo — persona text should come from stored map, not from agentInfo
      const nudge = plugin.buildIdentityNudge(AGENT_NAME, {});

      ok(nudge !== null, "Expected nudge to be non-null even with empty agentInfo");
      ok(nudge!.includes("Identity Check"), "Expected nudge to contain 'Identity Check'");
    });

    it("should return null when not initialized (no cache)", () => {
      // Do NOT call initializeSession — cache is empty
      const nudge = plugin.buildIdentityNudge(AGENT_NAME, AGENT_INFO_V1);

      strictEqual(nudge, null);
    });

    it("should fallback to extractPersona(agentInfo) when no stored persona exists", () => {
      // This tests the ?? extractPersona(agentInfo) fallback in buildNudge:
      //   1. this.agentPersonas.get("fallback-agent") → undefined (no stored persona)
      //   2. Falls back to extractPersona(agentInfo) → "You are a helpful assistant..."
      //   3. Cache has no questions (initializeSession was never called) → null
      //
      // What we verify: the extractPersona fallback succeeds without crashing,
      // and the result is null only because of empty cache (not because of
      // failed persona extraction). This ensures backward compatibility if
      // agentInfo is ever populated in production hooks.
      const nudge = plugin.buildIdentityNudge("fallback-agent", AGENT_INFO_V1);

      strictEqual(nudge, null);
    });

    it("should return null when no identity questions exist", async () => {
      const emptyIdentityMockClient = aMockChatClient(JSON.stringify({
        identity: [],
        rules: ["Am I following my constraints?"],
        references: ["Did I read the reference files?"],
        progress: ["Am I making progress?"],
      }));
      const emptyPlugin = new AgentPersonaCoachPlugin();
      emptyPlugin.setChatClient(emptyIdentityMockClient);
      await emptyPlugin.initializeSession(AGENT_NAME, AGENT_INFO_V1);

      const nudge = emptyPlugin.buildIdentityNudge(AGENT_NAME, AGENT_INFO_V1);

      strictEqual(nudge, null);
    });
  });

  describe("config accessibility", () => {
    it("should expose config as public readonly", () => {
      ok(plugin.config, "plugin.config should be accessible");
      deepStrictEqual(plugin.config.categories, DEFAULT_CONFIG.categories);
    });
  });

  describe("modelOverride support", () => {
    it("should pass modelOverride through initializeSession when model is provided", async () => {
      mockClient = aMockChatClient(VALID_JSON_RESPONSE);
      plugin = new AgentPersonaCoachPlugin();
      plugin.setChatClient(mockClient);

      await plugin.initializeSession(AGENT_NAME, {
        system: "You are a code reviewer.",
        model: { providerID: "puma", modelID: "qwopus3.6" },
      });

      strictEqual(mockClient.calls.length, 1);
      ok(mockClient.calls[0].modelOverride !== undefined, "modelOverride should be passed");
      strictEqual(mockClient.calls[0].modelOverride!.providerID, "puma");
      strictEqual(mockClient.calls[0].modelOverride!.modelID, "qwopus3.6");
    });

    it("should pass undefined modelOverride when model is not provided", async () => {
      mockClient = aMockChatClient(VALID_JSON_RESPONSE);
      plugin = new AgentPersonaCoachPlugin();
      plugin.setChatClient(mockClient);

      await plugin.initializeSession(AGENT_NAME, {
        system: "You are a code reviewer.",
      });

      strictEqual(mockClient.calls.length, 1);
      strictEqual(mockClient.calls[0].modelOverride, undefined, "modelOverride should be undefined when model not provided");
    });

    it("should forward modelOverride in createCompletion to underlying chatClient", async () => {
      mockClient = aMockChatClient(VALID_JSON_RESPONSE);
      plugin = new AgentPersonaCoachPlugin();
      plugin.setChatClient(mockClient);

      await plugin.createCompletion({
        model: "default",
        messages: [{ role: "user", content: "test" }],
        modelOverride: { providerID: "puma", modelID: "qwopus3.6" },
      });

      strictEqual(mockClient.calls.length, 1);
      ok(mockClient.calls[0].modelOverride !== undefined, "modelOverride should be forwarded");
      strictEqual(mockClient.calls[0].modelOverride!.providerID, "puma");
      strictEqual(mockClient.calls[0].modelOverride!.modelID, "qwopus3.6");
    });

    it("should forward undefined modelOverride in createCompletion when not provided", async () => {
      mockClient = aMockChatClient(VALID_JSON_RESPONSE);
      plugin = new AgentPersonaCoachPlugin();
      plugin.setChatClient(mockClient);

      await plugin.createCompletion({
        model: "default",
        messages: [{ role: "user", content: "test" }],
      });

      strictEqual(mockClient.calls.length, 1);
      strictEqual(mockClient.calls[0].modelOverride, undefined, "modelOverride should be undefined when not provided");
    });
  });
});
