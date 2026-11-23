# AI Roundtable

Let ChatGPT, Claude, Grok, Gemini, DeepSeek, and any other model on [OpenRouter](https://openrouter.ai) **talk to each other and work on one task together.**

Give it a task. GPT drafts, Claude pushes back, Grok argues the other side, Gemini fills the gaps, and one model writes the final answer. You watch the whole conversation stream live.

It comes in two parts that share one core:

- **Web app**: a local roundtable UI with live streaming, per-turn cost, and saved history.
- **MCP server**: gives Claude Code, Claude Desktop, Cursor, and any other MCP client the tools `ask_model`, `roundtable`, and `list_models`, so your assistant can get a second opinion from another AI partway through a task.

One OpenRouter key reaches every model, so you don't need separate OpenAI, Anthropic, and xAI accounts.

## Modes

| Mode | What happens |
|---|---|
| **parallel** | Every model answers on its own, without seeing the others. Then the synthesizer merges the best parts. Fastest. |
| **discuss** | Models take turns for 1–5 rounds. Each one sees everything said so far, agrees, disagrees, and moves the answer forward. Then they produce a final answer. |
| **pipeline** | The first model writes a draft. Each next model lists the biggest problems and rewrites it. Then the synthesizer polishes it. |

## Quick start

Requires Node.js 22 or newer.

```bash
git clone https://github.com/prakasbhattarai-web/ai-roundtable.git
cd ai-roundtable
npm install
cp .env.example .env        # then paste your key from https://openrouter.ai/keys
npm run web                 # → http://localhost:4747
```

To try it without a key or spending anything, run `AI_BRIDGE_MOCK=1 npm run web`. The models reply with placeholder text, so you can see how it works.

## Use it from Claude Code, Claude Desktop, or Cursor (MCP)

**Claude Code**

```bash
claude mcp add ai-roundtable -- node /full/path/to/ai-roundtable/src/mcp.js
```

**Claude Desktop / Cursor** (`claude_desktop_config.json` / `.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "ai-roundtable": {
      "command": "node",
      "args": ["/full/path/to/ai-roundtable/src/mcp.js"]
    }
  }
}
```

The server reads the key from the project's `.env`. You can also set `OPENROUTER_API_KEY` in the `env` block of the config above.

Then ask your assistant something like:

> *"Ask Grok and Gemini to review this plan and tell me where they disagree."*
> *"Run a roundtable with gpt, claude and deepseek in pipeline mode on this README."*

| Tool | Inputs |
|---|---|
| `ask_model` | `model`, `prompt`, optional `system` |
| `roundtable` | `task`, optional `team`, `mode`, `rounds`, `synthesizer` |
| `list_models` | none |

Sessions run through MCP also appear in the web app's history.

## Choosing models

Edit [`config.json`](config.json) to change the aliases, the default team, who writes the final answer, or the per-turn token limit. In both the UI and the MCP tools you can also use any OpenRouter model id directly, for example `mistralai/mistral-large` or `meta-llama/llama-4-maverick`. See the full list at [openrouter.ai/models](https://openrouter.ai/models).

## Cost

Every turn is a normal paid API call on your OpenRouter account. The UI and the MCP output show the exact cost per turn and per session, using OpenRouter's usage accounting. A 3-model, 2-round discussion with mid-priced models usually costs a few cents. `maxTokensPerTurn` in `config.json` limits how long each reply can be.

## How it works

```
                 ┌──────────────┐
   Web UI ──SSE──┤              │
                 │  roundtable  ├──► OpenRouter ──► GPT / Claude / Grok / Gemini / …
   MCP client ───┤   (core)     │
                 └──────────────┘
```

Each model gets a system prompt that names the other participants and its role for this turn. It also gets the task plus a labelled transcript of everything said so far. This works the same way with every provider, because it only uses plain chat messages. If one model fails (bad id, rate limit), that turn is marked as failed and the rest of the session carries on.

```
src/config.js      loads .env + config.json, resolves model aliases
src/openrouter.js  streaming chat client (+ mock mode)
src/roundtable.js  the three modes and the prompts
src/mcp.js         MCP server (stdio)
src/web.js         local web server + JSON history in runs/
web/index.html     the UI
```

## Security

- The web server binds to `127.0.0.1` only. It spends your credit, so don't expose it to a network without adding authentication.
- `.env` and saved sessions (`runs/*.json`) are git-ignored.

## Contributing

Issues and pull requests are welcome. Run `npm test` before opening a PR. The tests use mock mode and make no API calls.

## License

[Apache 2.0](LICENSE)
