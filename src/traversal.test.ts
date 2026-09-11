import { describe, it } from "node:test";
import { strictEqual, deepStrictEqual, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TraversalConfig, TraversalNudgeEngine } from "./traversal.js";
import {
  formatTraversalNudge,
  formatBacktrackNudge,
  formatRealignNudge,
  formatHardGateMessage,
} from "./injector.js";
import { DEFAULT_CONFIG } from "./types.js";

function makeConfig(
  overrides: Partial<typeof DEFAULT_CONFIG.categories.traversal> = {}
): typeof DEFAULT_CONFIG.categories.traversal {
  return { ...DEFAULT_CONFIG.categories.traversal, enabled: true, ...overrides };
}

describe("TraversalNudgeEngine — traversal detection", () => {
  it("should detect direct bensyne_* traversal tool names", () => {
    const engine = new TraversalNudgeEngine(makeConfig());
    engine.observeTool("s1", "bensyne_expandFileRelations", { file_id: "file_a" });
    const state = engine.getState("s1");
    strictEqual(state.pending, true);
    strictEqual(state.anchorNode, "file_a");
  });

  it("should detect meta_use-wrapped traversal tool names", () => {
    const engine = new TraversalNudgeEngine(makeConfig());
    engine.observeTool("s1", "meta_use", {
      name: "bensyne_expandFileRelations",
      args: { file_id: "file_a" },
    });
    const state = engine.getState("s1");
    strictEqual(state.pending, true);
    strictEqual(state.anchorNode, "file_a");
  });

  it("should detect LiteLLM double-prefixed traversal names", () => {
    const engine = new TraversalNudgeEngine(makeConfig());
    engine.observeTool("s1", "bensyne_bensyne-expandFileRelations", { file_id: "file_a" });
    strictEqual(engine.getState("s1").pending, true);
  });

  it("should not treat non-traversal tools as traversal", () => {
    const engine = new TraversalNudgeEngine(makeConfig());
    const nudges = engine.observeTool("s1", "bash", { command: "ls" });
    deepStrictEqual(nudges, []);
    strictEqual(engine.getState("s1").pending, false);
  });

  it("should fall back to tool name when no file_id/node_id in args", () => {
    const engine = new TraversalNudgeEngine(makeConfig());
    engine.observeTool("s1", "bensyne_getPersonaEntryNode", { memory_bank: "persona_worker" });
    strictEqual(engine.getState("s1").anchorNode, "bensyne_getPersonaEntryNode");
  });
});

describe("TraversalNudgeEngine — anchor, advance, reset", () => {
  it("should anchor on first traversal call and record path", () => {
    const engine = new TraversalNudgeEngine(makeConfig());
    engine.observeTool("s1", "bensyne_expandFileRelations", { file_id: "file_a" });
    const state = engine.getState("s1");
    strictEqual(state.anchorNode, "file_a");
    strictEqual(state.pending, true);
    deepStrictEqual(state.path, ["file_a"]);
    strictEqual(state.cycleCount, 0);
    strictEqual(state.repeats, 0);
    strictEqual(state.nonTraversalCalls, 0);
  });

  it("should treat forward jump as advancement (reset cycleCount, no nudge)", () => {
    const engine = new TraversalNudgeEngine(makeConfig({ backtrackAfter: 2 }));
    engine.observeTool("s1", "bensyne_expandFileRelations", { file_id: "file_a" });
    engine.observeTool("s1", "bensyne_expandFileRelations", { file_id: "file_a" }); // cycle 1
    engine.observeTool("s1", "bensyne_expandFileRelations", { file_id: "file_a" }); // cycle 2 -> backtrack
    const nudges = engine.observeTool("s1", "bensyne_expandFileRelations", { file_id: "file_b" }); // forward
    deepStrictEqual(nudges, []);
    const state = engine.getState("s1");
    strictEqual(state.anchorNode, "file_b");
    strictEqual(state.cycleCount, 0);
    strictEqual(state.repeats, 0);
    deepStrictEqual(state.path, ["file_a", "file_b"]);
  });

  it("should treat backward jump as advancement (reset cycleCount, no nudge)", () => {
    const engine = new TraversalNudgeEngine(makeConfig({ backtrackAfter: 2 }));
    engine.observeTool("s1", "bensyne_expandFileRelations", { file_id: "file_a" });
    engine.observeTool("s1", "bensyne_expandFileRelations", { file_id: "file_b" });
    engine.observeTool("s1", "bensyne_expandFileRelations", { file_id: "file_b" }); // cycle 1
    engine.observeTool("s1", "bensyne_expandFileRelations", { file_id: "file_b" }); // cycle 2 -> backtrack
    const nudges = engine.observeTool("s1", "bensyne_expandFileRelations", { file_id: "file_a" }); // backward
    deepStrictEqual(nudges, []);
    const state = engine.getState("s1");
    strictEqual(state.anchorNode, "file_a");
    strictEqual(state.cycleCount, 0);
    deepStrictEqual(state.path, ["file_a", "file_b", "file_a"]);
  });

  it("should reset clears all state (new task boundary)", () => {
    const engine = new TraversalNudgeEngine(makeConfig());
    engine.observeTool("s1", "bensyne_expandFileRelations", { file_id: "file_a" });
    engine.reset("s1");
    const state = engine.getState("s1");
    strictEqual(state.pending, false);
    strictEqual(state.anchorNode, undefined);
    deepStrictEqual(state.path, []);
    strictEqual(state.nonTraversalCalls, 0);
    strictEqual(state.repeats, 0);
    strictEqual(state.cycleCount, 0);
  });

  it("should clear removes session state", () => {
    const engine = new TraversalNudgeEngine(makeConfig());
    engine.observeTool("s1", "bensyne_expandFileRelations", { file_id: "file_a" });
    engine.clear("s1");
    strictEqual(engine.getState("s1").pending, false);
  });

  it("should keep sessions independent", () => {
    const engine = new TraversalNudgeEngine(makeConfig());
    engine.observeTool("s1", "bensyne_expandFileRelations", { file_id: "file_a" });
    engine.observeTool("s2", "bash");
    strictEqual(engine.getState("s1").anchorNode, "file_a");
    strictEqual(engine.getState("s2").pending, false);
  });
});

