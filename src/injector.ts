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

/**
 * Append a nudge to the system prompt.
 * If the system prompt already ends with a <system-reminder>, prepend before it.
 * Otherwise, append at the end.
 */
export function injectNudge(systemPrompt: string, nudge: string): string {
  const reminderTag = "</system-reminder>";
  const lastReminderIndex = systemPrompt.lastIndexOf(reminderTag);

  if (lastReminderIndex !== -1) {
    // Insert before the last closing system-reminder tag
    const afterTag = lastReminderIndex + reminderTag.length;
    return (
      systemPrompt.slice(0, afterTag) +
      "\n" +
      nudge +
      "\n" +
      systemPrompt.slice(afterTag)
    );
  }

  // No existing system-reminder — append at the end
  return systemPrompt + "\n" + nudge;
}
