import {
  formatTraversalNudge,
  formatBacktrackNudge,
  formatRealignNudge,
  formatHardGateMessage,
} from "./injector.js";

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
  maxRepeats: number | typeof Infinity; // cap per anchor; Infinity = unlimited cadence (D4)
  historyDepth: number; // path history size for backtrack suggestions
  backtrackAfter: number; // same-node re-anchors before a backtrack nudge fires
  wording: string; // progress template with {node}
  stuckWording: string; // backtrack template with {node}
  // ── Task 1: extended config surface (spec §8, D8) — mirrors types.ts ──
  onUserMessage: "reset" | "realign";
  bootstrapWording: string;
  realignWording: string;
  ladderWording: string[];
  hardGate: { enabled: boolean; allowedTools?: string[]; wording: string };
  supervisor: {
    enabled: boolean;
    model: string;
    maxCallsPerSession: number;
    sampleEvery: number;
    ladderWording: string[];
  };
}

export interface TraversalSessionState {
  anchorNode?: string; // last traversal tool label (e.g. "expandFileRelations")
  path: string[]; // recent anchor history (last historyDepth) — for backtrack suggestions
  pending: boolean; // agent anchored on a node
  realignPending: boolean; // a user message arrived and the agent must re-affirm (D3 / spec §4)
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

/**
 * Resolve the hard gate's effective allow-list (spec §6 / D6):
 * `toolPatterns ∪ hardGate.allowedTools` — and `toolPatterns` alone when
 * `allowedTools` is not provided / empty. Pure; the engine exposes it via the
 * `hardGateAllowedTools` getter so callers (and tests) can observe it.
 */
export function resolveHardGateAllowList(config: TraversalConfig): string[] {
  const explicit =
    config.hardGate.allowedTools?.filter((t) => typeof t === "string" && t !== "") ?? [];
  if (explicit.length === 0) return [...config.toolPatterns];
  return [...new Set([...config.toolPatterns, ...explicit])];
}

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
   * Realign a session after a user message (onUserMessage: "realign" — D3).
   * Keeps the anchor (node, kind, path) but re-opens the compliance window:
   * the next observation must be a traversal call (re-affirmation) or the
   * first non-traversal call fires an immediate realign nudge.
   */
  realign(sessionId: string): void {
    const state = this.getState(sessionId);
    state.realignPending = true;
    state.nonTraversalCalls = 0;
    state.repeats = 0;
    state.cycleCount = 0;
  }

  /**
   * Whether a session is anchored on a decision-tree node (used by the
   * bootstrap wiring — Task 6). Pure engine state.
   */
  hasAnchor(sessionId: string): boolean {
    const state = this.getState(sessionId);
    return state.pending === true && state.anchorNode !== undefined;
  }

  /**
   * The hard gate's observable effective allow-list (spec §6 / D6):
   * `toolPatterns ∪ hardGate.allowedTools`, falling back to `toolPatterns`
   * when `allowedTools` is not provided or empty.
   */
  get hardGateAllowedTools(): string[] {
    return resolveHardGateAllowList(this.config);
  }

  /**
   * Deterministic blocking decision for the hard gate (spec §6 / D6) — the
   * narrow, opt-in exception to ADR-0009 (see ADR-0013). Returns the message
   * to block with, or null to allow. The engine only RETURNS the message —
   * the server's before-hook (Task 6) throws it.
   *
   * Block/allow matrix:
   * - `!config.enabled` or `!config.hardGate.enabled` → null (feature off, D8).
   * - un-anchored session → null (first-time sessions are covered by the
   *   bootstrap path, never the gate).
   * - `realignPending === false` → null (never block outside the realignment
   *   window).
   * - traversal tool (`isTraversalTool`, reused) or tool in the effective
   *   allow-list → null (allows).
   * - any other tool → `formatHardGateMessage(hardGate.wording)`.
   */
  blockIfNeeded(sessionID: string, toolName: string, toolArgs?: unknown): string | null {
    if (!this.config.enabled || !this.config.hardGate.enabled) return null;
    if (!this.hasAnchor(sessionID)) return null;
    const state = this.getState(sessionID);
    if (state.realignPending !== true) return null;
    if (this.isTraversalTool(toolName, toolArgs)) return null;
    if (this.matchesAnyPattern(toolName, this.hardGateAllowedTools, toolArgs)) return null;
    return formatHardGateMessage(this.config.hardGate.wording);
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
    return this.matchesAnyPattern(toolName, this.config.toolPatterns, toolArgs);
  }

  /**
   * Substring match of a tool name (and, for `meta_use`-wrapped shapes, the
   * wrapped `args.name`) against any pattern in the given list. Shared by
   * `isTraversalTool` (toolPatterns) and `blockIfNeeded` (effective
   * allow-list) — single source of truth for shape handling.
   */
  private matchesAnyPattern(toolName: string, patterns: string[], toolArgs?: unknown): boolean {
    if (patterns.some((p) => toolName.includes(p))) return true;
    if (toolArgs && typeof toolArgs === "object") {
      const name = (toolArgs as Record<string, unknown>).name;
      if (typeof name === "string") {
        return patterns.some((p) => name.includes(p));
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

    // ANY traversal call — first-anchor, advancement, or same-node re-anchor —
    // means the agent has re-affirmed/aligned (spec §4 / D3).
    state.realignPending = false;

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

    // Realign window (D3): the first non-traversal call emits the realign
    // nudge immediately, before the nudgeAfter cadence. The flag is consumed
    // so subsequent calls follow the normal ladder cadence.
    if (state.realignPending) {
      state.repeats++;
      const nudge = this.buildProgressNudge(state);
      state.realignPending = false;
      return [nudge];
    }

    const calls = state.nonTraversalCalls;
    if (calls < this.config.nudgeAfter) return [];
    if ((calls - this.config.nudgeAfter) % this.config.recurrentEvery !== 0) return [];

    state.repeats++;
    return [this.buildProgressNudge(state)];
  }

  private buildProgressNudge(state: TraversalSessionState): string {
    const nodeLabel = state.anchorNode ?? "";
    if (state.realignPending) {
      return formatRealignNudge(this.config.realignWording, nodeLabel);
    }
    if (state.anchorKind === "pause") {
      return formatTraversalNudge(PAUSE_NODE_WORDING, nodeLabel);
    }
    return formatTraversalNudge(this.ladderWordingFor(state.repeats), nodeLabel);
  }

  /**
   * Select the progress-nudge wording by intensity tier (spec §5.2 / D4).
   * tier 0 (repeats < 3): advisory; tier 1 (3 <= repeats < 6): explicit;
   * tier 2 (repeats >= 6): stern. Missing ladder entries fall back to the
   * advisory `wording` — never throws, never emits undefined.
   */
  private ladderWordingFor(repeats: number): string {
    const tier = repeats < 3 ? 0 : repeats < 6 ? 1 : 2;
    const entry = this.config.ladderWording[tier];
    if (typeof entry === "string" && entry !== "") return entry;
    return this.config.wording;
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
      realignPending: false,
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
