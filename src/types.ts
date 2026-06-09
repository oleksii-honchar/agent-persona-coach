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
  referenceCheckInjected: boolean;
}

export interface PluginConfig {
  enabled: boolean;
  categories: {
    identity: { enabled: boolean; cadence: number };
    rules: { enabled: boolean; criticalPermissions: string[]; criticalTools: string[] };
    references: { enabled: boolean; afterCalls: number };
    progress: { enabled: boolean; cadence: number };
  };
}

export const DEFAULT_CONFIG: PluginConfig = {
  enabled: true,
  categories: {
    identity: { enabled: true, cadence: 4 },
    rules: { enabled: true, criticalPermissions: ["write", "bash", "task", "create"], criticalTools: [] },
    references: { enabled: true, afterCalls: 2 },
    progress: { enabled: true, cadence: 8 },
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
