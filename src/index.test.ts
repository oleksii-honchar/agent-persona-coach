import { describe, it, beforeEach } from "node:test";
import { strictEqual, ok, deepStrictEqual, notStrictEqual } from "node:assert/strict";
import { AgentPersonaCoachPlugin } from "./index.js";
import { DEFAULT_CONFIG, deepMerge } from "./types.js";
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

  describe("onToolAfter — rules logic", () => {
    beforeEach(async () => {
      await plugin.initializeSession(AGENT_NAME, AGENT_INFO_V1);
    });

    it("should not have onToolBefore method (moved to onToolAfter)", () => {
      strictEqual(typeof (plugin as any).onToolBefore, "undefined", "onToolBefore should not exist on plugin");
    });

    it("should not trigger rules nudge when tool is not in criticalPermissions (DEFAULT_CONFIG)", () => {
      // DEFAULT_CONFIG has criticalPermissions: ["bash", "edit", "task"] — "write" is NOT critical
      for (let i = 0; i < 10; i++) {
        const result = plugin.onToolAfter(SESSION_ID, "write", {}, AGENT_NAME, AGENT_INFO_V1);
        ok(!result.some(n => n.includes("Rule Compliance")), `Rules nudge should not trigger at call ${i + 1} (write not critical)`);
      }
    });

    it("should not trigger rules nudge for non-critical tool", () => {
      for (let i = 0; i < 10; i++) {
        const result = plugin.onToolAfter(SESSION_ID, "read", {}, AGENT_NAME, AGENT_INFO_V1);
        ok(!result.some(n => n.includes("Rule Compliance")), `Rules nudge should not trigger for read at call ${i + 1}`);
      }
    });

    it("should trigger rules nudge at cadence when criticalPermissions includes tool name", async () => {
      // Plugin with criticalPermissions: ["bash"] — "bash" IS critical
      const rulesPlugin = new AgentPersonaCoachPlugin({
        categories: {
          identity: { enabled: false, cadence: 10, afterEachUserMessage: true },
          rules: { enabled: true, cadence: 10, criticalPermissions: ["bash"], criticalTools: [] },
          references: { enabled: false, cadence: 30 },
          progress: { enabled: false, cadence: 20 },
        },
      });
      const rulesMockClient = aMockChatClient(VALID_JSON_RESPONSE);
      rulesPlugin.setChatClient(rulesMockClient);
      await rulesPlugin.initializeSession(AGENT_NAME, AGENT_INFO_V1);

      // Calls 1-9 — no rules nudge (below cadence)
      for (let i = 0; i < 9; i++) {
        const result = rulesPlugin.onToolAfter(SESSION_ID, "bash", {}, AGENT_NAME, AGENT_INFO_V1);
        ok(!result.some(n => n.includes("Rule Compliance")), `Rules nudge should not trigger below cadence at call ${i + 1}`);
      }

      // Call 10 — rules nudge fires at cadence 10
      const result = rulesPlugin.onToolAfter(SESSION_ID, "bash", {}, AGENT_NAME, AGENT_INFO_V1);
      ok(result.some(n => n.includes("Rule Compliance")), "Rules nudge should trigger at cadence 10");
    });

    it("should not trigger rules nudge for non-critical tool even with criticalPermissions set", async () => {
      const rulesPlugin = new AgentPersonaCoachPlugin({
        categories: {
          identity: { enabled: false, cadence: 10, afterEachUserMessage: true },
          rules: { enabled: true, cadence: 10, criticalPermissions: ["bash"], criticalTools: [] },
          references: { enabled: false, cadence: 30 },
          progress: { enabled: false, cadence: 20 },
        },
      });
      const rulesMockClient2 = aMockChatClient(VALID_JSON_RESPONSE);
      rulesPlugin.setChatClient(rulesMockClient2);
      await rulesPlugin.initializeSession(AGENT_NAME, AGENT_INFO_V1);

      for (let i = 0; i < 10; i++) {
        const result = rulesPlugin.onToolAfter(SESSION_ID, "read", {}, AGENT_NAME, AGENT_INFO_V1);
        ok(!result.some(n => n.includes("Rule Compliance")), `Rules nudge should not trigger for read at call ${i + 1}`);
      }
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

  describe("deep merge config behavior", () => {
    it("should preserve other categories when overriding only one category partially", () => {
      const partialPlugin = new AgentPersonaCoachPlugin({
        categories: { identity: { cadence: 5 } },
      });
      // Overridden value
      strictEqual(partialPlugin.config.categories.identity.cadence, 5);
      // Preserved from DEFAULT_CONFIG
      strictEqual(partialPlugin.config.categories.rules.cadence, 10);
      strictEqual(partialPlugin.config.categories.references.cadence, 30);
      strictEqual(partialPlugin.config.categories.progress.cadence, 20);
    });

    it("should preserve other category fields when overriding one field in a category", () => {
      const partialPlugin = new AgentPersonaCoachPlugin({
        categories: { identity: { enabled: false } },
      });
      strictEqual(partialPlugin.config.categories.identity.enabled, false);
      // Other fields in identity category preserved from DEFAULT_CONFIG
      strictEqual(partialPlugin.config.categories.identity.cadence, 10);
      strictEqual(partialPlugin.config.categories.identity.afterEachUserMessage, true);
    });

    it("should use DEFAULT_CONFIG.coachPrompt when no coachPrompt in config", async () => {
      mockClient = aMockChatClient(VALID_JSON_RESPONSE);
      plugin = new AgentPersonaCoachPlugin();
      plugin.setChatClient(mockClient);
      await plugin.initializeSession(AGENT_NAME, AGENT_INFO_V1);

      strictEqual(mockClient.calls.length, 1);
      ok(mockClient.calls[0].messages[0].content.includes("IDENTITY CHECK"), "Default prompt should contain IDENTITY CHECK");
    });

    it("should use custom coachPrompt when provided in config", async () => {
      const customPrompt = "Custom coaching prompt: {personaText}";
      mockClient = aMockChatClient(VALID_JSON_RESPONSE);
      plugin = new AgentPersonaCoachPlugin({ coachPrompt: customPrompt });
      plugin.setChatClient(mockClient);
      await plugin.initializeSession(AGENT_NAME, AGENT_INFO_V1);

      strictEqual(mockClient.calls.length, 1);
      ok(mockClient.calls[0].messages[0].content.includes("Custom coaching prompt"), "Custom prompt should be used");
      // Custom prompt replaces the default
      ok(!mockClient.calls[0].messages[0].content.includes("IDENTITY CHECK"), "Custom prompt should not contain identity check section from default");
    });

    it("should fall back to DEFAULT_CONFIG.coachPrompt when coachPrompt is empty string", async () => {
      mockClient = aMockChatClient(VALID_JSON_RESPONSE);
      plugin = new AgentPersonaCoachPlugin({ coachPrompt: "" });
      plugin.setChatClient(mockClient);
      await plugin.initializeSession(AGENT_NAME, AGENT_INFO_V1);

      strictEqual(mockClient.calls.length, 1);
      ok(mockClient.calls[0].messages[0].content.includes("IDENTITY CHECK"), "Fallback to default prompt should contain IDENTITY CHECK");
    });

    it("should fall back to DEFAULT_CONFIG.coachPrompt when coachPrompt is null", async () => {
      mockClient = aMockChatClient(VALID_JSON_RESPONSE);
      plugin = new AgentPersonaCoachPlugin({ coachPrompt: null as any });
      plugin.setChatClient(mockClient);
      await plugin.initializeSession(AGENT_NAME, AGENT_INFO_V1);

      strictEqual(mockClient.calls.length, 1);
      ok(mockClient.calls[0].messages[0].content.includes("IDENTITY CHECK"), "Fallback to default prompt should contain IDENTITY CHECK");
    });

    it("should fall back to DEFAULT_CONFIG.coachPrompt when coachPrompt is undefined", async () => {
      mockClient = aMockChatClient(VALID_JSON_RESPONSE);
      plugin = new AgentPersonaCoachPlugin({ coachPrompt: undefined });
      plugin.setChatClient(mockClient);
      await plugin.initializeSession(AGENT_NAME, AGENT_INFO_V1);

      strictEqual(mockClient.calls.length, 1);
      ok(mockClient.calls[0].messages[0].content.includes("IDENTITY CHECK"), "Fallback to default prompt should contain IDENTITY CHECK");
    });

    it("should preserve deepMerge semantics with multiple partial overrides", () => {
      const mergedPlugin = new AgentPersonaCoachPlugin({
        enabled: false,
        categories: {
          identity: { cadence: 15 },
          progress: { enabled: false },
        },
      });
      // Overridden values
      strictEqual(mergedPlugin.config.enabled, false);
      strictEqual(mergedPlugin.config.categories.identity.cadence, 15);
      strictEqual(mergedPlugin.config.categories.progress.enabled, false);
      // Preserved from DEFAULT_CONFIG
      strictEqual(mergedPlugin.config.categories.identity.enabled, true);
      strictEqual(mergedPlugin.config.categories.rules.cadence, 10);
      strictEqual(mergedPlugin.config.categories.progress.cadence, 20);
    });

    it("should use DEFAULT_CONFIG.coachPrompt from deepMerge behavior (not defaulting in the plugin)", async () => {
      // This test confirms the coachPrompt flows through initializeSession
      // and does NOT use the default just because the config was built via deepMerge
      const customPrompt = "Focused prompt: {personaText}";
      mockClient = aMockChatClient(VALID_JSON_RESPONSE);
      plugin = new AgentPersonaCoachPlugin({ coachPrompt: customPrompt });
      plugin.setChatClient(mockClient);
      await plugin.initializeSession(AGENT_NAME, AGENT_INFO_V1);

      strictEqual(mockClient.calls.length, 1);
      // BuildCoachPrompt should use the custom promptTemplate
      ok(mockClient.calls[0].messages[0].content.includes("Focused prompt"));
      ok(!mockClient.calls[0].messages[0].content.includes("IDENTITY CHECK"));
    });
  });
});
