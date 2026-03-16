English | [日本語](./README.md)

# claude-token-saver-mcp

An MCP server that offloads Claude Code's coding tasks to a local LLM (Ollama), saving Cloud API token consumption.

## How It Works

```
Claude Code  ──MCP──▶  claude-token-saver-mcp  ──HTTP──▶  Ollama (local)
                              │
                              ├─ Prompt injection detection
                              ├─ Input validation
                              ├─ Priority queue control
                              ├─ Output sanitization
                              ├─ Cost savings calculation
                              ├─ Prometheus metrics
                              └─ Multi-node distributed execution
```

When Claude Code calls the `offload_work` / `compress_context` tools, requests are forwarded to local Ollama. Since no Cloud API is used, token costs are saved.

v0.3.0 introduces **batch processing**, **priority queue**, **metrics**, **data persistence**, **multi-node distributed execution**, and **model registry auto-update**.

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
[claude-token-saver-mcp v0.3.0] Tier 2 (Standard) | Model: qwen2.5-coder:7b | Ollama: connected
```

## Available Tools

### `offload_work`

Offload coding tasks to the local LLM.

```
task:          "Write a function to sort an array in TypeScript"
language:      "typescript"     (optional)
context:       "// existing code..." (optional)
output_format: "code"           (optional: code|diff|explanation|raw)
model:         "qwen3:8b"       (optional: direct model override)
category:      "coding"         (optional: category-based auto-selection)
```

### `compress_context`

Summarize large text using the local LLM to reduce context size.

```
content:    "Large log output or file contents..."
focus:      "Parts related to errors"  (optional)
max_length: 2000                       (optional: 100-10000)
model:      "qwen3:8b"                 (optional: specify model)
```

### `batch_offload` (v0.3.0)

Submit multiple tasks as a batch. Supports sequential and parallel modes.

```
tasks: [
  {"task": "Write a sort function", "language": "typescript"},
  {"task": "Write unit tests for it", "language": "typescript"}
]
sequential: true   (optional: true=sequential with previous result as context, false=parallel)
```

### `cost_dashboard`

View cumulative cost savings and model usage statistics.

```
(no arguments)
```

### `get_metrics` (v0.3.0)

Get server metrics in Prometheus text format or JSON.

```
format: "json"       (optional: json|prometheus)
```

### `recommend_model`

Recommend the optimal model based on task category. Takes system specs and installed models into account.

```
category:       "coding"    (required: coding, coding-agent, japanese-text, japanese-coding, translation, summarization, general)
prefer_quality: true        (optional: quality-first=true, speed-first=false)
```

### `pull_model`

Download a model from the Ollama registry.

```
model: "qwen3:14b"  (required: model name to download)
```

### `preload_model`

Preload a model into VRAM for warm-start inference.

```
model:      "qwen2.5-coder:32b"  (required: model name to preload)
keep_alive: "-1"                 (optional: load retention time. "-1"=permanent, "5m", "1h")
```

### `list_loaded_models`

List models currently loaded in VRAM.

```
(no arguments)
```

### `configure_model_selector`

Manage model selector settings at runtime.

```
setting: "blocked_models"   (required: blocked_models|license_filter|custom_recommendations)
action:  "get"              (required: get|set|add|remove)
values:  ["model-name"]     (optional: for set/add/remove)
```

### `auto_setup`

Recommend, download, and preload the best model in one step.

```
category:       "coding"  (optional, default: "general")
prefer_quality: false     (optional: quality priority)
skip_pull:      false     (optional: skip download)
skip_preload:   false     (optional: skip VRAM preload)
```

## Agent Team Integration

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
| `QUEUE_MAX_SIZE` | `10` | Max queue length |
| `QUEUE_TIMEOUT_MS` | `60000` | Queue timeout (ms) |
| `OLLAMA_TIMEOUT_MS` | (auto per tier) | Ollama request timeout (ms) |

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
  "persistence": {
    "enabled": true,
    "autoSaveIntervalMs": 300000
  },
  "registryUpdater": {
    "enabled": true,
    "updateIntervalMs": 1800000
  },
  "distributed": {
    "enabled": false,
    "nodes": [
      {"id": "node1", "baseUrl": "http://192.168.1.10:11434"},
      {"id": "node2", "baseUrl": "http://192.168.1.11:11434"}
    ],
    "strategy": "model-affinity"
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
- **Priority Queue**: Max 10 items, 200 KB payload limit, 60-second timeout

## Development

```bash
npm ci
npm run dev          # Development mode (tsx watch)
npm test             # Run tests (736 tests)
npm run test:e2e     # E2E tests (requires Ollama)
npm run test:coverage # With coverage
npm run lint         # ESLint
npm run typecheck    # tsc --noEmit
npm run build        # Production build
```

## Architecture

```
src/
├── server.ts              # MCP server entry point (11 tools registered)
├── config/                # Zod config schema & loader
├── tiering/               # RAM-based auto-tiering (3 levels)
├── ollama/                # Ollama client, model manager, load balancer
├── queue/                 # FIFO queue & priority queue
├── cost/                  # Cost calculation & reporter
├── tools/                 # 11 MCP tool handlers
├── model-selector/        # Registry, recommendation engine, VRAM calc, execution tracker, benchmark DB, auto-updater
├── metrics/               # Prometheus metrics collector
├── persistence/           # ExecutionTracker / BenchmarkStore file persistence
├── logging/               # Structured logging helpers
├── validators/            # Input validation & PI defense
└── errors.ts              # CTS-XXXX error system
```

## License

[Apache License 2.0](./LICENSE)
