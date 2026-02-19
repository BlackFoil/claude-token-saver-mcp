English | [日本語](./README.md)

# claude-token-saver-mcp

An MCP server that offloads Claude Code's coding tasks to a local LLM (Ollama), saving Cloud API token consumption.

## How It Works

```
Claude Code  ──MCP──▶  claude-token-saver-mcp  ──HTTP──▶  Ollama (local)
                              │
                              ├─ Prompt injection detection
                              ├─ Input validation
                              ├─ FIFO queue control
                              ├─ Output sanitization
                              └─ Cost savings calculation
```

When Claude Code calls the `offload_work` / `compress_context` tools, requests are forwarded to local Ollama. Since no Cloud API is used, token costs are saved.

v0.2.0 introduces a **Dynamic Model Selector** that automatically recommends and selects the optimal local model based on task category.

## Requirements

- Node.js >= 20
- [Ollama](https://ollama.com/) running locally

## Installation

```bash
npm install -g claude-token-saver-mcp
```

Or build from source:

```bash
git clone https://github.com/pulseagent/claude-token-saver-mcp.git
cd claude-token-saver-mcp
npm ci
npm run build
```

## Setup

### 1. Pull an Ollama Model

A model is automatically selected based on your machine's RAM:

| Tier | RAM | Model | Context Limit |
|:---:|:---:|:---|:---:|
| Light | < 16 GB | phi4:latest | 4,000 tokens |
| Standard | 16–48 GB | qwen2.5-coder:7b | 12,000 tokens |
| Ultra | > 48 GB | qwen2.5-coder:32b | 32,000 tokens |

Pull the model for your tier in advance:

```bash
# Example: Standard tier
ollama pull qwen2.5-coder:7b
```

### 2. Register with Claude Code

Add to `~/.claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "token-saver": {
      "command": "claude-token-saver-mcp"
    }
  }
}
```

If built from source:

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

### 3. Verify Startup

When Claude Code starts, you should see output like this on stderr:

```
[claude-token-saver-mcp v0.1.0] Tier 2 (Standard) | Model: qwen2.5-coder:7b | Ollama: connected
```

## Available Tools

### `offload_work`

Offload coding tasks to the local LLM.

```
task:          "Write a function to sort an array in TypeScript"
language:      "typescript"     (optional)
context:       "// existing code..." (optional)
output_format: "code"           (optional: code|diff|explanation|raw)
```

### `compress_context`

Summarize large text using the local LLM to reduce context size.

```
content:    "Large log output or file contents..."
focus:      "Parts related to errors"  (optional)
max_length: 2000                       (optional: 100-10000)
model:      "qwen3:8b"                 (optional: specify model)
```

### `recommend_model` (v0.2.0)

Recommend the optimal model based on task category. Takes system specs and installed models into account.

```
category:       "coding"    (required: coding, coding-agent, japanese-text, japanese-coding, translation, summarization, general)
prefer_quality: true        (optional: quality-first=true, speed-first=false)
```

### `pull_model` (v0.2.0)

Download a model from the Ollama registry.

```
model: "qwen3:14b"  (required: model name to download)
```

### `preload_model` (v0.2.0)

Preload a model into VRAM for warm-start inference.

```
model:      "qwen2.5-coder:32b"  (required: model name to preload)
keep_alive: "-1"                 (optional: load retention time. "-1"=permanent, "5m", "1h")
```

### `list_loaded_models` (v0.2.0)

List models currently loaded in VRAM.

```
(no arguments)
```

## Agent Team Integration (v0.2.0)

Add an `LLM Usage` column to the role table in CLAUDE.md to enable automatic model recommendations for each role:

```markdown
| Role | Agent | LLM Usage |
|:---|:---|:---|
| PM | Claude Code | Cloud API |
| Coder | Local LLM | coding |
| Writer | Local LLM | japanese-text |
```

Recommended workflow:

1. `recommend_model(category="coding")` — check the optimal model
2. `pull_model(model="qwen2.5-coder:32b")` — download the model
3. `preload_model(model="qwen2.5-coder:32b")` — preload into VRAM
4. `offload_work(task="...", model="qwen2.5-coder:32b")` — execute the task

## Configuration

Configure via environment variables or `~/.config/claude-token-saver/config.json`:

### Environment Variables

| Variable | Default | Description |
|:---|:---|:---|
| `OLLAMA_BASE_URL` | `http://127.0.0.1:11434` | Ollama URL |
| `TIER_OVERRIDE` | (auto-detect) | Force tier (`1`, `2`, `3`) |
| `MODEL_OVERRIDE` | (auto per tier) | Force model override |
| `LOG_LEVEL` | `info` | Log level |
| `MODEL_SELECTOR_ENABLED` | `true` | Enable/disable Dynamic Model Selector |
| `MODEL_PREFER_QUALITY` | `false` | Quality-first (`true`) / speed-first (`false`) |
| `MAX_SIMULTANEOUS_MODELS` | `auto` | Max simultaneous VRAM models (`auto` or number) |
| `PRELOAD_KEEP_ALIVE` | `-1` | Preload retention time (`-1`=permanent) |

### Configuration File Example

```json
{
  "ollama": {
    "baseUrl": "http://127.0.0.1:11434"
  },
  "tier": {
    "forceLevel": 2,
    "primaryModel": "qwen2.5-coder:7b",
    "contextLimit": 16000
  },
  "queue": {
    "maxQueueLength": 10,
    "rateLimitPerMinute": 30
  },
  "cost": {
    "comparisonModel": "claude-sonnet-4-5"
  },
  "logLevel": "info"
}
```

## Docker

```bash
# Build & start (connects to host Ollama)
docker compose up -d
```

When Ollama is running on the host machine, it auto-connects via `host.docker.internal`.

## Security

- **Prompt Injection Defense**: Inspects input against 20 patterns (5 categories), blocking malicious prompts
- **Output Sanitization**: Replaces API keys, passwords, JWTs, and more (11 patterns) with `[REDACTED]`
- **Input Size Limits**: Task 50,000 chars, context 100,000 chars, compression content 200,000 chars
- **FIFO Queue**: Max 10 items, 200 KB payload limit, 60-second timeout

## Development

```bash
npm ci
npm run dev          # Development mode (tsx watch)
npm test             # Run tests (404+ tests)
npm run test:coverage # With coverage
npm run lint         # ESLint
npm run typecheck    # tsc --noEmit
npm run build        # Production build
```

## Architecture

```
src/
├── server.ts              # MCP server entry point
├── config/                # Config schema & loader
├── tiering/               # RAM-based auto-tiering
├── ollama/                # Ollama client & model manager
├── queue/                 # Promise-based FIFO queue
├── cost/                  # Cost calculation & reporter
├── tools/                 # offload_work / compress_context / recommend_model / preload_model / list_loaded_models / pull_model
├── model-selector/        # Dynamic Model Selector (registry, recommendation engine, VRAM calc, CLAUDE.md parser)
├── validators/            # Input validation & PI defense
└── errors.ts              # CTS-XXXX error system
```

## License

[Apache License 2.0](./LICENSE)
