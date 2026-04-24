# pi-custom-provider-deepseek

DeepSeek OpenAI-compatible custom provider for Pi.

The provider uses:
- base URL: `https://api.deepseek.com`
- API key env var: `DEEPSEEK_API_KEY`
- Pi API mode: `openai-completions`
- provider id: `deepseek-custom`

## Model catalog

This package exposes the two DeepSeek v4 models requested for Pi agent use.

| Model ID | Display name | Context window | Max output | Thinking |
|---|---|---:|---:|---|
| `deepseek-v4-pro` | `DeepSeek V4 Pro` | 1,000,000 | 384,000 | yes |
| `deepseek-v4-flash` | `DeepSeek V4 Flash` | 1,000,000 | 384,000 | yes |

The context and output limits follow DeepSeek's published v4 model metadata:
- context length: 1M
- max output: 384K

## Thinking mode

DeepSeek v4 defaults to thinking mode. Pi expects thinking to be controlled by Pi's thinking setting, so this provider wraps Pi's OpenAI-compatible stream and adds the DeepSeek request field:

```json
{ "thinking": { "type": "enabled" } }
```

when Pi thinking is selected, and:

```json
{ "thinking": { "type": "disabled" } }
```

when Pi thinking is off.

The provider also maps Pi thinking effort onto DeepSeek's documented OpenAI-format `reasoning_effort` values:
- `minimal`, `low`, `medium` -> `high`
- `high`, `xhigh` -> `max`

## Install

From this package directory:

```bash
bun install
```

Then add this package as a Pi package or extension according to your local Pi setup.

## Usage

```bash
export DEEPSEEK_API_KEY=...
pi --provider deepseek-custom --model deepseek-v4-flash
pi --provider deepseek-custom --model deepseek-v4-pro --thinking high
```

## Development

```bash
make init
make test
make check
make format
```

## Live tests

Live tests are gated by `DEEPSEEK_API_KEY` and live in:
- `__tests__/llm/live.test.ts`

Run them with:

```bash
make test-llm
# or
bun run test:llm
```
