import { describe, it } from "node:test";
import { ok, strictEqual } from "node:assert/strict";
import { COACH_PROMPT, buildCoachPrompt } from "./prompt.js";

describe("buildCoachPrompt", () => {
  it("should contain the persona text in the output", () => {
    const personaText = "You are a senior architect. Always review before committing.";
    const result = buildCoachPrompt(personaText);
    ok(result.includes(personaText));
  });

  it("should wrap persona text in <agent-persona> tags", () => {
    const personaText = "Be helpful and concise.";
    const result = buildCoachPrompt(personaText);
    ok(result.includes("<agent-persona>"));
    ok(result.includes("</agent-persona>"));
    ok(result.includes(personaText));
  });

  it("should trim whitespace from persona text", () => {
    const personaText = "  \n  You are a coder.  \n  ";
    const result = buildCoachPrompt(personaText);
    ok(result.includes("You are a coder."));
    ok(!result.includes("  \n  You are a coder.  \n  "));
  });

  it("should contain output JSON structure with all 4 categories", () => {
    const result = buildCoachPrompt("test persona");
    ok(result.includes('"identity"'), "should contain identity key");
    ok(result.includes('"rules"'), "should contain rules key");
    ok(result.includes('"references"'), "should contain references key");
    ok(result.includes('"progress"'), "should contain progress key");
  });

  it("should contain the 4 category descriptions", () => {
    const result = buildCoachPrompt("test persona");
    ok(result.includes("IDENTITY CHECK"));
    ok(result.includes("RULE COMPLIANCE"));
    ok(result.includes("REFERENCE CHECK"));
    ok(result.includes("PROGRESS CHECK"));
  });

  it("should not be vulnerable to template injection via {personaText} in input", () => {
    // If persona text contains {personaText}, String.replace with a string
    // only replaces the first occurrence — the placeholder in the template,
    // NOT the one in the persona text. This is safe by design.
    const maliciousText = "Injected {personaText} with fake template";
    const result = buildCoachPrompt(maliciousText);

    // The malicious {personaText} should appear literally in the output
    ok(result.includes(maliciousText));

    // The original template placeholder should still be replaced
    // (i.e., {personaText} appears exactly once — the one from persona text, not the template)
    const matches = [...result.matchAll(/\{personaText\}/g)];
    strictEqual(matches.length, 1, "Should have exactly one {personaText} occurrence (from persona text itself)");
  });

  it("should preserve special characters in persona text", () => {
    const personaText = "Use <tags> & \"quotes\" — em-dash and ${template} literals.";
    const result = buildCoachPrompt(personaText);
    ok(result.includes(personaText));
  });

  it("should preserve multi-line persona text", () => {
    const personaText = "Line 1: Be helpful.\nLine 2: Stay concise.\nLine 3: Never guess.";
    const result = buildCoachPrompt(personaText);
    ok(result.includes(personaText));
  });
});

describe("COACH_PROMPT", () => {
  it("should contain the concise-and-focused instruction", () => {
    ok(
      COACH_PROMPT.includes("Keep questions concise and focused"),
      "COACH_PROMPT must contain the concise-and-focused instruction",
    );
  });

  it("should NOT contain the 80-character limit instruction", () => {
    ok(
      !COACH_PROMPT.includes("Keep each question under 80 characters"),
      "COACH_PROMPT must NOT contain the old 80-character instruction",
    );
  });
});
