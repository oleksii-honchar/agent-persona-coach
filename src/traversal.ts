import { formatTraversalNudge, formatBacktrackNudge } from "./injector.js";

/**
 * Traversal-Nudge mode — deterministic, zero-LLM state machine (AD-7).
 *
 * Observes tool calls after execution and, when the agent is anchored on a
 * decision-tree node, injects recurrent <system-reminder> nudges to follow the
 * node and traverse to the next one. Pure observation + state (AD-7, AD-8) —
 * no model client dependency.
 */

export interface TraversalConfig {
  enabled: boolean;
  toolPatterns: string[]; // substring match on tool name
  nudgeAfter: number; // first nudge after N non-traversal calls
  recurrentEvery: number; // re-nudge every N calls after first
  maxRepeats: number; // cap per anchor
  historyDepth: number; // path history size for backtrack suggestions
  backtrackAfter: number; // same-node re-anchors before a backtrack nudge fires
  wording: string; // progress template with {node}
  stuckWording: string; // backtrack template with {node}
}

export interface TraversalSessionState {
  anchorNode?: string; // last traversal tool label (e.g. "expandFileRelations")
  path: string[]; // recent anchor history (last historyDepth) — for backtrack suggestions
  pending: boolean; // agent anchored on a node
  nonTraversalCalls: number; // consecutive non-traversal calls since anchor
  repeats: number; // nudges already injected for this anchor
  cycleCount: number; // consecutive re-anchors on the SAME node (stuck-in-branch signal)
  anchorKind?: "normal" | "pause"; // pause/wait node classification (AD-13)
}

/**
 * Pause-node wording (AD-13): a node whose `veto` is non-empty is a wait node —
 * the agent must not proceed until the user answers. Biases the progress nudge.
 */
const PAUSE_NODE_WORDING =
  "You are on a wait node ({node}) — do not proceed until the user answers; re-expand when direction is received.";

export class TraversalNudgeEngine {
  private states = new Map<string, TraversalSessionState>();

  constructor(private config: TraversalConfig) {}

  /**
   * Observe one tool call for a session. Returns nudges to inject (empty when
   * none apply). Traversal calls re-anchor the state machine; non-traversal
   * calls accrue toward the nudge cadence.
   */
  observeTool(sessionId: string, toolName: string, toolArgs?: unknown): string[] {
    if (!this.config.enabled) return [];
    const state = this.getState(sessionId);
    if (this.isTraversalTool(toolName, toolArgs)) {
      return this.observeTraversal(state, toolName, toolArgs);
    }
    return this.observeNonTraversal(state);
  }

  /**
   * Reset a session's traversal state (new task boundary — `chat.message`).
   */
  reset(sessionId: string): void {
    this.states.set(sessionId, this.createState());
  }

  /**
   * Remove a session's traversal state entirely.
   */
  clear(sessionId: string): void {
    this.states.delete(sessionId);
  }

  /**
   * Read a session's traversal state (creates a fresh empty state on first access).
   */
  getState(sessionId: string): TraversalSessionState {
    let state = this.states.get(sessionId);
    if (!state) {
      state = this.createState();
      this.states.set(sessionId, state);
    }
    return state;
  }

  // ---- Internals ----

  /**
   * Substring match against configured tool patterns. Covers direct
   * `bensyne_*` names, LiteLLM double-prefixed names, and `meta_use`-wrapped
   * shapes (the wrapped tool name lives in args.name).
   */
  private isTraversalTool(toolName: string, toolArgs?: unknown): boolean {
    if (this.config.toolPatterns.some((p) => toolName.includes(p))) return true;
    if (toolArgs && typeof toolArgs === "object") {
      const name = (toolArgs as Record<string, unknown>).name;
      if (typeof name === "string") {
        return this.config.toolPatterns.some((p) => name.includes(p));
      }
    }
    return false;
  }

  /**
   * Prefer `file_id`/`node_id` from args (clean, unique node identity — AD-13);
   * fall back to the tool name. Unwraps `meta_use` shape `{ name, args }`.
   */
  private extractNodeId(toolName: string, toolArgs?: unknown): string {
    const args = this.normalizeArgs(toolName, toolArgs);
    if (args) {
      const fileId = args.file_id;
      if (typeof fileId === "string" && fileId) return fileId;
      const nodeId = args.node_id;
      if (typeof nodeId === "string" && nodeId) return nodeId;
    }
    return toolName;
  }

