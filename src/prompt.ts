/**
 * Build the prompt with persona text.
 */
export function buildCoachPrompt(personaText: string, promptTemplate: string): string {
  return promptTemplate.replace("{personaText}", personaText.trim());
}
