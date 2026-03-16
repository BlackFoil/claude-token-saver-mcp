# ユースケース集

claude-token-saver-mcp の各ツールを活用する具体的なシナリオ集です。
すべての例は Claude Code 上での対話を想定しています。

---

## 0. ワンステップセットアップ (auto_setup)

### 0.1 初回セットアップ

**シナリオ:** 初めてツールを使う。最適なモデルを自動で導入したい。

**Claude Code での依頼文例:**

```
コーディング用にローカルLLMをセットアップして
```

**期待される動作:**

1. `auto_setup(category="coding")` が呼ばれる
2. RAM検出 → 最適モデル推奨 → 自動DL → VRAMプリロード → 即利用可能

---

### 0.2 カテゴリ別セットアップ

**シナリオ:** 日本語テキスト処理用のモデルを導入したい。

**Claude Code での依頼文例:**

```
日本語テキスト処理に最適なモデルを準備して
```

**期待される動作:**

1. `auto_setup(category="japanese-text")` が呼ばれる
2. 日本語処理に強いモデルが自動選択・ダウンロード・プリロードされる

---

### 0.3 品質優先セットアップ

**シナリオ:** より精度の高いモデルを使いたい。

**Claude Code での依頼文例:**

```
品質重視でコーディング用モデルをセットアップして
```

**期待される動作:**

1. `auto_setup(category="coding", prefer_quality=true)` が呼ばれる
2. 品質スコアの高いモデルが優先的に選択される

---

## 1. コード生成をローカルLLMにオフロード (`offload_work`)

### 1.1 基本的なコード生成

**シナリオ:** 定型的なユーティリティ関数の生成を Claude API ではなくローカル LLM に処理させ、トークンコストを節約する。

**Claude Code での依頼文例:**

```
TypeScript でバブルソートの関数を書いて。ジェネリクス対応で、比較関数を引数に取れるようにして。
```

**期待される動作:**

1. Claude Code が `offload_work` ツールを呼び出す
2. パラメータ:
   ```json
   {
     "task": "バブルソートの関数を書いて。ジェネリクス対応で、比較関数を引数に取れるようにして。",
     "language": "typescript",
     "output_format": "code"
   }
   ```
3. ローカル Ollama が TypeScript コードを生成して返却
4. レスポンスにモデル名・トークン数・節約額が付記される

**コスト節約のポイント:** ボイラープレートやユーティリティ関数の生成は Claude API の得意分野だが、コスト対効果でローカル LLM が有利。1回あたり約 $0.01〜$0.05 の節約が見込める。

---

### 1.2 既存コードのリファクタリング

**シナリオ:** 既存ファイルの内容を `context` に渡し、リファクタリングをローカル LLM に依頼する。

**Claude Code での依頼文例:**

```
この関数をリファクタリングして、早期リターンパターンに書き換えて。

<ファイル内容をペースト>
```

**期待される動作:**

1. `offload_work` ツールが呼ばれる
2. パラメータ:
   ```json
   {
     "task": "この関数を早期リターンパターンにリファクタリングして",
     "context": "function processUser(user: User) {\n  if (user) {\n    if (user.isActive) {\n      if (user.hasPermission) {\n        return doWork(user);\n      }\n    }\n  }\n  return null;\n}",
     "language": "typescript",
     "output_format": "code"
   }
   ```
3. ローカル LLM がネストを解消したコードを返す

**コスト節約のポイント:** `context` にファイル全文（最大100,000文字）を含められる。大きなファイルのリファクタリングほどトークン節約効果が大きい。

---

### 1.3 ユニットテストの自動生成

**シナリオ:** 既存の関数定義を渡してテストコードを生成させる。テスト生成は定型的な作業なのでローカル LLM に最適。

**Claude Code での依頼文例:**

```
この関数のユニットテストを vitest で書いて。正常系・異常系・エッジケースを含めて。

<関数のソースコード>
```

**期待される動作:**

1. `offload_work` ツールが呼ばれる
2. パラメータ:
   ```json
   {
     "task": "この関数のユニットテストを vitest で書いて。正常系・異常系・エッジケースを含めて。",
     "context": "export function calculateTax(price: number, rate: number): number {\n  if (price < 0) throw new Error('price must be non-negative');\n  if (rate < 0 || rate > 1) throw new Error('rate must be 0-1');\n  return Math.round(price * rate);\n}",
     "language": "typescript",
     "output_format": "code"
   }
   ```
3. ローカル LLM が `describe/it` ブロックを含むテストファイルを生成

**コスト節約のポイント:** テスト生成は入出力ともにトークン量が多い。ローカルに委任することで 1 関数あたり数百〜数千トークンの Claude API 消費を回避できる。

---

### 1.4 差分出力 (diff 形式)