  /**
   * Best-effort pause-node classification (AD-13, OQ11): a non-empty `veto` in
   * `fetchFile` output frontmatter marks a pause/wait node. Falls back to
   * "normal" when unavailable.
   */
  private classifyAnchor(toolName: string, toolArgs?: unknown): "normal" | "pause" {
    const args = this.normalizeArgs(toolName, toolArgs);
    const veto = args?.veto;
    if (Array.isArray(veto) && veto.length > 0) return "pause";
    if (typeof veto === "string" && veto.trim() !== "") return "pause";
    return "normal";
  }

  /**
   * Any different node — forward OR backward — counts as advancement
   * (AD-12 labyrinth rule); resets cycleCount.
   */
  private isAnchorChanged(newAnchor: string, prevAnchor: string): boolean {
    return newAnchor !== prevAnchor;
  }

  private observeTraversal(
    state: TraversalSessionState,
    toolName: string,
    toolArgs?: unknown
  ): string[] {
    const nodeId = this.extractNodeId(toolName, toolArgs);
    const kind = this.classifyAnchor(toolName, toolArgs);
    const nudges: string[] = [];

    if (state.pending && state.anchorNode !== undefined) {
      if (this.isAnchorChanged(nodeId, state.anchorNode)) {
        // Advancement — forward or backward jump: re-anchor, reset counters.
        state.anchorNode = nodeId;
        state.anchorKind = kind;
        state.cycleCount = 0;
        state.repeats = 0;
        state.nonTraversalCalls = 0;
        this.pushPath(state, nodeId);
      } else {
        // Same-node re-anchor — stuck-in-branch signal.
        state.cycleCount++;
        state.repeats = 0;
        state.nonTraversalCalls = 0;
        if (
          state.cycleCount >= this.config.backtrackAfter &&
          state.cycleCount % this.config.backtrackAfter === 0
        ) {
          nudges.push(formatBacktrackNudge(this.config.stuckWording, state.path));
        }
      }
    } else {
      // First anchor for this session.
      state.pending = true;
      state.anchorNode = nodeId;
      state.anchorKind = kind;
      state.cycleCount = 0;
      state.repeats = 0;
      state.nonTraversalCalls = 0;
      this.pushPath(state, nodeId);
    }

    return nudges;
  }

  private observeNonTraversal(state: TraversalSessionState): string[] {
    state.nonTraversalCalls++;
    if (!state.pending || state.anchorNode === undefined) return [];
    if (state.repeats >= this.config.maxRepeats) return [];

    const calls = state.nonTraversalCalls;
    if (calls < this.config.nudgeAfter) return [];
    if ((calls - this.config.nudgeAfter) % this.config.recurrentEvery !== 0) return [];

    state.repeats++;
    return [this.buildProgressNudge(state)];
  }

  private buildProgressNudge(state: TraversalSessionState): string {
    const nodeLabel = state.anchorNode ?? "";
    if (state.anchorKind === "pause") {
      return formatTraversalNudge(PAUSE_NODE_WORDING, nodeLabel);
    }
    return formatTraversalNudge(this.config.wording, nodeLabel);
  }

  /**
   * Append a node to the path history, capping at historyDepth. Consecutive
   * duplicates are not pushed (same-node re-anchors are cycles, not steps).
   */
  private pushPath(state: TraversalSessionState, nodeId: string): void {
    if (state.path[state.path.length - 1] !== nodeId) {
      state.path.push(nodeId);
      if (state.path.length > this.config.historyDepth) {
        state.path = state.path.slice(-this.config.historyDepth);
      }
    }
  }

  private createState(): TraversalSessionState {
    return {
      anchorNode: undefined,
      path: [],
      pending: false,
      nonTraversalCalls: 0,
      repeats: 0,
      cycleCount: 0,
      anchorKind: undefined,
    };
  }

  /**
   * Unwrap `meta_use`-wrapped args (`{ name, args: {...} }`) to the inner args
   * object so `file_id`/`node_id`/`veto` are read from the wrapped call.
   */
  private normalizeArgs(
    _toolName: string,
    toolArgs?: unknown
  ): Record<string, unknown> | undefined {
    if (!toolArgs || typeof toolArgs !== "object") return undefined;
    const args = toolArgs as Record<string, unknown>;
    if (typeof args.name === "string" && args.args && typeof args.args === "object") {
      return args.args as Record<string, unknown>;
    }
    return args;
  }
}