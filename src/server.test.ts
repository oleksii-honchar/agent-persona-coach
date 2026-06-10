import { describe, it, beforeEach, afterEach } from "node:test";
import { strictEqual, ok, deepStrictEqual } from "node:assert/strict";
import { AgentPersonaCoachPlugin } from "./index.js";
import serverModule from "./server.js";
import { createServerHooks } from "./server.js";

/**
 * The server default export is now a V1 plugin object { id, server }.
 * Extract the bare server function for direct testing.
 */
const server = serverModule.server;

function aMockPluginInput() {
  return {
    client: {
      config: {
        get: async () => ({
          model: "test-provider/test-model",
          providers: {
            "test-provider": {
              baseURL: "http://localhost:1234",
              apiKey: "test-key",
            },
          },
        }),
      },
    },
    project: {},
    directory: "/tmp/test",
    worktree: "/tmp/test",
    serverUrl: new URL("http://localhost:8080"),
    $: {},
  };
}

describe("server", () => {
  let originalFetch: typeof globalThis.fetch;
  let capturedStderr: string[] = [];
  let originalStderrWrite: typeof process.stderr.write;

  // Store original prototype methods
  const originalSetChatClient = AgentPersonaCoachPlugin.prototype.setChatClient;
  const originalInitializeSession = AgentPersonaCoachPlugin.prototype.initializeSession;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    capturedStderr = [];
    originalStderrWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk: string | Buffer) => {
      const text = typeof chunk === "string" ? chunk : chunk.toString();
      for (const line of text.split("\n").filter(Boolean)) {
        capturedStderr.push(line);
      }
      return originalStderrWrite(chunk);
    };

    // Restore prototypes before each test
    AgentPersonaCoachPlugin.prototype.setChatClient = originalSetChatClient;
    AgentPersonaCoachPlugin.prototype.initializeSession = originalInitializeSession;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.stderr.write = originalStderrWrite;
    // Always restore prototypes after each test
    AgentPersonaCoachPlugin.prototype.setChatClient = originalSetChatClient;
    AgentPersonaCoachPlugin.prototype.initializeSession = originalInitializeSession;
  });

  describe("plugin startup", () => {
    it("should create ProviderChatClient and call setChatClient", async () => {
      let setChatClientCalled = false;
      let chatClientArg: unknown;

      AgentPersonaCoachPlugin.prototype.setChatClient = function (client: any) {
        setChatClientCalled = true;
        chatClientArg = client;
        return originalSetChatClient.call(this, client);
      };

      const hooks = await server(aMockPluginInput() as any);
      ok(setChatClientCalled, "setChatClient should be called");
      ok(chatClientArg, "chatClient should be provided");
      ok(typeof hooks["chat.message"] === "function");
      ok(typeof hooks["experimental.chat.system.transform"] === "function");
    });
  });

  describe("chat.message hook", () => {
    it("should only store agent name, not call initializeSession", async () => {
      let initCalled = false;

      AgentPersonaCoachPlugin.prototype.initializeSession = async function () {
        initCalled = true;
      };

      const hooks = await server(aMockPluginInput() as any);
      await hooks["chat.message"]!(
        { sessionID: "sess-1", agent: "test-agent" } as any,
        { message: "", parts: [] }
      );

      strictEqual(initCalled, false, "initializeSession should not be called");
    });

    it("should do nothing when agent is missing", async () => {
      let initCalled = false;

      AgentPersonaCoachPlugin.prototype.initializeSession = async function () {
        initCalled = true;
      };

      const hooks = await server(aMockPluginInput() as any);
      await hooks["chat.message"]!(
        { sessionID: "sess-1" } as any,
        { message: "", parts: [] }
      );

      strictEqual(initCalled, false, "initializeSession should not be called without agent");
    });

    it("should do nothing when sessionID is missing", async () => {
      let initCalled = false;

      AgentPersonaCoachPlugin.prototype.initializeSession = async function () {
        initCalled = true;
      };

      const hooks = await server(aMockPluginInput() as any);
      await hooks["chat.message"]!(
        { agent: "test-agent" } as any,
        { message: "", parts: [] }
      );

      strictEqual(initCalled, false, "initializeSession should not be called without sessionID");
    });
  });

  describe("experimental.chat.system.transform hook", () => {
    it("should initialize session on first call with extracted persona", async () => {
      const initCalls: Array<{ agent: string; info: Record<string, unknown> }> = [];

      AgentPersonaCoachPlugin.prototype.initializeSession = async function (
        agent: string,
        info: Record<string, unknown>
      ) {
        initCalls.push({ agent, info });
      };

      const hooks = await server(aMockPluginInput() as any);

      // First, set the agent via chat.message
      await hooks["chat.message"]!(
        { sessionID: "sess-1", agent: "test-agent" } as any,
        { message: "", parts: [] }
      );

      // Then call system.transform with persona text
      const output = { system: ["You are a helpful assistant."] };
      await hooks["experimental.chat.system.transform"]!(
        { sessionID: "sess-1", model: {} } as any,
        output
      );

      strictEqual(initCalls.length, 1, "initializeSession should be called once");
      strictEqual(initCalls[0].agent, "test-agent");
      strictEqual(initCalls[0].info.system, "You are a helpful assistant.");
    });

    it("should be idempotent — skip initialization on second call", async () => {
      const initCalls: Array<{ agent: string; info: Record<string, unknown> }> = [];

      AgentPersonaCoachPlugin.prototype.initializeSession = async function (
        agent: string,
        info: Record<string, unknown>
      ) {
        initCalls.push({ agent, info });
      };

      const hooks = await server(aMockPluginInput() as any);

      await hooks["chat.message"]!(
        { sessionID: "sess-1", agent: "test-agent" } as any,
        { message: "", parts: [] }
      );

      const output = { system: ["You are a helpful assistant."] };
      await hooks["experimental.chat.system.transform"]!(
        { sessionID: "sess-1", model: {} } as any,
        output
      );
      await hooks["experimental.chat.system.transform"]!(
        { sessionID: "sess-1", model: {} } as any,
        output
      );

      strictEqual(initCalls.length, 1, "initializeSession should be called exactly once");
    });

    it("should log warning and skip when persona text is empty", async () => {
      let initCalled = false;

      AgentPersonaCoachPlugin.prototype.initializeSession = async function () {
        initCalled = true;
      };

      const hooks = await server(aMockPluginInput() as any);

      await hooks["chat.message"]!(
        { sessionID: "sess-1", agent: "test-agent" } as any,
        { message: "", parts: [] }
      );

      const output = { system: ['{"type": "object", "properties": {}}'] };
      await hooks["experimental.chat.system.transform"]!(
        { sessionID: "sess-1", model: {} } as any,
        output
      );

      strictEqual(initCalled, false, "initializeSession should not be called for empty persona");
      ok(
        capturedStderr.some((line) => /no persona text extracted/i.test(line)),
        "should log warning about empty persona"
      );
    });

    it("should exit early when no agent is mapped for the session", async () => {
      let initCalled = false;

      AgentPersonaCoachPlugin.prototype.initializeSession = async function () {
        initCalled = true;
      };

      const hooks = await server(aMockPluginInput() as any);

      // Do NOT call chat.message first — no agent mapped
      const output = { system: ["You are a helpful assistant."] };
      await hooks["experimental.chat.system.transform"]!(
        { sessionID: "sess-1", model: {} } as any,
        output
      );

      strictEqual(initCalled, false, "initializeSession should not be called without mapped agent");
    });

    it("should exit early when sessionID is missing", async () => {
      let initCalled = false;

      AgentPersonaCoachPlugin.prototype.initializeSession = async function () {
        initCalled = true;
      };

      const hooks = await server(aMockPluginInput() as any);

      const output = { system: ["You are a helpful assistant."] };
      await hooks["experimental.chat.system.transform"]!(
        { model: {} } as any,
        output
      );

      strictEqual(initCalled, false, "initializeSession should not be called without sessionID");
    });

    it("should still inject nudges after initialization", async () => {
      // Mock initializeSession to do nothing (we're testing nudge injection)
      AgentPersonaCoachPlugin.prototype.initializeSession = async function () {};
      // Mock onToolBefore to return a test nudge so lastNudges gets populated
      const originalOnToolBefore = AgentPersonaCoachPlugin.prototype.onToolBefore;
      AgentPersonaCoachPlugin.prototype.onToolBefore = function () {
        return "<system-reminder>Rules nudge: remember the rules.</system-reminder>";
      };

      try {
        const hooks = await server(aMockPluginInput() as any);

        await hooks["chat.message"]!(
          { sessionID: "sess-1", agent: "test-agent" } as any,
          { message: "", parts: [] }
        );

        // Inject a nudge via tool.execute.before
        await hooks["tool.execute.before"]!(
          { tool: "write", sessionID: "sess-1", callID: "call-1" } as any,
          { args: {} }
        );

        // Call system.transform — should init AND inject nudge
        const output = { system: ["You are a helpful assistant."] };
        await hooks["experimental.chat.system.transform"]!(
          { sessionID: "sess-1", model: {} } as any,
          output
        );

        // The system prompt should have been updated with the nudge
        ok(
          output.system[0].includes("Rules nudge"),
          "system prompt should contain injected nudge"
        );
      } finally {
        AgentPersonaCoachPlugin.prototype.onToolBefore = originalOnToolBefore;
      }
    });

    it("should initialize a second session independently", async () => {
      const initCalls: Array<{ agent: string; info: Record<string, unknown> }> = [];

      AgentPersonaCoachPlugin.prototype.initializeSession = async function (
        agent: string,
        info: Record<string, unknown>
      ) {
        initCalls.push({ agent, info });
      };

      const hooks = await server(aMockPluginInput() as any);

      // Session 1
      await hooks["chat.message"]!(
        { sessionID: "sess-1", agent: "agent-a" } as any,
        { message: "", parts: [] }
      );
      await hooks["experimental.chat.system.transform"]!(
        { sessionID: "sess-1", model: {} } as any,
        { system: ["Persona A"] }
      );

      // Session 2
      await hooks["chat.message"]!(
        { sessionID: "sess-2", agent: "agent-b" } as any,
        { message: "", parts: [] }
      );
      await hooks["experimental.chat.system.transform"]!(
        { sessionID: "sess-2", model: {} } as any,
        { system: ["Persona B"] }
      );

      strictEqual(initCalls.length, 2, "initializeSession should be called for each session");
      strictEqual(initCalls[0].agent, "agent-a");
      strictEqual(initCalls[0].info.system, "Persona A");
      strictEqual(initCalls[1].agent, "agent-b");
      strictEqual(initCalls[1].info.system, "Persona B");
    });
  });

  describe("createServerHooks — pendingUserMessageIdentity", () => {
    function aMockPlugin(overrides: Partial<AgentPersonaCoachPlugin> = {}): AgentPersonaCoachPlugin {
      const plugin = new AgentPersonaCoachPlugin();
      return {
        ...plugin,
        config: {
          ...plugin.config,
          categories: {
            ...plugin.config.categories,
            identity: {
              ...plugin.config.categories.identity,
              enabled: true,
              afterEachUserMessage: true,
              ...overrides.config?.categories?.identity,
            },
          },
        },
        initializeSession: async () => {},
        buildIdentityNudge: () => "<system-reminder>Identity Check: Who am I?</system-reminder>",
        updateSystemPrompt: (system: string, nudges: string | string[]) =>
          `${system}\n${Array.isArray(nudges) ? nudges.join("\n") : nudges}`,
        ...overrides,
      } as AgentPersonaCoachPlugin;
    }

    it("should queue identity nudge on chat.message when enabled", async () => {
      const plugin = aMockPlugin();
      const hooks = await createServerHooks(plugin, aMockPluginInput() as any);

      await hooks["chat.message"]!(
        { sessionID: "sess-1", agent: "test-agent" } as any,
        { message: "", parts: [] }
      );

      // Flag should be set — verified by system.transform injecting the nudge
      const output = { system: ["You are a helpful assistant."] };
      await hooks["experimental.chat.system.transform"]!(
        { sessionID: "sess-1", model: {} } as any,
        output
      );

      ok(
        output.system[0].includes("Identity Check"),
        "system prompt should contain identity nudge after user message"
      );
    });

    it("should clear the flag after system.transform processes it", async () => {
      const plugin = aMockPlugin();
      const hooks = await createServerHooks(plugin, aMockPluginInput() as any);

      // First user message — flag set
      await hooks["chat.message"]!(
        { sessionID: "sess-1", agent: "test-agent" } as any,
        { message: "", parts: [] }
      );

      // System transform — nudge injected and flag cleared
      const output1 = { system: ["You are a helpful assistant."] };
      await hooks["experimental.chat.system.transform"]!(
        { sessionID: "sess-1", model: {} } as any,
        output1
      );
      ok(output1.system[0].includes("Identity Check"), "first transform should inject nudge");

      // Second system transform — no new user message, flag should be gone
      const output2 = { system: ["You are a helpful assistant."] };
      await hooks["experimental.chat.system.transform"]!(
        { sessionID: "sess-1", model: {} } as any,
        output2
      );
      strictEqual(
        output2.system[0],
        "You are a helpful assistant.",
        "second transform should NOT inject nudge (flag cleared)"
      );
    });

    it("should not queue identity nudge when afterEachUserMessage is false", async () => {
      const plugin = aMockPlugin({
        config: {
          categories: {
            identity: {
              enabled: true,
              afterEachUserMessage: false,
            } as any,
          },
        } as any,
      });
      const hooks = await createServerHooks(plugin, aMockPluginInput() as any);

      await hooks["chat.message"]!(
        { sessionID: "sess-1", agent: "test-agent" } as any,
        { message: "", parts: [] }
      );

      const output = { system: ["You are a helpful assistant."] };
      await hooks["experimental.chat.system.transform"]!(
        { sessionID: "sess-1", model: {} } as any,
        output
      );

      strictEqual(
        output.system[0],
        "You are a helpful assistant.",
        "should NOT inject identity nudge when afterEachUserMessage is false"
      );
    });

    it("should not queue identity nudge when identity category is disabled", async () => {
      const plugin = aMockPlugin({
        config: {
          categories: {
            identity: {
              enabled: false,
              afterEachUserMessage: true,
            } as any,
          },
        } as any,
      });
      const hooks = await createServerHooks(plugin, aMockPluginInput() as any);

      await hooks["chat.message"]!(
        { sessionID: "sess-1", agent: "test-agent" } as any,
        { message: "", parts: [] }
      );

      const output = { system: ["You are a helpful assistant."] };
      await hooks["experimental.chat.system.transform"]!(
        { sessionID: "sess-1", model: {} } as any,
        output
      );

      strictEqual(
        output.system[0],
        "You are a helpful assistant.",
        "should NOT inject identity nudge when identity is disabled"
      );
    });

    it("should clear the flag even when buildIdentityNudge returns null", async () => {
      const plugin = aMockPlugin({
        buildIdentityNudge: () => null,
      });
      const hooks = await createServerHooks(plugin, aMockPluginInput() as any);

      await hooks["chat.message"]!(
        { sessionID: "sess-1", agent: "test-agent" } as any,
        { message: "", parts: [] }
      );

      const output1 = { system: ["You are a helpful assistant."] };
      await hooks["experimental.chat.system.transform"]!(
        { sessionID: "sess-1", model: {} } as any,
        output1
      );
      strictEqual(output1.system[0], "You are a helpful assistant.", "no nudge when buildIdentityNudge returns null");

      // Second transform — flag should still be cleared
      const output2 = { system: ["You are a helpful assistant."] };
      await hooks["experimental.chat.system.transform"]!(
        { sessionID: "sess-1", model: {} } as any,
        output2
      );
      strictEqual(output2.system[0], "You are a helpful assistant.", "flag should remain cleared");
    });

    it("should clear the flag even when system.length === 0", async () => {
      const plugin = aMockPlugin();
      const hooks = await createServerHooks(plugin, aMockPluginInput() as any);

      await hooks["chat.message"]!(
        { sessionID: "sess-1", agent: "test-agent" } as any,
        { message: "", parts: [] }
      );

      const output1 = { system: [] as string[] };
      await hooks["experimental.chat.system.transform"]!(
        { sessionID: "sess-1", model: {} } as any,
        output1
      );
      deepStrictEqual(output1.system, [], "no system prompt to inject into");

      // Second transform — flag should be cleared, no injection
      const output2 = { system: ["You are a helpful assistant."] };
      await hooks["experimental.chat.system.transform"]!(
        { sessionID: "sess-1", model: {} } as any,
        output2
      );
      strictEqual(output2.system[0], "You are a helpful assistant.", "flag should be cleared even after empty system");
    });

    it("should handle identity nudge per-session independently", async () => {
      const plugin = aMockPlugin();
      const hooks = await createServerHooks(plugin, aMockPluginInput() as any);

      // Session 1: user message
      await hooks["chat.message"]!(
        { sessionID: "sess-1", agent: "agent-a" } as any,
        { message: "", parts: [] }
      );

      // Session 2: user message
      await hooks["chat.message"]!(
        { sessionID: "sess-2", agent: "agent-b" } as any,
        { message: "", parts: [] }
      );

      // Transform session 1 only
      const output1 = { system: ["Persona A"] };
      await hooks["experimental.chat.system.transform"]!(
        { sessionID: "sess-1", model: {} } as any,
        output1
      );

      ok(output1.system[0].includes("Identity Check"), "session 1 should get nudge");

      // Session 2 should still have flag set
      const output2 = { system: ["Persona B"] };
      await hooks["experimental.chat.system.transform"]!(
        { sessionID: "sess-2", model: {} } as any,
        output2
      );

      ok(output2.system[0].includes("Identity Check"), "session 2 should also get nudge");
    });

    it("should inject both user-message identity nudge and cadence nudge in same turn", async () => {
      const plugin = aMockPlugin({
        onToolBefore: () => "<system-reminder>Rule Compliance: remember the rules.</system-reminder>",
      });
      const hooks = await createServerHooks(plugin, aMockPluginInput() as any);

      // Trigger a rules nudge via tool.execute.before (populates lastNudges)
      await hooks["tool.execute.before"]!(
        { sessionID: "sess-1", tool: "write", callID: "call-1" } as any,
        { args: {} }
      );

      // Set pending user-message flag
      await hooks["chat.message"]!(
        { sessionID: "sess-1", agent: "test-agent" } as any,
        { message: "", parts: [] }
      );

      // System transform should inject both nudges
      const output = { system: ["You are a helpful assistant."] };
      await hooks["experimental.chat.system.transform"]!(
        { sessionID: "sess-1", model: {} } as any,
        output
      );

      ok(
        output.system[0].includes("Identity Check"),
        "should contain identity nudge from user-message"
      );
      ok(
        output.system[0].includes("Rule Compliance"),
        "should contain rules nudge from cadence"
      );
    });
  });
});