describe("TraversalNudgeEngine — cycle detection (AD-12)", () => {
  it("should increment cycleCount on same-node re-anchor", () => {
    const engine = new TraversalNudgeEngine(makeConfig());
    engine.observeTool("s1", "bensyne_expandFileRelations", { file_id: "file_a" });
    engine.observeTool("s1", "bensyne_expandFileRelations", { file_id: "file_a" });
    strictEqual(engine.getState("s1").cycleCount, 1);
    engine.observeTool("s1", "bensyne_expandFileRelations", { file_id: "file_a" });
    strictEqual(engine.getState("s1").cycleCount, 2);
  });

  it("should fire backtrack nudge at backtrackAfter (stuck wording)", () => {
    const engine = new TraversalNudgeEngine(makeConfig({ backtrackAfter: 3 }));
    engine.observeTool("s1", "bensyne_expandFileRelations", { file_id: "file_a" });
    engine.observeTool("s1", "bensyne_expandFileRelations", { file_id: "file_a" });
    engine.observeTool("s1", "bensyne_expandFileRelations", { file_id: "file_a" });
    const nudges = engine.observeTool("s1", "bensyne_expandFileRelations", { file_id: "file_a" });
    strictEqual(nudges.length, 1);
    ok(nudges[0].includes("Backtrack Check"));
    ok(nudges[0].includes("You keep re-anchoring"));
    ok(nudges[0].includes("Recent anchors"));
  });

  it("should not fire backtrack nudge before backtrackAfter", () => {
    const engine = new TraversalNudgeEngine(makeConfig({ backtrackAfter: 3 }));
    engine.observeTool("s1", "bensyne_expandFileRelations", { file_id: "file_a" });
    const n1 = engine.observeTool("s1", "bensyne_expandFileRelations", { file_id: "file_a" });
    const n2 = engine.observeTool("s1", "bensyne_expandFileRelations", { file_id: "file_a" });
    deepStrictEqual(n1, []);
    deepStrictEqual(n2, []);
  });

  it("should not push duplicate consecutive anchors onto path", () => {
    const engine = new TraversalNudgeEngine(makeConfig());
    engine.observeTool("s1", "bensyne_expandFileRelations", { file_id: "file_a" });
    engine.observeTool("s1", "bensyne_expandFileRelations", { file_id: "file_a" });
    engine.observeTool("s1", "bensyne_expandFileRelations", { file_id: "file_a" });
    deepStrictEqual(engine.getState("s1").path, ["file_a"]);
  });
});

