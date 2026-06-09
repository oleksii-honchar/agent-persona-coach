import { describe, it, beforeEach } from "node:test";
import { strictEqual, ok } from "node:assert/strict";
import { CoachStateManager } from "./state.js";
import { DEFAULT_CONFIG, type PluginConfig } from "./types.js";

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
      // getState returns a new throwaway object if state was never persisted.
      // State is only persisted when incrementToolCall or markReferenceCheckInjected stores it.
      manager.incrementToolCall("session-1");
      const state1 = manager.getState("session-1");
      const state2 = manager.getState("session-1");
      strictEqual(state1, state2);
    });

    it("should not persist state for session that has never been modified", () => {
      // Untouched sessions return fresh objects each time
      const state1 = manager.getState("fresh-session");
      const state2 = manager.getState("fresh-session");
      // Both should have default values but be different objects
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

  describe("shouldInjectIdentityCheck — cadence at 4", () => {
    it("should return false at call 0 (no tool calls yet)", () => {
      const state = manager.getState("session-1");
      ok(!manager.shouldInjectIdentityCheck(state));
    });

    it("should return true at call 4", () => {
      const session = "session-1";
      for (let i = 0; i < 4; i++) manager.incrementToolCall(session);
      const state = manager.getState(session);
      ok(manager.shouldInjectIdentityCheck(state));
    });

    it("should return true at call 8", () => {
      const session = "session-1";
      for (let i = 0; i < 8; i++) manager.incrementToolCall(session);
      const state = manager.getState(session);
      ok(manager.shouldInjectIdentityCheck(state));
    });

    it("should return true at call 12", () => {
      const session = "session-1";
      for (let i = 0; i < 12; i++) manager.incrementToolCall(session);
      const state = manager.getState(session);
      ok(manager.shouldInjectIdentityCheck(state));
    });

    it("should return false at call 1 (not divisible by 4)", () => {
      const session = "session-1";
      manager.incrementToolCall(session);
      const state = manager.getState(session);
      ok(!manager.shouldInjectIdentityCheck(state));
    });

    it("should return false at call 3", () => {
      const session = "session-1";
      for (let i = 0; i < 3; i++) manager.incrementToolCall(session);
      const state = manager.getState(session);
      ok(!manager.shouldInjectIdentityCheck(state));
    });

    it("should return false at call 5", () => {
      const session = "session-1";
      for (let i = 0; i < 5; i++) manager.incrementToolCall(session);
      const state = manager.getState(session);
      ok(!manager.shouldInjectIdentityCheck(state));
    });
  });

  describe("shouldInjectProgressCheck — cadence at 8", () => {
    it("should return false at call 0", () => {
      const state = manager.getState("session-1");
      ok(!manager.shouldInjectProgressCheck(state));
    });

    it("should return true at call 8", () => {
      const session = "session-1";
      for (let i = 0; i < 8; i++) manager.incrementToolCall(session);
      const state = manager.getState(session);
      ok(manager.shouldInjectProgressCheck(state));
    });

    it("should return true at call 16", () => {
      const session = "session-1";
      for (let i = 0; i < 16; i++) manager.incrementToolCall(session);
      const state = manager.getState(session);
      ok(manager.shouldInjectProgressCheck(state));
    });

    it("should return false at call 4 (identity cadence, not progress)", () => {
      const session = "session-1";
      for (let i = 0; i < 4; i++) manager.incrementToolCall(session);
      const state = manager.getState(session);
      ok(!manager.shouldInjectProgressCheck(state));
    });

    it("should return false at call 7", () => {
      const session = "session-1";
      for (let i = 0; i < 7; i++) manager.incrementToolCall(session);
      const state = manager.getState(session);
      ok(!manager.shouldInjectProgressCheck(state));
    });
  });

  describe("shouldInjectReferenceCheck — once after 2 calls", () => {
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

    it("should return true at call 2 (threshold reached)", () => {
      const session = "session-1";
      manager.incrementToolCall(session);
      manager.incrementToolCall(session);
      const state = manager.getState(session);
      ok(manager.shouldInjectReferenceCheck(state));
    });

    it("should return true at call 5 (threshold exceeded, not yet marked)", () => {
      const session = "session-1";
      for (let i = 0; i < 5; i++) manager.incrementToolCall(session);
      const state = manager.getState(session);
      ok(manager.shouldInjectReferenceCheck(state));
    });

    it("should return false after reference check is marked as injected", () => {
      const session = "session-1";
      for (let i = 0; i < 3; i++) manager.incrementToolCall(session);
      manager.markReferenceCheckInjected(session);
      const state = manager.getState(session);
      ok(!manager.shouldInjectReferenceCheck(state));
    });

    it("should return false after reference check is marked even at high call counts", () => {
      const session = "session-1";
      for (let i = 0; i < 10; i++) manager.incrementToolCall(session);
      manager.markReferenceCheckInjected(session);
      const state = manager.getState(session);
      ok(!manager.shouldInjectReferenceCheck(state));
    });
  });

  describe("shouldInjectRuleCompliance — before critical tools", () => {
    it("should return true for write permission via metadata", () => {
      ok(manager.shouldInjectRuleCompliance("someTool", { requiresPermission: "write" }));
    });

    it("should return true for bash permission via metadata", () => {
      ok(manager.shouldInjectRuleCompliance("runCmd", { requiresPermission: "bash" }));
    });

    it("should return true for task permission via metadata", () => {
      ok(manager.shouldInjectRuleCompliance("delegateTask", { requiresPermission: "task" }));
    });

    it("should return true for create permission via metadata", () => {
      ok(manager.shouldInjectRuleCompliance("createFile", { requiresPermission: "create" }));
    });

    it("should return false for non-critical permission via metadata", () => {
      ok(!manager.shouldInjectRuleCompliance("readFile", { requiresPermission: "read" }));
    });

    it("should return false for tool with no metadata and empty criticalTools", () => {
      ok(!manager.shouldInjectRuleCompliance("someHarmlessTool"));
    });

    it("should return false for tool with no metadata (undefined permissions)", () => {
      ok(!manager.shouldInjectRuleCompliance("someTool", {}));
    });
  });

  describe("clear", () => {
    it("should reset state for a session", () => {
      const session = "session-1";
      manager.incrementToolCall(session);
      manager.incrementToolCall(session);
      manager.markReferenceCheckInjected(session);

      manager.clear(session);

      const state = manager.getState(session);
      strictEqual(state.toolCallCount, 0);
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
      for (let i = 0; i < 4; i++) disabledManager.incrementToolCall(session);
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
      for (let i = 0; i < 8; i++) disabledManager.incrementToolCall(session);
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
      for (let i = 0; i < 3; i++) disabledManager.incrementToolCall(session);
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
      ok(!disabledManager.shouldInjectRuleCompliance("someTool", { requiresPermission: "write" }));
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
        ok(customManager.shouldInjectRuleCompliance("dangerousTool"));
        ok(customManager.shouldInjectRuleCompliance("anotherTool"));
        ok(!customManager.shouldInjectRuleCompliance("safeTool"));
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
        ok(!customManager.shouldInjectRuleCompliance("anyTool"));
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
  });
});
