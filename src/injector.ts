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

/**
 * Format a bootstrap nudge as a <system-reminder> block (spec §3).
 * Reminds a fresh/un-anchored agent to enter its persona decision tree before
 * its next tool call.
 */
export function formatBootstrapNudge(wording: string): string {
  return `<system-reminder>
  Traversal Check:
  - ${wording}
  This is a deterministic reminder - no model call was made.
  Continue with your task.
</system-reminder>`;
}

/**
 * Format a realign nudge as a <system-reminder> block (spec §4).
 * A new user message arrived; re-evaluate whether {node} still matches intent,
 * otherwise traverse. The {node} placeholder in wording is replaced with node.
 */
export function formatRealignNudge(wording: string, node: string): string {
  const resolved = wording.replaceAll("{node}", node);
  return `<system-reminder>
  Realign Check:
  - ${resolved}
  This is a deterministic reminder - no model call was made.
  Continue with your task.
</system-reminder>`;
}

/**
 * Format the hard-gate blocking message as a <system-reminder> block (spec §6).
 * Returned by the engine when a non-traversal tool fires during a pending
 * realignment; the server hook throws it to abort the tool call.
 */
export function formatHardGateMessage(wording: string): string {
  return `<system-reminder>
  Hard Gate:
  - ${wording}
</system-reminder>`;
}


