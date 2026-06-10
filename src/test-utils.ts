import type { ChatClient, ModelOverride } from "./generator.js";

/**
 * Factory for a mock ChatClient that returns a configurable JSON response.
 * Used in tests to control what the model "says" during generation.
 *
 * Each call to createCompletion returns the configured response.
 * Supports call counting via the `calls` array.
 */
export function aMockChatClient(
  responseText: string | string[] = "{}"
): ChatClient & { calls: Array<{ model: string; messages: Array<{ role: string; content: string }>; modelOverride?: ModelOverride }> } {
  const responses = Array.isArray(responseText) ? [...responseText] : [responseText];
  const calls: Array<{ model: string; messages: Array<{ role: string; content: string }>; modelOverride?: ModelOverride }> = [];

  return {
    calls,
    async createCompletion(request: { model: string; messages: Array<{ role: "user" | "assistant" | "system"; content: string }>; modelOverride?: ModelOverride }) {
      calls.push({ model: request.model, messages: request.messages, modelOverride: request.modelOverride });
      const text = responses.shift() ?? responses[responses.length - 1] ?? "{}";
      return { text };
    },
  };
}
