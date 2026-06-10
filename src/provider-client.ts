import type { ChatClient, ModelOverride } from "./generator.js";
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

      // Use runtime provider list (config.provider is empty at this point)
      const providerList = await (this.sdkClient as any).provider.list();
      const allProviders = providerList.data?.all ?? providerList.all ?? [];
      const provider = allProviders.find(
        (p: any) => p.id === providerID
      );
      if (!provider) {
        log.warn("ProviderChatClient: provider not found in runtime list", { providerID });
        this.cachedConfig = null;
        return null;
      }

      // Resolve baseURL: options.baseURL > model.api.url
      const modelInfo = provider.models?.[modelID];
      const baseURL = provider.options?.baseURL ?? modelInfo?.api?.url;
      // Resolve apiKey: options.apiKey > provider.key > first env var
      let apiKey = provider.options?.apiKey ?? provider.key;
      if (!apiKey && provider.env?.length > 0) {
        for (const envVar of provider.env) {
          const val = (globalThis as any).process?.env?.[envVar];
          if (val) {
            apiKey = val;
            break;
          }
        }
      }
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

  private async getModelFromOverride(modelOverride: ModelOverride): Promise<ProviderConfig> {
    // Use the SDK client's provider.list() to get the runtime provider map
    // (config.provider is empty at this point — providers are resolved lazily)
    const providerList = await (this.sdkClient as any).provider.list();
    const allProviders = providerList.data?.all ?? providerList.all ?? [];
    const provider = allProviders.find(
      (p: any) => p.id === modelOverride.providerID
    );
    if (!provider) {
      log.error(`Provider "${modelOverride.providerID}" not found — available: ${JSON.stringify(allProviders.map((p: any) => p.id))}`);
      throw new Error(`Provider "${modelOverride.providerID}" not found in SDK config`);
    }

    // Resolve baseURL: options.baseURL > model.api.url
    const modelInfo = provider.models?.[modelOverride.modelID];
    const baseURL = provider.options?.baseURL ?? modelInfo?.api?.url;
    if (!baseURL) {
      throw new Error(`Missing baseURL for provider "${modelOverride.providerID}"`);
    }

    // Resolve apiKey: options.apiKey > provider.key > first env var
    let apiKey = provider.options?.apiKey ?? provider.key;
    if (!apiKey && provider.env?.length > 0) {
      for (const envVar of provider.env) {
        const val = (globalThis as any).process?.env?.[envVar];
        if (val) {
          apiKey = val;
          break;
        }
      }
    }
    if (!apiKey) {
      throw new Error(`Missing apiKey for provider "${modelOverride.providerID}"`);
    }

    return {
      providerID: modelOverride.providerID,
      modelID: modelOverride.modelID,
      baseURL,
      apiKey,
    };
  }

  async createCompletion(request: {
    model: string;
    messages: Array<{ role: "user" | "assistant" | "system"; content: string }>;
    modelOverride?: ModelOverride;
  }): Promise<{ text: string }> {
    let config: ProviderConfig;
    if (request.modelOverride) {
      config = await this.getModelFromOverride(request.modelOverride);
    } else {
      const loaded = await this.loadConfig();
      if (!loaded) {
        throw new Error("Provider config is missing or malformed; cannot create completion");
      }
      config = loaded;
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
