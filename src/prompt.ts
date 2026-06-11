export const COACH_PROMPT = `You are analyzing an agent's persona to generate targeted reflection questions.
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

/**
 * Build the prompt with persona text.
 */
export function buildCoachPrompt(personaText: string): string {
  return COACH_PROMPT.replace("{personaText}", personaText.trim());
}
