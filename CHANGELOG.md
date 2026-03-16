# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] - 2026-03-16

### Added

- npm公開ワークフロー (`publish.yml`) — provenance付き自動publish
- `.env.example` 更新 — v0.2.0+の全環境変数を網羅
- `.npmrc` 作成 — registry/access/provenance設定
- `.prettierrc` 明示化 — `endOfLine: "lf"` 追加
- Prometheusメトリクスエクスポート — `MetricsCollector` + `get_metrics` MCPツール
- ExecutionTracker / BenchmarkStore ファイル永続化 — `PersistenceManager` (自動保存5分間隔)
- 構造化ログヘルパー — `createToolLogContext`, `createRequestId`
- バッチタスクサブミッション — `batch_offload` MCPツール (1-10タスク, 順次/並列)
- 優先度付きキュー — `PriorityQueue` (URGENT/HIGH/NORMAL/LOW)
- モデルレジストリ自動更新 — `RegistryUpdater` (9パターン自動分類)
- 分散実行 — `OllamaLoadBalancer` (round-robin/least-connections/model-affinity + フェイルオーバー)
- `auto_setup` MCPツール — ワンステップでモデル推奨→DL→プリロード (15テスト)
- Config Schema拡張: `distributed` / `persistence` / `registryUpdater` セクション

### Changed

- テスト: 592 → 736 (+144テスト, 39ファイル)
- MCPツール: 8 → 11
- lint / typecheck / build 全パス

## [0.2.0] - 2026-02-19

### Added

- Dynamic Model Selector with 7 task categories × 3 performance tiers
- `recommend_model` MCP tool — AI-powered model recommendations based on system specs
- `preload_model` MCP tool — VRAM warm-start for faster inference
- `list_loaded_models` MCP tool — VRAM usage monitoring
- `pull_model` MCP tool — Ollama registry downloads
- `configure_model_selector` MCP tool — runtime settings management
- `cost_dashboard` MCP tool — cost savings visualization
- Model/category parameters for `offload_work` and `compress_context`
- CLAUDE.md role table parser for team-based model assignment
- Benchmark data management with JSON persistence
- Execution history tracker with circular buffer (1000 records)
- Quantization variant auto-selection (Q4_K_M/Q5_K_M/Q8_0)
- Custom recommendation table overrides via config
- Periodic Ollama health check (60s interval)
- English README (README.en.md)

### Changed

- Version bump from 0.1.0 to 0.2.0
- Enhanced recommendation engine with benchmark enrichment and performance-based reranking

## [0.1.0] - 2026-02-15

### Added

- Initial MCP server with stdio transport
- `offload_work` tool — delegate coding tasks to local Ollama LLM
- `compress_context` tool — summarize large text via local LLM
- RAM-based 3-tier auto-detection (Light/Standard/Ultra)
- Prompt injection defense (20 patterns across 5 categories)
- Output sanitization (11 patterns — API keys, passwords, JWTs)
- FIFO queue with rate limiting (max 10 concurrent, 200KB payload limit)
- Cost calculation engine with Claude API pricing comparison
- Docker Compose support
- CI/CD pipeline (GitHub Actions — Node 20/22 matrix)
- 277 automated tests (unit/security/integration)
- Apache 2.0 license