describe("TraversalNudgeEngine — cadence (nudgeAfter / recurrentEvery / maxRepeats)", () => {
  it("should nudge only after nudgeAfter non-traversal calls", () => {
    const engine = new TraversalNudgeEngine(
      makeConfig({ nudgeAfter: 2, recurrentEvery: 2, maxRepeats: 3 })
    );
    engine.observeTool("s1", "bensyne_expandFileRelations", { file_id: "file_a" });
    deepStrictEqual(engine.observeTool("s1", "bash"), []);
    const nudges = engine.observeTool("s1", "bash");
    strictEqual(nudges.length, 1);
    ok(nudges[0].includes("Traversal Check"));
    ok(nudges[0].includes("decision-tree node file_a"));
  });

  it("should re-nudge every recurrentEvery calls after the first, capped at maxRepeats", () => {
    const engine = new TraversalNudgeEngine(
      makeConfig({ nudgeAfter: 2, recurrentEvery: 2, maxRepeats: 3 })
    );
    engine.observeTool("s1", "bensyne_expandFileRelations", { file_id: "file_a" });
    engine.observeTool("s1", "bash"); // 1
    engine.observeTool("s1", "bash"); // 2 -> nudge 1
    engine.observeTool("s1", "bash"); // 3
    const n2 = engine.observeTool("s1", "bash"); // 4 -> nudge 2
    strictEqual(n2.length, 1);
    engine.observeTool("s1", "bash"); // 5
    const n3 = engine.observeTool("s1", "bash"); // 6 -> nudge 3
    strictEqual(n3.length, 1);
    engine.observeTool("s1", "bash"); // 7
    const n4 = engine.observeTool("s1", "bash"); // 8 -> capped
    deepStrictEqual(n4, []);
    strictEqual(engine.getState("s1").repeats, 3);
  });

  it("should stop nudging after a traversal call (streak reset)", () => {
    const engine = new TraversalNudgeEngine(
      makeConfig({ nudgeAfter: 2, recurrentEvery: 2, maxRepeats: 3 })
    );
    engine.observeTool("s1", "bensyne_expandFileRelations", { file_id: "file_a" });
    engine.observeTool("s1", "bash"); // 1
    engine.observeTool("s1", "bash"); // 2 -> nudge
    engine.observeTool("s1", "bensyne_expandFileRelations", { file_id: "file_b" }); // traversal
    deepStrictEqual(engine.observeTool("s1", "bash"), []); // streak restarted
    strictEqual(engine.getState("s1").nonTraversalCalls, 1);
  });

  it("should not nudge before any anchor exists", () => {
    const engine = new TraversalNudgeEngine(makeConfig({ nudgeAfter: 1 }));
    deepStrictEqual(engine.observeTool("s1", "bash"), []);
    deepStrictEqual(engine.observeTool("s1", "bash"), []);
  });

  it("should do nothing when disabled", () => {
    const engine = new TraversalNudgeEngine(makeConfig({ enabled: false }));
    deepStrictEqual(
      engine.observeTool("s1", "bensyne_expandFileRelations", { file_id: "file_a" }),
      []
    );
    strictEqual(engine.getState("s1").pending, false);
    deepStrictEqual(engine.observeTool("s1", "bash"), []);
  });
});

describe("TraversalNudgeEngine — pause-node classification (AD-13)", () => {
  it("should classify anchor as pause when veto non-empty and bias the nudge", () => {
    const engine = new TraversalNudgeEngine(makeConfig({ nudgeAfter: 1 }));
    engine.observeTool("s1", "bensyne_fetchFile", {
      file_id: "file_pause",
      veto: ["Do not proceed until direction given"],
    });
    strictEqual(engine.getState("s1").anchorKind, "pause");
    const nudges = engine.observeTool("s1", "bash");
    strictEqual(nudges.length, 1);
    ok(nudges[0].includes("wait node"));
    ok(nudges[0].includes("do not proceed until the user answers"));
  });

  it("should classify anchor as normal when no veto", () => {
    const engine = new TraversalNudgeEngine(makeConfig());
    engine.observeTool("s1", "bensyne_expandFileRelations", { file_id: "file_a" });
    strictEqual(engine.getState("s1").anchorKind, "normal");
  });

  it("should classify anchor as normal when veto is an empty array", () => {
    const engine = new TraversalNudgeEngine(makeConfig());
    engine.observeTool("s1", "bensyne_fetchFile", { file_id: "file_a", veto: [] });
    strictEqual(engine.getState("s1").anchorKind, "normal");
  });
});

describe("injector — traversal formatters (C4)", () => {
  it("formatTraversalNudge should produce a Traversal Check system-reminder block", () => {
    const result = formatTraversalNudge(
      "You are on decision-tree node {node}. Follow it.",
      "20-tdd"
    );
    ok(result.startsWith("<system-reminder>"));
    ok(result.endsWith("</system-reminder>"));
    ok(result.includes("Traversal Check:"));
    ok(result.includes("- You are on decision-tree node 20-tdd. Follow it."));
    ok(result.includes("This is a deterministic reminder - no model call was made."));
    ok(result.includes("Continue with your task."));
  });

  it("formatBacktrackNudge should produce a Backtrack Check block with path hints", () => {
    const result = formatBacktrackNudge("You keep re-anchoring on node {node}.", [
      "file_a",
      "file_b",
    ]);
    ok(result.startsWith("<system-reminder>"));
    ok(result.endsWith("</system-reminder>"));
    ok(result.includes("Backtrack Check:"));
    ok(result.includes("- You keep re-anchoring on node file_b."));
    ok(result.includes("- Recent anchors: file_a → file_b"));
    ok(result.includes("This is a deterministic reminder - no model call was made."));
  });

  it("formatBacktrackNudge should omit path line when path is empty", () => {
    const result = formatBacktrackNudge("Jump back to an ancestor.", []);
    ok(result.includes("Backtrack Check:"));
    ok(!result.includes("Recent anchors"));
  });
});

