const CATEGORY_NAMES: Record<string, string> = {
  identity: "Identity Check",
  rules: "Rule Compliance",
  references: "Reference Check",
  progress: "Progress Check",
};

/**
 * Layer-2 guard (Ad-Hoc fix): a label is renderable into `{node}` only when it
 * is a real node id — `file_...`/`node_...`-shaped, or at least does NOT look
 * like a traversal tool name. Tool names (bensyne_*, getPersonaEntryNode,
 * expandFileRelations, fetchFile, ...) must NEVER be interpolated into `{node}`:
 * the wording then either carries a file_id `fetchFile` can use, or leaves
 * `{node}` unrendered so the wording's own fallback clause applies.
 *
 * Shared by every formatter in this module and by the traversal engine's
 * message paths (blockIfNeeded → resolveGateNode).
 */
const TRAVERSAL_TOOL_NAME_PATTERN =
  /bensyne|getPersonaEntryNode|expandFileRelations|fetchFile|getPersonaStatus|recallMemory|searchFiles|searchMemoryBank|listMemoryBanks|getMemoryStats|FileChunks/i;

export function isNodeIdLabel(label: string): boolean {
  if (typeof label !== "string" || label === "") return false;
  if (label.startsWith("file_") || label.startsWith("node_")) return true;
  return !TRAVERSAL_TOOL_NAME_PATTERN.test(label);
}

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
  const resolved =
    nodeLabel && isNodeIdLabel(nodeLabel) ? wording.replaceAll("{node}", nodeLabel) : wording;
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
  const resolved =
    nodeLabel && isNodeIdLabel(nodeLabel) ? wording.replaceAll("{node}", nodeLabel) : wording;
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
  const resolved = node && isNodeIdLabel(node) ? wording.replaceAll("{node}", node) : wording;
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
 * The {node} placeholder in wording is replaced with node when provided
 * (mirrors formatRealignNudge); without node the wording is output as-is.
 */
export function formatHardGateMessage(wording: string, node?: string): string {
  const rendered = node && isNodeIdLabel(node) ? wording.replaceAll("{node}", node) : wording;
  return `<system-reminder>
  Hard Gate:
  - ${rendered}
  </system-reminder>`;
}

/**
 * Format a dynamic hard-gate blocking message (spec §6.1).
 *
 * Unlike formatHardGateMessage (legacy single-wording), this function selects
 * the wording based on whether a real node label is available:
 * - node defined AND isNodeIdLabel(node): uses hardGateConfig.wordingWithNode
 *   (or hardGateConfig.wording as fallback) with {node} replaced
 * - node undefined or not a valid node id: uses hardGateConfig.wordingNoNode
 *   (or hardGateConfig.wording as fallback)
 *
 * This enables different messaging for mid-task blocking vs. first-call
 * blocking, without the {node} placeholder being left unrendered.
 */
export function formatDynamicHardGateMessage(
  node: string | undefined,
  hardGateConfig: {
    wording: string;
    wordingWithNode?: string;
    wordingNoNode?: string;
  }
): string {
  let wording = hardGateConfig.wording;
  let resolved = wording;

  if (node && isNodeIdLabel(node)) {
    wording = hardGateConfig.wordingWithNode || hardGateConfig.wording;
    resolved = wording.replaceAll("{node}", node);
  } else {
    wording = hardGateConfig.wordingNoNode || hardGateConfig.wording;
    resolved = wording;
  }

  return `<system-reminder>
  Hard Gate:
  - ${resolved}
  </system-reminder>`;
}

