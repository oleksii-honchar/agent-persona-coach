import { describe, it } from "node:test";
import { strictEqual, deepStrictEqual, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TraversalNudgeEngine } from "./traversal.js";
import { formatTraversalNudge, formatBacktrackNudge } from "./injector.js";
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