**シナリオ:** 既存コードへの変更を diff 形式で受け取り、パッチ適用のワークフローに組み込む。

**Claude Code での依頼文例:**

```
このファイルの console.log をすべて logger.info に置き換えた差分を出して。
```

**期待される動作:**

1. `offload_work` ツールが呼ばれる
2. パラメータ:
   ```json
   {
     "task": "console.log をすべて logger.info に置き換えて",
     "context": "function handleRequest(req: Request) {\n  console.log('request received', req.url);\n  const result = processRequest(req);\n  console.log('result:', result);\n  return result;\n}",
     "language": "typescript",
     "output_format": "diff"
   }
   ```
3. ローカル LLM が unified diff 形式で変更箇所を出力する:
   ```diff
   - console.log('request received', req.url);
   + logger.info('request received', req.url);
   ```

**コスト節約のポイント:** `output_format: "diff"` を指定すると、変更箇所のみの出力になるため、出力トークン数が抑えられ、ローカル LLM の処理も高速化する。

---

## 2. 大量テキストの要約 (`compress_context`)

### 2.1 ログファイルの要約

**シナリオ:** CI ログやアプリケーションログの長大な出力を要約し、Claude に渡すコンテキストを圧縮する。

**Claude Code での依頼文例:**

```
このビルドログを要約して。エラーと警告に絞って。

<数千行のログ出力>
```

**期待される動作:**

1. `compress_context` ツールが呼ばれる
2. パラメータ:
   ```json
   {
     "content": "<数千行のビルドログ>",
     "focus": "エラーと警告",
     "max_length": 1000
   }
   ```
3. ローカル LLM がエラー・警告箇所だけを抽出した要約を返す
4. レスポンスに圧縮率（例: `15000 -> 800 chars (94.7% reduced)`）が表示される

**コスト節約のポイント:** 10,000文字のログを 1,000文字に圧縮すれば、その後 Claude に渡すトークン量が約 90% 削減される。ログの要約自体はローカルで無料処理。

---

### 2.2 大きなソースファイルの概要把握

**シナリオ:** 1,000行超のソースファイルの全体構造を把握するために要約させる。

**Claude Code での依頼文例:**

```
この server.ts の構造を要約して。関数一覧とその役割がわかるように。
```

**期待される動作:**

1. `compress_context` ツールが呼ばれる
2. パラメータ:
   ```json
   {
     "content": "<server.ts の全文>",
     "focus": "関数一覧とその役割",
     "max_length": 2000
   }
   ```
3. ローカル LLM が関数名・クラス・export 一覧を構造化して返す

**コスト節約のポイント:** ファイル全文を Claude に送ると数千トークン消費するが、要約後は数百トークンで同じ情報を伝えられる。コードナビゲーションの初期段階で特に有効。

---

### 2.3 フォーカス指定による重点要約

**シナリオ:** 長いドキュメントの中から特定トピックに関する情報だけを抽出する。

**Claude Code での依頼文例:**

```
このAPIドキュメントから認証関連の部分だけ要約して。
```

**期待される動作:**

1. `compress_context` ツールが呼ばれる
2. パラメータ:
   ```json
   {
     "content": "<API ドキュメント全文>",
     "focus": "認証・認可・トークン管理",
     "max_length": 1500
   }
   ```
3. ローカル LLM が認証関連のエンドポイント・パラメータ・フローだけを抽出して返す

**コスト節約のポイント:** `focus` パラメータにより、不要な情報を除外した的確な要約が得られる。Claude への入力トークンを最小限に抑えつつ、必要な情報を漏らさない。

---

## 3. バッチ処理 (`batch_offload`)

### 3.1 複数ファイルの一括コード生成

**シナリオ:** 複数のユーティリティ関数を一度にまとめて生成する。個別に `offload_work` を呼ぶより効率的。

**Claude Code での依頼文例:**

```
以下の3つのユーティリティ関数を TypeScript で書いて:
1. 配列のチャンク分割 (chunk)
2. ディープクローン (deepClone)
3. デバウンス (debounce)
```

**期待される動作:**

1. `batch_offload` ツールが呼ばれる
2. パラメータ:
   ```json
   {
     "tasks": [
       { "task": "配列を指定サイズのチャンクに分割する chunk<T>(arr: T[], size: number): T[][] 関数を書いて", "language": "typescript" },
       { "task": "ディープクローンする deepClone<T>(obj: T): T 関数を書いて", "language": "typescript" },
       { "task": "デバウンスする debounce(fn: Function, ms: number) 関数を書いて", "language": "typescript" }
     ],
     "sequential": false
   }
   ```
3. 3タスクが並列でローカル LLM に送られ、すべての結果がまとめて返る
4. レスポンス: `Batch Results: 3/3 succeeded` + 各タスクの生成コード + 合計節約額

