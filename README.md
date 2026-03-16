[English](./README.en.md) | 日本語

# claude-token-saver-mcp

Claude Code のコーディングタスクをローカル LLM (Ollama) にオフロードし、Cloud API のトークン消費を節約する MCP サーバー。

## 仕組み

```
Claude Code  ──MCP──▶  claude-token-saver-mcp  ──HTTP──▶  Ollama (ローカル)
                              │
                              ├─ プロンプトインジェクション検知
                              ├─ 入力バリデーション
                              ├─ 優先度付きキュー制御
                              ├─ 出力サニタイズ
                              ├─ コスト節約計算
                              ├─ Prometheus メトリクス
                              └─ マルチノード分散実行
```

Claude Code が `offload_work` / `compress_context` ツールを呼ぶと、リクエストはローカルの Ollama に転送されます。Cloud API を使わないため、その分のトークンコストが節約されます。

v0.3.0 では**バッチ処理**、**優先度キュー**、**メトリクス**、**データ永続化**、**マルチノード分散実行**、**モデルレジストリ自動更新**を搭載。

## 要件

- Node.js >= 20
- [Ollama](https://ollama.com/) がローカルで起動していること

## インストール

```bash
npm install -g claude-token-saver-mcp
```

または、ソースからビルド:

```bash
git clone https://github.com/pulseagent/claude-token-saver-mcp.git
cd claude-token-saver-mcp
npm ci
npm run build
```

## セットアップ

### 1. Ollama のモデルを取得

マシンの RAM に応じて自動的にモデルが選択されます:

| Tier | RAM | モデル | コンテキスト上限 |
|:---:|:---:|:---|:---:|
| Light | < 16 GB | phi4:latest | 4,000 tokens |
| Standard | 16–48 GB | qwen2.5-coder:7b | 12,000 tokens |
| Ultra | > 48 GB | qwen2.5-coder:32b | 32,000 tokens |

使用するモデルを事前にプルしてください:

```bash
# 例: Standard tier
ollama pull qwen2.5-coder:7b
```

### 2. Claude Code に登録

`~/.claude/claude_desktop_config.json` に追加:

```json
{
  "mcpServers": {
    "token-saver": {
      "command": "claude-token-saver-mcp"
    }
  }
}
```

ソースからビルドした場合:

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

### 3. 起動確認

Claude Code を起動すると、stderr に以下のようなログが出力されます:

```
[claude-token-saver-mcp v0.3.0] Tier 2 (Standard) | Model: qwen2.5-coder:7b | Ollama: connected
```

## 提供ツール

### `offload_work`

コーディングタスクをローカル LLM にオフロード。

```
task:          "TypeScript で配列をソートする関数を書いて"
language:      "typescript"     (オプション)
context:       "// 既存コード..." (オプション)
output_format: "code"           (オプション: code|diff|explanation|raw)
model:         "qwen3:8b"       (オプション: モデル直接指定)
category:      "coding"         (オプション: カテゴリ別自動選択)
```

### `compress_context`

大きなテキストをローカル LLM で要約し、コンテキスト量を削減。

```
content:    "大量のログ出力やファイル内容..."
focus:      "エラーに関する部分"  (オプション)
max_length: 2000                 (オプション: 100-10000)
model:      "qwen3:8b"           (オプション: モデル指定)
```

### `batch_offload` (v0.3.0)

複数タスクを一括でオフロード。順次/並列モードに対応。

```
tasks: [
  {"task": "ソート関数を書いて", "language": "typescript"},
  {"task": "そのユニットテストを書いて", "language": "typescript"}
]
sequential: true   (オプション: true=順次実行で前の結果を次に渡す, false=並列)
```

### `cost_dashboard`

累計コスト節約額とモデル使用統計を表示。

```
(引数なし)
```

### `get_metrics` (v0.3.0)

サーバーメトリクスを Prometheus テキスト形式または JSON で取得。

```
format: "json"       (オプション: json|prometheus)
```

### `recommend_model`

タスクカテゴリに応じた最適モデルを推奨。システムスペックとインストール済みモデルを考慮。

```
category:       "coding"    (必須: coding, coding-agent, japanese-text, japanese-coding, translation, summarization, general)
prefer_quality: true        (オプション: 品質優先=true, 速度優先=false)
```

### `pull_model`

Ollama レジストリからモデルをダウンロード。

```
model: "qwen3:14b"  (必須: ダウンロードするモデル名)
```

### `preload_model`

モデルを VRAM にプリロードし、推論をウォームスタート。

```
model:      "qwen2.5-coder:32b"  (必須: プリロードするモデル名)
keep_alive: "-1"                 (オプション: ロード保持時間。"-1"=永続, "5m", "1h")
```

### `list_loaded_models`

現在 VRAM にロード中のモデル一覧を表示。

```
(引数なし)
```

### `configure_model_selector`

モデルセレクターの設定をランタイムで管理。

```
setting: "blocked_models"   (必須: blocked_models|license_filter|custom_recommendations)
action:  "get"              (必須: get|set|add|remove)
values:  ["model-name"]     (オプション: set/add/remove 用)
```

## Agent Team 連携

CLAUDE.md のロールテーブルに `LLM用途` 列を追加すると、各ロールに最適なモデルを自動推奨できます:

```markdown
| 役割 | 担当 | LLM用途 |
|:---|:---|:---|
| PM | Claude Code | Cloud API |
| Coder | Local LLM | coding |
| Writer | Local LLM | japanese-text |
```

推奨ワークフロー:

1. `recommend_model(category="coding")` で最適モデルを確認
2. `pull_model(model="qwen2.5-coder:32b")` でモデルをダウンロード
3. `preload_model(model="qwen2.5-coder:32b")` で VRAM にプリロード
4. `offload_work(task="...", model="qwen2.5-coder:32b")` でタスク実行

## 設定

環境変数または `~/.config/claude-token-saver/config.json` で設定可能:

### 環境変数

| 変数 | デフォルト | 説明 |
|:---|:---|:---|
| `OLLAMA_BASE_URL` | `http://127.0.0.1:11434` | Ollama の URL |
| `TIER_OVERRIDE` | (自動検出) | Tier を強制指定 (`1`, `2`, `3`) |
| `MODEL_OVERRIDE` | (Tier に応じて自動) | 使用モデルを強制指定 |
| `LOG_LEVEL` | `info` | ログレベル |
| `MODEL_SELECTOR_ENABLED` | `true` | 動的モデルセレクター有効/無効 |
| `MODEL_PREFER_QUALITY` | `false` | 品質優先 (`true`) / 速度優先 (`false`) |
| `MAX_SIMULTANEOUS_MODELS` | `auto` | VRAM同時ロード上限 (`auto` または数値) |
| `PRELOAD_KEEP_ALIVE` | `-1` | プリロード保持時間 (`-1`=永続) |
| `QUEUE_MAX_SIZE` | `10` | キュー最大長 |
| `QUEUE_TIMEOUT_MS` | `60000` | キュータイムアウト (ms) |
| `OLLAMA_TIMEOUT_MS` | (Tier に応じて自動) | Ollama リクエストタイムアウト (ms) |

### 設定ファイル例

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
# ビルド & 起動 (ホストの Ollama に接続)
docker compose up -d
```

Ollama がホストマシンで動いている場合、`host.docker.internal` 経由で自動接続します。

## セキュリティ

- **プロンプトインジェクション防御**: 20 パターン (5 カテゴリ) で入力を検査、悪意あるプロンプトをブロック
- **出力サニタイズ**: API キー、パスワード、JWT 等 11 パターンを `[REDACTED]` に置換
- **入力サイズ制限**: タスク 50,000 文字、コンテキスト 100,000 文字、圧縮コンテンツ 200,000 文字
- **優先度キュー**: 最大 10 件、ペイロード上限 200 KB、タイムアウト 60 秒

## 開発

```bash
npm ci
npm run dev          # 開発モード (tsx watch)
npm test             # テスト実行 (721 テスト)
npm run test:e2e     # E2E テスト (Ollama 必須)
npm run test:coverage # カバレッジ付き
npm run lint         # ESLint
npm run typecheck    # tsc --noEmit
npm run build        # プロダクションビルド
```

## アーキテクチャ

```
src/
├── server.ts              # MCP サーバーエントリポイント (10 ツール登録)
├── config/                # Zod 設定スキーマ & ローダー
├── tiering/               # RAM ベース自動ティアリング (3 段階)
├── ollama/                # Ollama クライアント, モデルマネージャー, ロードバランサー
├── queue/                 # FIFO キュー & 優先度キュー
├── cost/                  # コスト計算 & レポーター
├── tools/                 # 10 MCP ツールハンドラー
├── model-selector/        # レジストリ, 推奨エンジン, VRAM計算, 実行トラッカー, ベンチマークDB, 自動更新
├── metrics/               # Prometheus メトリクス収集
├── persistence/           # ExecutionTracker / BenchmarkStore ファイル永続化
├── logging/               # 構造化ログヘルパー
├── validators/            # 入力バリデーション & PI 防御
└── errors.ts              # CTS-XXXX エラー体系
```

## ライセンス

[Apache License 2.0](./LICENSE)
