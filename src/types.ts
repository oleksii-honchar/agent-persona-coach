// Types for Agent Persona Coach

/**
 * Deep partial — makes all properties of T optional recursively.
 * Arrays and primitives are left as-is; only plain objects are recursed into.
 */
export type DeepPartial<T> = T extends object
  ? { [P in keyof T]?: DeepPartial<T[P]> }
  : T;

export interface CoachQuestions {
  agentName: string;
  personaHash: string;
  questions: {
    identity: string[];
    rules: string[];
    references: string[];
    progress: string[];
  };
  generatedAt: string;
}

export interface CoachState {
  toolCallCount: number;
  criticalToolCallCount: number;
  referenceCheckInjected: boolean;
}

export interface PluginConfig {
  enabled: boolean;
  coachPrompt: string;
  categories: {
    identity: { enabled: boolean; cadence: number; afterEachUserMessage: boolean };
    rules: { enabled: boolean; cadence: number; criticalPermissions: string[]; criticalTools: string[] };
    references: { enabled: boolean; cadence: number };
    progress: { enabled: boolean; cadence: number };
  };
}

export const COACH_PROMPT_DEFAULT = `You are analyzing an agent's persona to generate targeted reflection questions.
The agent operates as follows:

<agent-persona>
{personaText}
</agent-persona>

Generate exactly 2-3 questions for each of the following categories.
Each question should be specific to THIS agent's persona — NOT generic.

Category 1: IDENTITY CHECK
- Purpose: Help the agent verify it's operating in its correct role
- Questions should make the agent reflect on whether it's staying in its lane
- Example: "Am I [agent's role] or am I doing something outside my scope?"

  Task Completion:
  - Help agent assess if task is done and whether they're stuck in a loop
  - Questions should ask:
    - Have you accomplished the task goal?
    - Am I looping through the same problem?
    - If stuck, should I ask the human for help?

Category 2: RULE COMPLIANCE
- Purpose: Help the agent verify it's following its constraints BEFORE taking critical actions
- Emphasize: NEVER, ALWAYS, MUST — the strongest constraints from the persona
- Questions should reference specific rules from THIS persona
- Example: "Before I [action], am I following my rule to [specific rule]?"

Category 3: REFERENCE CHECK
- Purpose: Ensure the agent reads ALL reference files mentioned in its persona
- Emphasize: reading all reference files mentioned in the persona description
- Questions should reference specific files/sections if named in the persona
- Example: "Have I read [specific file] that my persona says I should?"

Category 4: PROGRESS CHECK
- Purpose: Help the agent assess progress and quality
- Questions should make the agent evaluate whether it's on track
- Example: "Is what I'm producing actually meeting [agent's goal]?"

  Stagnation Check:
  - Help agent assess if they're making real progress
  - Questions should ask:
    - Is my progress meaningful, or am I circling back?
    - If the task isn't done, would a fundamentally different approach help?
    - Should I seek human guidance at this point?

Rules for questions:
- Make them PERSONA-SPECIFIC, not generic
- Reference actual constraints, rules, files from the persona
- Keep questions concise and focused — aim for a single clear thought per question
- Use second person ("you") — these are addressed to the agent
- If a category doesn't apply (e.g., persona has no rules), skip it with empty array

Output JSON:
{
  "identity": ["Question 1?", "Question 2?", "Question 3?"],
  "rules": ["Question 1?", "Question 2?"],
  "references": ["Question 1?", "Question 2?", "Question 3?"],
  "progress": ["Question 1?", "Question 2?"]
}
`;

export const DEFAULT_CONFIG: PluginConfig = {
  enabled: true,
  coachPrompt: COACH_PROMPT_DEFAULT,
  categories: {
    identity: { enabled: true, cadence: 10, afterEachUserMessage: true },
    rules: { enabled: true, cadence: 10, criticalPermissions: ["bash", "edit", "task"], criticalTools: [] },
    references: { enabled: true, cadence: 30 },
    progress: { enabled: true, cadence: 20 },
  },
};

/**
 * Deep merge source into target.
 * - Plain objects are recursively merged
 * - Arrays are replaced (not merged)
 * - Primitive values are replaced
 * - Undefined source values are skipped (target value preserved)
 * - Does NOT mutate the target object
 */
export function deepMerge<T extends object>(target: T, source: DeepPartial<T>): T {
  // Use string-keyed access — source/target are plain objects at runtime.
  // DeepPartial<T> loses indexability at the type level, so we cast to Record<string, unknown>.
  const s = source as Record<string, unknown>;
  const t = target as Record<string, unknown>;
  const result = { ...t } as Record<string, unknown>;

  for (const key of Object.keys(source)) {
    const sourceValue = s[key];
    const targetValue = t[key];

    if (sourceValue === undefined) {
      continue;
    }

    if (isPlainObject(sourceValue) && isPlainObject(targetValue)) {
      result[key] = deepMerge(
        targetValue as Record<string, unknown>,
        sourceValue as Record<string, unknown>,
      );
    } else {
      result[key] = sourceValue;
    }
  }

  return result as T;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Extract persona text from agent info.
 * V1 (Agent.Info): uses `prompt` field
 * V2 (AgentV2.Info): uses `system` field
 */
export function extractPersona(agentInfo: Record<string, unknown>): string {
  return (agentInfo as any).prompt ?? (agentInfo as any).system ?? "";
}

/**
 * Prefixes of hidden native agent prompts that reuse the session's sessionID
 * for their LLM call (agent/prompt/title.txt, compaction.txt, summary.txt).
 * Used as a fallback filter (ADR-003) for hosts without the agent identity
 * contract change — prefix matching minimizes false positives on real personas.
 */
const NATIVE_AGENT_PROMPT_MARKERS = [
  "You are a title generator", // agent/prompt/title.txt
  "You are an anchored context summarization assistant", // agent/prompt/compaction.txt
  "Summarize what was done in this conversation", // agent/prompt/summary.txt
];

/**
 * Extract persona text from system prompts array.
 * Filters out tool JSON schemas, <system-reminder> blocks, and native
 * agent prompts (title/compaction/summary).
 */
export function extractPersonaFromSystem(systemPrompts: string[]): string {
  const filtered = systemPrompts.filter((prompt) => {
    const hasSchemaMarkers = prompt.includes('"type": "object"') && prompt.includes('"properties"');
    const hasSystemReminder = prompt.includes("<system-reminder>");
    const isNativePrompt = NATIVE_AGENT_PROMPT_MARKERS.some((m) => prompt.startsWith(m));
    return !hasSchemaMarkers && !hasSystemReminder && !isNativePrompt;
  });
  return filtered.map((p) => p.trim()).join("\n\n").trim();
}