describe("TraversalNudgeEngine — zero LLM calls (AD-7/AD-11)", () => {
  it("should not import or reference ChatClient/createCompletion", () => {
    const source = readFileSync(new URL("./traversal.ts", import.meta.url), "utf8");
    ok(!source.includes("ChatClient"));
    ok(!source.includes("createCompletion"));
  });
});

describe("TraversalNudgeEngine — extended config surface (Task 1)", () => {
  it("should accept the new capability fields on TraversalConfig (type mirror) and stay inert when disabled", () => {
    const cfg: TraversalConfig = {
      enabled: false,
      toolPatterns: ["expandFileRelations"],
      nudgeAfter: 1,
      recurrentEvery: 1,
      maxRepeats: 3,
      historyDepth: 5,
      backtrackAfter: 3,
      wording: "w",
      stuckWording: "s",
      onUserMessage: "realign",
      bootstrapWording: "b",
      realignWording: "r",
      ladderWording: ["advisory", "explicit", "stern"],
      hardGate: { enabled: false, allowedTools: [], wording: "blocked" },
      supervisor: {
        enabled: false,
        model: "",
        maxCallsPerSession: 10,
        sampleEvery: 2,
        ladderWording: ["x", "y", "z"],
      },
    };
    const engine = new TraversalNudgeEngine(cfg);
    deepStrictEqual(engine.observeTool("s1", "bash"), []);
    strictEqual(engine.getState("s1").pending, false);
  });

  it("should flow the new defaults through makeConfig (engine sees the extended surface)", () => {
    const cfg = makeConfig();
    strictEqual(cfg.onUserMessage, "realign");
    strictEqual(cfg.hardGate.enabled, false);
    deepStrictEqual(cfg.hardGate.allowedTools, []);
    strictEqual(cfg.supervisor.enabled, false);
    strictEqual(cfg.supervisor.maxCallsPerSession, 10);
    strictEqual(cfg.supervisor.sampleEvery, 2);
    strictEqual(cfg.ladderWording.length, 3);
  });
});

