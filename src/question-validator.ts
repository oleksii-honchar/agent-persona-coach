/**
 * Question validation and truncation.
 *
 * Per spec §5: "Keep each question under 80 characters."
 * Questions exceeding 80 characters are truncated with a "…" suffix
 * and a warning is logged. Empty arrays are preserved (spec allows
 * skipping categories that don't apply).
 */

export interface QuestionCategories {
  identity: string[];
  rules: string[];
  references: string[];
  progress: string[];
}

const MAX_LENGTH = 80;
const ELLIPSIS = "\u2026"; // …

/**
 * Validate and truncate questions to ensure none exceed MAX_LENGTH characters.
 *
 * - Questions with length ≤ 80 pass through unchanged.
 * - Questions with length > 80 are truncated to 79 characters + "…" (80 total).
 * - A warning is logged for each truncated question.
 * - Empty arrays are preserved as-is.
 * - Returns a new object; input is not mutated.
 */
export function validateQuestions(
  categories: QuestionCategories
): QuestionCategories {
  const result: QuestionCategories = {
    identity: [],
    rules: [],
    references: [],
    progress: [],
  };

  const categoryNames: Array<keyof QuestionCategories> = [
    "identity",
    "rules",
    "references",
    "progress",
  ];

  let truncatedCount = 0;

  for (const category of categoryNames) {
    const questions = categories[category];
    for (const q of questions) {
      if (q.length > MAX_LENGTH) {
        result[category].push(q.slice(0, MAX_LENGTH - 1) + ELLIPSIS);
        truncatedCount++;
      } else {
        result[category].push(q);
      }
    }
  }

  if (truncatedCount > 0) {
    console.warn(
      `[persona-coach] Truncated ${truncatedCount} question(s) exceeding ${MAX_LENGTH} characters.`
    );
  }

  return result;
}
