import { describe, it } from "node:test";
import { strictEqual, deepStrictEqual, notStrictEqual } from "node:assert/strict";
import { extractPersona, extractPersonaFromSystem, DEFAULT_CONFIG, deepMerge, DeepPartial } from "./types.js";

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
  it("should have identity enabled with cadence 10 and afterEachUserMessage true", () => {
    strictEqual(DEFAULT_CONFIG.categories.identity.enabled, true);
    strictEqual(DEFAULT_CONFIG.categories.identity.cadence, 10);
    strictEqual(DEFAULT_CONFIG.categories.identity.afterEachUserMessage, true);
  });

  it("should have rules enabled with cadence 10 and criticalPermissions set", () => {
    strictEqual(DEFAULT_CONFIG.categories.rules.enabled, true);
    strictEqual(DEFAULT_CONFIG.categories.rules.cadence, 10);
    deepStrictEqual(DEFAULT_CONFIG.categories.rules.criticalPermissions, ["bash", "edit", "task"]);
  });

  it("should have references enabled with cadence 30", () => {
    strictEqual(DEFAULT_CONFIG.categories.references.enabled, true);
    strictEqual(DEFAULT_CONFIG.categories.references.cadence, 30);
  });

  it("should have progress enabled with cadence 20", () => {
    strictEqual(DEFAULT_CONFIG.categories.progress.enabled, true);
    strictEqual(DEFAULT_CONFIG.categories.progress.cadence, 20);
  });

  it("should have coachPrompt as a non-empty string with key phrases", () => {
    strictEqual(typeof DEFAULT_CONFIG.coachPrompt, "string");
    notStrictEqual(DEFAULT_CONFIG.coachPrompt, "");
    strictEqual(DEFAULT_CONFIG.coachPrompt.includes("IDENTITY CHECK"), true);
    strictEqual(DEFAULT_CONFIG.coachPrompt.includes("{personaText}"), true);
  });
});

describe("deepMerge", () => {
  it("should merge partial nested objects (only change one category field, others preserved)", () => {
    const target = {
      enabled: true,
      categories: {
        identity: { enabled: true, cadence: 10, afterEachUserMessage: true },
        rules: { enabled: true, cadence: 10, criticalPermissions: ["bash", "edit", "task"], criticalTools: [] },
        references: { enabled: true, cadence: 30 },
        progress: { enabled: true, cadence: 20 },
      },
      coachPrompt: "default prompt",
    };
    const source: DeepPartial<typeof target> = {
      categories: {
        identity: { enabled: false },
      },
    };
    const result = deepMerge(target, source);
    // identity.enabled changed
    strictEqual(result.categories.identity.enabled, false);
    // identity.cadence preserved
    strictEqual(result.categories.identity.cadence, 10);
    // identity.afterEachUserMessage preserved
    strictEqual(result.categories.identity.afterEachUserMessage, true);
    // rules untouched
    strictEqual(result.categories.rules.enabled, true);
    strictEqual(result.categories.rules.cadence, 10);
    // references untouched
    strictEqual(result.categories.references.enabled, true);
    // progress untouched
    strictEqual(result.categories.progress.enabled, true);
    // top-level fields preserved
    strictEqual(result.enabled, true);
  });

  it("should replace arrays (not merge them)", () => {
    const target = { items: ["a", "b", "c"], name: "test" };
    const source: DeepPartial<typeof target> = { items: ["x", "y"] };
    const result = deepMerge(target, source);
    deepStrictEqual(result.items, ["x", "y"]);
    strictEqual(result.name, "test");
  });

  it("should skip undefined values in source", () => {
    const target = { a: 1, b: 2, c: 3 };
    const source: DeepPartial<typeof target> = { a: 10, b: undefined };
    const result = deepMerge(target, source);
    strictEqual(result.a, 10); // defined value replaces
    strictEqual(result.b, 2);  // undefined skipped, original preserved
    strictEqual(result.c, 3);  // untouched
  });

  it("should return target unchanged for empty source", () => {
    const target = { a: 1, b: { c: 2 } };
    const result = deepMerge(target, {});
    strictEqual(result.a, 1);
    strictEqual(result.b.c, 2);
  });

  it("should replace primitive values from source", () => {
    const target = { count: 5, label: "old", active: false };
    const source: DeepPartial<typeof target> = { count: 42, label: "new", active: true };
    const result = deepMerge(target, source);
    strictEqual(result.count, 42);
    strictEqual(result.label, "new");
    strictEqual(result.active, true);
  });

  it("should deeply merge nested objects at multiple levels", () => {
    const target = {
      level1: {
        level2: {
          level3: { value: "deep", flag: true },
          other: 99,
        },
      },
    };
    const source: DeepPartial<typeof target> = {
      level1: {
        level2: {
          level3: { value: "overridden" },
        },
      },
    };
    const result = deepMerge(target, source);
    strictEqual(result.level1.level2.level3.value, "overridden");
    strictEqual(result.level1.level2.level3.flag, true); // preserved
    strictEqual(result.level1.level2.other, 99); // preserved
  });

  it("should not mutate the target object", () => {
    const target = { a: 1, b: 2 };
    const source: DeepPartial<typeof target> = { a: 99 };
    const result = deepMerge(target, source);
    strictEqual(result.a, 99); // merged correctly
    strictEqual(target.a, 1);  // original unchanged
  });
});

