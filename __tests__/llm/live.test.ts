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
  provider: "deepseek-custom",
  apiKey: apiKey ?? model.apiKey,
}));
const modelCases = models.map((model) => [model.id, model] as const);

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

describe.skipIf(!apiKey)("DeepSeek live provider catalog", () => {
  test("exposed model set is non-empty", () => {
    assert.notEqual(models.length, 0);
  });

  test.each(modelCases)("%s basic text generation", async (_modelId, model) => {
    const message = await consumeStream(
      providerConfig.streamSimple(
        model,
        {
          systemPrompt: "You are terse. Reply with exactly ok.",
          messages: [userMessage("Reply with exactly ok")],
        },
        {
          apiKey,
          maxTokens: 64,
        },
      ),
    );

    assert.match(textFromMessage(message).toLowerCase(), /ok/);
  });

  test.each(modelCases)("%s tool roundtrip", async (_modelId, model) => {
    const prompt =
      "Call tool emit_result with value ok. Do not answer directly.";
    const firstMessage = await consumeStream(
      providerConfig.streamSimple(
        model,
        {
          systemPrompt: "You are a tool-use test harness.",
          messages: [userMessage(prompt)],
          tools,
        },
        {
          apiKey,
          maxTokens: 256,
        },
      ),
    );
    const toolCall = firstMessage.content.find(
      (content) => content.type === "toolCall",
    );

    assert.ok(toolCall, `expected ${model.id} to emit a tool call`);

    const secondMessage = await consumeStream(
      providerConfig.streamSimple(
        model,
        {
          systemPrompt: "You are a tool-use test harness.",
          messages: [
            userMessage(prompt),
            firstMessage,
            toolResultMessage(toolCall.id, toolCall.name),
          ],
          tools,
        },
        {
          apiKey,
          maxTokens: 256,
        },
      ),
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
      const message = await consumeStream(
        providerConfig.streamSimple(
          model,
          {
            systemPrompt: "You are terse. Reply with exactly ok.",
            messages: [
              userMessage("Think briefly, then reply with exactly ok"),
            ],
          },
          {
            apiKey,
            reasoning: "high",
            maxTokens: 256,
          },
        ),
      );

      assert.match(textFromMessage(message).toLowerCase(), /ok/);
    },
  );
});
