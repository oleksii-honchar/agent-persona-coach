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
 * Format a traversal nudge as a <system-reminder> block.
 * The {node} placeholder in wording is replaced with nodeLabel.
 */
export function formatTraversalNudge(wording: string, nodeLabel: string): string {
  const resolved = wording.replaceAll("{node}", nodeLabel);
  return `<system-reminder>
  Traversal Check:
  - ${resolved}
  This is a deterministic reminder - no model call was made.
  Continue with your task.
</system-reminder>`;
}

/**
 * Format a backtrack nudge as a <system-reminder> block.
 * The {node} placeholder in wording is replaced with the most recent anchor;
 * path history is included as ancestor hints when available.
 */
export function formatBacktrackNudge(wording: string, path: string[]): string {
  const nodeLabel = path.length > 0 ? path[path.length - 1] : "";
  const resolved = wording.replaceAll("{node}", nodeLabel);
  const pathLine = path.length > 0 ? `\n  - Recent anchors: ${path.join(" → ")}` : "";
  return `<system-reminder>
  Backtrack Check:
  - ${resolved}${pathLine}
  This is a deterministic reminder - no model call was made.
  Continue with your task.
</system-reminder>`;
}


