import { AgentPersonaCoachPlugin } from "./index.js";
import { ProviderChatClient } from "./provider-client.js";
import { extractPersonaFromSystem } from "./types.js";
import type { DeepPartial, PluginConfig } from "./types.js";

import { log } from "./logger.js";

// ── Plugin System Types (matching better-opencode plugin signatures) ──────────

export interface PluginInput {
  client: unknown;
  project: unknown;
  directory: string;
  worktree: string;
  serverUrl: URL;
  $: unknown;
}

export type PluginOptions = Record<string, unknown>;

export interface Hooks {
  "chat.message"?: (
    input: {
      sessionID: string;
      agent?: string;
      model?: { providerID: string; modelID: string };
      messageID?: string;
      variant?: string;
    },
    output: { message: unknown; parts: unknown[] }
  ) => Promise<void>;

  "tool.execute.after"?: (
    input: { tool: string; sessionID: string; callID: string; args: unknown },
    output: {
      title: string;
      output: string;
      metadata: unknown;
      inject?: Array<{ role: "user" | "system"; text: string }>;
    }
  ) => Promise<void>;

  "experimental.chat.system.transform"?: (
    input: {
      sessionID?: string;
      model?: { providerID: string; id: string; [key: string]: unknown };
      agent?: string; // NEW — agent identity for this LLM call
    },
    output: { system: string[] }
  ) => Promise<void>;
}

// Hidden native agents that reuse the session's sessionID for their LLM call.
// (title/summary/compaction are mode:"primary" + hidden:true in agent.ts).
// explore/scout are mode:"subagent" — they have their own sessions and can be
// the legitimately tracked session agent, so they must NOT be in this list.
const NATIVE_AGENT_NAMES = new Set(["title", "summary", "compaction"]);

export type Plugin = (
  input: PluginInput,
  options?: PluginOptions
) => Promise<Hooks>;

// ── Hook Factory (exported for testability) ──────────────────────────────────

/**
 * Creates the plugin hooks wired to a given AgentPersonaCoachPlugin instance.
 * Exported so tests can pass a fully mocked plugin.
 */
