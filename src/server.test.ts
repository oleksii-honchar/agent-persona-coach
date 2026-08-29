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
          rules: { enabled: true, cadence: 10, criticalPermissions: ["bash", "edit", "task"], criticalTools: [] },
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
          rules: { enabled: true, cadence: 10, criticalPermissions: ["bash", "edit", "task"], criticalTools: [] },
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

  // ── Task 4 (C5+C6): traversal nudge delivery via output.inject (ADR-0004) ──

  describe("tool.execute.after — traversal nudge delivery (C5/C6)", () => {
    /**
     * Plugin with all generative categories disabled and traversal enabled
     * via deepMerge override (keeps DEFAULT traversal toolPatterns/etc),
     * wired through createServerHooks exactly like production.
     */
    function traversalHooks() {
      const plugin = new AgentPersonaCoachPlugin({
        categories: {
          identity: { enabled: false },
          rules: { enabled: false },
          references: { enabled: false },
          progress: { enabled: false },
          traversal: { enabled: true, nudgeAfter: 2, recurrentEvery: 2, maxRepeats: 3 },
        },
      });
      return createServerHooks(plugin, aMockPluginInput() as any);
    }

    function aToolOutput() {
      return { title: "", output: "", metadata: {} } as any;
    }

    it("should inject the traversal nudge into output.inject as a synthetic user message", async () => {
      const hooks = await traversalHooks();

      // Register the agent for the session
      await hooks["chat.message"]!(
        { sessionID: "sess-1", agent: "test-agent" } as any,
        { message: "", parts: [] }
      );

      // Traversal anchor call — no nudge yet
      const anchored = aToolOutput();
      await hooks["tool.execute.after"]!(
        { tool: "bensyne_expandFileRelations", sessionID: "sess-1", callID: "c1", args: { file_id: "file_a" } } as any,
        anchored
      );
      strictEqual(anchored.inject, undefined, "anchor call must not inject a nudge");

      // Non-traversal call #1 — still below nudgeAfter (2)
      const silent = aToolOutput();
      await hooks["tool.execute.after"]!(
        { tool: "read", sessionID: "sess-1", callID: "c2", args: {} } as any,
        silent
      );
      strictEqual(silent.inject, undefined, "no inject before nudgeAfter non-traversal calls");

      // Non-traversal call #2 — cadence reached → traversal nudge delivered
      const nudged = aToolOutput();
      await hooks["tool.execute.after"]!(
        { tool: "read", sessionID: "sess-1", callID: "c3", args: {} } as any,
        nudged
      );

      ok(nudged.inject && nudged.inject.length >= 1, "output.inject should contain the traversal nudge");
      ok(
        nudged.inject.some(
          (n: { role: string; text: string }) =>
            n.role === "user" && n.text.includes("<system-reminder>") && n.text.includes("Traversal Check")
        ),
        "output.inject should merge the traversal <system-reminder> as a synthetic user message"
      );
    });

    it("should stop injecting traversal nudges after a traversal call advances the anchor", async () => {
      const hooks = await traversalHooks();

      await hooks["chat.message"]!(
        { sessionID: "sess-1", agent: "test-agent" } as any,
        { message: "", parts: [] }
      );

      await hooks["tool.execute.after"]!(
        { tool: "bensyne_expandFileRelations", sessionID: "sess-1", callID: "c1", args: { file_id: "file_a" } } as any,
        aToolOutput()
      );
      await hooks["tool.execute.after"]!(
        { tool: "read", sessionID: "sess-1", callID: "c2", args: {} } as any,
        aToolOutput()
      );
      const nudged = aToolOutput();
      await hooks["tool.execute.after"]!(
        { tool: "read", sessionID: "sess-1", callID: "c3", args: {} } as any,
        nudged
      );
      ok(
        nudged.inject && nudged.inject.some((n: { text: string }) => n.text.includes("Traversal Check")),
        "traversal nudge fires at cadence"
      );

      // Anchor advances to a different node (forward/backward) — streak resets
      await hooks["tool.execute.after"]!(
        { tool: "bensyne_expandFileRelations", sessionID: "sess-1", callID: "c4", args: { file_id: "file_b" } } as any,
        aToolOutput()
      );
      const after = aToolOutput();
      await hooks["tool.execute.after"]!(
        { tool: "read", sessionID: "sess-1", callID: "c5", args: {} } as any,
        after
      );
      strictEqual(after.inject, undefined, "no nudge right after the anchor advances");
    });

    it("should reset the traversal anchor on a new user message (chat.message — new task boundary, spec C3 / AD-8)", async () => {
      const hooks = await traversalHooks();

      // User message 1 registers the agent for the session.
      await hooks["chat.message"]!(
        { sessionID: "sess-1", agent: "test-agent" } as any,
        { message: "", parts: [] }
      );

      // Traversal anchor call — no nudge on the anchor itself.
      await hooks["tool.execute.after"]!(
        { tool: "bensyne_expandFileRelations", sessionID: "sess-1", callID: "c1", args: { file_id: "file_a" } } as any,
        aToolOutput()
      );

      // Non-traversal calls up to cadence (nudgeAfter: 2) → nudge fires.
      await hooks["tool.execute.after"]!(
        { tool: "read", sessionID: "sess-1", callID: "c2", args: {} } as any,
        aToolOutput()
      );
      const nudged = aToolOutput();
      await hooks["tool.execute.after"]!(
        { tool: "read", sessionID: "sess-1", callID: "c3", args: {} } as any,
        nudged
      );
      ok(
        nudged.inject && nudged.inject.some((n: { text: string }) => n.text.includes("Traversal Check")),
        "traversal nudge should fire at cadence before the new user message"
      );

      // New user message — resets the traversal engine (new task boundary).
      await hooks["chat.message"]!(
        { sessionID: "sess-1", agent: "test-agent" } as any,
        { message: "after reset", parts: [] }
      );

      // Without a NEW traversal anchor, non-traversal calls must stay silent —
      // the reset cleared the anchor state.
      const silent1 = aToolOutput();
      await hooks["tool.execute.after"]!(
        { tool: "read", sessionID: "sess-1", callID: "c4", args: {} } as any,
        silent1
      );
      const silent2 = aToolOutput();
      await hooks["tool.execute.after"]!(
        { tool: "read", sessionID: "sess-1", callID: "c5", args: {} } as any,
        silent2
      );
      strictEqual(silent1.inject, undefined, "no nudge after reset before a new traversal anchor");
      strictEqual(silent2.inject, undefined, "no nudge after reset even at the old cadence count");
    });

    it("should add no new hooks (only chat.message, tool.execute.after, experimental.chat.system.transform)", async () => {
      const hooks = await traversalHooks();
      deepStrictEqual(
        Object.keys(hooks).sort(),
        ["chat.message", "experimental.chat.system.transform", "tool.execute.after"].sort(),
        "hooks object must expose exactly the existing hook keys"
      );
    });
  });

  // ── Task 1 (ADR-002 + ADR-004): identity gate + race fix ──

  describe("experimental.chat.system.transform identity gate + race fix", () => {
    it("should NOT initialize when input.agent is a hidden native agent (title)", async () => {
      let initCallCount = 0;

      AgentPersonaCoachPlugin.prototype.initializeSession = async function () {
        initCallCount++;
      };

      const hooks = await server(aMockPluginInput() as any);

      // Register the real session agent
      await hooks["chat.message"]!(
        { sessionID: "sess-1", agent: "test-agent" } as any,
        { message: "", parts: [] }
      );

      // Hidden native title-gen call reuses the session's sessionID
      await (hooks as any)["experimental.chat.system.transform"](
        { sessionID: "sess-1", agent: "title" } as any,
        { system: ["You are a title generator. You output ONLY a thread title."] }
      );

      strictEqual(initCallCount, 0, "title-gen call must NOT initialize the session");
    });

    it("should NOT initialize when input.agent does not match the session's tracked agent", async () => {
      let initCallCount = 0;

      AgentPersonaCoachPlugin.prototype.initializeSession = async function () {
        initCallCount++;
      };

      const hooks = await server(aMockPluginInput() as any);

      // Register the real session agent
      await hooks["chat.message"]!(
        { sessionID: "sess-1", agent: "test-agent" } as any,
        { message: "", parts: [] }
      );

      // A different agent's call must be skipped — no claim, no init
      await (hooks as any)["experimental.chat.system.transform"](
        { sessionID: "sess-1", agent: "other-agent" } as any,
        { system: ["You are another agent."] }
      );

      strictEqual(initCallCount, 0, "mismatched agent call must NOT initialize the session");
    });

    it("should initialize when input.agent matches the session's tracked agent", async () => {
      let initCallCount = 0;
      let initAgent: string | undefined;

      AgentPersonaCoachPlugin.prototype.initializeSession = async function (agent: string) {
        initCallCount++;
        initAgent = agent;
      };

      const hooks = await server(aMockPluginInput() as any);

      // Register the real session agent
      await hooks["chat.message"]!(
        { sessionID: "sess-1", agent: "test-agent" } as any,
        { message: "", parts: [] }
      );

      await (hooks as any)["experimental.chat.system.transform"](
        { sessionID: "sess-1", agent: "test-agent" } as any,
        { system: ["You are a test agent. Do good things."] }
      );

      strictEqual(initCallCount, 1, "matching agent call should initialize");
      strictEqual(initAgent, "test-agent");
    });

    it("should fall through to marker filter when input.agent is absent (old host)", async () => {
      let initCallCount = 0;

      AgentPersonaCoachPlugin.prototype.initializeSession = async function () {
        initCallCount++;
      };

      const hooks = await server(aMockPluginInput() as any);

      // Register the real session agent
      await hooks["chat.message"]!(
        { sessionID: "sess-1", agent: "test-agent" } as any,
        { message: "", parts: [] }
      );

      // Old host: no agent in input — falls through to persona extraction.
      // A native title prompt must be filtered out (marker filter), so no init.
      await (hooks as any)["experimental.chat.system.transform"](
        { sessionID: "sess-1" } as any,
        { system: ["You are a title generator. You output ONLY a thread title."] }
      );

      strictEqual(initCallCount, 0, "old host title prompt must be dropped by marker filter");
    });

    it("should initialize exactly once when two system.transform calls are concurrent", async () => {
      let initCallCount = 0;

      AgentPersonaCoachPlugin.prototype.initializeSession = async function () {
        initCallCount++;
        // Simulate async init so both calls overlap before either completes
        await new Promise((resolve) => setTimeout(resolve, 10));
      };

      const hooks = await server(aMockPluginInput() as any);

      // Register the real session agent
      await hooks["chat.message"]!(
        { sessionID: "sess-1", agent: "test-agent" } as any,
        { message: "", parts: [] }
      );

      // Fire both concurrently — race between title-gen and real call
      await Promise.all([
        (hooks as any)["experimental.chat.system.transform"](
          { sessionID: "sess-1", agent: "test-agent" } as any,
          { system: ["You are a test agent. Do good things."] }
        ),
        (hooks as any)["experimental.chat.system.transform"](
          { sessionID: "sess-1", agent: "test-agent" } as any,
          { system: ["You are a test agent. Do good things."] }
        ),
      ]);

      strictEqual(initCallCount, 1, "concurrent calls must initialize exactly once");
    });

    it("should delete the claim when initializeSession rejects so a later call retries", async () => {
      let initCallCount = 0;

      AgentPersonaCoachPlugin.prototype.initializeSession = async function () {
        initCallCount++;
        if (initCallCount === 1) {
          throw new Error("Simulated init failure");
        }
      };

      const hooks = await server(aMockPluginInput() as any);

      // Register the real session agent
      await hooks["chat.message"]!(
        { sessionID: "sess-1", agent: "test-agent" } as any,
        { message: "", parts: [] }
      );

      // First call fails — must not throw to the caller
      await (hooks as any)["experimental.chat.system.transform"](
        { sessionID: "sess-1", agent: "test-agent" } as any,
        { system: ["You are a test agent. Do good things."] }
      );
      strictEqual(initCallCount, 1, "first call attempted init");

      // Claim must have been deleted — a subsequent call retries
      await (hooks as any)["experimental.chat.system.transform"](
        { sessionID: "sess-1", agent: "test-agent" } as any,
        { system: ["You are a test agent. Do good things."] }
      );

      strictEqual(initCallCount, 2, "failed init must be retried on the next call");
    });
  });
});
