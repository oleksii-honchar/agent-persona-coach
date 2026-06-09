import { AgentPersonaCoachPlugin } from "./index.js";

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
  _input: PluginInput,
  _options?: PluginOptions
): Promise<Hooks> {
  const plugin = new AgentPersonaCoachPlugin();

  // Per-session state: agent name and last nudge
  const sessionAgent = new Map<string, string>();
  const lastNudge = new Map<string, string | null>();

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

      // Initialize session on first message.
      // agentInfo is passed as {} — production use requires fetching
      // the full agent config from the SDK client (input.client).
      try {
        await plugin.initializeSession(agent, {});
      } catch (err) {
        console.warn(
          `[persona-coach] Failed to initialize session for agent ${agent}:`,
          err instanceof Error ? err.message : err
        );
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
      const nudge = plugin.onToolBefore(
        sessionID,
        tool,
        { requiresPermission: tool },
        agentName,
        {}
      );

      if (nudge) {
        lastNudge.set(sessionID, nudge);
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

      const nudge = plugin.onToolAfter(sessionID, tool, args, agentName, {});

      if (nudge) {
        lastNudge.set(sessionID, nudge);

        // Inject as a synthetic system message — better-opencode
        // flushes injected messages into the session context.
        output.inject = [{ role: "system", text: nudge }];
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

      const system = output.system;
      if (system.length === 0) return;

      const nudge = lastNudge.get(sessionID);
      if (!nudge) return;

      // Inject nudge into the last system prompt element
      system[system.length - 1] = plugin.updateSystemPrompt(
        system[system.length - 1],
        nudge
      );
    },
  };
};

export default server;
