// Types for Agent Persona Coach

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
  categories: {
    identity: { enabled: boolean; cadence: number; afterEachUserMessage: boolean };
    rules: { enabled: boolean; cadence: number; criticalPermissions: string[]; criticalTools: string[] };
    references: { enabled: boolean; cadence: number };
    progress: { enabled: boolean; cadence: number };
  };
}

export const DEFAULT_CONFIG: PluginConfig = {
  enabled: true,
  categories: {
    identity: { enabled: true, cadence: 10, afterEachUserMessage: true },
    rules: { enabled: true, cadence: 10, criticalPermissions: [], criticalTools: [] },
    references: { enabled: true, cadence: 30 },
    progress: { enabled: true, cadence: 20 },
  },
};

/**
 * Extract persona text from agent info.
 * V1 (Agent.Info): uses `prompt` field
 * V2 (AgentV2.Info): uses `system` field
 */
export function extractPersona(agentInfo: Record<string, unknown>): string {
  return (agentInfo as any).prompt ?? (agentInfo as any).system ?? "";
}

/**
 * Extract persona text from system prompts array.
 * Filters out tool JSON schemas and <system-reminder> blocks.
 */
export function extractPersonaFromSystem(systemPrompts: string[]): string {
  const filtered = systemPrompts.filter((prompt) => {
    const hasSchemaMarkers = prompt.includes('"type": "object"') && prompt.includes('"properties"');
    const hasSystemReminder = prompt.includes("<system-reminder>");
    return !hasSchemaMarkers && !hasSystemReminder;
  });
  return filtered.map((p) => p.trim()).join("\n\n").trim();
}
