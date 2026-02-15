# Final Specification: claude-token-saver-mcp (v2.0)

## 1. 開発目的

Claude Code（Agent Teams）におけるクラウドAPI（Claude 3.5 Sonnet等）のトークン消費を抑制する。「高コストな推論・意思決定はクラウド」、「定型作業・長文要約・コード量産はローカル」という役割分担を、**「シングルモデル・シングルキュー」** 方式で実現する。

## 2. インテリジェント・リソース管理

### A. 階層別モデル・ティアリング (Tiering)

PCの負荷を抑えるため、**「1つのTierにつき1つのモデルのみ」** をロードする。タスクごとのモデル切り替え（アンロード/ロード）は行わない。

| Tier | 検知RAM | 採用モデル (Default) | コンテキスト上限 |
|:---|:---|:---|:---|
| **Tier 1 (Light)** | < 16GB | `phi4:latest` | 4,000 tokens |
| **Tier 2 (Standard)** | 16GB - 48GB | `qwen2.5-coder:7b` | 12,000 tokens |
| **Tier 3 (Ultra)** | > 48GB | `qwen2.5-coder:32b` | 32,000 tokens |

### B. キューと環境変数の制御

- **並列実行の禁止:** 複数エージェントが同時にツールを叩いた場合、FIFOキューで1件ずつ処理する（同時実行数 = 1）。
- **GPU最適化:** MacのMetal（GPU）を優先利用するように `OLLAMA_NUM_GPU` 等の環境変数を自動調整する。

## 3. 動的価格フェッチとコスト計算

起動時に最新のAPI価格情報を取得し、節約額を正確に算出する。

- **価格取得:** `https://api.anthropic.com/v1/pricing`（または同等の最新ソース）から価格を取得。フェッチ失敗時はハードコードされたデフォルト値を使用。
- **節約額計算式:**

$$Savings (\$) = (InputTokens_{local} \times Price_{cloud\_in}) + (OutputTokens_{local} \times Price_{cloud\_out})$$

- **出力:** 各タスク終了時に「今回の節約額：$XX.XX / 累計節約額：$XX.XX」をstderrに出力する。

## 4. ローカルLLMの「性格」固定 (System Prompt)

ローカルLLMに対し、以下のシステムプロンプトを強制的に付与し、余計なトークン生成（挨拶、解説、過度なMarkdown）を徹底的に排除する。

**System Prompt:**

```
You are a specialized code/text processing worker.
RETURN ONLY the requested result.
NO conversational filler (e.g., 'Sure', 'Here is the code').
NO explanations unless explicitly asked.
Use raw text or raw code blocks without extra commentary.
```

## 5. MCP ツール定義

### ① `offload_work`

- **機能:** 定型コード生成、ユニットテスト作成、リファクタリング等の実行。
- **Claudeへの提示:** `(Cost-Saver) Executes coding tasks on local LLM to save tokens.`

### ② `compress_context`

- **機能:** 巨大なファイルをローカルで要約し、要点のみをクラウドへ返す。
- **制約:** Tierごとのコンテキスト上限を超える場合は、先頭からカットオフし、警告を添える。

## 6. ユーザー体験 (UX) 要件

- **初回起動:** 該当モデルがOllama内に存在しない場合、`ollama pull [model_name] (y/n)?` とユーザーに確認を求める。
- **フォールバック:** ローカルLLMが30秒以内に応答しない場合、またはキューの待ち時間が60秒を超えた場合、Claude本体に「Cloudでの直接処理」を促すエラーを返す。
