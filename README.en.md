English | [日本語](./README.md)

[![CI](https://github.com/pulseagent/claude-token-saver-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/pulseagent/claude-token-saver-mcp/actions) [![npm](https://img.shields.io/npm/v/claude-token-saver-mcp)](https://www.npmjs.com/package/claude-token-saver-mcp) [![Coverage](https://img.shields.io/badge/coverage-97%25-brightgreen)]() [![License](https://img.shields.io/badge/license-Apache--2.0-blue)](./LICENSE)

# claude-token-saver-mcp

**Run Claude Code's routine tasks on a local LLM, reducing API token costs to zero.**

Code generation, refactoring, test creation, text summarization — all processed on your local Ollama instead of the Cloud API. Security built in.

```json
{
  "mcpServers": {
    "token-saver": { "command": "npx", "args": ["-y", "claude-token-saver-mcp"] }
  }
}
```

## Highlights

- **Zero-cost execution** — Routine tasks processed locally. No Cloud API usage
- **Auto model selection** — Detects RAM and auto-recommends, downloads, and preloads the best model (`auto_setup`)
- **Security built in** — PI defense (20 patterns) + output sanitization (11 patterns). A protection layer missing from other local LLM tools
- **Cost visibility** — Track savings in real time (`cost_dashboard`)
- **Batch processing** — Submit multiple tasks at once, sequential or parallel
- **Distributed execution** — Load balancing across multiple Ollama nodes (advanced)

## Auto Tiering

| RAM | Tier | Model | Context |
|:---:|:---:|:---|:---:|
| < 16 GB | Light | phi4:latest | 4,000 |
| 16–48 GB | Standard | qwen2.5-coder:7b | 12,000 |
| > 48 GB | Ultra | qwen2.5-coder:32b | 32,000 |

## How It Works

```
You: "Write a sort function"    → offload_work generates it locally
You: "Summarize this log"       → compress_context compresses locally
You: "Show me cost savings"     → cost_dashboard: $47.89 saved
```

## Requirements

- Node.js >= 20
- [Ollama](https://ollama.com/)

## Setup

### 1. Start Ollama

```bash
# No manual model pull needed — auto_setup handles it
ollama serve
```

### 2. Register with Claude Code

Add to `~/.claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "token-saver": { "command": "npx", "args": ["-y", "claude-token-saver-mcp"] }
  }
}
```

<details>
<summary>Building from source</summary>

```bash
git clone https://github.com/pulseagent/claude-token-saver-mcp.git
cd claude-token-saver-mcp
npm ci && npm run build
```

```json
{
  "mcpServers": {
    "token-saver": {
      "command": "node",
      "args": ["/path/to/claude-token-saver-mcp/dist/server.js"]
    }
  }
}
```

</details>

### 3. Auto-setup a model

In Claude Code:

```
Set up a local LLM for coding tasks
```

The best model for your RAM is automatically recommended, downloaded, and preloaded.

## Tools

| Tool | Description |
|:---|:---|
| `offload_work` | Run code generation and refactoring locally |
| `compress_context` | Summarize large text locally |
| `auto_setup` | One-step model recommend → download → preload |
| `batch_offload` | Submit multiple tasks at once (sequential/parallel) |
| `cost_dashboard` | Cumulative savings and model usage stats |
| `get_metrics` | Server metrics (JSON / Prometheus) |
| `recommend_model` | Best model recommendation by task category |
| `pull_model` | Download Ollama models |
| `preload_model` | Preload models into VRAM |
| `list_loaded_models` | List currently loaded models |
| `configure_model_selector` | Runtime selector configuration |

## Configuration

Configure via environment variables or `~/.config/claude-token-saver/config.json`.

→ **[Configuration Reference](./docs/user/configuration.md)**

<details>
<summary>Key environment variables</summary>

| Variable | Default | Description |
|:---|:---|:---|
| `OLLAMA_BASE_URL` | `http://127.0.0.1:11434` | Ollama URL |
| `TIER_OVERRIDE` | (auto-detect) | Force tier (`1`/`2`/`3`) |
| `MODEL_OVERRIDE` | (auto) | Force model override |
| `LOG_LEVEL` | `info` | Log level |

</details>

## Security

- **Prompt injection defense**: 5 categories, 20 patterns inspect all input
- **Output sanitization**: API keys, passwords, JWTs, and more (11 patterns) replaced with `[REDACTED]`
- **Input size limits**: Task 50K / context 100K / compression 200K chars

## Documentation

| | |
|:---|:---|
| [Quick Start](./docs/user/quickstart.md) | Get started in 5 minutes |
| [Use Cases](./docs/user/use-cases.md) | Practical examples |
| [Configuration](./docs/user/configuration.md) | All settings |
| [FAQ](./docs/user/faq.md) | Common questions |
| [Troubleshooting](./docs/user/troubleshooting.md) | Error resolution |

## Development

```bash
npm ci
npm test             # 736 tests
npm run test:e2e     # E2E (requires Ollama)
npm run build        # Production build
```

## License

[Apache License 2.0](./LICENSE)
