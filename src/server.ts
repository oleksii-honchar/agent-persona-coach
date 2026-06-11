import { AgentPersonaCoachPlugin } from "./index.js";
import { ProviderChatClient } from "./provider-client.js";

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

  "tool.execute.before"?: (
    input: { tool: string; sessionID: string; callID: string },
    output: { args: unknown }
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
}

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
  log.info("Plugin started");

  // Per-session state: agent name
  const sessionAgent = new Map<string, string>();

  return {
    /**
     * chat.message — Fires on each user message.
     * On first message for a session, initializes the coach
     * (generates or retrieves cached reflection questions for the agent).
     */
    "chat.message": async (input, _output) => {
      const { sessionID, agent } = input;
      if (!agent || !sessionID) return;

      // Check if this is the first message for this session before setting
      const isFirstMessage = !sessionAgent.has(sessionID);

      // Track agent name for this session (for use in tool hooks)
      sessionAgent.set(sessionID, agent);

      // Initialize session on first user message for this session
      if (isFirstMessage) {
        const model = input.model
          ? { providerID: input.model.providerID, modelID: input.model.modelID }
          : undefined;
        await plugin.initializeSession?.(agent, { model }).catch((err) => {
          log.warn(`Failed to initialize session for agent ${agent}`, { error: err instanceof Error ? err.message : String(err) });
        });
        log.info(`Session ${sessionID} initialized for agent ${agent}`);
      }
    },

    /**
     * tool.execute.before — Fires before each tool execution.
     * Checks if the tool is critical (requires permission) and
     * injects a rule compliance nudge when appropriate.
     *
     * The hook doesn't expose tool permission metadata, so we derive
     * `requiresPermission` from the tool name itself (e.g., "write" tool
     * maps to "write" permission in the criticalPermissions config).
     */
    "tool.execute.before": async (input, _output) => {
      const { tool, sessionID } = input;
      const agentName = sessionAgent.get(sessionID) ?? "";

      // Derive permission from tool name — matches criticalPermissions
      // like ["write", "bash", "task", "create"] in DEFAULT_CONFIG.
      const nudge = plugin.onToolBefore?.(
        sessionID,
        tool,
        { requiresPermission: tool },
        agentName,
        {}
      ) ?? null;

      // Note: nudge is no longer injected into system prompt — only tracked for potential future use
      log.info(`${tool} → rules nudge triggered (session ${sessionID})`, { nudge });
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

  };
}

// ── Server Entry Point ───────────────────────────────────────────────────────

/**
 * Plugin entry point for better-opencode plugin system.
 *
 * Wires AgentPersonaCoachPlugin to better-opencode hooks:
 * - `chat.message` — Initializes session on first message (generates/caches questions)
 * - `tool.execute.before` — Checks rule compliance before critical tools
 * - `tool.execute.after` — Injects identity/reference/progress nudges at cadence via output.inject
 *
 * Note: `agentInfo` is passed as an empty object `{}` in the current wiring.
 * Production use requires fetching the full agent config from the SDK client.
 */
const server: Plugin = async function server(
  pluginInput: PluginInput,
  _options?: PluginOptions
): Promise<Hooks> {
  const plugin = new AgentPersonaCoachPlugin();

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
