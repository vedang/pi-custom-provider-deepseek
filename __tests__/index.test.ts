import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { test } from "vitest";

import {
  DEEPSEEK_API_KEY_ENV,
  DEEPSEEK_BASE_URL,
  DEEPSEEK_EXPOSED_MODELS,
  DEEPSEEK_STATIC_CONTEXT_WINDOW,
  DEEPSEEK_STATIC_MAX_TOKENS,
  applyDeepSeekThinkingPayload,
  buildDeepSeekProviderConfig,
  createDeepSeekStreamSimple,
} from "../src/core";

const indexPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "src",
  "index.ts",
);

const noopStream = (() => ({}) as never) as never;
const EXPECTED_MODEL_IDS = ["deepseek-v4-pro", "deepseek-v4-flash"];

function buildConfig() {
  return buildDeepSeekProviderConfig(noopStream);
}

function createTestModel(id = "deepseek-v4-flash") {
  return {
    id,
    name: `Test model ${id}`,
    provider: "deepseek-custom",
    api: "openai-completions",
    baseUrl: "https://example.invalid",
    apiKey: "placeholder-key",
    reasoning: true,
    input: ["text"] as Array<"text" | "image">,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1,
    maxTokens: 1,
    compat: {
      supportsStore: false,
      supportsDeveloperRole: false,
      supportsReasoningEffort: true,
    },
  };
}

function createCapturedInvocationRecorder() {
  let capturedOptions: Record<string, unknown> | undefined;

  return {
    baseStream(
      _model: unknown,
      _context: unknown,
      options?: Record<string, unknown>,
    ) {
      capturedOptions = options;
      return {
        push() {},
        end() {},
      } as never;
    },
    getCapturedOptions() {
      return capturedOptions;
    },
  };
}

async function invokeCapturedOnPayload(
  capturedOptions: Record<string, unknown> | undefined,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const result = await (
    capturedOptions?.onPayload as
      | ((payload: unknown, model?: unknown) => Promise<unknown> | unknown)
      | undefined
  )?.(payload, createTestModel());

  return (result ?? payload) as Record<string, unknown>;
}

test("index extension registers deepseek-custom provider", () => {
  const source = readFileSync(indexPath, "utf-8");
  assert.match(source, /registerProvider\([\s\S]*"deepseek-custom"/);
});

test("buildDeepSeekProviderConfig returns DeepSeek OpenAI-compatible catalog", () => {
  const config = buildConfig();

  assert.equal(config.api, "openai-completions");
  assert.equal(config.baseUrl, DEEPSEEK_BASE_URL);
  assert.equal(config.apiKey, DEEPSEEK_API_KEY_ENV);
  assert.deepEqual(
    config.models.map((model) => model.id),
    EXPECTED_MODEL_IDS,
  );
});

test("exposed model templates match requested catalog ids", () => {
  assert.deepEqual(
    DEEPSEEK_EXPOSED_MODELS.map((model) => model.id),
    EXPECTED_MODEL_IDS,
  );
});

test("curated models expose 1M context and DeepSeek v4 metadata", () => {
  const config = buildConfig();

  for (const model of config.models) {
    assert.equal(model.reasoning, true);
    assert.deepEqual(model.input, ["text"]);
    assert.equal(model.contextWindow, DEEPSEEK_STATIC_CONTEXT_WINDOW);
    assert.equal(model.maxTokens, DEEPSEEK_STATIC_MAX_TOKENS);
    assert.equal(model.compat.supportsStore, false);
    assert.equal(model.compat.supportsDeveloperRole, false);
    assert.equal(model.compat.supportsReasoningEffort, true);
  }
});

test("applyDeepSeekThinkingPayload disables thinking when Pi thinking is off", () => {
  const payload: Record<string, unknown> = {};

  applyDeepSeekThinkingPayload(payload, undefined);

  assert.deepEqual(payload.thinking, { type: "disabled" });
});

test("applyDeepSeekThinkingPayload enables thinking when Pi thinking is selected", () => {
  const payload: Record<string, unknown> = {};

  applyDeepSeekThinkingPayload(payload, "high");

  assert.deepEqual(payload.thinking, { type: "enabled" });
});

test("applyDeepSeekThinkingPayload backfills empty reasoning content for thinking replay", () => {
  const payload: Record<string, unknown> = {
    messages: [
      { role: "user", content: "hi" },
      { role: "assistant", content: "ok" },
      { role: "assistant", content: "ok", reasoning_content: "kept" },
      { role: "tool", content: "done", tool_call_id: "call_1" },
    ],
  };

  applyDeepSeekThinkingPayload(payload, "high");

  assert.deepEqual(payload.messages, [
    { role: "user", content: "hi" },
    { role: "assistant", content: "ok", reasoning_content: "" },
    { role: "assistant", content: "ok", reasoning_content: "kept" },
    { role: "tool", content: "done", tool_call_id: "call_1" },
  ]);
});

test("createDeepSeekStreamSimple preserves caller payload replacement and applies thinking toggle", async () => {
  const recorder = createCapturedInvocationRecorder();
  const streamSimple = createDeepSeekStreamSimple(recorder.baseStream as never);

  streamSimple(
    createTestModel(),
    { messages: [] },
    {
      reasoning: "high",
      onPayload() {
        return { fromCaller: true };
      },
    },
  );

  const payload = await invokeCapturedOnPayload(recorder.getCapturedOptions(), {
    original: true,
  });

  assert.equal(payload.fromCaller, true);
  assert.equal(payload.original, undefined);
  assert.deepEqual(payload.thinking, { type: "enabled" });
});
