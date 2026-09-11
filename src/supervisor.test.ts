import { describe, it, beforeEach } from "node:test";
import { strictEqual, ok } from "node:assert/strict";
import { ComplianceSupervisor, type SupervisorConfig } from "./supervisor.js";
import { aMockChatClient } from "./test-utils.js";
import type { ChatClient } from "./generator.js";

// ---- Fixtures (module scope — shared across describes) ----

const COMPLIANT_JSON = JSON.stringify({ classification: "compliant" });
const SKIP_JSON = JSON.stringify({ classification: "skip" });
const EVASIVE_JSON = JSON.stringify({ classification: "evasive" });
const MARKDOWN_WRAPPED_JSON = `\`\`\`json
${COMPLIANT_JSON}
\`\`\``;
const UNCLASSIFIED_JSON = JSON.stringify({ mood: "happy" });
const INVALID_JSON = "not json {{{";

function aSupervisorConfig(overrides: Partial<SupervisorConfig> = {}): SupervisorConfig {
  return {
    enabled: true,
    model: "mock-small-model",
    maxCallsPerSession: 10,
    sampleEvery: 2,
    ladderWording: ["advisory-tier0", "explicit-tier1", "brutal-tier2"],
    ...overrides,
  };
}

function aThrowingChatClient(): ChatClient & { calls: number } {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    async createCompletion() {
      calls += 1;
      throw new Error("model exploded");
    },
  };
}

// Fixture reply shapes: reports node + status / omits status / evades with unrelated text
const REPORTS_NODE_AND_STATUS =
  "current node: 20-tdd-10-red-tests; target green-implement; condition met; no vetoes held; status: proceeding";
const OMITS_STATUS =
  "OK, I looked at src/supervisor.ts and it seems fine, moving on to the plumbing.";
const EVADES_WITH_UNRELATED =
  "The weather is nice today and I have been thinking about parallel test runners.";

describe("ComplianceSupervisor", () => {
  let supervisor: ComplianceSupervisor;
  let mockClient: ReturnType<typeof aMockChatClient>;

  beforeEach(() => {
    mockClient = aMockChatClient(COMPLIANT_JSON);
    supervisor = new ComplianceSupervisor(aSupervisorConfig(), mockClient);
  });

  describe("judge", () => {
    it("returns 'compliant' when the reply reports the node and its status", async () => {
      mockClient = aMockChatClient(COMPLIANT_JSON);
      supervisor = new ComplianceSupervisor(aSupervisorConfig(), mockClient);

      const result = await supervisor.judge("ses-1", [REPORTS_NODE_AND_STATUS]);

      strictEqual(result, "compliant");
    });

    it("returns 'skip' when the reply omits the required status", async () => {
      mockClient = aMockChatClient(SKIP_JSON);
      supervisor = new ComplianceSupervisor(aSupervisorConfig(), mockClient);

      const result = await supervisor.judge("ses-1", [EVADES_WITH_UNRELATED]);

      strictEqual(result, "skip");
    });

    it("returns 'evasive' when the reply evades with unrelated text", async () => {
      mockClient = aMockChatClient(EVASIVE_JSON);
      supervisor = new ComplianceSupervisor(aSupervisorConfig(), mockClient);

      const result = await supervisor.judge("ses-1", [EVADES_WITH_UNRELATED]);

      strictEqual(result, "evasive");
    });

    it("parses markdown-wrapped JSON via the generator-style helper", async () => {
      mockClient = aMockChatClient(MARKDOWN_WRAPPED_JSON);
      supervisor = new ComplianceSupervisor(aSupervisorConfig(), mockClient);

      const result = await supervisor.judge("ses-1", [REPORTS_NODE_AND_STATUS]);

      strictEqual(result, "compliant");
    });

    it("calls createCompletion with the configured supervisor model and the recent turns", async () => {
      await supervisor.judge("ses-1", [REPORTS_NODE_AND_STATUS, OMITS_STATUS]);

      strictEqual(mockClient.calls.length, 1);
      strictEqual(mockClient.calls[0].model, "mock-small-model");
      ok(mockClient.calls[0].messages[0].content.includes(REPORTS_NODE_AND_STATUS));
    });

    it("maps an unknown classification to 'compliant' (fail-open, never throws)", async () => {
      mockClient = aMockChatClient(UNCLASSIFIED_JSON);
      supervisor = new ComplianceSupervisor(aSupervisorConfig(), mockClient);

      const result = await supervisor.judge("ses-1", [REPORTS_NODE_AND_STATUS]);

      strictEqual(result, "compliant");
    });

    it("resolves to 'compliant' when the model returns non-JSON text", async () => {
      mockClient = aMockChatClient(INVALID_JSON);
      supervisor = new ComplianceSupervisor(aSupervisorConfig(), mockClient);

      const result = await supervisor.judge("ses-1", [REPORTS_NODE_AND_STATUS]);

      strictEqual(result, "compliant");
    });
  });

  describe("judge — throwing model client", () => {
    it("resolves to 'compliant' and does not throw (best-effort, D7)", async () => {
      const throwing = aThrowingChatClient();
      supervisor = new ComplianceSupervisor(aSupervisorConfig(), throwing);
      let settled = false;

      let result: string | undefined;
      try {
        result = await supervisor.judge("ses-1", [REPORTS_NODE_AND_STATUS]);
        settled = true;
      } catch {
        settled = false;
      }

      ok(settled, "judge must not throw when the model client throws");
      strictEqual(result, "compliant");
      strictEqual((throwing as { calls: number }).calls, 1);
    });
  });

  describe("judge — maxCallsPerSession cap", () => {
    it("stops invoking createCompletion once the cap is hit (returns 'compliant' without calling)", async () => {
      supervisor = new ComplianceSupervisor(
        aSupervisorConfig({ maxCallsPerSession: 2 }),
        mockClient
      );

      const first = await supervisor.judge("ses-1", [REPORTS_NODE_AND_STATUS]);
      const second = await supervisor.judge("ses-1", [REPORTS_NODE_AND_STATUS]);
      const third = await supervisor.judge("ses-1", [REPORTS_NODE_AND_STATUS]);

      strictEqual(first, "compliant");
      strictEqual(second, "compliant");
      strictEqual(third, "compliant");
      strictEqual(mockClient.calls.length, 2, "createCompletion must be invoked only 2 times");
    });
  });

  describe("escalate", () => {
    it("maps 0-1 skips to tier0, 2-3 to tier1, 4+ to tier2", async () => {
      const cases: Array<[number, string]> = [
        [0, "advisory-tier0"],
        [1, "advisory-tier0"],
        [2, "explicit-tier1"],
        [3, "explicit-tier1"],
        [4, "brutal-tier2"],
        [10, "brutal-tier2"],
      ];

      for (const [length, expected] of cases) {
        strictEqual(supervisor.escalate(length), expected, `skipChain=${length}`);
      }
    });

    it("clamps long skip chains to the LAST ladder tier", async () => {
      strictEqual(supervisor.escalate(99), "brutal-tier2");
      strictEqual(supervisor.escalate(Number.MAX_SAFE_INTEGER), "brutal-tier2");
    });

    it("clamps to the last tier when the ladder has fewer entries than requested tier", async () => {
      supervisor = new ComplianceSupervisor(
        aSupervisorConfig({ ladderWording: ["only-advisory", "only-explicit"] }),
        mockClient
      );

      strictEqual(supervisor.escalate(0), "only-advisory");
      strictEqual(supervisor.escalate(2), "only-explicit");
      strictEqual(supervisor.escalate(99), "only-explicit", "long chain clamps to last available");
    });
  });
});