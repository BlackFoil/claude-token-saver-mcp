[English](./README.en.md) | 日本語

[![CI](https://github.com/pulseagent/claude-token-saver-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/pulseagent/claude-token-saver-mcp/actions) [![npm](https://img.shields.io/npm/v/claude-token-saver-mcp)](https://www.npmjs.com/package/claude-token-saver-mcp) [![Coverage](https://img.shields.io/badge/coverage-97%25-brightgreen)](https://github.com/pulseagent/claude-token-saver-mcp/actions) [![License](https://img.shields.io/badge/license-Apache--2.0-blue)](./LICENSE)

# claude-token-saver-mcp

> **Status: Beta** — 個人利用に適しています。736テスト / 97%カバレッジ。

**Claude Code の定型タスクをローカル LLM で処理し、API トークン消費をゼロにする MCP サーバー。**

コード生成、リファクタリング、テスト作成、テキスト要約 — これらを Cloud API の代わりにあなたの PC の [Ollama](https://ollama.com/) で実行します。セキュリティ内蔵。

<!-- デモGIF: 以下の内容で録画してここに貼ってください -->
<!-- Claude Code で「ソート関数を書いて」→ offload_work 実行 → コード生成 → cost_dashboard で節約額表示 -->
<!-- 推奨: 800x450px, 15-20秒, asciinema or vhs -->

## なぜ作ったか

Claude Code の API 利用を分析したところ、**リクエストの約 40% が定型的なコード生成やテキスト処理**でした。これらは 7B パラメータのローカルモデルでも十分な品質で処理できます。「高度な推論は Cloud、定型作業は Local」— この役割分担を自動化するために作りました。

## ビジョン

ローカル LLM の性能は急速に向上しています。2024年の Llama 3 から 2025年の Qwen3 まで、わずか1年でコーディングベンチマーク (HumanEval) は **60% → 85%** に到達しました。

この流れが続けば、Agent Teams の中にローカル LLM が標準的に組み込まれる日は近いでしょう。claude-token-saver-mcp は、その未来に先行して **「Cloud × Local のハイブリッド実行基盤」** を提供します。

## どう動くのか

[MCP (Model Context Protocol)](https://modelcontextprotocol.io/) は、Claude Code が外部ツールを呼び出すための標準プロトコルです。このサーバーを登録すると、Claude Code が **タスクの性質を判断し、定型作業を自動的にローカル LLM に委譲**します。

```text
Claude Code ──MCP──▶ token-saver ──HTTP──▶ Ollama (あなたの PC)
     │                                         │
     │  「これは定型タスクだ。ローカルに任せよう」  │
     │                                         │
     └─── 高度な推論・設計判断は Cloud で継続 ───┘
```

Ollama が停止中や応答遅延時は、自動的に Cloud API にフォールバック。サービスは中断しません。

## 30秒セットアップ

**前提:** [Node.js 20+](https://nodejs.org/) と [Ollama](https://ollama.com/) をインストール済み。
Ollama はローカルで AI モデルを動かすためのツールです。

**0.** Ollama を起動:

```bash
ollama serve
```

**1.** `~/.claude/claude_desktop_config.json` に追加 (ファイルがなければ新規作成):

```json
{
  "mcpServers": {
    "token-saver": { "command": "npx", "args": ["-y", "claude-token-saver-mcp"] }
  }
}
```

**2.** Claude Code を起動し、こう依頼:

```text
コーディング用にローカルLLMをセットアップして
```

RAM に応じた最適モデルが自動で推奨・ダウンロード (約 4GB)・プリロードされます。

**3.** 動作確認 — 以下を依頼:

```text
TypeScript で配列をシャッフルする関数を書いて
```

応答の末尾に `Model: qwen2.5-coder:7b | Savings: $0.02` のようなメタ情報が表示されれば成功です。
表示されない場合は `ollama list` でモデルを確認し、[トラブルシューティング](./docs/user/troubleshooting.md) を参照してください。

<!-- TODO: セットアップ完了のスクリーンショットをここに貼る -->
<!-- 内容: Claude Code で offload_work が実行され、応答末尾に Model / Tokens / Savings が表示されている様子 -->
<!-- 推奨: 800x400px, ターミナルスクリーンショット -->

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

## Highlights

- **ゼロコスト実行** — 定型タスクはローカル処理。Cloud API 不使用
- **自動モデル選択** — RAM を検出し、PC に最適なモデルを自動導入 (`auto_setup`)
- **セキュリティ内蔵** — プロンプトインジェクション防御 + 出力サニタイズ。他のローカル LLM ツールにはない保護層
- **コスト可視化** — 節約額をリアルタイム追跡。月額 $200 利用なら **$50〜80 の節約** が見込めます *(約40%の定型タスク比率に基づく試算)*
- **フォールバック** — Ollama 停止時は自動で Cloud に切り替え。サービス中断なし

## 使い方

```text
あなた: 「ソート関数を書いて」    → offload_work がローカルで生成 💰 $0.02 節約
あなた: 「このログを要約して」    → compress_context がローカルで圧縮 💰 $0.05 節約
あなた: 「コスト節約を見せて」    → cost_dashboard: 累計 $47.89 節約
あなた: 「3つのAPIを一括実装して」 → batch_offload: 3タスクを順次処理
```

## 品質とトレードオフ

正直に言うと、ローカル 7B モデルの出力は Claude には及びません。しかし:

| タスク | ローカル品質 | 向いている |
|:---|:---:|:---:|
| ボイラープレートコード生成 | ★★★★☆ | ✅ |
| ユニットテスト作成 | ★★★★☆ | ✅ |
| テキスト要約 | ★★★★☆ | ✅ |
| リファクタリング (単純) | ★★★☆☆ | ✅ |
| アーキテクチャ設計 | ★★☆☆☆ | ❌ Cloud推奨 |
| 複雑なデバッグ | ★★☆☆☆ | ❌ Cloud推奨 |

Claude Code 自身がタスクの複雑さを判断し、適切に振り分けます。ローカルの品質が不足する場合は Cloud で処理されます。

## 自動ティアリング

| RAM | Tier | モデル | DLサイズ |
|:---:|:---:|:---|:---:|
| < 16 GB | Light | phi4:latest | ~2.5 GB |
| 16–48 GB | Standard | qwen2.5-coder:7b | ~4.7 GB |
| > 48 GB | Ultra | qwen2.5-coder:32b | ~18 GB |

## ツール一覧

| ツール | 説明 |
|:---|:---|
| `offload_work` | コード生成・リファクタリングをローカルで実行 |
| `compress_context` | 大量テキストをローカルで要約 |
| `auto_setup` | 最適モデルの推奨→DL→プリロードをワンステップ |
| `batch_offload` | 複数タスクを一括投入 (順次/並列) |
| `cost_dashboard` | 累計節約額とモデル使用統計 |

<details>
<summary>その他のツール (6件)</summary>

| ツール | 説明 |
|:---|:---|
| `get_metrics` | サーバーメトリクス (JSON / Prometheus) |
| `recommend_model` | タスクカテゴリ別の最適モデル推奨 |
| `pull_model` | Ollama モデルのダウンロード |
| `preload_model` | VRAM プリロード |
| `list_loaded_models` | ロード中モデル一覧 |
| `configure_model_selector` | セレクター設定のランタイム管理 |

</details>

## セキュリティ

ローカル LLM への入出力を自動保護します:

- **プロンプトインジェクション防御**: 5 カテゴリ 20 パターンで悪意ある入力をブロック
- **出力サニタイズ**: API キー・パスワード・JWT 等 11 パターンを `[REDACTED]` に自動置換
- **データプライバシー**: 全処理がローカル完結。外部送信なし

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
npm test             # 736 テスト (97% カバレッジ)
npm run typecheck    # 型チェック
npm run lint         # ESLint
npm run build        # プロダクションビルド
```

**対応プラットフォーム:** macOS, Linux, Windows (Ollama が動作する環境)

コントリビューション歓迎です。→ [CONTRIBUTING.md](./CONTRIBUTING.md)

## ライセンス

[Apache License 2.0](./LICENSE)