**コスト節約のポイント:** `sequential: false`（デフォルト）で並列処理され、合計処理時間が短縮される。1回のツール呼び出しで最大10タスクまで送れるため、ツール呼び出しのオーバーヘッドも削減。

---

### 3.2 順次モード: コード → テスト → ドキュメントの連鎖生成

**シナリオ:** まずコードを生成し、そのコードをコンテキストとしてテストを生成し、さらにドキュメントを生成する連鎖処理。

**Claude Code での依頼文例:**

```
以下を順番にやって:
1. TypeScript で Stack クラスを実装
2. そのテストを vitest で書く
3. JSDoc コメントを追加
```

**期待される動作:**

1. `batch_offload` ツールが呼ばれる
2. パラメータ:
   ```json
   {
     "tasks": [
       { "task": "TypeScript で Stack<T> クラスを実装して。push, pop, peek, isEmpty, size メソッドを含めて。", "language": "typescript", "output_format": "code" },
       { "task": "前の結果の Stack クラスに対する vitest テストを書いて。", "language": "typescript", "output_format": "code" },
       { "task": "前の結果のコードに JSDoc コメントを追加して。全メソッドに @param と @returns を含めて。", "language": "typescript", "output_format": "code" }
     ],
     "sequential": true
   }
   ```
3. `sequential: true` により、タスク1の出力がタスク2のコンテキスト（`Previous result`）として自動的に渡される
4. タスク2の出力がタスク3のコンテキストとして渡される

**コスト節約のポイント:** `sequential: true` を指定すると、前のタスクの結果が次のタスクに自動で引き継がれる。Claude 側でコンテキストを保持する必要がないため、クラウドトークンの消費がゼロになる。

---

## 4. モデル管理ワークフロー

### 4.1 最適モデルの発見と導入

**シナリオ:** タスクに最適なモデルを見つけてインストールし、VRAM にロードして使う一連のフロー。

> **ヒント:** `auto_setup` ツールを使えば、以下の4ステップを1ステップに簡略化できます。「コーディング用にローカルLLMをセットアップして」と依頼するだけで、推奨・ダウンロード・プリロードが自動実行されます（セクション0参照）。

**Claude Code での依頼文例:**

```
コーディング用の最適なモデルを教えて。品質重視で。
```

**期待される動作（ステップバイステップ）:**

**Step 1: `recommend_model` でモデル推薦を取得**

```json
{
  "category": "coding",
  "prefer_quality": true
}
```

返却例:
```
推奨: devstral:24b (installed: false, score: 92)
次点: qwen3:14b (installed: true, score: 85)
```

**Step 2: `pull_model` で未インストールモデルをダウンロード**

```json
{
  "model": "devstral:24b"
}
```

**Step 3: `preload_model` で VRAM にロード**

```json
{
  "model": "devstral:24b",
  "keep_alive": "-1"
}
```

`keep_alive: "-1"` はセッション中ずっとモデルをロードし続ける設定。

**Step 4: `offload_work` でモデルを指定して使用**

```json
{
  "task": "REST API のCRUDエンドポイントを実装して",
  "language": "typescript",
  "model": "devstral:24b"
}
```

**コスト節約のポイント:** `recommend_model` はシステムの RAM 量と既にインストール済みのモデルを考慮して推薦する。`preload_model` で事前ロードしておくと、初回推論のコールドスタート（数秒〜十数秒）を回避できる。

---

### 4.2 タスクカテゴリ別のモデル使い分け

**シナリオ:** タスクの種類に応じて自動的に最適なモデルを選択させる。

対応カテゴリ一覧:

| カテゴリ | 用途 | 推奨シーン |
|---|---|---|
| `coding` | コード生成・リファクタリング | 関数実装、バグ修正 |
| `coding-agent` | エージェント的コーディング | 複雑なマルチステップタスク |
| `japanese-text` | 日本語テキスト処理 | 日本語ドキュメント作成 |
| `japanese-coding` | 日本語でのコーディング | 日本語コメント付きコード |
| `translation` | 翻訳 | 英日・日英翻訳 |
| `summarization` | 要約 | ドキュメント圧縮 |
| `general` | 汎用 | その他のタスク |

**Claude Code での依頼文例:**

```
日本語のREADMEを書いて（japanese-textカテゴリで）。
```

**期待される動作:**

1. `offload_work` ツールが呼ばれる
2. パラメータ:
   ```json
   {
     "task": "以下のプロジェクトの日本語READMEを書いて...",
     "category": "japanese-text",
     "output_format": "raw"
   }
   ```
3. `category` に基づき、日本語処理に強いモデル（例: `qwen3:14b`）が自動選択される
4. `model` パラメータを明示指定した場合はそちらが優先される

**コスト節約のポイント:** `category` を指定するだけで、タスクに最適なモデルが自動選択される。日本語テキストに英語特化モデルを使う無駄を回避し、品質と速度の両方が向上する。

