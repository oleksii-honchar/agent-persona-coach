import { createHash } from "node:crypto";
import type { CoachQuestions } from "./types.js";
import { buildCoachPrompt } from "./prompt.js";
import { validateQuestions } from "./question-validator.js";
import { log } from "./logger.js";

/**
 * Minimal chat completion client interface.
 * In production, this would be the actual model client.
 */
export interface ChatClient {
  createCompletion(request: {
    model: string;
    messages: Array<{ role: "user" | "assistant" | "system"; content: string }>;
  }): Promise<{ text: string }>;
}

/**
 * Extract JSON from a response that may be wrapped in markdown code blocks.
 * LLMs often output ```json { ... } ``` instead of raw JSON.
 *
 * Strategy:
 * 1. If the text contains ```json or ``` blocks, extract the content between them.
 * 2. Otherwise, return the original text (it might be raw JSON).
 */
export function extractJsonFromMarkdown(text: string): string {
  // Match ```json ... ``` or ``` ... ``` blocks
  const jsonBlockMatch = text.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
  if (jsonBlockMatch) {
    return jsonBlockMatch[1].trim();
  }
  return text;
}

export class CoachGenerator {
  constructor(private client: ChatClient) {}

  async generate(
    agentName: string,
    personaText: string
  ): Promise<CoachQuestions> {
    if (!personaText.trim()) {
      return this.emptyQuestions(agentName, personaText);
    }

    const prompt = buildCoachPrompt(personaText);
    const personaHash = createHash("sha256").update(personaText).digest("hex").slice(0, 16);

    try {
      const response = await this.client.createCompletion({
        model: "default",
        messages: [{ role: "user", content: prompt }],
      });

      const extractedText = extractJsonFromMarkdown(response.text);
      const parsed = JSON.parse(extractedText);

      const rawQuestions = {
        identity: parsed.identity || [],
        rules: parsed.rules || [],
        references: parsed.references || [],
        progress: parsed.progress || [],
      };

      const validated = validateQuestions(rawQuestions);

      return {
        agentName,
        personaHash,
        questions: validated,
        generatedAt: new Date().toISOString(),
      };
    } catch (error) {
      // Fallback: return empty questions if generation fails
      log.warn(`Failed to generate questions for ${agentName}`, { error: error instanceof Error ? error.message : String(error) });
      return this.emptyQuestions(agentName, personaText);
    }
  }

  private emptyQuestions(agentName: string, personaText: string): CoachQuestions {
    const personaHash = createHash("sha256").update(personaText).digest("hex").slice(0, 16);

    return {
      agentName,
      personaHash,
      questions: {
        identity: [],
        rules: [],
        references: [],
        progress: [],
      },
      generatedAt: new Date().toISOString(),
    };
  }
}
