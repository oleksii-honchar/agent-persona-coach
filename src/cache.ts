import { createHash } from "node:crypto";
import type { CoachQuestions } from "./types.js";

export class CoachQuestionsCache {
  private cache = new Map<string, CoachQuestions>();

  private static hash(text: string): string {
    return createHash("sha256").update(text).digest("hex").slice(0, 16);
  }

  private key(agentName: string, personaHash: string): string {
    return `${agentName}:${personaHash}`;
  }

  get(agentName: string, personaText: string): CoachQuestions | undefined {
    const hash = CoachQuestionsCache.hash(personaText);
    return this.cache.get(this.key(agentName, hash));
  }

  set(questions: CoachQuestions): void {
    this.cache.set(this.key(questions.agentName, questions.personaHash), questions);
  }

  invalidate(agentName: string): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${agentName}:`)) {
        this.cache.delete(key);
      }
    }
  }

  clear(): void {
    this.cache.clear();
  }

  /**
   * Get or generate questions. If cache miss, calls the generate function.
   */
  async getOrGenerate(
    agentName: string,
    personaText: string,
    modelOverride: { providerID: string; modelID: string } | undefined,
    generate: (
      agentName: string,
      personaText: string,
      modelOverride: { providerID: string; modelID: string } | undefined
    ) => Promise<CoachQuestions>
  ): Promise<CoachQuestions> {
    const cached = this.get(agentName, personaText);
    if (cached) return cached;

    const questions = await generate(agentName, personaText, modelOverride);
    this.set(questions);
    return questions;
  }
}