export async function createServerHooks(
  plugin: AgentPersonaCoachPlugin,
  pluginInput: PluginInput
): Promise<Hooks> {
  log.info("[persona-coach] Plugin started");

  // Per-session state
  const sessionAgent = new Map<string, string>();
  const initializedSessions = new Set<string>();
  const pendingUserMessageIdentity = new Map<string, boolean>();

  return {
    /**
     * chat.message — Fires on each user message.
     * Tracks the agent name for this session and flags identity nudges.
     * Session initialization is delegated to experimental.chat.system.transform
     * where the system prompt (including persona text) is available.
     */
    "chat.message": async (input, _output) => {
      const { sessionID, agent } = input;
      if (!agent || !sessionID) return;

      // Track agent name for this session (for use in tool hooks)
      sessionAgent.set(sessionID, agent);

      // Flag identity nudge for injection after each user message
      if (
        plugin.config?.categories?.identity?.enabled &&
        plugin.config?.categories?.identity?.afterEachUserMessage
      ) {
        pendingUserMessageIdentity.set(sessionID, true);
        log.info(`Identity nudge queued for session ${sessionID}`);
      }

      // Reset the traversal engine — a new user message is a new task
      // boundary: the previous node anchor must not carry over (spec C3 / AD-8).
      plugin.resetTraversal?.(sessionID);
    },

   /**
      * tool.execute.after — Fires after each tool execution.
     * Checks cadence-based categories (identity, references, progress)
     * and injects the nudge as a synthetic system message via output.inject.
     */
    "tool.execute.after": async (input, output) => {
      const { tool, sessionID, args } = input;
      const agentName = sessionAgent.get(sessionID) ?? "";

      const nudges = plugin.onToolAfter?.(sessionID, tool, args, agentName, {}) ?? [];

      if (nudges.length > 0) {
        const categories = nudges
          .map(n => n.includes("Identity") ? "identity" : n.includes("Progress") ? "progress" : n.includes("Reference") ? "references" : "?")
          .join(", ");
        log.info(`${categories} (${nudges.length} nudge${nudges.length > 1 ? "s" : ""})`, { nudges });

        // Inject each nudge as a separate synthetic system message
        output.inject = nudges.map(text => ({ role: "user" as const, text }));
      }
    },

    /**
     * experimental.chat.system.transform — Fires on each LLM call, before the
     * system prompt is sent to the model. Used for persona extraction and
     * session initialization only (no nudge injection).
     *
     * This hook is the only place with access to the actual system prompt
     * content (output.system: string[]), which is required to extract the
     * persona text for initializeSession.
     */
    "experimental.chat.system.transform": async (input, output) => {
      const { sessionID } = input;
      if (!sessionID) return;

      const agentName = sessionAgent.get(sessionID);
      if (!agentName) return;

      // ── Identity gate (primary defense) ─────────────────────────────
      const callAgent = input.agent;
      if (callAgent) {
        // Skip native hidden agents by name
        if (NATIVE_AGENT_NAMES.has(callAgent)) return;
        // Skip calls whose agent doesn't match the session's tracked agent
        if (callAgent !== agentName) return;
      }
      // If input.agent is absent (host without contract change), fall through
      // to marker filter below — defense in depth during rollout.

      // Initialize session on first LLM call for this session
      if (!initializedSessions.has(sessionID)) {
        const personaText = extractPersonaFromSystem(output.system);
        if (personaText) {
          // Claim BEFORE await — prevents concurrent system.transform calls (title-gen + real)
          initializedSessions.add(sessionID);
          try {
            const model = input.model
              ? { providerID: input.model.providerID, modelID: input.model.id }
              : undefined;
            // NOTE: no `.catch()` here — rejection must propagate so the outer
            // catch deletes the claim and the session can be retried.
            await plugin.initializeSession?.(agentName, { system: personaText, model });
            log.info(`Session ${sessionID} initialized for agent ${agentName}`);
          } catch (err) {
            initializedSessions.delete(sessionID);
            log.warn(`Failed to initialize session for agent ${agentName}`, { error: err instanceof Error ? err.message : String(err) });
          }
        } else {
          // No persona (native prompt filtered out) — do NOT claim, so the real
          // agent's call can initialize on its own system.transform invocation.
          log.warn(`No persona text extracted from system prompt for agent ${agentName}. Skipping.`);
        }
      }
    },

  };
}

// ── Server Entry Point ───────────────────────────────────────────────────────

/**
 * Plugin entry point for better-opencode plugin system.
 *
* Wires AgentPersonaCoachPlugin to better-opencode hooks:
   * - `chat.message` — Tracks agent name + flags identity nudges (no initialization)
   * - `tool.execute.after` — Injects identity/reference/progress/rules nudges at cadence via output.inject
   * - `experimental.chat.system.transform` — Extracts persona from system prompt and initializes session
 *
 * Note: `agentInfo` is passed as an empty object `{}` in the current wiring.
 * Production use requires fetching the full agent config from the SDK client.
 */
const server: Plugin = async function server(
  pluginInput: PluginInput,
  options?: PluginOptions
): Promise<Hooks> {
  // Pass the opencode.jsonc plugin block (enabled/categories/traversal) through
  // to the constructor — deepMerge into DEFAULT_CONFIG makes it take effect
  // (better-opencode passes load.options to server(input, options)).
  const plugin = new AgentPersonaCoachPlugin(
    (options ?? {}) as DeepPartial<PluginConfig>
  );

  // Wire the ProviderChatClient so the generator can call the LLM
  const chatClient = new ProviderChatClient(pluginInput.client);
  plugin.setChatClient(chatClient);

  return createServerHooks(plugin, pluginInput);
};

/**
 * V1 plugin format object for better-opencode plugin system.
 *
 * Using an object with `id` and `server()` lets readV1Plugin detect this as
 * a V1 plugin directly, bypassing getLegacyPlugins (which would iterate ALL
 * function exports from index.ts — class constructors, utility functions —
 * and call them all as servers, causing crashes).
 */
export default { id: "agent-persona-coach", server };
