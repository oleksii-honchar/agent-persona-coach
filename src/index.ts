import type { ChatClient } from "./generator.js";
import type { CoachState, PluginConfig } from "./types.js";
import { DEFAULT_CONFIG, extractPersona } from "./types.js";
import { CoachQuestionsCache } from "./cache.js";
import { CoachGenerator, extractJsonFromMarkdown } from "./generator.js";
import { CoachStateManager } from "./state.js";
import { formatNudge, injectNudge } from "./injector.js";
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
  private config: PluginConfig;
  private cache: CoachQuestionsCache;
  private generator: CoachGenerator;
  private stateManager: CoachStateManager;

  constructor(config: Partial<PluginConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.cache = new CoachQuestionsCache();
    this.generator = new CoachGenerator(this);
    this.stateManager = new CoachStateManager(this.config);
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
  }): Promise<{ text: string }> {
    if (!this.chatClient) {
      throw new Error(
        "[persona-coach] ChatClient not set. Call setChatClient() with the model client."
      );
    }
    return this.chatClient.createCompletion(request);
  }

  // ---- Agent Info Resolution ----

  /**
   * Resolve agent info from the SDK client when agentInfo is empty.
   * Fetches the full config from the server and extracts the agent's prompt.
   */
  async resolveAgentInfo(
    agentName: string,
    client: unknown
  ): Promise<Record<string, unknown>> {
    // If client is not available, return empty object
    if (!client || typeof client !== "object") {
      return {};
    }

    // Try to fetch agent info from the SDK client
    try {
      const configClient = (client as any).config;
      if (!configClient || typeof configClient.get !== "function") {
        return {};
      }

      const config = await configClient.get();
      const configData = config?.data ?? config;

      if (configData?.agent && typeof configData.agent === "object") {
        const agentEntry = configData.agent[agentName];
        if (agentEntry && typeof agentEntry === "object") {
          log.info(`Resolved agent info for ${agentName} from SDK client`);
          return agentEntry as Record<string, unknown>;
        }
      }

      log.warn(`Agent ${agentName} not found in SDK client config`);
    } catch (err) {
      log.warn(`Failed to resolve agent info from SDK client`, {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    return {};
  }

  // ---- Public API ----

  /**
   * Called at session start to generate (or retrieve cached) questions.
   */
  async initializeSession(
    agentName: string,
    agentInfo: Record<string, unknown>
  ): Promise<void> {
    const personaText = extractPersona(agentInfo);
    if (!personaText) {
      log.warn(`No persona text found for agent ${agentName}. Skipping.`);
      return;
    }

    // Generate or retrieve cached questions
    const questions = await this.cache.getOrGenerate(agentName, personaText, (name: string, text: string) =>
      this.generator.generate(name, text)
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
    _toolName: string,
    _toolArgs: unknown,
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

    return nudges;
  }

  /**
   * Called before each tool execution.
   * Returns a nudge string if rule compliance should be checked, or null.
   */
  onToolBefore(
    sessionId: string,
    toolName: string,
    toolMetadata: { requiresPermission?: string },
    agentName: string,
    agentInfo: Record<string, unknown>
  ): string | null {
    // First check if the tool is critical at all (permission/name check only)
    if (!this.stateManager.isToolCritical(toolName, toolMetadata)) return null;

    // Increment critical count BEFORE cadence check (so 2nd call has count=2, 2%2=0)
    const state = this.stateManager.incrementCriticalToolCall(sessionId);

    // Check cadence: inject on every N-th critical call
    if (this.stateManager.shouldInjectRuleCompliance(state, toolName, toolMetadata)) {
      return this.buildNudge("rules", agentName, agentInfo);
    }

    return null;
  }

  /**
   * Update system prompt with one or more nudges if needed.
   */
  updateSystemPrompt(systemPrompt: string, nudge: string | string[] | null): string {
    if (!nudge) return systemPrompt;
    const nudges = Array.isArray(nudge) ? nudge : [nudge];
    return nudges.reduce((prompt, n) => injectNudge(prompt, n), systemPrompt);
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
    const personaText = extractPersona(agentInfo);
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
  }

  /**
   * Clear all session state.
   */
  clearSession(sessionId: string): void {
    this.stateManager.clear(sessionId);
  }
}

export { CoachQuestionsCache, CoachGenerator, extractJsonFromMarkdown, CoachStateManager };
export { formatNudge, injectNudge } from "./injector.js";
export { extractPersona } from "./types.js";
export type {
  CoachQuestions,
  CoachState,
  PluginConfig,
} from "./types.js";
export type { ChatClient } from "./generator.js";

// Plugin entry point — default export for better-opencode plugin system
export { default } from "./server.js";
