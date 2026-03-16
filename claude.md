# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

```bash
npm ci                  # Install dependencies
npm run build           # Production build (tsup → dist/server.js)
npm run dev             # Dev mode with hot reload (tsx watch)
npm run typecheck       # TypeScript strict check (tsc --noEmit)
npm run lint            # ESLint (src/ + tests/)
npm run lint:fix        # ESLint autofix
npm run format:check    # Prettier check (CI uses this)

# Tests
npm test                # All unit/security/integration tests (vitest)
npm run test:e2e        # E2E tests (requires running Ollama)
npm run test:coverage   # Coverage report (thresholds: 80%)
npx vitest run tests/unit/queue.test.ts          # Single test file
npx vitest run -t "Q-12"                         # Single test by name
```

## Architecture

MCP server that offloads Claude Code tasks to local Ollama, saving cloud API tokens.

```
Claude Code ──MCP/stdio──▶ server.ts ──HTTP──▶ Ollama (local LLM)
```

### Core Pipeline (server.ts bootstrap order)

1. **Config** (`config/schema.ts` + `config/index.ts`) — Zod-validated. Layering: schema defaults → `~/.config/claude-token-saver/config.json` → env vars → runtime updates
2. **Tiering** (`tiering/detector.ts`) — Auto-detects Tier 1/2/3 from `os.totalmem()`. Controls model, context limits (4K/12K/32K), and timeouts
3. **OllamaClient** (`ollama/client.ts`) — NDJSON streaming with 3-tier timeout (request/firstToken/heartbeat). Periodic health checks every 60s
4. **Queue** (`queue/fifo-queue.ts`, `queue/priority-queue.ts`) — Promise-based, concurrency=1. Priority levels: URGENT/HIGH/NORMAL/LOW
5. **Tools** (`tools/*.ts`) — 11 MCP tools. Each handler receives a typed context object, validates with Zod, returns `CallToolResult`

### Tier System

| Tier | RAM | Default Model | Context |
|:---:|:---:|:---|:---:|
| 1 (Light) | <16GB | phi4:latest | 4K |
| 2 (Standard) | 16-48GB | qwen2.5-coder:7b | 12K |
| 3 (Ultra) | >48GB | qwen2.5-coder:32b | 32K |

### Model Selector (`model-selector/`)

Registry: `category × tier → prioritized model list`. 7 categories (coding, coding-agent, japanese-text, japanese-coding, translation, summarization, general). Recommender flow: registry lookup → quality/speed sort → installed-first → license filter → blocked filter → VRAM constraint. ExecutionTracker records model performance in a circular buffer (max 1000). BenchmarkStore holds static benchmark scores (humanEval, sweBench, japaneseMTBench).

### Error System (`errors.ts`)

All domain errors extend `CTSError` with `code` (CTS-1xxx–6xxx), `retryable`, and `fallbackToCloud`. Tool handlers convert via `ctsErrorToCallToolResult()`.
- 1xxx: Ollama connection — 2xxx: Timeouts — 3xxx: Model not found — 4xxx: Queue — 5xxx: Input/PI — 6xxx: Config

### Security (`validators/`)

- **Prompt injection**: 5-category detection (direct override, role injection, prompt leak, encoding evasion, role switch)
- **Output sanitization**: 11 patterns (API keys, tokens, passwords, PEM, JWTs, connection strings) → `[REDACTED]`
- **Input limits**: task 50K chars, context 100K, compress content 200K

### Distributed (`ollama/load-balancer.ts`)

Multi-node Ollama with 3 strategies (round-robin, least-connections, model-affinity) and automatic failover. Enabled via `distributed` config section.

## Key Conventions

- **stdout is MCP protocol only** — all logging to stderr via pino structured JSON
- **Tool handler pattern**: health check → validate → PI check → resolve model → enqueue → cost calc → sanitize output → return
- **Fallback to cloud**: when Ollama is unavailable or queue full, return `[FALLBACK_TO_CLOUD]` so Claude processes the task directly
- **Persistence**: cost history uses atomic write (temp + rename). Execution/benchmark data auto-saved every 5 min to `~/.config/claude-token-saver/`
- **アウトプットは日本語** per project convention

## Team Structure

| 役割 | 担当 | 責務 |
|:---|:---|:---|
| PM / Coder 1 | Claude Code (Leader) | 全体進捗管理、タスク分割、コード統合 |
| Coder 2 / Tester / Security | Codex CLI | アルゴリズム実装、テスト、脆弱性診断 |
| Planner / Architect / Governance | Gemini CLI | 企画、設計、特許調査 |

### SSOT (唯一の真実)

- `docs/design/` — 設計書 (mcp-server, security, infrastructure, dynamic-model-selector等)
- `docs/decisions.md` — 意思決定ログ
- `tasks/todo.md` — タスクステータス (PMが管理)
- `docs/planning/` — 調査・ガバナンスレポート

### 開発フロー

Phase 1 (企画・調査) → Phase 2 (基本設計) → Phase 3 (詳細設計・タスク化) → Phase 4 (コーディング・レビュー) → Phase 5 (テスト・検証)

重要な意思決定は強制評議会プロセス: 提言 → 多角レビュー (Governance/Architect/Security/Tester) → 合意形成 → `docs/decisions.md` に記録。
