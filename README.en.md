English | [日本語](./README.md)

[![CI](https://github.com/hiko99/claude-token-saver-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/hiko99/claude-token-saver-mcp/actions) [![npm](https://img.shields.io/npm/v/claude-token-saver-mcp)](https://www.npmjs.com/package/claude-token-saver-mcp) [![Coverage](https://img.shields.io/badge/coverage-97%25-brightgreen)](https://github.com/hiko99/claude-token-saver-mcp/actions) [![License](https://img.shields.io/badge/license-Apache--2.0-blue)](./LICENSE)

# claude-token-saver-mcp

> **Status: Beta** — Suitable for individual use. 736 tests / 97% coverage.

**Run Claude Code's routine tasks on a local LLM, reducing API token costs to zero.**

Code generation, refactoring, test creation, text summarization — all processed on your local [Ollama](https://ollama.com/) instead of the Cloud API. Security built in.

<!-- Demo GIF: Record the following and embed here -->
<!-- Claude Code "Write a sort function" → offload_work runs → code generated → cost_dashboard shows savings -->
<!-- Recommended: 800x450px, 15-20s, asciinema or vhs -->

## Why I Built This

After analyzing Claude Code API usage, I found that **~40% of requests were routine code generation and text processing** — tasks a local 7B model handles well. "Complex reasoning on Cloud, routine work on Local" — this tool automates that split.

## Vision

Local LLM performance is improving rapidly. From Llama 3 in 2024 to Qwen3 in 2025, the industry-standard code generation test ([HumanEval](https://arxiv.org/abs/2107.03374)) jumped from **60% to 85%** in just one year.

At this pace, local LLMs will soon become a standard part of Agent Teams. claude-token-saver-mcp provides a **"Cloud × Local hybrid execution platform"** ahead of that future.

## How It Works

[MCP (Model Context Protocol)](https://modelcontextprotocol.io/) is the standard protocol for Claude Code to call external tools. Once registered, Claude Code **evaluates each task and automatically delegates routine work to your local LLM**.

```text
Claude Code ──MCP──▶ token-saver ──HTTP──▶ Ollama (your PC)
     │                                         │
     │  "This is a routine task. Delegate it."  │
     │                                         │
     └─── Complex reasoning stays on Cloud ────┘
```

If Ollama is down or slow, tasks automatically fall back to the Cloud API. No service interruption.

## 30-Second Setup

**Prerequisites:** [Node.js 20+](https://nodejs.org/) and [Ollama](https://ollama.com/) installed.
Ollama is a tool for running AI models locally on your machine.

**0.** Start Ollama:

```bash
ollama serve
```

### Claude Code (CLI)

**1.** Create `.mcp.json` in your project root:

```json
{
  "mcpServers": {
    "token-saver": { "command": "npx", "args": ["-y", "claude-token-saver-mcp"] }
  }
}
```

**2.** Launch Claude Code and ask:

```text
Set up a local LLM for coding tasks
```

The best model for your RAM is automatically recommended, downloaded (~4GB), and preloaded.

**3.** Verify — ask Claude Code:

```text
Write a TypeScript function to shuffle an array
```

If the response footer shows `Model: qwen2.5-coder:7b | Savings: $0.02`, it's working.
If not, run `ollama list` to check your models, then see [Troubleshooting](./docs/user/troubleshooting.md).

### Claude Desktop

**1.** Add to `~/.claude/claude_desktop_config.json` (create the file if it doesn't exist):

```json
{
  "mcpServers": {
    "token-saver": { "command": "npx", "args": ["-y", "claude-token-saver-mcp"] }
  }
}
```

**2.** Restart Claude Desktop and ask:

```text
Set up a local LLM for coding tasks
```

**3.** Verification is the same as the CLI version above.

<!-- TODO: Screenshot of setup completion here -->
<!-- Content: Claude Code running offload_work, response footer showing Model / Tokens / Savings -->
<!-- Recommended: 800x400px, terminal screenshot -->

<details>
<summary>Building from source</summary>

```bash
git clone https://github.com/hiko99/claude-token-saver-mcp.git
cd claude-token-saver-mcp
npm ci && npm run build
```

Add to `.mcp.json` (CLI) or `claude_desktop_config.json` (Desktop):

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

## Highlights

- **Zero-cost execution** — Routine tasks processed locally. No Cloud API usage
- **Auto model selection** — Detects RAM and auto-recommends, downloads, and preloads the best model (`auto_setup`)
- **Security built in** — Prompt injection defense + output sanitization. A protection layer missing from other local LLM tools
- **Cost visibility** — Track savings in real time. Expect to **save $50–80/month** on a $200 plan *(based on ~40% routine task ratio)*
- **Fallback** — If Ollama is down, tasks automatically fall back to Cloud. No interruption

## How It Looks

```text
You: "Write a sort function"       → offload_work generates locally  💰 $0.02 saved
You: "Summarize this log"          → compress_context compresses     💰 $0.05 saved
You: "Show me cost savings"        → cost_dashboard: $47.89 total saved
You: "Implement 3 APIs at once"    → batch_offload: 3 tasks sequential
```

## Quality & Tradeoffs

Honestly, a local 7B model doesn't match Claude's quality. But for routine work:

| Task | Local Quality | Suited? |
|:---|:---:|:---:|
| Boilerplate code generation | ★★★★☆ | ✅ |
| Unit test creation | ★★★★☆ | ✅ |
| Text summarization | ★★★★☆ | ✅ |
| Simple refactoring | ★★★☆☆ | ✅ |
| Architecture design | ★★☆☆☆ | ❌ Use Cloud |
| Complex debugging | ★★☆☆☆ | ❌ Use Cloud |

Claude Code judges task complexity and routes accordingly. If local quality is insufficient, Cloud handles it.

## Auto Tiering

| RAM | Tier | Model | Download |
|:---:|:---:|:---|:---:|
| < 16 GB | Light | phi4:latest | ~2.5 GB |
| 16–48 GB | Standard | qwen2.5-coder:7b | ~4.7 GB |
| > 48 GB | Ultra | qwen2.5-coder:32b | ~18 GB |

## Tools

| Tool | Description |
|:---|:---|
| `offload_work` | Run code generation and refactoring locally |
| `compress_context` | Summarize large text locally |
| `auto_setup` | One-step model recommend → download → preload |
| `batch_offload` | Submit multiple tasks at once (sequential/parallel) |
| `cost_dashboard` | Cumulative savings and model usage stats |

<details>
<summary>More tools (6)</summary>

| Tool | Description |
|:---|:---|
| `get_metrics` | Server metrics (JSON / Prometheus) |
| `recommend_model` | Best model recommendation by task category |
| `pull_model` | Download Ollama models |
| `preload_model` | Preload models into VRAM |
| `list_loaded_models` | List currently loaded models |
| `configure_model_selector` | Runtime selector configuration |

</details>

## Security

All input/output to the local LLM is automatically protected:

- **Prompt injection defense**: 5 categories, 20 patterns block malicious input
- **Output sanitization**: API keys, passwords, JWTs (11 patterns) → `[REDACTED]`
- **Data privacy**: All processing stays local. Nothing sent externally

## Documentation

| | |
|:---|:---|
| [Quick Start](./docs/user/quickstart.md) | Get started in 5 minutes |
| [Use Cases](./docs/user/use-cases.md) | Practical examples |
| [Configuration](./docs/user/configuration.md) | All settings |
| [FAQ](./docs/user/faq.md) | Common questions |
| [Troubleshooting](./docs/user/troubleshooting.md) | Error resolution |

## Architecture

```text
src/
├── server.ts          # MCP entry point (11 tools registered)
├── tools/             # offload_work, compress_context, auto_setup, batch_offload, etc.
├── ollama/            # Ollama client & multi-node load balancer
├── queue/             # FIFO queue & priority queue (URGENT/HIGH/NORMAL/LOW)
├── model-selector/    # Model recommendation engine, benchmark DB, execution tracker
├── validators/        # Input validation & prompt injection defense
├── cost/              # Cost calculation & reporter
├── metrics/           # Prometheus metrics collector
├── persistence/       # ExecutionTracker / BenchmarkStore file persistence
├── config/            # Zod config schema & loader
├── tiering/           # RAM-based auto tiering
├── logging/           # Structured logging helpers
└── errors.ts          # CTS-XXXX error system
```

## Development

```bash
npm ci
npm test             # 736 tests (97% coverage)
npm run typecheck    # Type checking
npm run lint         # ESLint
npm run build        # Production build
```

**Platforms:** macOS, Linux, Windows (wherever Ollama runs)

Contributions welcome. → [CONTRIBUTING.md](./CONTRIBUTING.md)

## License

[Apache License 2.0](./LICENSE)
