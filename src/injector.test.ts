import { describe, it } from "node:test";
import { ok } from "node:assert/strict";
import {
  formatNudge,
  formatBootstrapNudge,
  formatRealignNudge,
  formatHardGateMessage,
  formatDynamicHardGateMessage,
} from "./injector.js";

describe("formatNudge", () => {
  it("should format identity nudge with correct category name", () => {
    const questions = ["Who am I in this context?", "Am I staying in my lane?"];
    const result = formatNudge("identity", questions);
    ok(result.includes("<system-reminder>"));
    ok(result.includes("</system-reminder>"));
    ok(result.includes("Identity Check"));
    ok(result.includes("- Who am I in this context?"));
    ok(result.includes("- Am I staying in my lane?"));
    ok(result.includes("Please reflect on these questions and adjust your behavior accordingly."));
    ok(result.includes("Continue with your task."));
  });

  it("should format rules nudge with correct category name", () => {
    const questions = ["Am I following the rules?"];
    const result = formatNudge("rules", ["Am I following the rules?"]);
    ok(result.includes("Rule Compliance"));
    ok(result.includes("- Am I following the rules?"));
  });

  it("should format references nudge with correct category name", () => {
    const result = formatNudge("references", ["Did I read the docs?"]);
    ok(result.includes("Reference Check"));
    ok(result.includes("- Did I read the docs?"));
  });

  it("should format progress nudge with correct category name", () => {
    const result = formatNudge("progress", ["Am I on track?"]);
    ok(result.includes("Progress Check"));
    ok(result.includes("- Am I on track?"));
  });

  it("should use raw category ID for unknown category name", () => {
    const result = formatNudge("unknown-category", ["Some question?"]);
    ok(result.includes("unknown-category"));
    ok(!result.includes("Unknown"));
  });

  it("should handle empty questions array", () => {
    const result = formatNudge("identity", []);
    ok(result.includes("<system-reminder>"));
    ok(result.includes("Identity Check"));
    // No bullet points for empty array
  });

  it("should handle single question", () => {
    const result = formatNudge("identity", ["Single question?"]);
    ok(result.includes("- Single question?"));
    // Should not have extra newlines from join
  });
});

describe("formatBootstrapNudge", () => {
  it("should wrap the bootstrap wording in a <system-reminder> block", () => {
    const result = formatBootstrapNudge("Enter your decision tree before your next tool.");
    ok(result.startsWith("<system-reminder>"));
    ok(result.endsWith("</system-reminder>"));
    ok(result.includes("Enter your decision tree before your next tool."));
  });
});

describe("formatRealignNudge", () => {
  it("should wrap the realign wording in a <system-reminder> block", () => {
    const result = formatRealignNudge("Re-evaluate whether node {node} still matches.", "10-realign");
    ok(result.startsWith("<system-reminder>"));
    ok(result.endsWith("</system-reminder>"));
    ok(result.includes("Re-evaluate whether node"));
  });

  it("should interpolate the {node} placeholder with the node label", () => {
    const result = formatRealignNudge("Current node is {node}. Report its status.", "10-understand");
    ok(result.includes("Current node is 10-understand."));
    ok(!result.includes("{node}"));
  });
});

describe("formatHardGateMessage", () => {
  it("should wrap the blocking message in a <system-reminder> block", () => {
    const result = formatHardGateMessage("BLOCKED — realign with the decision tree now.");
    ok(result.startsWith("<system-reminder>"));
    ok(result.endsWith("</system-reminder>"));
    ok(result.includes("BLOCKED — realign with the decision tree now."));
  });

  it("should interpolate the {node} placeholder with the node label when provided", () => {
    const result = formatHardGateMessage("BLOCKED — resume from {node}.", "file_a");
    ok(result.includes("resume from file_a."));
    ok(!result.includes("{node}"));
  });

  it("should leave the wording byte-identical when no node is provided (backward compatible)", () => {
    // No node arg → the {node} literal must be preserved exactly as the
    // pre-change behavior always produced (no templating happens).
    const result = formatHardGateMessage("BLOCKED — resume from {node}.");
    ok(result.startsWith("<system-reminder>"));
    ok(result.endsWith("</system-reminder>"));
    ok(result.includes("BLOCKED — resume from {node}."));
  });
});

