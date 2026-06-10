import { describe, it, beforeEach, afterEach } from "node:test";
import { strictEqual, ok, deepStrictEqual, rejects } from "node:assert/strict";
import { ProviderChatClient } from "./provider-client.js";

/**
 * Helpers to create mock SDK clients.
 */
function aMockSdkClient(config: Record<string, unknown> | null = null) {
  return {
    config: {
      get: async () => config,
    },
  };
}

/**
 * Helpers to create OpenAI-compatible fetch responses.
 */
function aMockFetchResponse(content: string, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    json: async () => ({
      choices: [
        {
          message: {
            role: "assistant",
            content,
          },
        },
      ],
    }),
    text: async () => JSON.stringify({ error: "bad request" }),
  };
}

function aMockFetchResponseWithChoices(choices: Array<{ message: { role: string; content: string } }>, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    json: async () => ({ choices }),
    text: async () => JSON.stringify({ error: "bad request" }),
  };
}

describe("ProviderChatClient", () => {
  let originalFetch: typeof globalThis.fetch;
  let capturedWarnings: string[] = [];
  let originalStderrWrite: typeof process.stderr.write;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    capturedWarnings = [];
    originalStderrWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk: string | Buffer) => {
      const text = typeof chunk === "string" ? chunk : chunk.toString();
      for (const line of text.split("\n").filter(Boolean)) {
        capturedWarnings.push(line);
      }
      return originalStderrWrite(chunk);
    };
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.stderr.write = originalStderrWrite;
  });

  describe("loadConfig", () => {
    it("should parse valid config with model=provider/model", async () => {
      const sdkClient = aMockSdkClient({
        model: "openai/gpt-4",
        provider: {
          openai: { options: { baseURL: "https://api.openai.com/v1", apiKey: "sk-test" } },
        },
      });
      const client = new ProviderChatClient(sdkClient as any);

      const config = await client.loadConfig();

      ok(config);
      strictEqual(config?.providerID, "openai");
      strictEqual(config?.modelID, "gpt-4");
      strictEqual(config?.baseURL, "https://api.openai.com/v1");
      strictEqual(config?.apiKey, "sk-test");
    });

    it("should log warning when model is missing", async () => {
      const sdkClient = aMockSdkClient({
        provider: {
          openai: { options: { baseURL: "https://api.openai.com/v1", apiKey: "sk-test" } },
        },
      });
      const client = new ProviderChatClient(sdkClient as any);

      const config = await client.loadConfig();

      strictEqual(config, null);
      ok(capturedWarnings.some((w) => /missing.*model/i.test(w)));
    });

    it("should log warning when model ref has no slash", async () => {
      const sdkClient = aMockSdkClient({
        model: "gpt4",
        provider: {
          openai: { options: { baseURL: "https://api.openai.com/v1", apiKey: "sk-test" } },
        },
      });
      const client = new ProviderChatClient(sdkClient as any);

      const config = await client.loadConfig();

      strictEqual(config, null);
      ok(capturedWarnings.some((w) => /malformed.*model/i.test(w)));
    });

    it("should log warning when provider is missing", async () => {
      const sdkClient = aMockSdkClient({
        model: "anthropic/claude-3",
        provider: {
          openai: { options: { baseURL: "https://api.openai.com/v1", apiKey: "sk-test" } },
        },
      });
      const client = new ProviderChatClient(sdkClient as any);

      const config = await client.loadConfig();

      strictEqual(config, null);
      ok(capturedWarnings.some((w) => /provider.*not found/i.test(w)));
    });

    it("should log warning when baseURL is missing", async () => {
      const sdkClient = aMockSdkClient({
        model: "openai/gpt-4",
        provider: {
          openai: { options: { baseURL: undefined, apiKey: "sk-test" } },
        },
      });
      const client = new ProviderChatClient(sdkClient as any);

      const config = await client.loadConfig();

      strictEqual(config, null);
      ok(capturedWarnings.some((w) => /missing.*baseURL.*apiKey/i.test(w)));
    });

    it("should log warning when apiKey is missing", async () => {
      const sdkClient = aMockSdkClient({
        model: "openai/gpt-4",
        provider: {
          openai: { options: { baseURL: "https://api.openai.com/v1", apiKey: undefined } },
        },
      });
      const client = new ProviderChatClient(sdkClient as any);

      const config = await client.loadConfig();

      strictEqual(config, null);
      ok(capturedWarnings.some((w) => /missing.*baseURL.*apiKey/i.test(w)));
    });

    it("should cache config after first load", async () => {
      let callCount = 0;
      const sdkClient = {
        config: {
          get: async () => {
            callCount++;
            return {
              model: "openai/gpt-4",
              provider: {
                openai: { options: { baseURL: "https://api.openai.com/v1", apiKey: "sk-test" } },
              },
            };
          },
        },
      };
      const client = new ProviderChatClient(sdkClient as any);

      await client.loadConfig();
      await client.loadConfig();

      strictEqual(callCount, 1);
    });

    it("should throw descriptive error when config.get() returns null", async () => {
      const sdkClient = aMockSdkClient(null);
      const client = new ProviderChatClient(sdkClient as any);

      await rejects(client.loadConfig(), /config.*missing|failed to load/i);
    });
  });

  describe("createCompletion", () => {
    it("should call fetch with correct URL, headers, and body", async () => {
      let fetchUrl: string | undefined;
      let fetchInit: RequestInit | undefined;

      globalThis.fetch = async (url: string | URL | Request, init?: RequestInit) => {
        fetchUrl = String(url);
        fetchInit = init;
        return aMockFetchResponse("Hello!") as Response;
      };

      const sdkClient = aMockSdkClient({
        model: "openai/gpt-4",
        provider: {
          openai: { options: { baseURL: "https://api.openai.com/v1", apiKey: "sk-test" } },
        },
      });
      const client = new ProviderChatClient(sdkClient as any);

      await client.createCompletion({
        model: "default",
        messages: [{ role: "user", content: "Hi" }],
      });

      strictEqual(fetchUrl, "https://api.openai.com/v1/chat/completions");
      ok(fetchInit);
      const headers = fetchInit!.headers as Record<string, string>;
      ok(headers["Authorization"].startsWith("Bearer "));
      strictEqual(headers["Content-Type"], "application/json");

      const body = JSON.parse(fetchInit!.body as string);
      strictEqual(body.model, "gpt-4");
      deepStrictEqual(body.messages, [{ role: "user", content: "Hi" }]);
    });

    it("should return { text: content } on successful response", async () => {
      globalThis.fetch = async () => aMockFetchResponse("Hello from LLM!") as Response;

      const sdkClient = aMockSdkClient({
        model: "openai/gpt-4",
        provider: {
          openai: { options: { baseURL: "https://api.openai.com/v1", apiKey: "sk-test" } },
        },
      });
      const client = new ProviderChatClient(sdkClient as any);

      const result = await client.createCompletion({
        model: "default",
        messages: [{ role: "user", content: "Hi" }],
      });

      strictEqual(result.text, "Hello from LLM!");
    });

    it("should return { text: '' } when choices is empty", async () => {
      globalThis.fetch = async () =>
        aMockFetchResponseWithChoices([]) as Response;

      const sdkClient = aMockSdkClient({
        model: "openai/gpt-4",
        provider: {
          openai: { options: { baseURL: "https://api.openai.com/v1", apiKey: "sk-test" } },
        },
      });
      const client = new ProviderChatClient(sdkClient as any);

      const result = await client.createCompletion({
        model: "default",
        messages: [{ role: "user", content: "Hi" }],
      });

      strictEqual(result.text, "");
    });

    it("should throw on non-OK response with status and body", async () => {
      globalThis.fetch = async () =>
        aMockFetchResponse("", 400) as Response;

      const sdkClient = aMockSdkClient({
        model: "openai/gpt-4",
        provider: {
          openai: { options: { baseURL: "https://api.openai.com/v1", apiKey: "sk-test" } },
        },
      });
      const client = new ProviderChatClient(sdkClient as any);

      await rejects(
        client.createCompletion({
          model: "default",
          messages: [{ role: "user", content: "Hi" }],
        }),
        /400|bad request/i
      );
    });

    it("should throw descriptive error when config is null", async () => {
      const sdkClient = aMockSdkClient(null);
      const client = new ProviderChatClient(sdkClient as any);

      await rejects(
        client.createCompletion({
          model: "default",
          messages: [{ role: "user", content: "Hi" }],
        }),
        /config.*missing|failed to load/i
      );
    });

    it("should throw descriptive error when model is missing", async () => {
      const sdkClient = aMockSdkClient({
        provider: {},
      });
      const client = new ProviderChatClient(sdkClient as any);

      await rejects(
        client.createCompletion({
          model: "default",
          messages: [{ role: "user", content: "Hi" }],
        }),
        /config.*missing|failed to load/i
      );
    });
  });

  describe("config caching", () => {
    it("should only call config.get() once across two createCompletion calls", async () => {
      let callCount = 0;
      const sdkClient = {
        config: {
          get: async () => {
            callCount++;
            return {
              model: "openai/gpt-4",
              provider: {
                openai: { options: { baseURL: "https://api.openai.com/v1", apiKey: "sk-test" } },
              },
            };
          },
        },
      };

      globalThis.fetch = async () => aMockFetchResponse("Hi") as Response;

      const client = new ProviderChatClient(sdkClient as any);

      await client.createCompletion({
        model: "default",
        messages: [{ role: "user", content: "Hi" }],
      });
      await client.createCompletion({
        model: "default",
        messages: [{ role: "user", content: "Hi again" }],
      });

      strictEqual(callCount, 1);
    });
  });
});