---

## 5. コスト管理

### 5.1 節約額の確認 (`cost_dashboard`)

**シナリオ:** セッション中にどれだけ Claude API コストを節約できたかを確認する。

**Claude Code での依頼文例:**

```
今日のコスト節約状況を見せて。
```

**期待される動作:**

1. `cost_dashboard` ツールが呼ばれる（引数なし）
2. 返却例:
   ```
   === Cost Dashboard ===
   Total requests: 42
   Total savings: $1.2345
   offload_work: 35 requests, $0.9876 saved
   compress_context: 7 requests, $0.2469 saved

   Model usage:
   - qwen3:14b: 30 requests
   - devstral:24b: 12 requests
   ```

**コスト節約のポイント:** 定期的にダッシュボードを確認することで、どのツール・モデルが最もコスト効率が良いかを把握できる。比較対象はデフォルトで `claude-sonnet-4-5` の料金。

---

### 5.2 メトリクスの監視 (`get_metrics`)

**シナリオ:** サーバーの健全性やキューの状態を確認する。デバッグやパフォーマンスチューニングに活用。

**Claude Code での依頼文例:**

```
MCP サーバーのメトリクスを見せて。
```

**期待される動作:**

1. `get_metrics` ツールが呼ばれる
2. パラメータ:
   ```json
   {
     "format": "json"
   }
   ```
3. 返却例:
   ```json
   {
     "requests_total": 42,
     "requests_success": 40,
     "requests_error": 2,
     "ollama_healthy": true,
     "queue_length": 0,
     "avg_latency_ms": 1250,
     "cost_savings_usd": 1.2345
   }
   ```

`format: "prometheus"` を指定すると Prometheus 形式のテキストメトリクスが返る。監視システムとの統合に便利。

**コスト節約のポイント:** エラー率やレイテンシを監視することで、モデルの過負荷やメモリ不足を早期に検知できる。問題発生時にクラウドフォールバックが増えるのを防ぎ、コスト増を回避。

---

## 6. Agent Team 連携

### 6.1 CLAUDE.md のロールテーブルとの連携

**シナリオ:** Claude Code の Agent Team 機能（PM / Coder / Writer など）で、各エージェントのロールに応じたモデル選択を自動化する。

**CLAUDE.md でのロール定義例:**

```markdown
| Role   | 担当タスク                  | 推奨カテゴリ       |
|--------|---------------------------|-------------------|
| PM     | 要件定義・タスク分解         | general           |
| Coder  | 実装・リファクタリング       | coding            |
| Writer | ドキュメント・翻訳          | japanese-text     |
| Tester | テスト生成・実行            | coding            |
```

**期待される動作:**

- Coder ロールのエージェントが `offload_work` を呼ぶ際に `category: "coding"` を自動付与
- Writer ロールのエージェントは `category: "japanese-text"` を使用
- 各ロールに最適なモデルが自動選択される

**コスト節約のポイント:** エージェントのロールとモデルカテゴリを紐づけることで、人手によるモデル指定が不要になる。適材適所のモデル配置でコストと品質を最適化。

---

### 6.2 PM / Coder / Writer 別のモデル最適化

**シナリオ:** 各ロールで実際にツールを使う際の典型パターン。

**PM（プロジェクトマネージャー）:**

```
要件を整理して、タスクに分解して。
```

→ `offload_work` + `category: "general"` + `output_format: "raw"`
→ 軽量モデルで高速にタスク分解

**Coder（開発者）:**

```
この関数を実装して。テストも書いて。
```

→ `batch_offload` + `sequential: true`
→ タスク1: 実装（`category: "coding"`）、タスク2: テスト生成（前の結果を自動参照）

**Writer（テクニカルライター）:**

```
この機能のユーザードキュメントを日本語で書いて。
```

→ `offload_work` + `category: "japanese-text"` + `output_format: "raw"`
→ 日本語に強いモデルが自動選択

**コスト節約のポイント:** バッチ処理の `sequential` モードを活用すると、Coder は「実装 → テスト → レビュー」の連鎖をローカル LLM だけで完結でき、Claude API トークンの消費をほぼゼロに抑えられる。

---

## まとめ: コスト節約の基本戦略

1. **定型タスクはすべてオフロード** — ボイラープレート、テスト、フォーマット変換など
2. **大きなコンテキストは先に圧縮** — ログ・ドキュメントは `compress_context` で要約してから Claude に渡す
3. **バッチ処理を活用** — 複数タスクは個別呼び出しより `batch_offload` で一括処理
4. **カテゴリ指定で自動モデル選択** — `category` パラメータでタスクに最適なモデルを自動適用
5. **定期的にダッシュボードを確認** — `cost_dashboard` で節約効果を可視化し、ワークフローを改善