describe("formatDynamicHardGateMessage", () => {
  const configWithBoth = {
    wording: "legacy default wording",
    wordingWithNode: "BLOCKED — resume from your current decision node: {node}.",
    wordingNoNode: "BLOCKED — you have no current node, re-enter via getPersonaEntryNode.",
  };

  it("should return wordingNoNode when node is undefined", () => {
    const result = formatDynamicHardGateMessage(undefined, configWithBoth);
    ok(result.includes("you have no current node, re-enter via getPersonaEntryNode."));
    ok(!result.includes("resume from your current decision node"));
    ok(!result.includes("{node}"));
  });

  it("should return wordingWithNode with {node} replaced when node is a valid file_id", () => {
    const result = formatDynamicHardGateMessage("file_abc123", configWithBoth);
    ok(result.includes("resume from your current decision node: file_abc123."));
    ok(!result.includes("{node}"));
    ok(!result.includes("you have no current node"));
  });

  it("should return wordingWithNode with {node} replaced when node is a valid node_id", () => {
    const result = formatDynamicHardGateMessage("node_xyz", configWithBoth);
    ok(result.includes("resume from your current decision node: node_xyz."));
    ok(!result.includes("{node}"));
  });

  it("should fallback to legacy wording when wordingWithNode is not set", () => {
    const configLegacyFallback = {
      wording: "BLOCKED — resume from {node}.",
      wordingNoNode: "BLOCKED — re-enter via getPersonaEntryNode.",
    };
    const result = formatDynamicHardGateMessage("file_a", configLegacyFallback);
    ok(result.includes("resume from file_a."));
    ok(!result.includes("{node}"));
  });

  it("should fallback to legacy wording when wordingNoNode is not set", () => {
    const configLegacyFallback = {
      wording: "BLOCKED — resume from {node}.",
      wordingWithNode: "BLOCKED — resume from your current decision node: {node}.",
    };
    const result = formatDynamicHardGateMessage(undefined, configLegacyFallback);
    ok(result.includes("BLOCKED — resume from {node}."));
    ok(!result.includes("your current decision node"));
  });

  it("should use legacy wording for both cases when neither new field is set (full backward compat)", () => {
    const configLegacyOnly = {
      wording: "BLOCKED — resume from {node}.",
    };
    const resultWithNode = formatDynamicHardGateMessage("file_a", configLegacyOnly);
    ok(resultWithNode.includes("resume from file_a."));
    ok(!resultWithNode.includes("{node}"));

    const resultNoNode = formatDynamicHardGateMessage(undefined, configLegacyOnly);
    ok(resultNoNode.includes("BLOCKED — resume from {node}."));
  });

  it("should treat tool names as not-a-node and return wordingNoNode", () => {
    const result = formatDynamicHardGateMessage("bensyne_getPersonaEntryNode", configWithBoth);
    ok(result.includes("you have no current node, re-enter via getPersonaEntryNode."));
    ok(!result.includes("bensyne_getPersonaEntryNode"));
    ok(!result.includes("{node}"));
  });

  it("should treat traversal tool names as not-a-node (multiple examples)", () => {
    const toolNames = [
      "expandFileRelations",
      "fetchFile",
      "getPersonaEntryNode",
      "recallMemory",
      "bensyne_expandFileRelations",
    ];
    for (const toolName of toolNames) {
      const result = formatDynamicHardGateMessage(toolName, configWithBoth);
      ok(result.includes("you have no current node"), `Expected wordingNoNode for tool name: ${toolName}`);
    }
  });

  it("should wrap the message in a <system-reminder> block", () => {
    const result = formatDynamicHardGateMessage(undefined, configWithBoth);
    ok(result.startsWith("<system-reminder>"));
    ok(result.endsWith("</system-reminder>"));
    ok(result.includes("Hard Gate:"));
  });
});

