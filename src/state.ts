import type { CoachState, PluginConfig } from "./types.js";

export class CoachStateManager {
  private states = new Map<string, CoachState>();

  constructor(private config: PluginConfig) {}

  getState(sessionId: string): CoachState {
    return (
      this.states.get(sessionId) ?? {
        toolCallCount: 0,
        criticalToolCallCount: 0,
        referenceCheckInjected: false,
      }
    );
  }

  incrementToolCall(sessionId: string): CoachState {
    const state = this.getState(sessionId);
    state.toolCallCount++;
    this.states.set(sessionId, state);
    return state;
  }

  markReferenceCheckInjected(sessionId: string): void {
    const state = this.getState(sessionId);
    state.referenceCheckInjected = true;
    this.states.set(sessionId, state);
  }

  shouldInjectIdentityCheck(state: CoachState): boolean {
    return (
      this.config.categories.identity.enabled &&
      state.toolCallCount > 0 &&
      state.toolCallCount % this.config.categories.identity.cadence === 0
    );
  }

  shouldInjectRuleCompliance(
    state: CoachState,
    toolName: string,
    toolMetadata?: { requiresPermission?: string }
  ): boolean {
    if (!this.isToolCritical(toolName, toolMetadata)) return false;

    // Cadence check: inject only on every N-th critical call
    return (
      state.criticalToolCallCount > 0 &&
      state.criticalToolCallCount % this.config.categories.rules.cadence === 0
    );
  }

  /**
   * Check if a tool is critical based on permission metadata or name.
   * Does NOT include cadence check — that's the caller's responsibility.
   */
  isToolCritical(
    toolName: string,
    toolMetadata?: { requiresPermission?: string }
  ): boolean {
    if (!this.config.categories.rules.enabled) return false;

    // Check permission tier from tool metadata (MetaTool-compatible)
    if (toolMetadata?.requiresPermission) {
      return this.config.categories.rules.criticalPermissions.includes(toolMetadata.requiresPermission);
    }
    // Check specific tool names from config
    if (this.config.categories.rules.criticalTools.length > 0) {
      return this.config.categories.rules.criticalTools.includes(toolName);
    }
    return false;
  }

  /**
   * Increment the critical tool call counter for a session.
   * Returns the updated state.
   */
  incrementCriticalToolCall(sessionId: string): CoachState {
    const state = this.getState(sessionId);
    state.criticalToolCallCount++;
    this.states.set(sessionId, state);
    return state;
  }

  shouldInjectReferenceCheck(state: CoachState): boolean {
    return (
      this.config.categories.references.enabled &&
      !state.referenceCheckInjected &&
      state.toolCallCount >= this.config.categories.references.afterCalls
    );
  }

  shouldInjectProgressCheck(state: CoachState): boolean {
    return (
      this.config.categories.progress.enabled &&
      state.toolCallCount > 0 &&
      state.toolCallCount % this.config.categories.progress.cadence === 0
    );
  }

  clear(sessionId: string): void {
    this.states.delete(sessionId);
  }
}
