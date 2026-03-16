# よくある質問 (FAQ)

## 基本

### Q: このツールを使うとどれくらい節約できますか？

A: タスクの量と種類に依存します。コスト計算は Claude Sonnet 4.5 の料金（入力 $3.00/1M tokens、出力 $15.00/1M tokens）を基準に行われます。コード生成1件あたり約$0.01-0.05の節約が見込め、1日100件のオフロードで月$30-150程度の節約が期待できます。`cost_dashboard` ツールで実際の節約額をいつでも確認できます。

### Q: Claude Code の動作が変わりますか？

A: いいえ。MCPツールとして登録されるだけで、Claude Code の通常動作に影響しません。Claude Code が判断して、適切なタスクを自動的にローカル LLM にオフロードします。

### Q: Ollama が落ちたらどうなりますか？

A: 自動的に Claude Cloud API にフォールバックします。`[FALLBACK_TO_CLOUD]` メッセージが返り、Claude Code 本体がタスクを処理します。サービスは中断しません。

### Q: どのモデルを使えばいいですか？

A: RAM に応じて自動選択されます（3段階のティアリング）:

| Tier | RAM | モデル | コンテキスト上限 |
|:---:|:---:|:---|:---:|
| Light (Tier 1) | < 16 GB | phi4:latest | 4,000 tokens |
| Standard (Tier 2) | 16-48 GB | qwen2.5-coder:7b | 12,000 tokens |
| Ultra (Tier 3) | > 48 GB | qwen2.5-coder:32b | 32,000 tokens |

`recommend_model` ツールで、タスクカテゴリに応じた最適モデルの推奨を受けることもできます。

### Q: Apple Silicon (M1/M2/M3/M4) で動きますか？

A: はい。Ollama が Metal GPU を自動利用します。特に M2 Pro 以上（16GB+）で快適に動作します。

## モデル関連

### Q: モデルの選び方がわかりません。自動で選んでもらえますか？

A: はい。`auto_setup` ツールを使えば、PCのスペック（RAM/VRAM）とタスクカテゴリに基づいて最適なモデルを自動選択・ダウンロード・プリロードします。Claude Code に「コーディング用にモデルをセットアップして」と依頼するだけです。

### Q: 推奨モデル以外のモデルも使えますか？

A: はい。`offload_work` の `model` パラメータで任意の Ollama モデルを指定できます。`MODEL_OVERRIDE` 環境変数でデフォルトモデルも変更可能です。

### Q: 日本語のタスクに強いモデルは？

A: Qwen3 シリーズが日本語に強いです。`recommend_model(category="japanese-text")` で推奨を確認できます。レジストリには Qwen3 8B / 14B / 32B のほか、Gemma3 や Nemotron 3 Nano も登録されています。日本語コーディングには `category="japanese-coding"` も利用できます。

### Q: 複数モデルを同時に使えますか？

A: VRAM の範囲内で可能です。`MAX_SIMULTANEOUS_MODELS` 設定で上限を制御できます（デフォルトは `auto`）。`preload_model` で事前ロードしておくと切り替えが高速です。

### Q: モデルのダウンロードにどれくらい時間がかかりますか？

A: モデルサイズとネットワーク速度に依存します。7B モデルで約2-5分、32B モデルで約15-30分程度です。`pull_model` ツールで Claude Code からダウンロードを実行できます。

## パフォーマンス

### Q: ローカル LLM の応答が遅いのですが？

A: いくつかの対策があります:

1. `preload_model` で事前ロード（初回ロード時間を排除）
2. 小さいモデルに切り替え（`TIER_OVERRIDE=1`）
3. `OLLAMA_NUM_GPU=999` で GPU 最大利用
4. 不要なアプリを閉じて RAM/VRAM を確保

各 Tier にはタイムアウトが設定されています（Tier 1: 60秒、Tier 2: 90秒、Tier 3: 180秒）。タイムアウトした場合は自動的にフォールバックします。

### Q: キューに大量のタスクが溜まりますが？

A: `QUEUE_MAX_SIZE`（デフォルト10）を増やすか、設定ファイルの `rateLimitPerMinute` で流量制御してください。`batch_offload` で一括投入も効率的です。

## セキュリティ

### Q: ローカル LLM に送ったデータは外部に送信されますか？

A: いいえ。Ollama は完全にローカルで動作し、データは外部に送信されません。

### Q: プロンプトインジェクション防御は無効にできますか？

A: セキュリティ上の理由から無効化はできません。20パターン（5カテゴリ）の検査ルールで入力を保護しています。正当なプロンプトがブロックされる場合は、タスク文を書き換えてください。

### Q: 出力のサニタイズで情報が消えてしまいますが？

A: API キーやパスワードのパターンに一致するテキストは `[REDACTED]` に置換されます。これはセキュリティ保護のため意図的な動作です。入力サイズ制限もあり、タスクは50,000文字、コンテキストは100,000文字、圧縮コンテンツは200,000文字が上限です。

## 設定・運用

### Q: 設定ファイルはどこにありますか？

A: `~/.config/claude-token-saver/config.json` です。環境変数でも設定可能です。主な環境変数:

| 変数 | デフォルト | 説明 |
|:---|:---|:---|
| `OLLAMA_BASE_URL` | `http://127.0.0.1:11434` | Ollama の URL |
| `TIER_OVERRIDE` | (自動検出) | Tier を強制指定 (`1`, `2`, `3`) |
| `MODEL_OVERRIDE` | (Tier に応じて自動) | 使用モデルを強制指定 |
| `MODEL_SELECTOR_ENABLED` | `true` | 動的モデルセレクター有効/無効 |
| `QUEUE_MAX_SIZE` | `10` | キュー最大長 |

詳細は [README](../../README.md) の設定セクションを参照してください。

### Q: Docker で使えますか？

A: はい。`docker compose up -d` で Ollama と一緒に起動できます。ホストの Ollama に接続する場合は `host.docker.internal` 経由です。

### Q: 複数の Ollama サーバーに分散できますか？

A: はい。`config.json` の `distributed` セクションで複数ノードを設定できます。`model-affinity` 戦略がデフォルトで、モデルがロード済みのノードを優先します。

```json
{
  "distributed": {
    "enabled": true,
    "nodes": [
      {"id": "node1", "baseUrl": "http://192.168.1.10:11434"},
      {"id": "node2", "baseUrl": "http://192.168.1.11:11434"}
    ],
    "strategy": "model-affinity"
  }
}
```

### Q: コスト節約履歴はどこに保存されますか？

A: `~/.config/claude-token-saver/cost-history.json` に永続化されます。サーバー再起動後も累計が継続します。永続化は設定ファイルの `persistence` セクションで制御でき、自動保存間隔（デフォルト5分）も変更可能です。

### Q: コスト比較の基準モデルを変更できますか？

A: はい。設定ファイルの `cost.comparisonModel` で変更できます。デフォルトは `claude-sonnet-4-5`（入力 $3.00/1M、出力 $15.00/1M）です。`claude-opus-4`（入力 $15.00/1M、出力 $75.00/1M）や `claude-haiku-3-5`（入力 $0.80/1M、出力 $4.00/1M）も選択できます。
