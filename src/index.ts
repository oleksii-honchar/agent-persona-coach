import type { ChatClient } from "./generator.js";
import type { CoachState, DeepPartial, PluginConfig } from "./types.js";
import { DEFAULT_CONFIG, extractPersona, deepMerge } from "./types.js";
import { CoachQuestionsCache } from "./cache.js";
import { CoachGenerator, extractJsonFromMarkdown } from "./generator.js";
import { CoachStateManager } from "./state.js";
import { formatNudge } from "./injector.js";
import { TraversalNudgeEngine } from "./traversal.js";
import { log } from "./logger.js";

/**
 * Agent Persona Coach Plugin
 *
 * Generates persona-specific reflection questions at session start
 * and injects them at predefined cadences during the session.
 *
 * Categories:
 * - Identity Check: every 4 tool calls (after)
 * - Rule Compliance: before critical tools (write/edit/bash/task)
 * - Reference Check: once, after 2 tool calls
 * - Progress Check: every 8 tool calls (after)
 */
export class AgentPersonaCoachPlugin {
  public readonly config: PluginConfig;
  private cache: CoachQuestionsCache;
  private generator: CoachGenerator;
  private stateManager: CoachStateManager;
  private traversalEngine: TraversalNudgeEngine;
  private agentPersonas = new Map<string, string>();

  constructor(config: DeepPartial<PluginConfig> = {}) {
    this.config = deepMerge(DEFAULT_CONFIG, config);
    this.cache = new CoachQuestionsCache();
    this.generator = new CoachGenerator(this);
    this.stateManager = new CoachStateManager(this.config);
    this.traversalEngine = new TraversalNudgeEngine(this.config.categories.traversal);
  }

  // ---- ChatClient interface (used by generator) ----

  /**
   * In production, this would be injected with the actual model client.
   * For now, it's a placeholder.
   */
  private chatClient: ChatClient | null = null;

  setChatClient(client: ChatClient): void {
    this.chatClient = client;
  }

  async createCompletion(request: {
    model: string;
    messages: Array<{ role: "user" | "assistant" | "system"; content: string }>;
    modelOverride?: { providerID: string; modelID: string };
  }): Promise<{ text: string }> {
    if (!this.chatClient) {
      throw new Error(
        "[persona-coach] ChatClient not set. Call setChatClient() with the model client."
      );
    }
    return this.chatClient.createCompletion(request);
  }

  // ---- Public API ----

  /**
   * Called at session start to generate (or retrieve cached) questions.
   */
  async initializeSession(
    agentName: string,
    agentInfo: { prompt?: string; system?: string; model?: { providerID: string; modelID: string } }
  ): Promise<void> {
    const personaText = extractPersona(agentInfo);
    if (!personaText) {
      log.warn(`No persona text found for agent ${agentName}. Skipping.`);
      return;
    }

    this.agentPersonas.set(agentName, personaText);

    // Guard against empty/null coachPrompt — fall back to default
    const promptTemplate = this.config.coachPrompt || DEFAULT_CONFIG.coachPrompt;

    // Generate or retrieve cached questions
    const questions = await this.cache.getOrGenerate(
      agentName,
      personaText,
      agentInfo.model,
      promptTemplate,
      (name: string, text: string, promptTmpl: string, modelOverride) =>
        this.generator.generate(name, text, promptTmpl, modelOverride)
    );

    log.info(`Session initialized for agent ${agentName} with ${Object.values(questions.questions).flat().length} questions`);
  }

  /**
   * Called after each tool execution.
   * Returns all applicable nudge strings (multiple categories may fire at same cadence).
   * Returns an empty array if no categories should be injected.
   */
  onToolAfter(
    sessionId: string,
    toolName: string,
    toolArgs: unknown,
    agentName: string,
    agentInfo: Record<string, unknown>
  ): string[] {
    const state = this.stateManager.incrementToolCall(sessionId);
    const nudges: string[] = [];

    // Check all cadence-based categories — accumulate all matches
    if (this.shouldInject(state, agentName, "identity")) {
      const nudge = this.buildNudge("identity", agentName, agentInfo);
      if (nudge) nudges.push(nudge);
    }
    if (this.shouldInject(state, agentName, "references")) {
      this.stateManager.markReferenceCheckInjected(sessionId);
      const nudge = this.buildNudge("references", agentName, agentInfo);
      if (nudge) nudges.push(nudge);
    }
    if (this.shouldInject(state, agentName, "progress")) {
      const nudge = this.buildNudge("progress", agentName, agentInfo);
      if (nudge) nudges.push(nudge);
    }

    // Rules logic (moved from onToolBefore)
    // Note: isToolCritical called with undefined metadata — will return false until
    // Task 15 fixes isToolCritical to work without metadata.
    if (this.stateManager.isToolCritical(toolName, undefined)) {
      const rulesState = this.stateManager.incrementCriticalToolCall(sessionId);
      if (this.stateManager.shouldInjectRuleCompliance(rulesState, toolName, undefined)) {
        const nudge = this.buildNudge("rules", agentName, agentInfo);
        if (nudge) nudges.push(nudge);
      }
    }

    // Traversal-nudge mode (C3, ADR-0009): deterministic observation after the
    // existing category nudges. Returns [] unless the traversal cadence holds;
    // makes no LLM calls (AD-7).
    nudges.push(...this.traversalEngine.observeTool(sessionId, toolName, toolArgs));

    return nudges;
  }

  /**
   * Reset traversal state for a session (new task boundary — `chat.message`).
   */
  resetTraversal(sessionId: string): void {
    this.traversalEngine.reset(sessionId);
  }

  // ---- Private helpers ----

  private shouldInject(
    state: CoachState,
    agentName: string,
    category: "identity" | "references" | "progress"
  ): boolean {
    switch (category) {
      case "identity":
        return this.stateManager.shouldInjectIdentityCheck(state);
      case "references":
        return this.stateManager.shouldInjectReferenceCheck(state);
      case "progress":
        return this.stateManager.shouldInjectProgressCheck(state);
    }
  }

  private buildNudge(
    category: "identity" | "rules" | "references" | "progress",
    agentName: string,
    agentInfo: Record<string, unknown>
  ): string | null {
    const personaText = this.agentPersonas.get(agentName) ?? extractPersona(agentInfo);
    if (!personaText) return null;

    const questions = this.cache.get(agentName, personaText);
    if (!questions || !questions.questions[category]?.length) {
      return null;
    }

    return formatNudge(category, questions.questions[category]);
  }

  /**
   * Invalidate cache for an agent (persona changed).
   */
  invalidateCache(agentName: string): void {
    this.cache.invalidate(agentName);
    this.agentPersonas.delete(agentName);
  }

  /**
   * Clear all session state.
   */
  clearSession(sessionId: string): void {
    this.stateManager.clear(sessionId);
    this.traversalEngine.clear(sessionId);
  }
}

export { CoachQuestionsCache, CoachGenerator, extractJsonFromMarkdown, CoachStateManager };
export { TraversalNudgeEngine } from "./traversal.js";
export { formatNudge } from "./injector.js";
export { extractPersona } from "./types.js";
export type {
  CoachQuestions,
  CoachState,
  PluginConfig,
} from "./types.js";
export type { ChatClient } from "./generator.js";

// Plugin entry point — default export for better-opencode plugin system
export { default } from "./server.js";