describe("extractPersonaFromSystem", () => {
  it("should return only persona prompts when mixed with schemas and reminders", () => {
    const prompts = [
      "You are a helpful assistant.",
      '{"type": "object", "properties": {"name": {"type": "string"}}}',
      "<system-reminder>foo</system-reminder>",
    ];
    const result = extractPersonaFromSystem(prompts);
    strictEqual(result, "You are a helpful assistant.");
  });

  it("should join multiple persona prompts with double newlines", () => {
    const prompts = ["You are a researcher.", "Always cite sources."];
    const result = extractPersonaFromSystem(prompts);
    strictEqual(result, "You are a researcher.\n\nAlways cite sources.");
  });

  it("should return empty string for only schemas", () => {
    const prompts = ['{"type": "object", "properties": {"name": {"type": "string"}}}'];
    const result = extractPersonaFromSystem(prompts);
    strictEqual(result, "");
  });

  it("should return empty string for only reminders", () => {
    const prompts = ["<system-reminder>remember this</system-reminder>"];
    const result = extractPersonaFromSystem(prompts);
    strictEqual(result, "");
  });

  it("should return empty string for empty array", () => {
    const result = extractPersonaFromSystem([]);
    strictEqual(result, "");
  });

  it("should return empty string when all prompts are filtered out", () => {
    const prompts = [
      '{"type": "object", "properties": {"foo": {}}}',
      "<system-reminder>bar</system-reminder>",
      '{"type": "object", "properties": {"baz": {}}}',
    ];
    const result = extractPersonaFromSystem(prompts);
    strictEqual(result, "");
  });

  it("should preserve whitespace in remaining prompts and trim final result", () => {
    const prompts = ["  You are a coder.  ", "  Write clean code.  "];
    const result = extractPersonaFromSystem(prompts);
    strictEqual(result, "You are a coder.\n\nWrite clean code.");
  });

  it("should not filter <System-Reminder> (case sensitive)", () => {
    const prompts = ["<System-Reminder>foo</System-Reminder>"];
    const result = extractPersonaFromSystem(prompts);
    strictEqual(result, "<System-Reminder>foo</System-Reminder>");
  });

  it("should not filter schema missing properties keyword", () => {
    const prompts = ['{"type": "object", "title": "Foo"}'];
    const result = extractPersonaFromSystem(prompts);
    strictEqual(result, '{"type": "object", "title": "Foo"}');
  });

  it("should not filter schema missing type object", () => {
    const prompts = ['{"properties": {"name": {"type": "string"}}}'];
    const result = extractPersonaFromSystem(prompts);
    strictEqual(result, '{"properties": {"name": {"type": "string"}}}');
  });

  // ── Task 1 (ADR-003): native-prompt marker filter (fallback) ──

  it("should drop a title generator prompt (native title.txt)", () => {
    const prompts = ["You are a title generator. You output ONLY a thread title. Nothing else."];
    const result = extractPersonaFromSystem(prompts);
    strictEqual(result, "");
  });

  it("should drop an anchored context summarization prompt (native compaction.txt)", () => {
    const prompts = ["You are an anchored context summarization assistant for coding sessions."];
    const result = extractPersonaFromSystem(prompts);
    strictEqual(result, "");
  });

  it("should drop a conversation summary prompt (native summary.txt)", () => {
    const prompts = ["Summarize what was done in this conversation. Write like a pull request description."];
    const result = extractPersonaFromSystem(prompts);
    strictEqual(result, "");
  });

  it("should preserve a real persona prompt with no markers, schema, or system-reminder", () => {
    const prompts = ["You are a helpful coding assistant. Always be concise."];
    const result = extractPersonaFromSystem(prompts);
    strictEqual(result, "You are a helpful coding assistant. Always be concise.");
  });

  it("should return only the real persona when mixed with a native marker prompt", () => {
    const prompts = [
      "You are a title generator. You output ONLY a thread title.",
      "You are a real agent. Do good things.",
    ];
    const result = extractPersonaFromSystem(prompts);
    strictEqual(result, "You are a real agent. Do good things.");
  });

  it("should still drop schema markers and <system-reminder> blocks alongside native markers", () => {
    const prompts = [
      "You are a title generator.",
      '{"type": "object", "properties": {"name": {"type": "string"}}}',
      "<system-reminder>remember this</system-reminder>",
      "You are a real agent.",
    ];
    const result = extractPersonaFromSystem(prompts);
    strictEqual(result, "You are a real agent.");
  });
});
