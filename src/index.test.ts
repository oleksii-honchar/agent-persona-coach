import { describe, it, beforeEach } from "node:test";
import { strictEqual, ok, deepStrictEqual, notStrictEqual } from "node:assert/strict";
import { AgentPersonaCoachPlugin, TraversalNudgeEngine } from "./index.js";
import { DEFAULT_CONFIG, deepMerge } from "./types.js";
import { aMockChatClient } from "./test-utils.js";
import { readFileSync } from "node:fs";

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

    it("should expose onToolBefore (Task 6 hard gate) returning null when the gate is off", () => {
      // DEFAULT_CONFIG: traversal.enabled=false and hardGate.enabled=false →
      // always null, never throws, never blocks.
      strictEqual(plugin.onToolBefore(SESSION_ID, "read", {}), null);
      strictEqual(plugin.onToolBefore(SESSION_ID, "bash", { command: "ls" }), null);
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

  describe("onToolAfter — traversal integration (C3)", () => {
    /**
     * Plugin with all generative categories disabled and traversal enabled
     * via deepMerge override (keeps DEFAULT traversal toolPatterns/etc).
     */
    function traversalPlugin(): AgentPersonaCoachPlugin {
      return new AgentPersonaCoachPlugin({
        categories: {
          identity: { enabled: false },
          rules: { enabled: false },
          references: { enabled: false },
          progress: { enabled: false },
          traversal: { enabled: true, nudgeAfter: 2, recurrentEvery: 2, maxRepeats: 3 },
        },
      });
    }

    it("should return a traversal nudge ONLY after nudgeAfter non-traversal calls", () => {
      const p = traversalPlugin();
      p.setChatClient(mockClient);

      p.onToolAfter(SESSION_ID, "bensyne_expandFileRelations", { file_id: "file_a" }, AGENT_NAME, {});

      const res1 = p.onToolAfter(SESSION_ID, "read", {}, AGENT_NAME, {});
      strictEqual(res1.some((n) => n.includes("Traversal Check")), false, "no traversal nudge before nudgeAfter");

      const res2 = p.onToolAfter(SESSION_ID, "read", {}, AGENT_NAME, {});
      ok(res2.some((n) => n.includes("Traversal Check")), "traversal nudge fires after nudgeAfter non-traversal calls");
    });

    it("should STOP returning traversal nudges after a traversal call advances the anchor", () => {
      const p = traversalPlugin();
      p.setChatClient(mockClient);

      p.onToolAfter(SESSION_ID, "bensyne_expandFileRelations", { file_id: "file_a" }, AGENT_NAME, {});
      p.onToolAfter(SESSION_ID, "read", {}, AGENT_NAME, {}); // non-traversal 1
      ok(p.onToolAfter(SESSION_ID, "read", {}, AGENT_NAME, {}).some((n) => n.includes("Traversal Check")), "nudge at cadence");

      // Traversal call re-anchors to a different node — streak resets
      p.onToolAfter(SESSION_ID, "bensyne_expandFileRelations", { file_id: "file_b" }, AGENT_NAME, {});
      const after = p.onToolAfter(SESSION_ID, "read", {}, AGENT_NAME, {});
      strictEqual(after.some((n) => n.includes("Traversal Check")), false, "no nudge right after anchor advance");
    });

    it("resetTraversal with onUserMessage:\"reset\" clears traversal state (escape hatch, AD-8)", () => {
      const p = new AgentPersonaCoachPlugin({
        categories: {
          identity: { enabled: false },
          rules: { enabled: false },
          references: { enabled: false },
          progress: { enabled: false },
          traversal: { enabled: true, nudgeAfter: 2, recurrentEvery: 2, maxRepeats: 3, onUserMessage: "reset" },
        },
      });
      p.setChatClient(mockClient);

      p.onToolAfter(SESSION_ID, "bensyne_expandFileRelations", { file_id: "file_a" }, AGENT_NAME, {});
      p.onToolAfter(SESSION_ID, "read", {}, AGENT_NAME, {});
      ok(p.onToolAfter(SESSION_ID, "read", {}, AGENT_NAME, {}).some((n) => n.includes("Traversal Check")));

      p.resetTraversal(SESSION_ID);

      // State cleared — non-traversal calls no longer nudge (no anchor)
      strictEqual(p.onToolAfter(SESSION_ID, "read", {}, AGENT_NAME, {}).some((n) => n.includes("Traversal Check")), false);
      strictEqual(p.onToolAfter(SESSION_ID, "read", {}, AGENT_NAME, {}).some((n) => n.includes("Traversal Check")), false);
    });

    it("clearSession should clear traversal state", () => {
      const p = traversalPlugin();
      p.setChatClient(mockClient);

      p.onToolAfter(SESSION_ID, "bensyne_expandFileRelations", { file_id: "file_a" }, AGENT_NAME, {});
      p.onToolAfter(SESSION_ID, "read", {}, AGENT_NAME, {});
      ok(p.onToolAfter(SESSION_ID, "read", {}, AGENT_NAME, {}).some((n) => n.includes("Traversal Check")));

      p.clearSession(SESSION_ID);

      strictEqual(p.onToolAfter(SESSION_ID, "read", {}, AGENT_NAME, {}).some((n) => n.includes("Traversal Check")), false);
    });

    it("should append traversal nudges to existing category nudges (no regression)", async () => {
      const p = new AgentPersonaCoachPlugin({
        categories: {
          identity: { enabled: true, cadence: 3 },
          rules: { enabled: false },
          references: { enabled: false },
          progress: { enabled: false },
          traversal: { enabled: true, nudgeAfter: 2, recurrentEvery: 2, maxRepeats: 3 },
        },
      });
      p.setChatClient(mockClient);
      await p.initializeSession(AGENT_NAME, AGENT_INFO_V1);

      p.onToolAfter(SESSION_ID, "bensyne_expandFileRelations", { file_id: "file_a" }, AGENT_NAME, AGENT_INFO_V1); // call 1
      p.onToolAfter(SESSION_ID, "read", {}, AGENT_NAME, AGENT_INFO_V1); // call 2, traversal streak 1
      const res = p.onToolAfter(SESSION_ID, "read", {}, AGENT_NAME, AGENT_INFO_V1); // call 3 + traversal streak 2

      ok(res.some((n) => n.includes("Identity Check")), "existing identity nudge still fires (cadence 3)");
      ok(res.some((n) => n.includes("Traversal Check")), "traversal nudge joins the same array");
    });

    it("should make zero LLM calls in traversal-only flows", () => {
      const p = traversalPlugin();
      const traversalMock = aMockChatClient(VALID_JSON_RESPONSE);
      p.setChatClient(traversalMock);

      // No initializeSession — pure traversal observation + nudging
      p.onToolAfter(SESSION_ID, "bensyne_getPersonaEntryNode", { memory_bank: "persona_worker" }, AGENT_NAME, {});
      p.onToolAfter(SESSION_ID, "read", {}, AGENT_NAME, {});
      ok(p.onToolAfter(SESSION_ID, "read", {}, AGENT_NAME, {}).some((n) => n.includes("Traversal Check")));
      p.onToolAfter(SESSION_ID, "bensyne_expandFileRelations", { file_id: "file_b" }, AGENT_NAME, {});
      p.onToolAfter(SESSION_ID, "read", {}, AGENT_NAME, {});

      strictEqual(traversalMock.calls.length, 0, "traversal mode must never trigger generation");
    });
  });

  // ── Task 6 (spec §3 + §6 wiring): bootstrap dispatch, before-hook delegate, resetTraversal routing ──

  describe("onToolBefore — hard-gate delegate (Task 6, spec §6)", () => {
    const GATE_WORDING = "BLOCKED — realign with the tree now.";

    /** Plugin with traversal enabled + hardGate enabled; anchor + realign window helper. */
    function gatePlugin(): AgentPersonaCoachPlugin {
      return new AgentPersonaCoachPlugin({
        categories: {
          identity: { enabled: false },
          rules: { enabled: false },
          references: { enabled: false },
          progress: { enabled: false },
          traversal: {
            enabled: true,
            nudgeAfter: 2,
            recurrentEvery: 2,
            maxRepeats: 3,
            hardGate: { enabled: true, wording: GATE_WORDING },
          },
        },
      });
    }

    /** Anchor a session then open the realignment window via resetTraversal (default realign). */
    function anchoredPending(p: AgentPersonaCoachPlugin, sessionId = SESSION_ID): void {
      p.onToolAfter(sessionId, "bensyne_expandFileRelations", { file_id: "file_a" }, AGENT_NAME, {});
      p.resetTraversal(sessionId); // default onUserMessage:"realign" → realign, not reset
    }

    it("returns null for an un-anchored session (never blocks outside a realignment window)", () => {
      const p = gatePlugin();
      p.setChatClient(mockClient);
      strictEqual(p.onToolBefore("fresh", "read", { path: "/tmp/a" }), null);
      strictEqual(p.onToolBefore("fresh", "bash", { command: "ls" }), null);
    });

    it("returns null for traversal tools during a pending realignment (allows)", () => {
      const p = gatePlugin();
      p.setChatClient(mockClient);
      anchoredPending(p);
      strictEqual(p.onToolBefore(SESSION_ID, "bensyne_expandFileRelations", { file_id: "file_b" }), null);
      strictEqual(p.onToolBefore(SESSION_ID, "bensyne_fetchFile", { file_id: "file_b" }), null);
      strictEqual(
        p.onToolBefore(SESSION_ID, "meta_use", {
          name: "bensyne_getPersonaEntryNode",
          args: { memory_bank: "agent-persona_worker" },
        }),
        null
      );
    });

    it("returns the hard-gate message (not a throw) for any other tool during a pending realignment", () => {
      const p = gatePlugin();
      p.setChatClient(mockClient);
      anchoredPending(p);
      const msg = p.onToolBefore(SESSION_ID, "read", { path: "/tmp/a" });
      ok(typeof msg === "string" && msg.includes("Hard Gate"), "returns the hard-gate message, never throws");
      ok(msg?.includes(GATE_WORDING), "message contains the configured gate wording");

      strictEqual(p.onToolBefore(SESSION_ID, "bash", { command: "ls" }), msg);
    });

    it("returns null again after the agent re-affirms via a traversal tool (window closes)", () => {
      const p = gatePlugin();
      p.setChatClient(mockClient);
      anchoredPending(p);

      // Window open → blocked.
      ok(typeof p.onToolBefore(SESSION_ID, "read", { path: "/tmp/a" }) === "string", "blocked while window open");

      // Re-affirmation consumes the window (observe traversal tool).
      p.onToolAfter(SESSION_ID, "bensyne_expandFileRelations", { file_id: "file_a" }, AGENT_NAME, {});
      strictEqual(p.onToolBefore(SESSION_ID, "read", { path: "/tmp/a" }), null, "window closed after re-affirmation");
    });
  });

  describe("resetTraversal routing + hasTraversalAnchor (Task 6 / ADR-0011)", () => {
    it("resetTraversal with onUserMessage:\"realign\" (default) keeps the anchor — first non-traversal call gets an immediate realign nudge", () => {
      // Same config as the traversalPlugin helper above (default onUserMessage:"realign").
      const p = new AgentPersonaCoachPlugin({
        categories: {
          identity: { enabled: false },
          rules: { enabled: false },
          references: { enabled: false },
          progress: { enabled: false },
          traversal: { enabled: true, nudgeAfter: 2, recurrentEvery: 2, maxRepeats: 3 },
        },
      });
      p.setChatClient(mockClient);

      p.onToolAfter(SESSION_ID, "bensyne_expandFileRelations", { file_id: "file_a" }, AGENT_NAME, {});
      p.resetTraversal(SESSION_ID); // routes to engine.realign (anchor preserved)

      ok(p.hasTraversalAnchor(SESSION_ID), "anchor is preserved after realign dispatch");
      const res = p.onToolAfter(SESSION_ID, "read", {}, AGENT_NAME, {});
      ok(res.some((n) => n.includes("Realign Check")), "first non-traversal call fires an immediate realign nudge");
    });

    it("resetTraversal with onUserMessage:\"reset\" wipes the anchor (escape hatch)", () => {
      const p = new AgentPersonaCoachPlugin({
        categories: {
          identity: { enabled: false },
          rules: { enabled: false },
          references: { enabled: false },
          progress: { enabled: false },
          traversal: { enabled: true, nudgeAfter: 2, recurrentEvery: 2, maxRepeats: 3, onUserMessage: "reset" },
        },
      });
      p.setChatClient(mockClient);

      p.onToolAfter(SESSION_ID, "bensyne_expandFileRelations", { file_id: "file_a" }, AGENT_NAME, {});
      ok(p.hasTraversalAnchor(SESSION_ID), "anchored before reset");
      p.resetTraversal(SESSION_ID); // routes to engine.reset (wipe)

      strictEqual(p.hasTraversalAnchor(SESSION_ID), false, "anchor is wiped after reset dispatch");
      const res = p.onToolAfter(SESSION_ID, "read", {}, AGENT_NAME, {});
      strictEqual(res.some((n) => n.includes("Traversal Check")), false, "no traversal nudge after reset");
    });

    it("hasTraversalAnchor reflects engine anchor state (bootstrap-queue signal)", () => {
      // Same config as the traversalPlugin helper above.
      const p = new AgentPersonaCoachPlugin({
        categories: {
          identity: { enabled: false },
          rules: { enabled: false },
          references: { enabled: false },
          progress: { enabled: false },
          traversal: { enabled: true, nudgeAfter: 2, recurrentEvery: 2, maxRepeats: 3 },
        },
      });
      p.setChatClient(mockClient);
      strictEqual(p.hasTraversalAnchor(SESSION_ID), false, "fresh session is un-anchored");
      p.onToolAfter(SESSION_ID, "bensyne_expandFileRelations", { file_id: "file_a" }, AGENT_NAME, {});
      strictEqual(p.hasTraversalAnchor(SESSION_ID), true, "anchored after a traversal call");
    });
  });

  describe("Task 6 — ADR-0012 bootstrap-nudge (docs)", () => {
    it("ADR-0012 exists in .vault/adrs/, parses as ADR-0012, and documents the bootstrap queue (mirrors identity-nudge bridge)", () => {
      const adr = readFileSync(
        new URL("../.vault/adrs/0012-bootstrap-nudge.adr.md", import.meta.url),
        "utf8"
      );
      ok(adr.includes("id: ADR-0012"));
      ok(adr.includes("bootstrap"));
      ok(adr.includes("pendingTraversal") || adr.includes("queue"), "documents the per-session queue bridge");
    });
  });

  describe("exports", () => {
    it("should export TraversalNudgeEngine for the server and tests", () => {
      strictEqual(typeof TraversalNudgeEngine, "function", "TraversalNudgeEngine should be exported from index");
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

  describe("supervisor wiring (Task 8, spec §7 / D7)", () => {
    const SUPERVISOR_LADDER = ["advisory-tier0", "explicit-tier1", "brutal-tier2"];
    const SKIP_VERDICT = JSON.stringify({ classification: "skip" });
    const EVASIVE_VERDICT = JSON.stringify({ classification: "evasive" });
    const COMPLIANT_VERDICT = JSON.stringify({ classification: "compliant" });

    function aSupervisorPlugin(supervisorOverrides: Record<string, unknown> = {}) {
      const plugin = new AgentPersonaCoachPlugin({
        categories: {
          identity: { enabled: false },
          rules: { enabled: false },
          references: { enabled: false },
          progress: { enabled: false },
          traversal: {
            supervisor: {
              enabled: true,
              model: "small-model",
              maxCallsPerSession: 10,
              sampleEvery: 2,
              ladderWording: SUPERVISOR_LADDER,
              ...supervisorOverrides,
            },
          },
        },
      });
      return plugin;
    }

    it("supervise returns the escalated ladder text on 'skip' and escalates on consecutive skips", async () => {
      const client = aMockChatClient([SKIP_VERDICT, SKIP_VERDICT]);
      const plugin = aSupervisorPlugin();
      plugin.setChatClient(client);
      plugin.appendAssistantTurn("ses-8", "last assistant reply without node status");

      const first = await plugin.supervise("ses-8", plugin.getRecentAssistantTurns("ses-8"));
      strictEqual(first.kind, "skip", "first skip verdict kind");
      strictEqual(first.text, "advisory-tier0", "first skip escalates to tier0");

      const second = await plugin.supervise("ses-8", plugin.getRecentAssistantTurns("ses-8"));
      strictEqual(second.kind, "skip");
      strictEqual(second.text, "explicit-tier1", "second consecutive skip escalates to tier1");

      strictEqual(client.calls.length, 2, "one judge call per supervise");
    });

    it("supervise returns the escalated text on 'evasive'", async () => {
      const client = aMockChatClient(EVASIVE_VERDICT);
      const plugin = aSupervisorPlugin();
      plugin.setChatClient(client);
      plugin.appendAssistantTurn("ses-8", "the weather is nice (unrelated)");

      const result = await plugin.supervise("ses-8", plugin.getRecentAssistantTurns("ses-8"));

      strictEqual(result.kind, "evasive");
      strictEqual(result.text, "advisory-tier0", "first evasive escalates to tier0");
    });

    it("resets the skip chain on 'compliant' so the next skip starts at tier0 again", async () => {
      const client = aMockChatClient([SKIP_VERDICT, COMPLIANT_VERDICT, SKIP_VERDICT]);
      const plugin = aSupervisorPlugin();
      plugin.setChatClient(client);
      plugin.appendAssistantTurn("ses-8", "compliant reply");

      const skip1 = await plugin.supervise("ses-8", plugin.getRecentAssistantTurns("ses-8"));
      strictEqual(skip1.text, "advisory-tier0");

      const compliant = await plugin.supervise("ses-8", plugin.getRecentAssistantTurns("ses-8"));
      strictEqual(compliant.kind, "compliant");
      strictEqual(compliant.text, undefined, "compliant carries no escalated text");

      const skip2 = await plugin.supervise("ses-8", plugin.getRecentAssistantTurns("ses-8"));
      strictEqual(skip2.text, "advisory-tier0", "skip chain reset on compliant");
    });

    it("makes no LLM call when the supervisor is disabled (returns compliant)", async () => {
      const client = aMockChatClient(SKIP_VERDICT);
      const plugin = new AgentPersonaCoachPlugin();
      plugin.setChatClient(client);
      plugin.appendAssistantTurn("ses-8", "irrelevant");

      const result = await plugin.supervise("ses-8", []);
      strictEqual(result.kind, "compliant");
      strictEqual(result.text, undefined);
      strictEqual(client.calls.length, 0, "no createCompletion when supervisor disabled");
    });

    it("ring buffer is bounded by traversal.historyDepth (default 5)", () => {
      const plugin = aSupervisorPlugin();
      for (let i = 1; i <= 7; i++) {
        plugin.appendAssistantTurn("ses-8", `turn-${i}`);
      }
      const turns = plugin.getRecentAssistantTurns("ses-8");
      strictEqual(turns.length, 5, "buffer caps at historyDepth");
      strictEqual(turns[0], "turn-3", "oldest entry kept");
      strictEqual(turns[4], "turn-7", "newest entry kept");
    });

    it("supervise with a throwing client does not reject (best-effort, D7)", async () => {
      const client = aMockChatClient(SKIP_VERDICT);
      const throwing = {
        calls: [] as any[],
        async createCompletion() {
          throw new Error("model explode");
        },
      };
      const plugin = aSupervisorPlugin();
      plugin.setChatClient(throwing as any);
      plugin.appendAssistantTurn("ses-8", "last turn");

      let settled = false;
      let result: { kind: string; text?: string } | undefined;
      try {
        result = await plugin.supervise("ses-8", plugin.getRecentAssistantTurns("ses-8"));
        settled = true;
      } catch {
        settled = false;
      }

      ok(settled, "supervise must not throw when judge's model client throws");
      strictEqual(result?.kind, "compliant", "failure fails open to compliant");
      strictEqual(result?.text, undefined);
    });
  });
});
