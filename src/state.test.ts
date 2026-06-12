import { describe, it, beforeEach } from "node:test";
import { strictEqual, ok, deepStrictEqual } from "node:assert/strict";
import { CoachStateManager } from "./state.js";
import { DEFAULT_CONFIG, type PluginConfig } from "./types.js";

const RULES_CONFIG: PluginConfig = {
  ...DEFAULT_CONFIG,
  categories: {
    ...DEFAULT_CONFIG.categories,
    rules: { ...DEFAULT_CONFIG.categories.rules, criticalPermissions: ["bash", "edit", "task"] },
  },
};

describe("CoachStateManager", () => {
  let manager: CoachStateManager;

  beforeEach(() => {
    manager = new CoachStateManager(DEFAULT_CONFIG);
  });

  describe("getState", () => {
    it("should return initial state for unknown session", () => {
      const state = manager.getState("session-1");
      strictEqual(state.toolCallCount, 0);
      strictEqual(state.referenceCheckInjected, false);
    });

    it("should return same object reference for same session after state is persisted via increment", () => {
      manager.incrementToolCall("session-1");
      const state1 = manager.getState("session-1");
      const state2 = manager.getState("session-1");
      strictEqual(state1, state2);
    });

    it("should not persist state for session that has never been modified", () => {
      const state1 = manager.getState("fresh-session");
      const state2 = manager.getState("fresh-session");
      strictEqual(state1.toolCallCount, 0);
      strictEqual(state2.toolCallCount, 0);
      ok(state1 !== state2, "Fresh sessions get new objects each call");
    });

    it("should return different objects for different sessions", () => {
      const state1 = manager.getState("session-1");
      const state2 = manager.getState("session-2");
      ok(state1 !== state2);
    });
  });

  describe("incrementToolCall", () => {
    it("should increment tool call count from 0 to 1", () => {
      const state = manager.incrementToolCall("session-1");
      strictEqual(state.toolCallCount, 1);
    });

    it("should increment tool call count over multiple calls", () => {
      manager.incrementToolCall("session-1");
      manager.incrementToolCall("session-1");
      const state = manager.incrementToolCall("session-1");
      strictEqual(state.toolCallCount, 3);
    });

    it("should track tool calls independently per session", () => {
      manager.incrementToolCall("session-1");
      manager.incrementToolCall("session-1");
      const state = manager.incrementToolCall("session-2");
      strictEqual(state.toolCallCount, 1);
    });
  });

  describe("markReferenceCheckInjected", () => {
    it("should mark reference check as injected", () => {
      manager.markReferenceCheckInjected("session-1");
      const state = manager.getState("session-1");
      strictEqual(state.referenceCheckInjected, true);
    });
  });

  describe("shouldInjectIdentityCheck — cadence at 10 (DEFAULT_CONFIG)", () => {
    it("should return false at call 0 (no tool calls yet)", () => {
      const state = manager.getState("session-1");
      ok(!manager.shouldInjectIdentityCheck(state));
    });

    it("should return true at call 10", () => {
      const session = "session-1";
      for (let i = 0; i < 10; i++) manager.incrementToolCall(session);
      const state = manager.getState(session);
      ok(manager.shouldInjectIdentityCheck(state));
    });

    it("should return true at call 20", () => {
      const session = "session-1";
      for (let i = 0; i < 20; i++) manager.incrementToolCall(session);
      const state = manager.getState(session);
      ok(manager.shouldInjectIdentityCheck(state));
    });

    it("should return true at call 30", () => {
      const session = "session-1";
      for (let i = 0; i < 30; i++) manager.incrementToolCall(session);
      const state = manager.getState(session);
      ok(manager.shouldInjectIdentityCheck(state));
    });

    it("should return false at call 1 (not divisible by 10)", () => {
      const session = "session-1";
      manager.incrementToolCall(session);
      const state = manager.getState(session);
      ok(!manager.shouldInjectIdentityCheck(state));
    });

    it("should return false at call 5", () => {
      const session = "session-1";
      for (let i = 0; i < 5; i++) manager.incrementToolCall(session);
      const state = manager.getState(session);
      ok(!manager.shouldInjectIdentityCheck(state));
    });

    it("should return false at call 9", () => {
      const session = "session-1";
      for (let i = 0; i < 9; i++) manager.incrementToolCall(session);
      const state = manager.getState(session);
      ok(!manager.shouldInjectIdentityCheck(state));
    });
  });

  describe("shouldInjectProgressCheck — cadence at 20 (DEFAULT_CONFIG)", () => {
    it("should return false at call 0", () => {
      const state = manager.getState("session-1");
      ok(!manager.shouldInjectProgressCheck(state));
    });

    it("should return true at call 20", () => {
      const session = "session-1";
      for (let i = 0; i < 20; i++) manager.incrementToolCall(session);
      const state = manager.getState(session);
      ok(manager.shouldInjectProgressCheck(state));
    });

    it("should return true at call 40", () => {
      const session = "session-1";
      for (let i = 0; i < 40; i++) manager.incrementToolCall(session);
      const state = manager.getState(session);
      ok(manager.shouldInjectProgressCheck(state));
    });

    it("should return false at call 10 (identity cadence, not progress)", () => {
      const session = "session-1";
      for (let i = 0; i < 10; i++) manager.incrementToolCall(session);
      const state = manager.getState(session);
      ok(!manager.shouldInjectProgressCheck(state));
    });

    it("should return false at call 15", () => {
      const session = "session-1";
      for (let i = 0; i < 15; i++) manager.incrementToolCall(session);
      const state = manager.getState(session);
      ok(!manager.shouldInjectProgressCheck(state));
    });
  });

  describe("shouldInjectReferenceCheck — once after 30 calls (DEFAULT_CONFIG)", () => {
    it("should return false at call 0", () => {
      const state = manager.getState("session-1");
      ok(!manager.shouldInjectReferenceCheck(state));
    });

    it("should return false at call 1 (before threshold)", () => {
      const session = "session-1";
      manager.incrementToolCall(session);
      const state = manager.getState(session);
      ok(!manager.shouldInjectReferenceCheck(state));
    });

    it("should return true at call 30 (threshold reached)", () => {
      const session = "session-1";
      for (let i = 0; i < 30; i++) manager.incrementToolCall(session);
      const state = manager.getState(session);
      ok(manager.shouldInjectReferenceCheck(state));
    });

    it("should return true at call 35 (threshold exceeded, not yet marked)", () => {
      const session = "session-1";
      for (let i = 0; i < 35; i++) manager.incrementToolCall(session);
      const state = manager.getState(session);
      ok(manager.shouldInjectReferenceCheck(state));
    });

    it("should return false after reference check is marked as injected", () => {
      const session = "session-1";
      for (let i = 0; i < 31; i++) manager.incrementToolCall(session);
      manager.markReferenceCheckInjected(session);
      const state = manager.getState(session);
      ok(!manager.shouldInjectReferenceCheck(state));
    });

    it("should return false after reference check is marked even at high call counts", () => {
      const session = "session-1";
      for (let i = 0; i < 50; i++) manager.incrementToolCall(session);
      manager.markReferenceCheckInjected(session);
      const state = manager.getState(session);
      ok(!manager.shouldInjectReferenceCheck(state));
    });
  });

  describe("shouldInjectRuleCompliance — cadence-based (RULES_CONFIG cadence 10)", () => {
    let rulesManager: CoachStateManager;

    beforeEach(() => {
      rulesManager = new CoachStateManager(RULES_CONFIG);
    });

    it("should return false at 1st critical call", () => {
      const state = { criticalToolCallCount: 1, toolCallCount: 1, referenceCheckInjected: false };
      ok(!rulesManager.shouldInjectRuleCompliance(state, "someTool", { requiresPermission: "edit" }));
    });

    it("should return true at 10th critical call (cadence 10)", () => {
      const state = { criticalToolCallCount: 10, toolCallCount: 10, referenceCheckInjected: false };
      ok(rulesManager.shouldInjectRuleCompliance(state, "someTool", { requiresPermission: "edit" }));
    });

    it("should return false at 5th critical call", () => {
      const state = { criticalToolCallCount: 5, toolCallCount: 5, referenceCheckInjected: false };
      ok(!rulesManager.shouldInjectRuleCompliance(state, "someTool", { requiresPermission: "edit" }));
    });

    it("should return true at 20th critical call (cadence 10)", () => {
      const state = { criticalToolCallCount: 20, toolCallCount: 20, referenceCheckInjected: false };
      ok(rulesManager.shouldInjectRuleCompliance(state, "someTool", { requiresPermission: "edit" }));
    });

    it("should return false at 0 critical calls", () => {
      const state = { criticalToolCallCount: 0, toolCallCount: 0, referenceCheckInjected: false };
      ok(!rulesManager.shouldInjectRuleCompliance(state, "someTool", { requiresPermission: "edit" }));
    });

    it("should return true at 1st critical call when cadence is 1 (old behavior)", () => {
      const cadence1Config: PluginConfig = {
        ...RULES_CONFIG,
        categories: {
          ...RULES_CONFIG.categories,
          rules: { ...RULES_CONFIG.categories.rules, cadence: 1 },
        },
      };
      const cadence1Manager = new CoachStateManager(cadence1Config);
      const state = { criticalToolCallCount: 1, toolCallCount: 1, referenceCheckInjected: false };
      ok(cadence1Manager.shouldInjectRuleCompliance(state, "someTool", { requiresPermission: "edit" }));
    });

    it("should return false for non-critical permission even at cadence boundary", () => {
      const state = { criticalToolCallCount: 10, toolCallCount: 10, referenceCheckInjected: false };
      ok(!rulesManager.shouldInjectRuleCompliance(state, "readFile", { requiresPermission: "read" }));
    });

    it("should return false for tool with no metadata and empty criticalTools", () => {
      const state = { criticalToolCallCount: 10, toolCallCount: 10, referenceCheckInjected: false };
      ok(!rulesManager.shouldInjectRuleCompliance(state, "someHarmlessTool"));
    });

    it("should return false for tool with no metadata (undefined permissions)", () => {
      const state = { criticalToolCallCount: 10, toolCallCount: 10, referenceCheckInjected: false };
      ok(!rulesManager.shouldInjectRuleCompliance(state, "someTool", {}));
    });
  });

  describe("isToolCritical — criticality only (no cadence)", () => {
    let rulesManager: CoachStateManager;

    beforeEach(() => {
      rulesManager = new CoachStateManager(RULES_CONFIG);
    });

    it("should return true for edit permission via metadata", () => {
      ok(rulesManager.isToolCritical("someTool", { requiresPermission: "edit" }));
    });

    it("should return true for bash permission via metadata", () => {
      ok(rulesManager.isToolCritical("runCmd", { requiresPermission: "bash" }));
    });

    it("should return true for task permission via metadata", () => {
      ok(rulesManager.isToolCritical("delegateTask", { requiresPermission: "task" }));
    });

    it("should return true for edit permission via metadata (createFile)", () => {
      ok(rulesManager.isToolCritical("createFile", { requiresPermission: "edit" }));
    });

    it("should return false for non-critical permission via metadata", () => {
      ok(!rulesManager.isToolCritical("readFile", { requiresPermission: "read" }));
    });

    it("should return false for tool with no metadata and empty criticalTools", () => {
      ok(!rulesManager.isToolCritical("someHarmlessTool"));
    });

    it("should return false for tool with no metadata (undefined permissions)", () => {
      ok(!rulesManager.isToolCritical("someTool", {}));
    });

    // ---- Metadata-less path (Task 15) ----

    it("should return true for tool name matching criticalPermissions without metadata", () => {
      // "edit" is in RULES_CONFIG.criticalPermissions; no metadata provided
      ok(rulesManager.isToolCritical("edit"));
    });

    it("should return true for tool name matching criticalPermissions without metadata (bash)", () => {
      ok(rulesManager.isToolCritical("bash"));
    });

    it("should return true for tool name matching criticalPermissions without metadata (task)", () => {
      ok(rulesManager.isToolCritical("task"));
    });

    it("should return true for tool name matching criticalPermissions without metadata (edit)", () => {
      ok(rulesManager.isToolCritical("edit"));
    });

    it("should return false for tool name NOT in criticalPermissions without metadata", () => {
      ok(!rulesManager.isToolCritical("readFile"));
    });

    it("should return false for tool name NOT in criticalPermissions without metadata (empty criticalTools)", () => {
      ok(!rulesManager.isToolCritical("someHarmlessTool"));
    });

    it("should prefer requiresPermission over toolName when both are provided", () => {
      // toolName "edit" is in criticalPermissions, but requiresPermission "read" is NOT
      // requiresPermission takes precedence
      ok(!rulesManager.isToolCritical("edit", { requiresPermission: "read" }));
    });

    it("should fall back to toolName when requiresPermission is not in criticalPermissions", () => {
      // requiresPermission "unknown" is NOT in criticalPermissions, toolName "edit" IS
      // With the new logic: permissionName = toolMetadata?.requiresPermission ?? toolName
      // So "unknown" is checked, not "edit"
      ok(!rulesManager.isToolCritical("edit", { requiresPermission: "unknown" }));
    });
  });

  describe("incrementCriticalToolCall", () => {
    it("should increment critical tool call count from 0 to 1", () => {
      const state = manager.incrementCriticalToolCall("session-1");
      strictEqual(state.criticalToolCallCount, 1);
    });

    it("should increment critical tool call count over multiple calls", () => {
      manager.incrementCriticalToolCall("session-1");
      manager.incrementCriticalToolCall("session-1");
      const state = manager.incrementCriticalToolCall("session-1");
      strictEqual(state.criticalToolCallCount, 3);
    });

    it("should track critical calls independently per session", () => {
      manager.incrementCriticalToolCall("session-1");
      manager.incrementCriticalToolCall("session-1");
      const state = manager.incrementCriticalToolCall("session-2");
      strictEqual(state.criticalToolCallCount, 1);
    });
  });

  describe("clear", () => {
    it("should reset state for a session", () => {
      const session = "session-1";
      manager.incrementToolCall(session);
      manager.incrementToolCall(session);
      manager.incrementCriticalToolCall(session);
      manager.markReferenceCheckInjected(session);

      manager.clear(session);

      const state = manager.getState(session);
      strictEqual(state.toolCallCount, 0);
      strictEqual(state.criticalToolCallCount, 0);
      strictEqual(state.referenceCheckInjected, false);
    });

    it("should not affect other sessions", () => {
      manager.incrementToolCall("session-1");
      manager.incrementToolCall("session-2");
      manager.incrementToolCall("session-2");

      manager.clear("session-2");

      const state1 = manager.getState("session-1");
      strictEqual(state1.toolCallCount, 1);
    });
  });

  describe("disabled categories", () => {
    it("should not inject identity check when disabled", () => {
      const disabledConfig: PluginConfig = {
        ...DEFAULT_CONFIG,
        categories: {
          ...DEFAULT_CONFIG.categories,
          identity: { ...DEFAULT_CONFIG.categories.identity, enabled: false },
        },
      };
      const disabledManager = new CoachStateManager(disabledConfig);
      const session = "session-1";
      for (let i = 0; i < 10; i++) disabledManager.incrementToolCall(session);
      const state = disabledManager.getState(session);
      ok(!disabledManager.shouldInjectIdentityCheck(state));
    });

    it("should not inject progress check when disabled", () => {
      const disabledConfig: PluginConfig = {
        ...DEFAULT_CONFIG,
        categories: {
          ...DEFAULT_CONFIG.categories,
          progress: { ...DEFAULT_CONFIG.categories.progress, enabled: false },
        },
      };
      const disabledManager = new CoachStateManager(disabledConfig);
      const session = "session-1";
      for (let i = 0; i < 20; i++) disabledManager.incrementToolCall(session);
      const state = disabledManager.getState(session);
      ok(!disabledManager.shouldInjectProgressCheck(state));
    });

    it("should not inject reference check when disabled", () => {
      const disabledConfig: PluginConfig = {
        ...DEFAULT_CONFIG,
        categories: {
          ...DEFAULT_CONFIG.categories,
          references: { ...DEFAULT_CONFIG.categories.references, enabled: false },
        },
      };
      const disabledManager = new CoachStateManager(disabledConfig);
      const session = "session-1";
      for (let i = 0; i < 31; i++) disabledManager.incrementToolCall(session);
      const state = disabledManager.getState(session);
      ok(!disabledManager.shouldInjectReferenceCheck(state));
    });

    it("should not inject rule compliance when disabled", () => {
      const disabledConfig: PluginConfig = {
        ...DEFAULT_CONFIG,
        categories: {
          ...DEFAULT_CONFIG.categories,
          rules: { ...DEFAULT_CONFIG.categories.rules, enabled: false },
        },
      };
      const disabledManager = new CoachStateManager(disabledConfig);
      const state = { criticalToolCallCount: 10, toolCallCount: 10, referenceCheckInjected: false };
      ok(!disabledManager.shouldInjectRuleCompliance(state, "someTool", { requiresPermission: "write" }));
    });

    it("should not consider tool critical when disabled", () => {
      const disabledConfig: PluginConfig = {
        ...DEFAULT_CONFIG,
        categories: {
          ...DEFAULT_CONFIG.categories,
          rules: { ...DEFAULT_CONFIG.categories.rules, enabled: false },
        },
      };
      const disabledManager = new CoachStateManager(disabledConfig);
      ok(!disabledManager.isToolCritical("someTool", { requiresPermission: "write" }));
    });

    describe("custom criticalTools config", () => {
      it("should return true for tool name in criticalTools list", () => {
        const customConfig: PluginConfig = {
          ...DEFAULT_CONFIG,
          categories: {
            ...DEFAULT_CONFIG.categories,
            rules: {
              ...DEFAULT_CONFIG.categories.rules,
              criticalPermissions: [],
              criticalTools: ["dangerousTool", "anotherTool"],
            },
          },
        };
        const customManager = new CoachStateManager(customConfig);
        ok(customManager.isToolCritical("dangerousTool"));
        ok(customManager.isToolCritical("anotherTool"));
        ok(!customManager.isToolCritical("safeTool"));
      });

      it("should return false when criticalTools is empty and no permission metadata", () => {
        const customConfig: PluginConfig = {
          ...DEFAULT_CONFIG,
          categories: {
            ...DEFAULT_CONFIG.categories,
            rules: {
              ...DEFAULT_CONFIG.categories.rules,
              criticalPermissions: [],
              criticalTools: [],
            },
          },
        };
        const customManager = new CoachStateManager(customConfig);
        ok(!customManager.isToolCritical("anyTool"));
      });

      it("should apply cadence with custom criticalTools", () => {
        const customConfig: PluginConfig = {
          ...DEFAULT_CONFIG,
          categories: {
            ...DEFAULT_CONFIG.categories,
            rules: {
              ...DEFAULT_CONFIG.categories.rules,
              criticalPermissions: [],
              criticalTools: ["dangerousTool"],
            },
          },
        };
        const customManager = new CoachStateManager(customConfig);
        // DEFAULT_CONFIG has cadence 10 for rules
        const state = { criticalToolCallCount: 10, toolCallCount: 10, referenceCheckInjected: false };
        ok(customManager.shouldInjectRuleCompliance(state, "dangerousTool"));
        const state1 = { criticalToolCallCount: 1, toolCallCount: 1, referenceCheckInjected: false };
        ok(!customManager.shouldInjectRuleCompliance(state1, "dangerousTool"));
      });
    });
  });

  describe("custom cadence", () => {
    it("should respect custom identity cadence of 3", () => {
      const customConfig: PluginConfig = {
        ...DEFAULT_CONFIG,
        categories: {
          ...DEFAULT_CONFIG.categories,
          identity: { ...DEFAULT_CONFIG.categories.identity, cadence: 3 },
        },
      };
      const customManager = new CoachStateManager(customConfig);
      const session = "session-1";
      for (let i = 0; i < 3; i++) customManager.incrementToolCall(session);
      ok(customManager.shouldInjectIdentityCheck(customManager.getState(session)));

      customManager.incrementToolCall(session);
      ok(!customManager.shouldInjectIdentityCheck(customManager.getState(session)));
    });

    it("should respect custom progress cadence of 5", () => {
      const customConfig: PluginConfig = {
        ...DEFAULT_CONFIG,
        categories: {
          ...DEFAULT_CONFIG.categories,
          progress: { ...DEFAULT_CONFIG.categories.progress, cadence: 5 },
        },
      };
      const customManager = new CoachStateManager(customConfig);
      const session = "session-1";
      for (let i = 0; i < 5; i++) customManager.incrementToolCall(session);
      ok(customManager.shouldInjectProgressCheck(customManager.getState(session)));
    });

    it("should respect custom rules cadence of 3", () => {
      const customConfig: PluginConfig = {
        ...RULES_CONFIG,
        categories: {
          ...RULES_CONFIG.categories,
          rules: { ...RULES_CONFIG.categories.rules, cadence: 3 },
        },
      };
      const customManager = new CoachStateManager(customConfig);

      // 1st critical call — no nudge
      const s1 = { criticalToolCallCount: 1, toolCallCount: 1, referenceCheckInjected: false };
      ok(!customManager.shouldInjectRuleCompliance(s1, "someTool", { requiresPermission: "edit" }));

      // 2nd critical call — no nudge (cadence is 3)
      const s2 = { criticalToolCallCount: 2, toolCallCount: 2, referenceCheckInjected: false };
      ok(!customManager.shouldInjectRuleCompliance(s2, "someTool", { requiresPermission: "edit" }));

      // 3rd critical call — nudge
      const s3 = { criticalToolCallCount: 3, toolCallCount: 3, referenceCheckInjected: false };
      ok(customManager.shouldInjectRuleCompliance(s3, "someTool", { requiresPermission: "edit" }));
    });
  });
});