describe("TraversalNudgeEngine — intensity ladder (Task 3, spec §5.2 / D4)", () => {
  const LADDER = [
    "LADDER-0 advisory on {node}",
    "LADDER-1 explicit on {node}",
    "LADDER-2 stern on {node}",
  ];

  function ladderEngine(overrides: Partial<typeof DEFAULT_CONFIG.categories.traversal> = {}) {
    return new TraversalNudgeEngine(
      makeConfig({
        nudgeAfter: 1,
        recurrentEvery: 1,
        maxRepeats: 99,
        ladderWording: LADDER,
        ...overrides,
      })
    );
  }

  it("should emit tier 0 for repeats 1-2, tier 1 for 3-5, tier 2 for 6+ (buildProgressNudge ladder)", () => {
    const engine = ladderEngine();
    engine.observeTool("s1", "bensyne_expandFileRelations", { file_id: "file_a" });
    const emitted: string[] = [];
    for (let i = 0; i < 8; i++) {
      const nudges = engine.observeTool("s1", "bash");
      strictEqual(nudges.length, 1, `nudge ${i + 1} should fire`);
      emitted.push(nudges[0]);
    }
    // Nudge i emits with state.repeats === i (repeat incremented before build).
    strictEqual(emitted[0], formatTraversalNudge(LADDER[0], "file_a"));
    strictEqual(emitted[1], formatTraversalNudge(LADDER[0], "file_a"));
    strictEqual(emitted[2], formatTraversalNudge(LADDER[1], "file_a"));
    strictEqual(emitted[3], formatTraversalNudge(LADDER[1], "file_a"));
    strictEqual(emitted[4], formatTraversalNudge(LADDER[1], "file_a"));
    strictEqual(emitted[5], formatTraversalNudge(LADDER[2], "file_a"));
    strictEqual(emitted[6], formatTraversalNudge(LADDER[2], "file_a"));
    strictEqual(emitted[7], formatTraversalNudge(LADDER[2], "file_a"));
  });

  it("should select tiers by exact repeats boundary: 3 → tier 1, 6 → tier 2", () => {
    const engine = ladderEngine();
    engine.observeTool("s1", "bensyne_expandFileRelations", { file_id: "file_a" });
    const expected = (repeatsAtBuild: number) => {
      if (repeatsAtBuild < 3) return LADDER[0];
      if (repeatsAtBuild < 6) return LADDER[1];
      return LADDER[2];
    };
    for (let repeats = 0; repeats <= 9; repeats++) {
      engine.getState("s1").repeats = repeats;
      const nudges = engine.observeTool("s1", "bash");
      strictEqual(nudges.length, 1);
      strictEqual(nudges[0], formatTraversalNudge(expected(repeats + 1), "file_a"));
    }
  });

  it("should fall back to the advisory wording for all tiers when ladderWording is empty", () => {
    const cfg = makeConfig({ nudgeAfter: 1, recurrentEvery: 1, maxRepeats: 99, ladderWording: [] });
    const engine = new TraversalNudgeEngine(cfg);
    engine.observeTool("s1", "bensyne_expandFileRelations", { file_id: "file_a" });
    for (let i = 0; i < 7; i++) {
      const nudges = engine.observeTool("s1", "bash");
      strictEqual(nudges.length, 1);
      strictEqual(nudges[0], formatTraversalNudge(cfg.wording, "file_a"));
    }
  });

  it("should fall back to the advisory wording when a ladder tier is missing (partial ladder)", () => {
    const cfg = makeConfig({
      nudgeAfter: 1,
      recurrentEvery: 1,
      maxRepeats: 99,
      ladderWording: ["only-tier0"],
    });
    const engine = new TraversalNudgeEngine(cfg);
    engine.observeTool("s1", "bensyne_expandFileRelations", { file_id: "file_a" });
    // Tier 0 uses the single ladder entry.
    let nudges = engine.observeTool("s1", "bash");
    strictEqual(nudges[0], formatTraversalNudge("only-tier0", "file_a"));
    // Tier 1 (repeat 3) and tier 2 (repeat 6) fall back to the default wording.
    for (const target of [3, 6]) {
      engine.getState("s1").repeats = target - 1;
      nudges = engine.observeTool("s1", "bash");
      strictEqual(nudges[0], formatTraversalNudge(cfg.wording, "file_a"));
    }
  });

  it("should keep the compliance clause in tier-0 wording (default ladder carries it)", () => {
    const engine = ladderEngine({ ladderWording: DEFAULT_CONFIG.categories.traversal.ladderWording });
    engine.observeTool("s1", "bensyne_expandFileRelations", { file_id: "file_a" });
    const nudges = engine.observeTool("s1", "bash");
    ok(nudges[0].includes("current node"));
    ok(nudges[0].includes("target, veto, and conditions"));
  });

  it("should keep pause-node wording regardless of ladder tier (regression)", () => {
    const engine = ladderEngine();
    engine.observeTool("s1", "bensyne_fetchFile", {
      file_id: "file_pause",
      veto: ["Do not proceed until direction given"],
    });
    engine.getState("s1").repeats = 2; // next nudge builds at repeat 3 (tier 1)
    const nudges = engine.observeTool("s1", "bash");
    strictEqual(nudges.length, 1);
    ok(nudges[0].includes("wait node"));
    ok(nudges[0].includes("do not proceed until the user answers"));
    ok(!nudges[0].includes("LADDER-1"));
  });
});

describe("TraversalNudgeEngine — unlimited cadence (Task 3, maxRepeats: Infinity)", () => {
  it("should keep nudging without a cap when maxRepeats is Infinity", () => {
    const engine = new TraversalNudgeEngine(
      makeConfig({ nudgeAfter: 1, recurrentEvery: 1, maxRepeats: Infinity, ladderWording: ["a", "b", "c"] })
    );
    engine.observeTool("s1", "bensyne_expandFileRelations", { file_id: "file_a" });
    const nudges: string[] = [];
    for (let i = 0; i < 30; i++) {
      nudges.push(...engine.observeTool("s1", "bash"));
    }
    ok(nudges.length >= 10, `expected many nudges without a cap, got ${nudges.length}`);
    for (const nudge of nudges) {
      ok(typeof nudge === "string" && nudge.length > 0);
      ok(nudge.includes("Traversal Check"));
    }
    strictEqual(engine.getState("s1").repeats, nudges.length);
  });

  it("should respect the default bounded maxRepeats (cap still applies, regression)", () => {
    const engine = new TraversalNudgeEngine(makeConfig({ nudgeAfter: 1, recurrentEvery: 1, maxRepeats: 3 }));
    engine.observeTool("s1", "bensyne_expandFileRelations", { file_id: "file_a" });
    const nudges: string[] = [];
    for (let i = 0; i < 10; i++) {
      nudges.push(...engine.observeTool("s1", "bash"));
    }
    strictEqual(nudges.length, 3);
    strictEqual(engine.getState("s1").repeats, 3);
  });

  it("should accept maxRepeats: Infinity at the type level (widened TraversalConfig)", () => {
    const cfg: TraversalConfig = makeConfig({ maxRepeats: Infinity });
    strictEqual(cfg.maxRepeats, Infinity);
  });
});

