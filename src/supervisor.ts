import { extractJsonFromMarkdown, type ChatClient } from "./generator.js";
import { log } from "./logger.js";

/**
 * Config surface for the opt-in LLM compliance supervisor (§7).
 *
 * Mirrors the nested `categories.traversal.supervisor` block in `types.ts`
 * (PluginConfig) — types.ts does not export a standalone `SupervisorConfig`,
 * so this module owns its copy and stays decoupled from the plugin config
 * tree; the server wiring (Task 8) passes `config.categories.traversal.supervisor`.
 */
export interface SupervisorConfig {
  enabled: boolean;
  model: string; // small/cheap model id used for classification
  maxCallsPerSession: number; // attempts cap — judge no-ops after this
  sampleEvery: number; // classify every N user messages (used by the caller)
  ladderWording: string[]; // 3 escalation tiers: advisory → explicit → brutal
}

export type SupervisionVerdict = "compliant" | "skip" | "evasive";

const CLASSIFICATION_EXPECTATION = [
  "The persona-tree compliance expectation: the agent must report its current node",
  "and the status of its target, vetoes, and conditions for traversal.",
].join(" ");



/**
 * Anything the plugin needs from the host plugin is a single `createCompletion`
 * call — the same ChatClient shape the generator uses. `AgentPersonaCoachPlugin`
 * satisfies this structurally; declaring the minimal shape here avoids an import
 * cycle (supervisor.ts ↔ index.ts).
 */
export interface SupervisionPlugin {
  createCompletion: ChatClient["createCompletion"];
}

/**
 * Opt-in LLM compliance supervisor (§7, D7).
 *
 * Classifies the agent's latest turn against the compliance expectation and
 * escalates ladder wording. Best-effort: classification errors never block and
 * resolve to "compliant" (fail-open — never punish on unverifiable signal).
 */
export class ComplianceSupervisor {
  private callsMade = 0;

  constructor(
    private readonly config: SupervisorConfig,
    private readonly plugin: SupervisionPlugin
  ) {}

  /**
   * Classify the agent's recent turns as compliant / skip / evasive.
   *
   * - Calls `plugin.createCompletion` with `config.model` and a minimal prompt
   *   referencing the compliance expectation; the JSON answer is parsed with
   *   the generator-style helper (`extractJsonFromMarkdown`).
   * - Defensive classification: any unrecognized / unparseable model answer
   *   maps to "compliant" (fail-open — never throw).
   * - Model errors log and resolve to "compliant" (D7 — never block).
   * - Own `maxCallsPerSession` counter: once hit, returns "compliant" without
   *   calling `createCompletion`. The counter counts call attempts (failed
   *   calls included) so the LLM budget is bounded regardless of failure mode.
   */
  async judge(sessionID: string, recentTurns: string[]): Promise<SupervisionVerdict> {
    if (this.callsMade >= this.config.maxCallsPerSession) {
      return "compliant";
    }

    this.callsMade += 1;

    try {
      const response = await this.plugin.createCompletion({
        model: this.config.model,
        messages: [{ role: "user", content: this.buildPrompt(recentTurns) }],
      });

      return this.classify(response.text);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.warn(`Supervisor classification failed for ${sessionID}; failing open to compliant. The deterministic engine is the guarantee; the supervisor is best-effort and never blocks.`, {
        error: message,
      });
      return "compliant";
    }
  }

  /**
   * Pick the ladder tier for a skip chain: 0-1 → tier0, 2-3 → tier1, 4+ → tier2.
   * Unknown/longer lengths clamp to the LAST tier; a ladder shorter than three
   * entries clamps to its last entry as well.
   */
  escalate(skipChain: number): string {
    const ladder = this.config.ladderWording;
    if (ladder.length === 0) {
      return "";
    }
    const tierIndex = skipChain <= 1 ? 0 : skipChain <= 3 ? 1 : 2;
    return ladder[Math.min(tierIndex, ladder.length - 1)];
  }

  private classify(text: string): SupervisionVerdict {
    const extracted = extractJsonFromMarkdown(text);
    let parsed: unknown;
    try {
      parsed = JSON.parse(extracted);
    } catch {
      parsed = null;
    }
    const raw = parsed != null && typeof parsed === "object" && "classification" in parsed
      ? (parsed as Record<string, unknown>).classification
      : undefined;
    const classification = typeof raw === "string" ? raw : "";
    switch (classification) {
      case "skip":
        return "skip";
      case "evasive":
        return "evasive";
      default:
        // Fail-open: unknowable/unparseable → don't punish (never throw).
        return "compliant";
    }
  }

  private buildPrompt(recentTurns: string[]): string {
    const turns = recentTurns.length > 0
      ? recentTurns.map((turn, index) => `${index + 1}. ${turn}`).join("\n")
      : "(no recent turns)";
    return [
      CLASSIFICATION_EXPECTATION,
      "",
      "Recent turns (latest last):",
      turns,
      "",
      'Classify the agent\'s latest reply as exactly one of: "compliant", "skip" or "evasive".',
      'Reply with raw JSON only: {"classification": "<verdict>"}',
    ].join("\n");
  }
}