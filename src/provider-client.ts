import type { ChatClient } from "./generator.js";
import { log } from "./logger.js";

interface ProviderConfig {
  providerID: string;
  modelID: string;
  baseURL: string;
  apiKey: string;
}

export class ProviderChatClient implements ChatClient {
  private cachedConfig: ProviderConfig | null | undefined;

  constructor(private sdkClient: unknown) {}

  async loadConfig(): Promise<ProviderConfig | null> {
    if (this.cachedConfig !== undefined) {
      return this.cachedConfig;
    }

    try {
      const config = await (this.sdkClient as any).config.get();

      if (!config) {
        throw new Error("SDK config is null or undefined");
      }

      const model = config.model;
      if (!model) {
        log.warn("ProviderChatClient: missing 'model' in SDK config");
        this.cachedConfig = null;
        return null;
      }

      const slashIndex = model.indexOf("/");
      if (slashIndex === -1) {
        log.warn("ProviderChatClient: malformed model ref (expected provider/model)", { model });
        this.cachedConfig = null;
        return null;
      }

      const providerID = model.slice(0, slashIndex);
      const modelID = model.slice(slashIndex + 1);

      // SDK config uses `provider` (singular) with credentials in `options`
      // e.g. { provider: { openai: { options: { apiKey: "...", baseURL: "..." } } } }
      const provider = config.provider?.[providerID];
      if (!provider) {
        log.warn("ProviderChatClient: provider not found in config", { providerID });
        this.cachedConfig = null;
        return null;
      }

      const baseURL = provider.options?.baseURL;
      const apiKey = provider.options?.apiKey;
      if (!baseURL || !apiKey) {
        log.warn("ProviderChatClient: missing baseURL or apiKey for provider", { providerID });
        this.cachedConfig = null;
        return null;
      }

      this.cachedConfig = {
        providerID,
        modelID,
        baseURL,
        apiKey,
      };

      return this.cachedConfig;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.warn("ProviderChatClient: failed to load config", { error: message });
      throw new Error(`Failed to load provider config: ${message}`);
    }
  }

  async createCompletion(request: {
    model: string;
    messages: Array<{ role: "user" | "assistant" | "system"; content: string }>;
  }): Promise<{ text: string }> {
    const config = await this.loadConfig();

    if (!config) {
      throw new Error("Provider config is missing or malformed; cannot create completion");
    }

    const url = `${config.baseURL}/chat/completions`;

    const response = await globalThis.fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.modelID,
        messages: request.messages,
      }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Provider returned ${response.status} ${response.statusText}: ${text}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content ?? "";

    return { text: content };
  }
}
