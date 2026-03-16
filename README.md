[English](./README.en.md) | 日本語

[![CI](https://github.com/pulseagent/claude-token-saver-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/pulseagent/claude-token-saver-mcp/actions) [![npm](https://img.shields.io/npm/v/claude-token-saver-mcp)](https://www.npmjs.com/package/claude-token-saver-mcp) [![Coverage](https://img.shields.io/badge/coverage-97%25-brightgreen)]() [![License](https://img.shields.io/badge/license-Apache--2.0-blue)](./LICENSE)

# claude-token-saver-mcp

**Claude Code の定型タスクをローカル LLM で処理し、API トークン消費をゼロにする MCP サーバー。**

コード生成、リファクタリング、テスト作成、テキスト要約 — これらを Cloud API の代わりにあなたの PC の Ollama で実行します。セキュリティ内蔵。

```json
{
  "mcpServers": {
    "token-saver": { "command": "npx", "args": ["-y", "claude-token-saver-mcp"] }
  }
}
```

## Highlights

- **ゼロコスト実行** — 定型タスクはローカル処理。Cloud API 不使用
- **自動モデル選択** — RAM を検出し、最適モデルを自動で推奨・導入 (`auto_setup`)
- **セキュリティ内蔵** — PI 防御 20 パターン + 出力サニタイズ 11 パターン。他のローカル LLM ツールにはない保護層
- **コスト可視化** — 節約額をリアルタイム追跡 (`cost_dashboard`)
- **バッチ処理** — 複数タスクを一括投入、順次/並列モード対応
- **分散実行** — 複数 Ollama ノードへのロードバランシング (advanced)

## 自動ティアリング

| RAM | Tier | モデル | コンテキスト |
|:---:|:---:|:---|:---:|
| < 16 GB | Light | phi4:latest | 4,000 |
| 16–48 GB | Standard | qwen2.5-coder:7b | 12,000 |
| > 48 GB | Ultra | qwen2.5-coder:32b | 32,000 |

## 使い方

```
あなた: 「ソート関数を書いて」 → offload_work がローカルで生成
あなた: 「このログを要約して」 → compress_context がローカルで圧縮
あなた: 「コスト節約を見せて」 → cost_dashboard: 累計 $47.89 節約
```

## 要件

- Node.js >= 20
- [Ollama](https://ollama.com/)

## セットアップ

### 1. Ollama を起動

```bash
# モデルは auto_setup で自動DLされるため、手動プルは不要
ollama serve
```

### 2. Claude Code に登録

`~/.claude/claude_desktop_config.json` に追加:

```json
{
  "mcpServers": {
    "token-saver": { "command": "npx", "args": ["-y", "claude-token-saver-mcp"] }
  }
}
```

<details>
<summary>ソースからビルドする場合</summary>

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

### 3. モデルを自動セットアップ

Claude Code で:

```
コーディング用にローカルLLMをセットアップして
```

RAM に応じた最適モデルが自動で推奨・DL・プリロードされます。

## ツール一覧

| ツール | 説明 |
|:---|:---|
| `offload_work` | コード生成・リファクタリングをローカルで実行 |
| `compress_context` | 大量テキストをローカルで要約 |
| `auto_setup` | 最適モデルの推奨→DL→プリロードをワンステップ |
| `batch_offload` | 複数タスクを一括投入 (順次/並列) |
| `cost_dashboard` | 累計節約額とモデル使用統計 |
| `get_metrics` | サーバーメトリクス (JSON / Prometheus) |
| `recommend_model` | タスクカテゴリ別の最適モデル推奨 |
| `pull_model` | Ollama モデルのダウンロード |
| `preload_model` | VRAM プリロード |
| `list_loaded_models` | ロード中モデル一覧 |
| `configure_model_selector` | セレクター設定のランタイム管理 |

## 設定

環境変数または `~/.config/claude-token-saver/config.json` で設定可能。

→ **[設定リファレンス](./docs/user/configuration.md)**

<details>
<summary>主な環境変数</summary>

| 変数 | デフォルト | 説明 |
|:---|:---|:---|
| `OLLAMA_BASE_URL` | `http://127.0.0.1:11434` | Ollama の URL |
| `TIER_OVERRIDE` | (自動検出) | Tier 強制指定 (`1`/`2`/`3`) |
| `MODEL_OVERRIDE` | (自動) | 使用モデル強制指定 |
| `LOG_LEVEL` | `info` | ログレベル |

</details>

## セキュリティ

- **プロンプトインジェクション防御**: 5 カテゴリ 20 パターンで入力を検査
- **出力サニタイズ**: API キー・パスワード・JWT 等 11 パターンを `[REDACTED]` に置換
- **入力サイズ制限**: タスク 50K / コンテキスト 100K / 圧縮 200K 文字

## ドキュメント

| | |
|:---|:---|
| [クイックスタート](./docs/user/quickstart.md) | 5分で始める |
| [ユースケース集](./docs/user/use-cases.md) | 具体的な活用例 |
| [設定リファレンス](./docs/user/configuration.md) | 全設定項目 |
| [FAQ](./docs/user/faq.md) | よくある質問 |
| [トラブルシューティング](./docs/user/troubleshooting.md) | エラー対応 |

## 開発

```bash
npm ci
npm test             # 736 テスト
npm run test:e2e     # E2E (Ollama 必須)
npm run build        # プロダクションビルド
```

## ライセンス

[Apache License 2.0](./LICENSE)
