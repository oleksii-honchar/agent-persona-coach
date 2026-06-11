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
      // tool.execute.before removed in Task 16 — should NOT exist
      ok(typeof (hooks as any)["tool.execute.before"] !== "function", "tool.execute.before should NOT be defined");
      ok(typeof hooks["tool.execute.after"] === "function");
      // experimental.chat.system.transform should exist (Task 13)
      ok(
        typeof (hooks as any)["experimental.chat.system.transform"] === "function",
        "experimental.chat.system.transform should be defined"
      );
    });
  });

  describe("chat.message hook", () => {
    it("should track agent name for session without calling initializeSession", async () => {
      let initCalled = false;

      AgentPersonaCoachPlugin.prototype.initializeSession = async function () {
        initCalled = true;
      };

      const hooks = await server(aMockPluginInput() as any);
      await hooks["chat.message"]!(
        { sessionID: "sess-1", agent: "test-agent" } as any,
        { message: "", parts: [] }
      );

      strictEqual(initCalled, false, "chat.message should NOT call initializeSession");

      // Verify agent is tracked by checking tool.execute.after can access it
      // (tool.execute.before removed in Task 16)
      await hooks["tool.execute.after"]!(
        { tool: "write", sessionID: "sess-1", callID: "call-1", args: {} } as any,
        { title: "", output: "", metadata: {} }
      );
      ok(true, "tool.execute.after should not crash — agent is tracked");
    });

    it("should do nothing when agent is missing", async () => {
      const hooks = await server(aMockPluginInput() as any);
      await hooks["chat.message"]!(
        { sessionID: "sess-1" } as any,
        { message: "", parts: [] }
      );
      // Should not throw
      ok(true, "should not throw when agent is missing");
    });

    it("should do nothing when sessionID is missing", async () => {
      const hooks = await server(aMockPluginInput() as any);
      await hooks["chat.message"]!(
        { agent: "test-agent" } as any,
        { message: "", parts: [] }
      );
      // Should not throw
      ok(true, "should not throw when sessionID is missing");
    });

    it("should still track agent (not init) when initializeSession is not defined on plugin", async () => {
      AgentPersonaCoachPlugin.prototype.initializeSession = undefined as any;

      const hooks = await server(aMockPluginInput() as any);

      // Should not throw
      await hooks["chat.message"]!(
        { sessionID: "sess-1", agent: "test-agent" } as any,
        { message: "", parts: [] }
      );

      // Tool hooks should still work (agent is stored)
      // (tool.execute.before removed in Task 16)
      await hooks["tool.execute.after"]!(
        { tool: "write", sessionID: "sess-1", callID: "call-1", args: {} } as any,
        { title: "", output: "", metadata: {} }
      );
      ok(true, "tool.execute.after should not crash");
    });

    // ── Task 13: chat.message no longer calls initializeSession ──

    it("should NOT call initializeSession (delegated to system.transform)", async () => {
      let initCalled = false;

      AgentPersonaCoachPlugin.prototype.initializeSession = async function () {
        initCalled = true;
      };

      const hooks = await server(aMockPluginInput() as any);
      await hooks["chat.message"]!(
        { sessionID: "sess-1", agent: "test-agent" } as any,
        { message: "", parts: [] }
      );

      strictEqual(initCalled, false, "chat.message should NOT call initializeSession");
    });

    it("should flag identity nudge via pendingUserMessageIdentity when afterEachUserMessage is enabled", async () => {
      const plugin = new AgentPersonaCoachPlugin();
      const hooks = await createServerHooks(plugin, aMockPluginInput() as any);

      await hooks["chat.message"]!(
        { sessionID: "sess-1", agent: "test-agent" } as any,
        { message: "", parts: [] }
      );

      // The chat.message hook should have flagged the session for identity nudge
      ok(
        capturedStderr.some((line) => /identity nudge queued/i.test(line)),
        "should log identity nudge queued when afterEachUserMessage is enabled"
      );
    });

    it("should NOT flag identity nudge when afterEachUserMessage is disabled", async () => {
      const plugin = new AgentPersonaCoachPlugin({
        categories: {
          identity: { enabled: true, cadence: 10, afterEachUserMessage: false },
          rules: { enabled: true, cadence: 10, criticalPermissions: ["write"], criticalTools: [] },
          references: { enabled: true, cadence: 30 },
          progress: { enabled: true, cadence: 20 },
        },
      });
      const hooks = await createServerHooks(plugin, aMockPluginInput() as any);

      await hooks["chat.message"]!(
        { sessionID: "sess-2", agent: "test-agent" } as any,
        { message: "", parts: [] }
      );

      strictEqual(
        capturedStderr.some((line) => /identity nudge queued/i.test(line)),
        false,
        "should NOT log identity nudge queued when afterEachUserMessage is disabled"
      );
    });

    it("should NOT flag identity nudge when identity category is disabled", async () => {
      const plugin = new AgentPersonaCoachPlugin({
        categories: {
          identity: { enabled: false, cadence: 10, afterEachUserMessage: true },
          rules: { enabled: true, cadence: 10, criticalPermissions: ["write"], criticalTools: [] },
          references: { enabled: true, cadence: 30 },
          progress: { enabled: true, cadence: 20 },
        },
      });
      const hooks = await createServerHooks(plugin, aMockPluginInput() as any);

      await hooks["chat.message"]!(
        { sessionID: "sess-3", agent: "test-agent" } as any,
        { message: "", parts: [] }
      );

      strictEqual(
        capturedStderr.some((line) => /identity nudge queued/i.test(line)),
        false,
        "should NOT log identity nudge queued when identity is disabled"
      );
    });
  });

  describe("experimental.chat.system.transform hook", () => {
    it("should exist on hooks object", async () => {
      const hooks = await server(aMockPluginInput() as any);
      ok(
        typeof (hooks as any)["experimental.chat.system.transform"] === "function",
        "experimental.chat.system.transform should be defined"
      );
    });

    it("should extract persona from output.system and call initializeSession with { system: personaText, model }", async () => {
      let initCalled = false;
      let initAgent: string | undefined;
      let initInfo: Record<string, unknown> | undefined;

      AgentPersonaCoachPlugin.prototype.initializeSession = async function (
        agent: string,
        info: Record<string, unknown>
      ) {
        initCalled = true;
        initAgent = agent;
        initInfo = info;
      };

      const hooks = await server(aMockPluginInput() as any);

      // First, chat.message to register the agent
      await hooks["chat.message"]!(
        { sessionID: "sess-1", agent: "test-agent" } as any,
        { message: "", parts: [] }
      );

      // Now system.transform fires with the system prompt
      await (hooks as any)["experimental.chat.system.transform"](
        {
          sessionID: "sess-1",
          model: { providerID: "puma", id: "qwopus3.6" },
        } as any,
        { system: ["You are a test agent. Do good things."] }
      );

      strictEqual(initCalled, true, "initializeSession should be called");
      strictEqual(initAgent, "test-agent");
      ok(initInfo?.system, "system should be passed to initializeSession");
      strictEqual(
        (initInfo!.system as string).includes("test agent"),
        true,
        "system should contain extracted persona text"
      );
      ok(initInfo?.model, "model should be passed to initializeSession");
      strictEqual((initInfo!.model as any).providerID, "puma");
      strictEqual((initInfo!.model as any).modelID, "qwopus3.6");
    });

    it("should NOT initialize again if session already in initializedSessions (idempotent)", async () => {
      let initCallCount = 0;

      AgentPersonaCoachPlugin.prototype.initializeSession = async function () {
        initCallCount++;
      };

      const hooks = await server(aMockPluginInput() as any);

      // Register agent
      await hooks["chat.message"]!(
        { sessionID: "sess-1", agent: "test-agent" } as any,
        { message: "", parts: [] }
      );

      // First system.transform — should init
      await (hooks as any)["experimental.chat.system.transform"](
        { sessionID: "sess-1" } as any,
        { system: ["You are a test agent."] }
      );
      strictEqual(initCallCount, 1, "first system.transform should initialize");

      // Second system.transform — should NOT init again
      await (hooks as any)["experimental.chat.system.transform"](
        { sessionID: "sess-1" } as any,
        { system: ["You are a test agent."] }
      );
      strictEqual(initCallCount, 1, "second system.transform should NOT re-initialize");
    });

    it("should log warning when no persona text extracted from system prompt", async () => {
      AgentPersonaCoachPlugin.prototype.initializeSession = async function () {
        // Should not be called
      };

      const hooks = await server(aMockPluginInput() as any);

      // Register agent
      await hooks["chat.message"]!(
        { sessionID: "sess-1", agent: "test-agent" } as any,
        { message: "", parts: [] }
      );

      // system.transform with only schema/reminder content → no persona
      await (hooks as any)["experimental.chat.system.transform"](
        { sessionID: "sess-1" } as any,
        {
          system: [
            '{"type": "object", "properties": {"foo": "bar"}}',
            "<system-reminder>Some reminder</system-reminder>",
          ],
        }
      );

      ok(
        capturedStderr.some((line) => /no persona text extracted/i.test(line)),
        "should log warning when no persona text extracted"
      );
    });

    it("should do nothing when sessionID is missing", async () => {
      let initCalled = false;

      AgentPersonaCoachPlugin.prototype.initializeSession = async function () {
        initCalled = true;
      };

      const hooks = await server(aMockPluginInput() as any);

      await (hooks as any)["experimental.chat.system.transform"](
        {} as any,
        { system: ["You are a test agent."] }
      );

      strictEqual(initCalled, false, "should not call initializeSession without sessionID");
    });

    it("should do nothing when agent is not registered for session", async () => {
      let initCalled = false;

      AgentPersonaCoachPlugin.prototype.initializeSession = async function () {
        initCalled = true;
      };

      const hooks = await server(aMockPluginInput() as any);

      // No chat.message call — agent not registered
      await (hooks as any)["experimental.chat.system.transform"](
        { sessionID: "unknown-sess" } as any,
        { system: ["You are a test agent."] }
      );

      strictEqual(initCalled, false, "should not call initializeSession without registered agent");
    });

    it("should handle initializeSession rejection gracefully", async () => {
      AgentPersonaCoachPlugin.prototype.initializeSession = async function () {
        throw new Error("Simulated init failure");
      };

      const hooks = await server(aMockPluginInput() as any);

      // Register agent
      await hooks["chat.message"]!(
        { sessionID: "sess-1", agent: "test-agent" } as any,
        { message: "", parts: [] }
      );

      // Should not throw
      await (hooks as any)["experimental.chat.system.transform"](
        { sessionID: "sess-1" } as any,
        { system: ["You are a test agent."] }
      );

      ok(
        capturedStderr.some((line) => /failed to initialize/i.test(line)),
        "should log warning on initialization failure"
      );
    });

    it("should NOT inject nudges (initialization only)", async () => {
      // The system.transform hook for Phase 0 should ONLY do initialization,
      // no nudge injection. We verify by checking that output.system is unchanged
      // (no nudge pushed).
      const personaText = "You are a test agent.";
      const output = { system: [personaText] };

      const hooks = await server(aMockPluginInput() as any);

      // Register agent
      await hooks["chat.message"]!(
        { sessionID: "sess-1", agent: "test-agent" } as any,
        { message: "", parts: [] }
      );

      // system.transform — should only init, not modify output.system
      await (hooks as any)["experimental.chat.system.transform"](
        { sessionID: "sess-1" } as any,
        output
      );

      // System should be unchanged (no nudge pushed)
      strictEqual(output.system.length, 1, "system array should be unchanged");
      strictEqual(output.system[0], personaText, "persona text should be unchanged");
    });
  });
});
