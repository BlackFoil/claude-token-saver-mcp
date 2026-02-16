# claude-token-saver-mcp

Claude Code のコーディングタスクをローカル LLM (Ollama) にオフロードし、Cloud API のトークン消費を節約する MCP サーバー。

## 仕組み

```
Claude Code  ──MCP──▶  claude-token-saver-mcp  ──HTTP──▶  Ollama (ローカル)
                              │
                              ├─ プロンプトインジェクション検知
                              ├─ 入力バリデーション
                              ├─ FIFO キュー制御
                              ├─ 出力サニタイズ
                              └─ コスト節約計算
```

Claude Code が `offload_work` / `compress_context` ツールを呼ぶと、リクエストはローカルの Ollama に転送されます。Cloud API を使わないため、その分のトークンコストが節約されます。

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
[claude-token-saver-mcp v0.1.0] Tier 2 (Standard) | Model: qwen2.5-coder:7b | Ollama: connected
```

## 提供ツール

### `offload_work`

コーディングタスクをローカル LLM にオフロード。

```
task:          "TypeScript で配列をソートする関数を書いて"
language:      "typescript"     (オプション)
context:       "// 既存コード..." (オプション)
output_format: "code"           (オプション: code|diff|explanation|raw)
```

### `compress_context`

大きなテキストをローカル LLM で要約し、コンテキスト量を削減。

```
content:    "大量のログ出力やファイル内容..."
focus:      "エラーに関する部分"  (オプション)
max_length: 2000                 (オプション: 100-10000)
```

## 設定

環境変数または `~/.config/claude-token-saver/config.json` で設定可能:

### 環境変数

| 変数 | デフォルト | 説明 |
|:---|:---|:---|
| `OLLAMA_BASE_URL` | `http://127.0.0.1:11434` | Ollama の URL |
| `TIER_OVERRIDE` | (自動検出) | Tier を強制指定 (`1`, `2`, `3`) |
| `MODEL_OVERRIDE` | (Tier に応じて自動) | 使用モデルを強制指定 |
| `LOG_LEVEL` | `info` | ログレベル |

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
- **FIFO キュー**: 最大 10 件、ペイロード上限 200 KB、タイムアウト 60 秒

## 開発

```bash
npm ci
npm run dev          # 開発モード (tsx watch)
npm test             # テスト実行 (277 テスト)
npm run test:coverage # カバレッジ付き
npm run lint         # ESLint
npm run typecheck    # tsc --noEmit
npm run build        # プロダクションビルド
```

## アーキテクチャ

```
src/
├── server.ts              # MCP サーバーエントリポイント
├── config/                # 設定スキーマ & ローダー
├── tiering/               # RAM ベース自動ティアリング
├── ollama/                # Ollama クライアント & モデルマネージャー
├── queue/                 # Promise-based FIFO キュー
├── cost/                  # コスト計算 & レポーター
├── tools/                 # offload_work / compress_context ハンドラ
├── validators/            # 入力バリデーション & PI 防御
└── errors.ts              # CTS-XXXX エラー体系
```

## ライセンス

[Apache License 2.0](./LICENSE)
