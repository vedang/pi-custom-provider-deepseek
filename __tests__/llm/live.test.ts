import assert from "node:assert/strict";

import type { AssistantMessage, Model } from "@mariozechner/pi-ai";
import { streamSimpleOpenAICompletions } from "@mariozechner/pi-ai";
import { describe, test } from "vitest";

import {
  DEEPSEEK_API_KEY_ENV,
  buildDeepSeekProviderConfig,
  createDeepSeekStreamSimple,
} from "../../src/core";

const apiKey = process.env[DEEPSEEK_API_KEY_ENV];
const PROVIDER_ID = "deepseek-custom";
const EXACT_OK_PROMPT = "Reply with exactly ok";
const TOOL_PROMPT =
  "Call tool emit_result with value ok. Do not answer directly.";
const toolSchema = {
  type: "object",
  properties: {
    value: { type: "string" },
  },
  required: ["value"],
} as never;
const tools = [
  {
    name: "emit_result",
    description: "Emit test result",
    parameters: toolSchema,
  },
];

const providerConfig = buildDeepSeekProviderConfig(
  createDeepSeekStreamSimple((model, context, options) =>
    streamSimpleOpenAICompletions(
      model as Model<"openai-completions">,
      context,
      options,
    ),
  ),
);
const models = providerConfig.models.map((model) => ({
  ...model,
  api: providerConfig.api,
  provider: PROVIDER_ID,
}));
const modelCases = models.map((model) => [model.id, model] as const);

type LiveModel = (typeof models)[number];
type StreamContext = Parameters<typeof providerConfig.streamSimple>[1];
type StreamOptions = NonNullable<
  Parameters<typeof providerConfig.streamSimple>[2]
>;

function userMessage(content: string) {
  return {
    role: "user" as const,
    content,
    timestamp: Date.now(),
  };
}

function toolResultMessage(toolCallId: string, toolName: string) {
  return {
    role: "toolResult" as const,
    toolCallId,
    toolName,
    content: [{ type: "text" as const, text: '{"value":"ok"}' }],
    isError: false,
    timestamp: Date.now(),
  };
}

function textFromMessage(message: AssistantMessage): string {
  return message.content
    .flatMap((content) => (content.type === "text" ? [content.text] : []))
    .join("")
    .trim();
}

async function consumeStream(
  stream: ReturnType<typeof providerConfig.streamSimple>,
) {
  let doneMessage: AssistantMessage | undefined;

  for await (const event of stream) {
    if (event.type === "error") {
      throw new Error(event.error.errorMessage ?? "stream failed");
    }
    if (event.type === "done") {
      doneMessage = event.message;
    }
  }

  assert.ok(doneMessage, "expected stream to finish with a message");
  return doneMessage;
}

async function runModel(
  model: LiveModel,
  context: StreamContext,
  options?: Omit<StreamOptions, "apiKey">,
) {
  return consumeStream(
    providerConfig.streamSimple(model, context, { apiKey, ...options }),
  );
}

describe.skipIf(!apiKey)("DeepSeek live provider catalog", () => {
  test("exposed model set is non-empty", () => {
    assert.notEqual(models.length, 0);
  });

  test.each(modelCases)("%s basic text generation", async (_modelId, model) => {
    const message = await runModel(
      model,
      {
        systemPrompt: "You are terse. Reply with exactly ok.",
        messages: [userMessage(EXACT_OK_PROMPT)],
      },
      { maxTokens: 64 },
    );

    assert.match(textFromMessage(message).toLowerCase(), /ok/);
  });

  test.each(modelCases)("%s tool roundtrip", async (_modelId, model) => {
    const firstMessage = await runModel(
      model,
      {
        systemPrompt: "You are a tool-use test harness.",
        messages: [userMessage(TOOL_PROMPT)],
        tools,
      },
      { maxTokens: 256 },
    );
    const toolCall = firstMessage.content.find(
      (content) => content.type === "toolCall",
    );

    assert.ok(toolCall, `expected ${model.id} to emit a tool call`);

    const secondMessage = await runModel(
      model,
      {
        systemPrompt: "You are a tool-use test harness.",
        messages: [
          userMessage(TOOL_PROMPT),
          firstMessage,
          toolResultMessage(toolCall.id, toolCall.name),
        ],
        tools,
      },
      { maxTokens: 256 },
    );

    assert.notEqual(
      textFromMessage(secondMessage).length,
      0,
      `expected ${model.id} to produce a final text response after tool result`,
    );
  });

  test.each(modelCases)(
    "%s thinking mode can be enabled",
    async (_modelId, model) => {
      const message = await runModel(
        model,
        {
          systemPrompt: "You are terse. Reply with exactly ok.",
          messages: [userMessage("Think briefly, then reply with exactly ok")],
        },
        { reasoning: "high", maxTokens: 256 },
      );

      assert.match(textFromMessage(message).toLowerCase(), /ok/);
    },
  );
});
