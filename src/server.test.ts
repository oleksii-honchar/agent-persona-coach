import { describe, it, beforeEach, afterEach } from "node:test";
import { strictEqual, ok, deepStrictEqual, rejects } from "node:assert/strict";
import { AgentPersonaCoachPlugin } from "./index.js";
import serverModule from "./server.js";
import { createServerHooks } from "./server.js";
import { aMockChatClient } from "./test-utils.js";

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
      // tool.execute.before added in Task 6 for the hard gate — must exist
      ok(typeof (hooks as any)["tool.execute.before"] === "function", "tool.execute.before should be defined (hard gate, Task 6)");
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

      // The first tool call after a fresh-session user message consumes the
      // queued bootstrap nudge (Task 6) — the traversal anchor call therefore
      // DOES inject, but only the system-role bootstrap, not a traversal nudge.
      const anchored = aToolOutput();
      await hooks["tool.execute.after"]!(
        { tool: "bensyne_expandFileRelations", sessionID: "sess-1", callID: "c1", args: { file_id: "file_a" } } as any,
        anchored
      );
      ok(anchored.inject && anchored.inject.length === 1, "anchor call injects exactly the bootstrap nudge");
      strictEqual(anchored.inject[0].role, "system", "bootstrap is a system-role inject");
      ok(
        anchored.inject[0].text.includes("Traversal Check") &&
          anchored.inject[0].text.includes("Enter it before your next tool"),
        "bootstrap nudge uses the bootstrap wording"
      );
      strictEqual(
        anchored.inject.some((n: { text: string }) => n.text.includes("decision-tree node")),
        false,
        "anchor call must not inject a traversal-progress nudge"
      );

      // Non-traversal call #1 — still below nudgeAfter (2)
      const silent = aToolOutput();
      await hooks["tool.execute.after"]!(
        { tool: "read", sessionID: "sess-1", callID: "c2", args: {} } as any,
        silent
      );
      strictEqual(silent.inject, undefined, "no inject before nudgeAfter non-traversal calls (bootstrap already consumed)");

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

    it("should realign (keep anchor) on a new user message with default onUserMessage:\"realign\" (Task 6 / ADR-0011)", async () => {
      const hooks = await traversalHooks();

      // User message 1 registers the agent for the session.
      await hooks["chat.message"]!(
        { sessionID: "sess-1", agent: "test-agent" } as any,
        { message: "", parts: [] }
      );

      // First tool call consumes the queued bootstrap; the traversal anchor call
      // anchors the session (file_a).
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

      // New user message — with the default onUserMessage:"realign" the anchor is
      // KEPT and the realignment window opens (Task 6 wiring, ADR-0011).
      await hooks["chat.message"]!(
        { sessionID: "sess-1", agent: "test-agent" } as any,
        { message: "after realign", parts: [] }
      );

      // The first non-traversal call after the user message fires an immediate
      // realign nudge (before the nudgeAfter cadence) — anchor still file_a.
      const realign1 = aToolOutput();
      await hooks["tool.execute.after"]!(
        { tool: "read", sessionID: "sess-1", callID: "c4", args: {} } as any,
        realign1
      );
      ok(
        realign1.inject &&
          realign1.inject.some((n: { text: string }) => n.text.includes("Realign Check")),
        "first non-traversal call after a user message fires an immediate realign nudge"
      );

      // The realignment window is consumed — the next call follows the normal
      // cadence (no immediate repeat).
      const realign2 = aToolOutput();
      await hooks["tool.execute.after"]!(
        { tool: "read", sessionID: "sess-1", callID: "c5", args: {} } as any,
        realign2
      );
      ok(
        !realign2.inject || !realign2.inject.some((n: { text: string }) => n.text.includes("Realign Check")),
        "no second realign nudge — window consumed"
      );
    });

    it("should wipe the traversal anchor on a new user message when onUserMessage:\"reset\" (escape hatch, AD-8)", async () => {
      const plugin = new AgentPersonaCoachPlugin({
        categories: {
          identity: { enabled: false },
          rules: { enabled: false },
          references: { enabled: false },
          progress: { enabled: false },
          traversal: { enabled: true, nudgeAfter: 2, recurrentEvery: 2, maxRepeats: 3, onUserMessage: "reset" },
        },
      });
      const hooks = await createServerHooks(plugin, aMockPluginInput() as any);

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
        "traversal nudge should fire at cadence before the new user message"
      );

      // onUserMessage:"reset" — the new user message wipes the anchor state
      // (old AD-8 strict task-boundary semantics, ADR-0011 escape hatch).
      await hooks["chat.message"]!(
        { sessionID: "sess-1", agent: "test-agent" } as any,
        { message: "after reset", parts: [] }
      );

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

    it("should expose exactly the hook surface: chat.message, tool.execute.before, tool.execute.after, experimental.chat.system.transform", async () => {
      const hooks = await traversalHooks();
      deepStrictEqual(
        Object.keys(hooks).sort(),
        ["chat.message", "experimental.chat.system.transform", "tool.execute.after", "tool.execute.before"].sort(),
        "hooks object must expose exactly the existing hook keys"
      );
    });
  });

  // ── Ad-hoc wiring task: plugin options from opencode.jsonc reach the plugin ──

  // ── Task 6 (spec §3 + §6 wiring): bootstrap queue + tool.execute.before hard gate ──

  describe("Task 6 — bootstrap queue + tool.execute.before (spec §3 / §6)", () => {
    /**
     * createServerHooks with a real plugin whose traversal category is enabled
     * and generative categories disabled (like traversalHooks above), returning
     * the hooks wired through createServerHooks.
     */
    function traversalHooks(
      override: { onUserMessage?: "reset" | "realign" } = {}
    ) {
      const plugin = new AgentPersonaCoachPlugin({
        categories: {
          identity: { enabled: false },
          rules: { enabled: false },
          references: { enabled: false },
          progress: { enabled: false },
          traversal: {
            enabled: true,
            nudgeAfter: 2,
            recurrentEvery: 2,
            maxRepeats: 3,
            ...(override.onUserMessage ? { onUserMessage: override.onUserMessage } : {}),
          },
        },
      });
      return createServerHooks(plugin, aMockPluginInput() as any);
    }

    function aToolOutput() {
      return { title: "", output: "", metadata: {} } as any;
    }

    it("queues a single-shot bootstrap nudge on a fresh session and injects it (role:system) on the first tool.execute.after", async () => {
      const hooks = await traversalHooks();

      // Fresh session — chat.message with traversal enabled and no anchor queues bootstrap.
      await hooks["chat.message"]!(
        { sessionID: "sess-b1", agent: "test-agent" } as any,
        { message: "", parts: [] }
      );

      const first = aToolOutput();
      await hooks["tool.execute.after"]!(
        { tool: "read", sessionID: "sess-b1", callID: "c1", args: {} } as any,
        first
      );
      ok(first.inject && first.inject.length === 1, "first tool.execute.after injects exactly one nudge");
      strictEqual(first.inject[0].role, "system", "bootstrap is role:system");
      ok(
        first.inject[0].text.includes("Enter it before your next tool"),
        "bootstrap text uses the traversal bootstrapWording"
      );
      ok(first.inject[0].text.includes("Traversal Check"), "bootstrap is a traversal-reminder block");

      // Second tool.execute.after — flag was deleted; bootstrap must NOT re-inject.
      const second = aToolOutput();
      await hooks["tool.execute.after"]!(
        { tool: "read", sessionID: "sess-b1", callID: "c2", args: {} } as any,
        second
      );
      strictEqual(second.inject, undefined, "second call must not re-inject the bootstrap");
    });

    it("prepends the bootstrap nudge BEFORE existing category nudges in output.inject", async () => {
      // Identity enabled with cadence 1 → the FIRST tool call also yields an
      // identity nudge; bootstrap must sit before it (spec §3, D2).
      const plugin = new AgentPersonaCoachPlugin({
        categories: {
          identity: { enabled: true, cadence: 1, afterEachUserMessage: true },
          rules: { enabled: false },
          references: { enabled: false },
          progress: { enabled: false },
          traversal: { enabled: true, nudgeAfter: 2, recurrentEvery: 2, maxRepeats: 3 },
        },
      });
      plugin.setChatClient(aMockChatClient(JSON.stringify({
        identity: ["Who am I?"],
        rules: [],
        references: [],
        progress: [],
      })));
      await plugin.initializeSession("test-agent", { system: "You are a persona agent." });
      const hooks = await createServerHooks(plugin, aMockPluginInput() as any);

      await hooks["chat.message"]!(
        { sessionID: "sess-b2", agent: "test-agent" } as any,
        { message: "", parts: [] }
      );

      const first = aToolOutput();
      await hooks["tool.execute.after"]!(
        { tool: "read", sessionID: "sess-b2", callID: "c1", args: {} } as any,
        first
      );

      ok(first.inject && first.inject.length === 2, "bootstrap + identity nudge both injected");
      strictEqual(first.inject[0].role, "system", "bootstrap is FIRST (system)");
      ok(first.inject[0].text.includes("Enter it before your next tool"), "first entry is the bootstrap");
      strictEqual(first.inject[1].role, "user", "category nudge is second (user)");
      ok(first.inject[1].text.includes("Identity Check"), "second entry is the identity nudge");
    });

    it("does NOT queue bootstrap when the session is already anchored (chat.message after anchor)", async () => {
      const hooks = await traversalHooks();

      // First user message — queues bootstrap.
      await hooks["chat.message"]!(
        { sessionID: "sess-b3", agent: "test-agent" } as any,
        { message: "", parts: [] }
      );

      // Anchor call consumes the bootstrap on the first tool.execute.after.
      const anchored = aToolOutput();
      await hooks["tool.execute.after"]!(
        { tool: "bensyne_expandFileRelations", sessionID: "sess-b3", callID: "c1", args: { file_id: "file_a" } } as any,
        anchored
      );
      ok(anchored.inject && anchored.inject.length === 1, "first call consumed the bootstrap");

      // Second user message — session is anchored → no bootstrap queued.
      await hooks["chat.message"]!(
        { sessionID: "sess-b3", agent: "test-agent" } as any,
        { message: "again", parts: [] }
      );

      const after = aToolOutput();
      await hooks["tool.execute.after"]!(
        { tool: "read", sessionID: "sess-b3", callID: "c2", args: {} } as any,
        after
      );

      ok(
        !after.inject || !after.inject.some((n: { role: string; text: string }) => n.role === "system"),
        "anchored session must not re-inject the bootstrap"
      );
    });

    it("tool.execute.before throws an Error containing the hard-gate text when onToolBefore returns a message", async () => {
      const plugin = new AgentPersonaCoachPlugin({
        categories: {
          identity: { enabled: false },
          rules: { enabled: false },
          references: { enabled: false },
          progress: { enabled: false },
          traversal: {
            enabled: true,
            hardGate: { enabled: true, wording: "BLOCKED — realign with the tree now." },
          },
        },
      });
      const hooks = await createServerHooks(plugin, aMockPluginInput() as any);

      // Anchor + open the realignment window so onToolBefore blocks.
      await hooks["chat.message"]!(
        { sessionID: "sess-g1", agent: "test-agent" } as any,
        { message: "", parts: [] }
      );
      await hooks["tool.execute.after"]!(
        { tool: "bensyne_expandFileRelations", sessionID: "sess-g1", callID: "c1", args: { file_id: "file_a" } } as any,
        aToolOutput()
      );
      // A new user message with default onUserMessage:"realign" opens the window.
      await hooks["chat.message"]!(
        { sessionID: "sess-g1", agent: "test-agent" } as any,
        { message: "realign me", parts: [] }
      );

      await rejects(
        hooks["tool.execute.before"]!(
          { tool: "read", sessionID: "sess-g1", callID: "g1" },
          { args: {} }
        ),
        (err: unknown) =>
          err instanceof Error && err.message.includes("BLOCKED — realign with the tree now."),
        "before-hook should throw the hard-gate message for a non-traversal tool during realignment"
      );

      // A traversal tool passes (no throw).
      await hooks["tool.execute.before"]!(
        { tool: "bensyne_fetchFile", sessionID: "sess-g1", callID: "g2" },
        { args: { file_id: "file_a" } }
      );
      ok(true, "traversal tools must pass the before-hook without throwing");
    });

    it("contract (fork shape): tool.execute.before receives args on OUTPUT — meta_use-wrapped traversal must pass", async () => {
      // Fork contract (better-opencode/packages/plugin/src/index.ts:304-307):
      //   tool.execute.before?: (input: { tool; sessionID; callID }, output: { args: any }) => Promise<void>
      // Args arrive on OUTPUT in the before-hook — unlike tool.execute.after, where they are on input.
      // The hard gate must unwrap meta_use-wrapped traversal names from output.args.
      const plugin = new AgentPersonaCoachPlugin({
        categories: {
          identity: { enabled: false },
          rules: { enabled: false },
          references: { enabled: false },
          progress: { enabled: false },
          traversal: {
            enabled: true,
            hardGate: { enabled: true, wording: "BLOCKED — realign with the tree now." },
          },
        },
      });
      const hooks = await createServerHooks(plugin, aMockPluginInput() as any);

      // Anchor + open the realignment window so onToolBefore blocks non-traversal tools.
      await hooks["chat.message"]!(
        { sessionID: "sess-g3", agent: "test-agent" } as any,
        { message: "", parts: [] }
      );
      await hooks["tool.execute.after"]!(
        { tool: "bensyne_expandFileRelations", sessionID: "sess-g3", callID: "c1", args: { file_id: "file_a" } } as any,
        aToolOutput()
      );
      await hooks["chat.message"]!(
        { sessionID: "sess-g3", agent: "test-agent" } as any,
        { message: "realign me", parts: [] }
      );

      // Fork-real invocation: input carries NO args; the wrapped tool name lives in output.args.
      // Guard test for Issue-1 (Task 10 fix): server.ts reads output.args → traversal tool
      // recognized via output.args.name → no throw. This shape is the runtime contract guard —
      // every other before-hook invocation in this suite uses the same fork-real shape.
      await hooks["tool.execute.before"]!(
        { tool: "meta_use", sessionID: "sess-g3", callID: "g3" },
        { args: { name: "bensyne_fetchFile", args: { file_id: "file_a" } } }
      );
      ok(true, "meta_use-wrapped traversal tool must pass the before-hook (args on output)");

      // Issue-3 disposition (review "unused variable `loaded` at src/server.ts:144"):
      // False positive — wrong line attribution. `loaded` lives in
      // src/provider-client.ts:144-148 and IS used (guard `if (!loaded) throw` +
      // `config = loaded`). No dead code exists in src/server.ts to remove.
    });

    it("tool.execute.before does not throw when onToolBefore returns null (no realignment window)", async () => {
      const hookses = await traversalHooks();

      // No chat.message → un-anchored → onToolBefore returns null → no throw.
      await hookses["tool.execute.before"]!(
        { tool: "read", sessionID: "sess-g2", callID: "g1" },
        { args: {} }
      );
      ok(true, "before-hook must not throw when onToolBefore returns null");
    });

    it("tool.execute.before prop should be a function on the returned hooks object", async () => {
      const hooks = await traversalHooks();
      ok(typeof hooks["tool.execute.before"] === "function", "tool.execute.before hook must be present");
    });
  });

  describe("server(pluginInput, options) — plugin options wiring (options → config)", () => {
    function aHookOutput() {
      return { title: "", output: "", metadata: {} } as any;
    }

    it("passes options into the plugin constructor — deepMerge applied to config", async () => {
      let capturedPlugin: AgentPersonaCoachPlugin | undefined;
      const originalSetChatClient = AgentPersonaCoachPlugin.prototype.setChatClient;
      // Capture the instance the server constructs (setChatClient is called on it).
      AgentPersonaCoachPlugin.prototype.setChatClient = function (client: any) {
        capturedPlugin = this as AgentPersonaCoachPlugin;
        return originalSetChatClient.call(this, client);
      };

      try {
        const hooks = await server(aMockPluginInput() as any, {
          categories: { traversal: { enabled: true, nudgeAfter: 2 } },
        });

        ok(capturedPlugin, "server should construct an AgentPersonaCoachPlugin");
        strictEqual(
          capturedPlugin!.config.categories.traversal.nudgeAfter,
          2,
          "options nudgeAfter override should be applied via deepMerge"
        );
        strictEqual(
          capturedPlugin!.config.categories.traversal.enabled,
          true,
          "options traversal override should be applied via deepMerge"
        );
        // deepMerge preserves the untouched traversal defaults
        strictEqual(
          capturedPlugin!.config.categories.traversal.maxRepeats,
          3,
          "unspecified traversal defaults should be preserved"
        );
        ok(typeof hooks["tool.execute.after"] === "function");
      } finally {
        AgentPersonaCoachPlugin.prototype.setChatClient = originalSetChatClient;
      }
    });

    it("delivers the traversal nudge via output.inject when options enable it (options → onToolAfter → output.inject)", async () => {
      const hooks = await server(aMockPluginInput() as any, {
        categories: { traversal: { enabled: true, nudgeAfter: 2 } },
      });

      // Register the agent for the session
      await hooks["chat.message"]!(
        { sessionID: "sess-1", agent: "test-agent" } as any,
        { message: "", parts: [] }
      );

      // The first tool call after a fresh-session user message consumes the
      // queued bootstrap nudge (Task 6) — the traversal anchor call therefore
      // DOES inject, but only the system-role bootstrap, not a traversal nudge.
      const anchored = aHookOutput();
      await hooks["tool.execute.after"]!(
        { tool: "bensyne_expandFileRelations", sessionID: "sess-1", callID: "c1", args: { file_id: "file_a" } } as any,
        anchored
      );
      ok(anchored.inject && anchored.inject.length === 1, "anchor call injects exactly the bootstrap nudge");
      strictEqual(anchored.inject[0].role, "system", "bootstrap is a system-role inject");
      ok(
        anchored.inject[0].text.includes("Traversal Check") &&
          anchored.inject[0].text.includes("Enter it before your next tool"),
        "bootstrap nudge uses the bootstrap wording"
      );
      strictEqual(
        anchored.inject.some((n: { text: string }) => n.text.includes("decision-tree node")),
        false,
        "anchor call must not inject a traversal-progress nudge"
      );

      // Non-traversal call #1 — still below nudgeAfter (2)
      const silent = aHookOutput();
      await hooks["tool.execute.after"]!(
        { tool: "read", sessionID: "sess-1", callID: "c2", args: {} } as any,
        silent
      );
      strictEqual(silent.inject, undefined, "no inject before nudgeAfter non-traversal calls");

      // Non-traversal call #2 — cadence (from options) reached → traversal nudge delivered
      const nudged = aHookOutput();
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

  // ── Task 8 (spec §7 wiring / D7): supervisor sampling + inject wiring ──

  describe("Task 8 — supervisor wiring (spec §7 / D7)", () => {
    const SUPERVISOR_LADDER = ["advisory-tier0", "explicit-tier1", "brutal-tier2"];
    const SKIP_VERDICT = JSON.stringify({ classification: "skip" });
    const COMPLIANT_VERDICT = JSON.stringify({ classification: "compliant" });

    /**
     * Real plugin with generative categories disabled and the LLM supervision
     * layer enabled, wired through createServerHooks exactly like production.
     * The ChatClient is injected per test (passing or throwing mock).
     */
    async function supervisorHooks(
      client: ReturnType<typeof aMockChatClient> | { createCompletion(): Promise<never> },
      supervisorOverrides: Record<string, unknown> = {}
    ) {
      const plugin = new AgentPersonaCoachPlugin({
        categories: {
          identity: { enabled: false },
          rules: { enabled: false },
          references: { enabled: false },
          progress: { enabled: false },
          traversal: {
            supervisor: {
              enabled: true,
              model: "small-model",
              maxCallsPerSession: 10,
              sampleEvery: 1,
              ladderWording: SUPERVISOR_LADDER,
              ...supervisorOverrides,
            },
          },
        },
      });
      plugin.setChatClient(client as any);
      const hooks = await createServerHooks(plugin, aMockPluginInput() as any);
      return { plugin, hooks };
    }

    function aToolOutput() {
      return { title: "", output: "", metadata: {} } as any;
    }

    it("injects the escalated ladder text into output.inject as a synthetic system message when supervision judges 'skip'", async () => {
      const client = aMockChatClient(SKIP_VERDICT);
      const { plugin, hooks } = await supervisorHooks(client);
      plugin.appendAssistantTurn("sess-8", "last assistant reply that skipped the tree check");

      // message 1 — sampleEvery: 1 → queued
      await hooks["chat.message"]!(
        { sessionID: "sess-8", agent: "test-agent" } as any,
        { message: "", parts: [] }
      );
      const output = aToolOutput();
      await hooks["tool.execute.after"]!(
        { tool: "read", sessionID: "sess-8", callID: "c1", args: {} } as any,
        output
      );

      ok(output.inject && output.inject.length === 1, "supervisor inject should be the only inject");
      strictEqual(output.inject[0].role, "system", "escalated message is a synthetic system message");
      strictEqual(output.inject[0].text, "advisory-tier0", "first skip uses ladder tier0");
    });

    it("injects nothing when supervision judges 'compliant'", async () => {
      const client = aMockChatClient(COMPLIANT_VERDICT);
      const { plugin, hooks } = await supervisorHooks(client);
      plugin.appendAssistantTurn("sess-8", "current node 20-tdd-10-red-tests; target green; conditions met");

      await hooks["chat.message"]!(
        { sessionID: "sess-8", agent: "test-agent" } as any,
        { message: "", parts: [] }
      );
      const output = aToolOutput();
      await hooks["tool.execute.after"]!(
        { tool: "read", sessionID: "sess-8", callID: "c1", args: {} } as any,
        output
      );

      strictEqual(output.inject, undefined, "compliant supervision must not inject anything");
      strictEqual(client.calls.length, 1, "judge still ran (one LLM call)");
    });

    it("sampleEvery=2 → supervision runs on user messages 2 and 4 (per-session counter)", async () => {
      const client = aMockChatClient(COMPLIANT_VERDICT);
      const { hooks } = await supervisorHooks(client, { sampleEvery: 2 });

      async function userMessage() {
        await hooks["chat.message"]!(
          { sessionID: "sess-8", agent: "test-agent" } as any,
          { message: "", parts: [] }
        );
      }
      async function toolCall() {
        const output = aToolOutput();
        await hooks["tool.execute.after"]!(
          { tool: "read", sessionID: "sess-8", callID: "c", args: {} } as any,
          output
        );
        return output;
      }

      await userMessage();
      const first = await toolCall();
      strictEqual(client.calls.length, 0, "message 1 not sampled");
      strictEqual(first.inject, undefined, "no supervision inject for message 1");

      await userMessage();
      const second = await toolCall();
      strictEqual(client.calls.length, 1, "message 2 sampled → one judge call");

      await userMessage();
      const third = await toolCall();
      strictEqual(client.calls.length, 1, "message 3 not sampled");
      strictEqual(third.inject, undefined, "no supervision inject for message 3");

      await userMessage();
      const fourth = await toolCall();
      strictEqual(client.calls.length, 2, "message 4 sampled → second judge call");
    });

    it("does not queue supervision and makes no LLM call when supervisor.enabled=false", async () => {
      const client = aMockChatClient(SKIP_VERDICT);
      const plugin = new AgentPersonaCoachPlugin({
        categories: {
          identity: { enabled: false },
          rules: { enabled: false },
          references: { enabled: false },
          progress: { enabled: false },
          traversal: { supervisor: { enabled: false, sampleEvery: 1 } },
        },
      });
      plugin.setChatClient(client);
      const hooks = await createServerHooks(plugin, aMockPluginInput() as any);

      for (let i = 0; i < 3; i++) {
        await hooks["chat.message"]!(
          { sessionID: "sess-8", agent: "test-agent" } as any,
          { message: "", parts: [] }
        );
        const output = aToolOutput();
        await hooks["tool.execute.after"]!(
          { tool: "read", sessionID: "sess-8", callID: `c${i}`, args: {} } as any,
          output
        );
        strictEqual(output.inject, undefined, `no supervision inject on message ${i + 1}`);
      }
      strictEqual(client.calls.length, 0, "no LLM call when supervisor disabled");
    });

    it("swallows supervisor failure — the hook does not reject and output.inject is unchanged", async () => {
      const throwing = {
        async createCompletion() {
          throw new Error("model exploded");
        },
      };
      const { plugin, hooks } = await supervisorHooks(throwing as any);
      plugin.appendAssistantTurn("sess-8", "last assistant reply");

      await hooks["chat.message"]!(
        { sessionID: "sess-8", agent: "test-agent" } as any,
        { message: "", parts: [] }
      );

      const output = aToolOutput();
      let settled = false;
      try {
        await hooks["tool.execute.after"]!(
          { tool: "read", sessionID: "sess-8", callID: "c1", args: {} } as any,
          output
        );
        settled = true;
      } catch {
        settled = false;
      }

      ok(settled, "tool.execute.after must not reject when the supervisor model call throws");
      strictEqual(output.inject, undefined, "output.inject unchanged on supervisor failure");

      // Flag must be cleared after the failed attempt — the next tool call must
      // not retry supervision (quiesce rather than spin on a broken model).
      const second = aToolOutput();
      await hooks["tool.execute.after"]!(
        { tool: "read", sessionID: "sess-8", callID: "c2", args: {} } as any,
        second
      );
      strictEqual(second.inject, undefined, "supervision flag cleared after failure");
    });
  });
});
