import { describe, it } from "node:test";
import { strictEqual } from "node:assert/strict";
import { extractPersona, DEFAULT_CONFIG } from "./types.js";

describe("extractPersona", () => {
  it("should extract persona from V1 agent with 'prompt' field", () => {
    const agentInfo = { prompt: "You are a helpful assistant. Always be concise." };
    const result = extractPersona(agentInfo);
    strictEqual(result, "You are a helpful assistant. Always be concise.");
  });

  it("should extract persona from V2 agent with 'system' field", () => {
    const agentInfo = { system: "You are a code reviewer. Check for bugs and style." };
    const result = extractPersona(agentInfo);
    strictEqual(result, "You are a code reviewer. Check for bugs and style.");
  });

  it("should prefer 'prompt' over 'system' when both fields are present", () => {
    const agentInfo = {
      prompt: "V1 persona text",
      system: "V2 persona text",
    };
    const result = extractPersona(agentInfo);
    strictEqual(result, "V1 persona text");
  });

  it("should return empty string when neither 'prompt' nor 'system' is present", () => {
    const agentInfo = { name: "test-agent", someOtherField: "value" };
    const result = extractPersona(agentInfo);
    strictEqual(result, "");
  });

  it("should return empty string for empty object", () => {
    const agentInfo: Record<string, unknown> = {};
    const result = extractPersona(agentInfo);
    strictEqual(result, "");
  });

  it("should return empty string for null/undefined fields but present object", () => {
    // ?? coalesces null/undefined to the right side
    const agentInfo = { prompt: null, system: undefined };
    // prompt is null, so ?? falls through to system (undefined), which falls through to ""
    const result = extractPersona(agentInfo);
    strictEqual(result, "");
  });

  it("should handle empty string prompt as empty string (not fall through to system)", () => {
    // "" is not nullish, so ?? short-circuits on ""
    const agentInfo = { prompt: "", system: "V2 persona text" };
    const result = extractPersona(agentInfo);
    strictEqual(result, "");
  });
});

describe("DEFAULT_CONFIG", () => {
  it("should have identity enabled with cadence 10", () => {
    strictEqual(DEFAULT_CONFIG.categories.identity.enabled, true);
    strictEqual(DEFAULT_CONFIG.categories.identity.cadence, 10);
  });

  it("should have rules enabled with cadence 10 and criticalPermissions", () => {
    strictEqual(DEFAULT_CONFIG.categories.rules.enabled, true);
    strictEqual(DEFAULT_CONFIG.categories.rules.cadence, 10);
    strictEqual(DEFAULT_CONFIG.categories.rules.criticalPermissions.includes("write"), true);
    strictEqual(DEFAULT_CONFIG.categories.rules.criticalPermissions.includes("bash"), true);
    strictEqual(DEFAULT_CONFIG.categories.rules.criticalPermissions.includes("task"), true);
    strictEqual(DEFAULT_CONFIG.categories.rules.criticalPermissions.includes("create"), true);
  });

  it("should have references enabled with cadence 30", () => {
    strictEqual(DEFAULT_CONFIG.categories.references.enabled, true);
    strictEqual(DEFAULT_CONFIG.categories.references.cadence, 30);
  });

  it("should have progress enabled with cadence 20", () => {
    strictEqual(DEFAULT_CONFIG.categories.progress.enabled, true);
    strictEqual(DEFAULT_CONFIG.categories.progress.cadence, 20);
  });
});
