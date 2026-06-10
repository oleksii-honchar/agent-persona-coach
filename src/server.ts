import { AgentPersonaCoachPlugin } from "./index.js";
import { ProviderChatClient } from "./provider-client.js";
import { extractPersonaFromSystem } from "./types.js";
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

  "experimental.chat.system.transform"?: (
    input: { sessionID?: string; model: unknown },
    output: { system: string[] }
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

  // Per-session state: agent name, last nudges, and initialization tracking
  const sessionAgent = new Map<string, string>();
  const lastNudges = new Map<string, string[]>();
  const initializedSessions = new Set<string>();
  const pendingUserMessageIdentity = new Map<string, boolean>();

  return {
    /**
     * chat.message — Fires on each user message.
     * On first message for a session, initializes the coach
     * (generates or retrieves cached reflection questions for the agent).
     */
    "chat.message": async (input, _output) => {
      const { sessionID, agent } = input;
      if (!agent || !sessionID) return;

      // Track agent name for this session (for use in tool hooks)
      sessionAgent.set(sessionID, agent);

      // NEW: Flag identity nudge for injection before next model response
      if (plugin.config?.categories?.identity?.enabled &&
          plugin.config?.categories?.identity?.afterEachUserMessage) {
        pendingUserMessageIdentity.set(sessionID, true);
        log.debug(`Identity nudge queued for session ${sessionID}`);
      }

      // NOTE: initialization moved to experimental.chat.system.transform
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
      const nudge = plugin.onToolBefore(
        sessionID,
        tool,
        { requiresPermission: tool },
        agentName,
        {}
      );

      if (nudge) {
        lastNudges.set(sessionID, [nudge]);
        log.debug(`${tool} → rules nudge injected (session ${sessionID})`);
      }
    },

    /**
     * tool.execute.after — Fires after each tool execution.
     * Checks cadence-based categories (identity, references, progress)
     * and injects the nudge as a synthetic system message via output.inject.
     */
    "tool.execute.after": async (input, output) => {
      const { tool, sessionID, args } = input;
      const agentName = sessionAgent.get(sessionID) ?? "";

      const nudges = plugin.onToolAfter(sessionID, tool, args, agentName, {});

      if (nudges.length > 0) {
        lastNudges.set(sessionID, nudges);

        const categories = nudges
          .map(n => n.includes("Identity") ? "identity" : n.includes("Progress") ? "progress" : n.includes("Reference") ? "references" : "?")
          .join(", ");
        log.debug(`${categories} (${nudges.length} nudge${nudges.length > 1 ? "s" : ""})`);

        // Inject each nudge as a separate synthetic system message
        output.inject = nudges.map(text => ({ role: "system" as const, text }));
      }
    },

    /**
     * experimental.chat.system.transform — Transforms the system prompt.
     * Injects the latest nudge into the LAST element of the system array,
     * wrapping it inside any existing <system-reminder> block.
     */
    "experimental.chat.system.transform": async (input, output) => {
      const { sessionID } = input;
      if (!sessionID) return;

      const agentName = sessionAgent.get(sessionID);
      if (!agentName) return;

      // --- Lazy initialization on first LLM call ---
      if (!initializedSessions.has(sessionID)) {
        const personaText = extractPersonaFromSystem(output.system);
        if (personaText) {
          try {
            await plugin.initializeSession(agentName, { system: personaText });
            initializedSessions.add(sessionID);
            log.info(`Session ${sessionID} initialized for agent ${agentName} (persona extracted from system prompt)`);
          } catch (err) {
            log.warn(`Failed to initialize session for agent ${agentName}`, { error: err instanceof Error ? err.message : String(err) });
          }
        } else {
          log.warn(`No persona text extracted from system prompt for agent ${agentName}. Skipping.`);
        }
      }

      // NEW: Inject identity nudge after each user message
      if (pendingUserMessageIdentity.get(sessionID)) {
        pendingUserMessageIdentity.delete(sessionID);
        const nudge = plugin.buildIdentityNudge(agentName, {});
        if (nudge) {
          const system = output.system;
          if (system.length > 0) {
            system[system.length - 1] = plugin.updateSystemPrompt(
              system[system.length - 1],
              nudge
            );
            log.debug(`identity (user-message) nudge injected (session ${sessionID})`);
          }
        }
      }

      // --- Nudge injection ---
      const system = output.system;
      if (system.length === 0) return;

      const nudges = lastNudges.get(sessionID);
      if (!nudges || nudges.length === 0) return;

      // Inject all nudges into the last system prompt element
      system[system.length - 1] = plugin.updateSystemPrompt(
        system[system.length - 1],
        nudges
      );
      log.debug(`system prompt updated with ${nudges.length} nudge${nudges.length > 1 ? "s" : ""} (session ${sessionID})`);
    },
  };
}

// ── Server Entry Point ───────────────────────────────────────────────────────

/**
 * Plugin entry point for better-opencode plugin system.
 *
 * Wires AgentPersonaCoachPlugin to better-opencode hooks:
 * - `chat.message` — Initializes session on first message (generates/caches questions)
 * - `tool.execute.before` — Injects rule compliance nudge before critical tools
 * - `tool.execute.after` — Injects identity/reference/progress nudges at cadence via output.inject
 * - `experimental.chat.system.transform` — Injects latest nudge into system prompt
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

export default server;