describe("TraversalNudgeEngine — realign vs reset (Task 4, spec §4 / D3)", () => {
  it("realign() keeps anchorNode/anchorKind/path and zeroes cadence counters, setting realignPending", () => {
    const engine = new TraversalNudgeEngine(
      makeConfig({ nudgeAfter: 1, recurrentEvery: 1, maxRepeats: 10 })
    );
    engine.observeTool("s1", "bensyne_expandFileRelations", { file_id: "file_a" });
    engine.observeTool("s1", "bensyne_expandFileRelations", { file_id: "file_b" });
    engine.observeTool("s1", "bensyne_expandFileRelations", { file_id: "file_b" }); // cycle 1
    engine.observeTool("s1", "bash"); // repeats=1, nonTraversalCalls=1

    engine.realign("s1");

    const state = engine.getState("s1");
    strictEqual(state.realignPending, true);
    strictEqual(state.anchorNode, "file_b");
    strictEqual(state.anchorKind, "normal");
    deepStrictEqual(state.path, ["file_a", "file_b"]);
    strictEqual(state.nonTraversalCalls, 0);
    strictEqual(state.repeats, 0);
    strictEqual(state.cycleCount, 0);
  });

  it("reset() still wipes anchor/path/pending/realignPending for the escape-hatch branch", () => {
    const engine = new TraversalNudgeEngine(makeConfig());
    engine.observeTool("s1", "bensyne_expandFileRelations", { file_id: "file_a" });
    engine.realign("s1");

    engine.reset("s1");

    const state = engine.getState("s1");
    strictEqual(state.pending, false);
    strictEqual(state.anchorNode, undefined);
    strictEqual(state.anchorKind, undefined);
    deepStrictEqual(state.path, []);
    strictEqual(state.realignPending, false);
    strictEqual(state.nonTraversalCalls, 0);
    strictEqual(state.repeats, 0);
    strictEqual(state.cycleCount, 0);
  });

  it("next traversal call after realign clears realignPending (advancement)", () => {
    const engine = new TraversalNudgeEngine(makeConfig());
    engine.observeTool("s1", "bensyne_expandFileRelations", { file_id: "file_a" });
    engine.realign("s1");
    strictEqual(engine.getState("s1").realignPending, true);

    engine.observeTool("s1", "bensyne_expandFileRelations", { file_id: "file_b" });

    strictEqual(engine.getState("s1").realignPending, false);
  });

  it("next traversal call after realign clears realignPending (same-node re-anchor)", () => {
    const engine = new TraversalNudgeEngine(makeConfig());
    engine.observeTool("s1", "bensyne_expandFileRelations", { file_id: "file_a" });
    engine.realign("s1");

    engine.observeTool("s1", "bensyne_expandFileRelations", { file_id: "file_a" });

    strictEqual(engine.getState("s1").realignPending, false);
  });

  it("first non-traversal call after realign emits an immediate realign nudge (before nudgeAfter) with {node} interpolated; following calls use normal cadence", () => {
    const realignWording = "REALIGN-WORDING for node {node}";
    const engine = new TraversalNudgeEngine(
      makeConfig({ nudgeAfter: 5, recurrentEvery: 2, maxRepeats: 20, realignWording })
    );
    engine.observeTool("s1", "bensyne_expandFileRelations", { file_id: "file_a" });
    engine.realign("s1");

    // First non-traversal call — immediate realign nudge although calls(1) < nudgeAfter(5).
    const n1 = engine.observeTool("s1", "bash");
    strictEqual(n1.length, 1);
    strictEqual(n1[0], formatRealignNudge(realignWording, "file_a"));
    ok(n1[0].includes("Realign Check"));
    strictEqual(engine.getState("s1").realignPending, false); // nudge consumed the flag

    // Following calls fall back to the normal cadence: empty until nudgeAfter.
    deepStrictEqual(engine.observeTool("s1", "bash"), []); // 2
    deepStrictEqual(engine.observeTool("s1", "bash"), []); // 3
    deepStrictEqual(engine.observeTool("s1", "bash"), []); // 4
    const n5 = engine.observeTool("s1", "bash"); // 5 -> cadence fires (ladder, not realign)
    strictEqual(n5.length, 1);
    ok(n5[0].includes("Traversal Check"));
    ok(!n5[0].includes("Realign Check"));
  });

  it("realign nudge never fires without an anchor (fresh session)", () => {
    const engine = new TraversalNudgeEngine(makeConfig({ nudgeAfter: 1 }));
    engine.realign("s1");
    deepStrictEqual(engine.observeTool("s1", "bash"), []);
  });

  it("hasAnchor() is false for a fresh session and true after any anchor", () => {
    const engine = new TraversalNudgeEngine(makeConfig());
    strictEqual(engine.hasAnchor("fresh"), false);
    engine.observeTool("s1", "bensyne_expandFileRelations", { file_id: "file_a" });
    strictEqual(engine.hasAnchor("s1"), true);
    strictEqual(engine.hasAnchor("other"), false);
  });

  it("hasAnchor() stays true after realign (anchor preserved), false after reset", () => {
    const engine = new TraversalNudgeEngine(makeConfig());
    engine.observeTool("s1", "bensyne_expandFileRelations", { file_id: "file_a" });
    engine.realign("s1");
    strictEqual(engine.hasAnchor("s1"), true);
    engine.reset("s1");
    strictEqual(engine.hasAnchor("s1"), false);
  });
});

