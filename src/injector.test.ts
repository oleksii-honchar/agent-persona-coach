import { describe, it } from "node:test";
import { ok } from "node:assert/strict";
import {
  formatNudge,
  formatBootstrapNudge,
  formatRealignNudge,
  formatHardGateMessage,
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
});

