import { type Model, streamSimpleOpenAICompletions } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
  buildDeepSeekProviderConfig,
  createDeepSeekStreamSimple,
} from "./core.js";

export default function deepSeekCustomExtension(pi: ExtensionAPI): void {
  pi.registerProvider(
    "deepseek-custom",
    buildDeepSeekProviderConfig(
      createDeepSeekStreamSimple((model, context, options) =>
        streamSimpleOpenAICompletions(
          model as Model<"openai-completions">,
          context,
          options,
        ),
      ),
    ),
  );
}
