import type {
  Api,
  SimpleStreamOptions,
  StreamFunction,
} from "@mariozechner/pi-ai";

export const DEEPSEEK_BASE_URL = "https://api.deepseek.com";
export const DEEPSEEK_API_KEY_ENV = "DEEPSEEK_API_KEY";
export const DEEPSEEK_STATIC_CONTEXT_WINDOW = 1_000_000;
export const DEEPSEEK_STATIC_MAX_TOKENS = 384_000;

const DEEPSEEK_REASONING_EFFORT_MAP = {
  minimal: "high",
  low: "high",
  medium: "high",
  high: "max",
  xhigh: "max",
};

type DeepSeekStreamSimple = StreamFunction<Api, SimpleStreamOptions>;

type DeepSeekModelTemplate = {
  id: string;
  name: string;
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
};

const SHARED_MODEL_DEFAULTS = {
  reasoning: true,
  input: ["text"] as ["text"],
  contextWindow: DEEPSEEK_STATIC_CONTEXT_WINDOW,
  maxTokens: DEEPSEEK_STATIC_MAX_TOKENS,
  compat: {
    supportsStore: false,
    supportsDeveloperRole: false,
    supportsReasoningEffort: true,
    reasoningEffortMap: DEEPSEEK_REASONING_EFFORT_MAP,
  },
};

export const DEEPSEEK_EXPOSED_MODELS = [
  {
    id: "deepseek-v4-pro",
    name: "DeepSeek V4 Pro",
    cost: {
      input: 1.74,
      output: 3.48,
      cacheRead: 0.145,
      cacheWrite: 1.74,
    },
  },
  {
    id: "deepseek-v4-flash",
    name: "DeepSeek V4 Flash",
    cost: {
      input: 0.14,
      output: 0.28,
      cacheRead: 0.028,
      cacheWrite: 0.14,
    },
  },
] satisfies DeepSeekModelTemplate[];

function materializeDeepSeekModels() {
  return DEEPSEEK_EXPOSED_MODELS.map((model) => ({
    ...SHARED_MODEL_DEFAULTS,
    ...model,
    baseUrl: DEEPSEEK_BASE_URL,
    apiKey: DEEPSEEK_API_KEY_ENV,
  }));
}

export function buildDeepSeekProviderConfig(
  streamSimple: DeepSeekStreamSimple,
) {
  return {
    baseUrl: DEEPSEEK_BASE_URL,
    apiKey: DEEPSEEK_API_KEY_ENV,
    api: "openai-completions" as const,
    streamSimple,
    models: materializeDeepSeekModels(),
  };
}

export function applyDeepSeekThinkingPayload(
  payload: Record<string, unknown>,
  reasoning: SimpleStreamOptions["reasoning"],
): void {
  payload.thinking = { type: reasoning ? "enabled" : "disabled" };
}

export function createDeepSeekStreamSimple(
  baseStreamSimple: DeepSeekStreamSimple,
): DeepSeekStreamSimple {
  return (model, context, options) =>
    baseStreamSimple(model, context, {
      ...options,
      async onPayload(payload, payloadModel) {
        const callerPayload = await options?.onPayload?.(payload, payloadModel);
        const nextPayload = (callerPayload ?? payload) as unknown;

        if (nextPayload && typeof nextPayload === "object") {
          applyDeepSeekThinkingPayload(
            nextPayload as Record<string, unknown>,
            options?.reasoning,
          );
        }

        return nextPayload;
      },
    });
}
