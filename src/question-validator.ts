/**
 * Question structure validation.
 *
 * The validator NEVER modifies question content — questions pass through
 * unchanged regardless of length. It only ensures structural correctness:
 * each category must be a non-null array of strings. Invalid categories
 * (null, undefined, non-array) are replaced with empty arrays.
 */

export interface QuestionCategories {
  identity: string[];
  rules: string[];
  references: string[];
  progress: string[];
}

/**
 * Validate question structure: ensure each category is a non-null array of strings.
 *
 * - Questions pass through unchanged regardless of length.
 * - Null/undefined/non-array categories are replaced with empty arrays.
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

  for (const category of categoryNames) {
    const questions = categories[category];
    if (Array.isArray(questions)) {
      result[category] = [...questions];
    }
    // else: null, undefined, or non-array → empty array (already set)
  }

  return result;
}
