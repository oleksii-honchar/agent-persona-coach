import { describe, it } from "node:test";
import { ok, strictEqual } from "node:assert/strict";
import { formatNudge, injectNudge } from "./injector.js";

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

describe("injectNudge", () => {
  it("should append nudge when no existing system-reminder block", () => {
    const systemPrompt = "You are a helpful assistant.\nBe concise.";
    const nudge = formatNudge("identity", ["Who am I?"]);
    const result = injectNudge(systemPrompt, nudge);

    ok(result.startsWith(systemPrompt));
    ok(result.includes(nudge));
    strictEqual(result.split("<system-reminder>").length, 2); // exactly one new block
  });

  it("should insert before existing system-reminder block", () => {
    const existingNudge = formatNudge("rules", ["Am I following rules?"]);
    const systemPrompt = `You are a helpful assistant.\n${existingNudge}\nMore instructions.`;
    const newNudge = formatNudge("identity", ["Who am I?"]);

    const result = injectNudge(systemPrompt, newNudge);

    // The new nudge should appear before the closing </system-reminder> of the existing one
    const newIndex = result.indexOf(newNudge);
    const existingCloseIndex = result.lastIndexOf("</system-reminder>");

    ok(newIndex < existingCloseIndex, "New nudge should be inserted before the existing closing tag");
    ok(result.includes(existingNudge));
    ok(result.includes(newNudge));
  });

  it("should insert before the LAST closing system-reminder tag when multiple exist", () => {
    const firstNudge = formatNudge("rules", ["Follow rules?"]);
    const secondNudge = formatNudge("identity", ["Who am I?"]);
    const systemPrompt = `Start.\n<system-reminder>First block</system-reminder>\n${firstNudge}\nEnd.`;

    const result = injectNudge(systemPrompt, secondNudge);

    // The second nudge should be inserted before the LAST </system-reminder>
    const allCloses = [...result.matchAll(/<\/system-reminder>/g)];
    const lastCloseIndex = result.lastIndexOf("</system-reminder>");
    const secondNudgeIndex = result.indexOf(secondNudge);

    // Last closing tag should have at least 2 occurrences (original first block + the rules nudge close)
    ok(allCloses.length >= 2);
    ok(secondNudgeIndex < lastCloseIndex);
  });

  it("should preserve original system prompt content", () => {
    const systemPrompt = "Original instructions here.";
    const nudge = formatNudge("identity", ["Who am I?"]);
    const result = injectNudge(systemPrompt, nudge);

    ok(result.startsWith("Original instructions here."));
  });

  it("should handle empty system prompt", () => {
    const systemPrompt = "";
    const nudge = formatNudge("identity", ["Who am I?"]);
    const result = injectNudge(systemPrompt, nudge);

    ok(result.startsWith("\n"));
    ok(result.includes(nudge));
  });

  it("should handle empty nudge", () => {
    const systemPrompt = "Some instructions.";
    const result = injectNudge(systemPrompt, "");

    ok(result.includes("Some instructions."));
  });
});