describe("Task 4 — ADR-0011 realign-on-user-message + AD-08 note path (docs)", () => {
  it("ADR-0011 exists in .vault/adrs/, parses as ADR-0011, and records the reset→realign change + escape hatch", () => {
    const adr = readFileSync(
      new URL("../.vault/adrs/0011-realign-on-user-message.adr.md", import.meta.url),
      "utf8"
    );
    ok(adr.includes("id: ADR-0011"));
    ok(adr.includes("realign"));
    ok(adr.includes("reset"));
  });

  it("ADR-0008 is left untouched (no supersession block) — the AD-08 change note lives in the session DECISIONS D3 (exactly-one path, step 9)", () => {
    const adr8 = readFileSync(
      new URL("../.vault/adrs/0008-restore-system-transform-init.adr.md", import.meta.url),
      "utf8"
    );
    ok(!adr8.includes("Change note (ADR-0011)"));
  });
});

describe("TraversalNudgeEngine — hard gate blockIfNeeded (Task 5, spec §6 / D6)", () => {
  const GATE_WORDING = "BLOCKED — realign with the decision tree now.";

  /** Engine with the hard gate switched on; `hardGate` in overrides replaces the whole object. */
  function gateEngine(
    overrides: Partial<typeof DEFAULT_CONFIG.categories.traversal> = {}
  ): TraversalNudgeEngine {
    return new TraversalNudgeEngine(
      makeConfig({
        hardGate: { enabled: true, wording: GATE_WORDING },
        ...overrides,
      })
    );
  }

  /** Anchor a session and open the realignment window (anchored + realignPending). */
  function anchoredPending(engine: TraversalNudgeEngine, sessionId = "s1"): void {
    engine.observeTool(sessionId, "bensyne_expandFileRelations", { file_id: "file_a" });
    engine.realign(sessionId);
  }

  it("should return null when the session is not anchored (never blocks outside the realignment window)", () => {
    const engine = gateEngine();
    strictEqual(engine.blockIfNeeded("fresh", "read", { path: "/tmp/a" }), null);
    strictEqual(engine.blockIfNeeded("fresh", "bash", { command: "ls" }), null);

    // Reset wipes the anchor — also un-anchored.
    anchoredPending(engine, "s1");
    strictEqual(engine.hasAnchor("s1"), true);
    engine.reset("s1");
    strictEqual(engine.hasAnchor("s1"), false);
    strictEqual(engine.blockIfNeeded("s1", "read"), null);
  });

  it("should return null when anchored but realignPending is false", () => {
    const engine = gateEngine();
    engine.observeTool("s1", "bensyne_expandFileRelations", { file_id: "file_a" });
    strictEqual(engine.blockIfNeeded("s1", "read"), null);

    // After a traversal re-affirmation the flag is consumed — window closed.
    anchoredPending(engine, "s2");
    engine.observeTool("s2", "bensyne_expandFileRelations", { file_id: "file_a" });
    strictEqual(engine.getState("s2").realignPending, false);
    strictEqual(engine.blockIfNeeded("s2", "read"), null);
  });

  it("should allow all traversal tools during a pending realignment", () => {
    const engine = gateEngine();
    anchoredPending(engine);
    const sessionId = "s1";
    for (const tool of ["getPersonaEntryNode", "expandFileRelations", "fetchFile", "getPersonaStatus"]) {
      strictEqual(engine.blockIfNeeded(sessionId, `bensyne_${tool}`, {}), null, `direct ${tool}`);
      strictEqual(engine.blockIfNeeded(sessionId, `bensyne_bensyne-${tool}`, {}), null, `LiteLLM ${tool}`);
    }
  });

  it("should allow meta_use-wrapped traversal tools during a pending realignment", () => {
    const engine = gateEngine();
    anchoredPending(engine);
    strictEqual(
      engine.blockIfNeeded("s1", "meta_use", {
        name: "bensyne_getPersonaEntryNode",
        args: { memory_bank: "agent-persona_worker" },
      }),
      null
    );
    strictEqual(
      engine.blockIfNeeded("s1", "meta_use", {
        name: "bensyne_expandFileRelations",
        args: { file_id: "file_a" },
      }),
      null
    );
  });

  it("should allow tools listed in hardGate.allowedTools during a pending realignment", () => {
    const engine = gateEngine({
      hardGate: { enabled: true, allowedTools: ["read", "bash"], wording: GATE_WORDING },
    });
    anchoredPending(engine);
    strictEqual(engine.blockIfNeeded("s1", "read", { path: "/tmp/a" }), null);
    strictEqual(engine.blockIfNeeded("s1", "bash", { command: "ls" }), null);
    // A tool outside the allow-list is still blocked.
    strictEqual(engine.blockIfNeeded("s1", "write", { path: "/tmp/b" }), formatHardGateMessage(GATE_WORDING));
  });

  it("should fall back to toolPatterns as the effective allow-list when allowedTools is not provided (undefined)", () => {
    const engine = gateEngine(); // hardGate = { enabled: true, wording } — allowedTools undefined
    anchoredPending(engine);
    // Traversal tools are in toolPatterns by default → allowed.
    strictEqual(engine.blockIfNeeded("s1", "bensyne_getPersonaStatus", {}), null);
    strictEqual(engine.blockIfNeeded("s1", "bensyne_expandFileRelations", { file_id: "file_a" }), null);
    // Non-traversal tool → blocked.
    strictEqual(engine.blockIfNeeded("s1", "read"), formatHardGateMessage(GATE_WORDING));
  });

  it("should fall back to toolPatterns as the effective allow-list when allowedTools is an empty array", () => {
    const engine = gateEngine({
      hardGate: { enabled: true, allowedTools: [], wording: GATE_WORDING },
    });
    anchoredPending(engine);
    strictEqual(engine.blockIfNeeded("s1", "bensyne_fetchFile", { file_id: "file_a" }), null);
    strictEqual(engine.blockIfNeeded("s1", "bash"), formatHardGateMessage(GATE_WORDING));
  });

  it("should return the hard-gate message (formatHardGateMessage output) for any other tool", () => {
    const engine = gateEngine();
    anchoredPending(engine);
    const msg = engine.blockIfNeeded("s1", "read", { path: "/tmp/a" });
    strictEqual(msg, formatHardGateMessage(GATE_WORDING));
    ok(msg?.includes("Hard Gate"));
    ok(msg?.includes(GATE_WORDING));

    const msg2 = engine.blockIfNeeded("s1", "bash", { command: "ls" });
    strictEqual(msg2, formatHardGateMessage(GATE_WORDING));
  });

  it("should never block when hardGate.enabled is false (even anchored + realignPending)", () => {
    const engine = new TraversalNudgeEngine(makeConfig()); // default hardGate.enabled = false
    anchoredPending(engine);
    strictEqual(engine.getState("s1").realignPending, true);
    strictEqual(engine.blockIfNeeded("s1", "read", { path: "/tmp/a" }), null);
    strictEqual(engine.blockIfNeeded("s1", "bash"), null);
  });

  it("should never block when the whole traversal feature is disabled (enabled=false)", () => {
    const engine = new TraversalNudgeEngine(
      makeConfig({
        enabled: false,
        hardGate: { enabled: true, wording: GATE_WORDING },
      })
    );
    engine.observeTool("s1", "bensyne_expandFileRelations", { file_id: "file_a" });
    engine.realign("s1");
    strictEqual(engine.blockIfNeeded("s1", "read"), null);
    strictEqual(engine.blockIfNeeded("s1", "bash"), null);
  });

  it("should expose the effective allow-list as toolPatterns ∪ allowedTools (observable resolution)", () => {
    const engine = gateEngine({
      hardGate: { enabled: true, allowedTools: ["read", "bash"], wording: GATE_WORDING },
    });
    const effective = engine.hardGateAllowedTools;
    strictEqual(effective.includes("read"), true);
    strictEqual(effective.includes("bash"), true);
    for (const p of DEFAULT_CONFIG.categories.traversal.toolPatterns) {
      strictEqual(effective.includes(p), true, `toolPatterns entry ${p} present`);
    }

    // Without allowedTools the effective allow-list is exactly toolPatterns.
    const fallback = gateEngine().hardGateAllowedTools;
    deepStrictEqual(fallback, DEFAULT_CONFIG.categories.traversal.toolPatterns);
  });
});

describe("Task 5 — ADR-0013 hard gate (docs)", () => {
  it("ADR-0013 exists in .vault/adrs/, parses as ADR-0013, and documents the ADR-0009 tension", () => {
    const adr = readFileSync(
      new URL("../.vault/adrs/0013-hard-gate.adr.md", import.meta.url),
      "utf8"
    );
    ok(adr.includes("id: ADR-0013"));
    ok(adr.includes("hard gate") || adr.includes("hard-gate") || adr.includes("Hard Gate"));
    ok(adr.includes("ADR-0009"));
  });
});
