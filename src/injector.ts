const CATEGORY_NAMES: Record<string, string> = {
  identity: "Identity Check",
  rules: "Rule Compliance",
  references: "Reference Check",
  progress: "Progress Check",
};

/**
 * Format reflection questions as a <system-reminder> block.
 */
export function formatNudge(categoryId: string, questions: string[]): string {
  const name = CATEGORY_NAMES[categoryId] || categoryId;
  const questionList = questions.map((q) => `- ${q}`).join("\n");

  return `<system-reminder>
  ${name}:
  ${questionList}
  Please reflect on these questions and adjust your behavior accordingly.
  Continue with your task.
</system-reminder>`;
}


