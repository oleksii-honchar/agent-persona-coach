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
      ok(typeof hooks["tool.execute.before"] === "function");
      ok(typeof hooks["tool.execute.after"] === "function");
      // experimental.chat.system.transform should NOT exist
      strictEqual(
        (hooks as any)["experimental.chat.system.transform"],
        undefined,
        "experimental.chat.system.transform should not be defined"
      );
    });
  });

  describe("chat.message hook", () => {
    it("should call initializeSession on first user message for a session", async () => {
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
      await hooks["chat.message"]!(
        { sessionID: "sess-1", agent: "test-agent" } as any,
        { message: "", parts: [] }
      );

      strictEqual(initCalled, true, "initializeSession should be called on first message");
      strictEqual(initAgent, "test-agent");
      // model should be undefined since we didn't pass it
      strictEqual(initInfo?.model, undefined);
    });

    it("should call initializeSession with model when model is provided", async () => {
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
      await hooks["chat.message"]!(
        {
          sessionID: "sess-model",
          agent: "test-agent",
          model: { providerID: "puma", modelID: "qwopus3.6" },
        } as any,
        { message: "", parts: [] }
      );

      strictEqual(initCalled, true, "initializeSession should be called");
      strictEqual(initAgent, "test-agent");
      ok(initInfo?.model !== undefined, "model should be passed to initializeSession");
      strictEqual((initInfo!.model as any).providerID, "puma");
      strictEqual((initInfo!.model as any).modelID, "qwopus3.6");
    });

    it("should call initializeSession exactly once per session (idempotent)", async () => {
      let initCallCount = 0;

      AgentPersonaCoachPlugin.prototype.initializeSession = async function () {
        initCallCount++;
      };

      const hooks = await server(aMockPluginInput() as any);

      // First message for sess-1 — should init
      await hooks["chat.message"]!(
        { sessionID: "sess-1", agent: "test-agent" } as any,
        { message: "", parts: [] }
      );
      strictEqual(initCallCount, 1, "first message should initialize");

      // Second message for sess-1 — should NOT init again
      await hooks["chat.message"]!(
        { sessionID: "sess-1", agent: "test-agent" } as any,
        { message: "", parts: [] }
      );
      strictEqual(initCallCount, 1, "second message should NOT re-initialize");
    });

    it("should initialize each session independently", async () => {
      const initCalls: Array<{ agent: string }> = [];

      AgentPersonaCoachPlugin.prototype.initializeSession = async function (
        agent: string
      ) {
        initCalls.push({ agent });
      };

      const hooks = await server(aMockPluginInput() as any);

      // Session 1
      await hooks["chat.message"]!(
        { sessionID: "sess-1", agent: "agent-a" } as any,
        { message: "", parts: [] }
      );

      // Session 2
      await hooks["chat.message"]!(
        { sessionID: "sess-2", agent: "agent-b" } as any,
        { message: "", parts: [] }
      );

      strictEqual(initCalls.length, 2, "initializeSession should be called for each session");
      strictEqual(initCalls[0].agent, "agent-a");
      strictEqual(initCalls[1].agent, "agent-b");
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

    it("should handle initializeSession rejection gracefully", async () => {
      AgentPersonaCoachPlugin.prototype.initializeSession = async function () {
        throw new Error("Simulated init failure");
      };

      const hooks = await server(aMockPluginInput() as any);

      // Should not throw — the error should be caught and logged
      await hooks["chat.message"]!(
        { sessionID: "sess-1", agent: "test-agent" } as any,
        { message: "", parts: [] }
      );

      // Verify warning was logged
      ok(
        capturedStderr.some((line) => /failed to initialize/i.test(line)),
        "should log warning on initialization failure"
      );
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
      const originalOnToolBefore = AgentPersonaCoachPlugin.prototype.onToolBefore;
      AgentPersonaCoachPlugin.prototype.onToolBefore = function () {
        return "<system-reminder>Rules nudge</system-reminder>";
      };

      try {
        // Should not throw on tool hooks that need sessionAgent
        await hooks["tool.execute.before"]!(
          { tool: "write", sessionID: "sess-1", callID: "call-1" } as any,
          { args: {} }
        );
        // Just verify no crash
        ok(true, "tool.execute.before should not crash");
      } finally {
        AgentPersonaCoachPlugin.prototype.onToolBefore = originalOnToolBefore;
      }
    });
  });
});
