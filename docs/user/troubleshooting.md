# トラブルシューティング

Claude Token Saver MCP (CTS) の利用中に発生しうる問題と、その解決策をまとめたガイドです。

---

## よくある問題と解決策

### Ollama に接続できない (CTS-1001)

**症状:**

- エラーメッセージ: `[CTS-1001] Cannot connect to Ollama at ...`
- `FALLBACK: このタスクはクラウドAPIで直接処理してください。` が表示される
- ヘルスチェックで `Ollama: not available` と表示される

**原因:**

- Ollama が起動していない
- Ollama の URL が間違っている
- ファイアウォールやネットワーク設定で接続がブロックされている

**解決策:**

1. Ollama を起動する:

   ```bash
   ollama serve
   ```

2. 接続を確認する:

   ```bash
   curl http://127.0.0.1:11434/
   ```

   `Ollama is running` と表示されれば正常です。

3. デフォルト以外のポートやホストを使用している場合、環境変数で指定する:

   ```bash
   export OLLAMA_BASE_URL=http://localhost:11435
   ```

   または設定ファイル (`~/.config/claude-token-saver/config.json`) で指定:

   ```json
   {
     "ollama": {
       "baseUrl": "http://localhost:11435"
     }
   }
   ```

---

### Ollama バージョンが古い (CTS-1002)

**症状:**

- エラーメッセージ: `[CTS-1002] Ollama version X.X.X is below minimum required 0.1.34`

**原因:**

- インストールされている Ollama のバージョンが 0.1.34 未満

**解決策:**

Ollama を最新版にアップデートしてください:

```bash
# macOS (Homebrew)
brew upgrade ollama

# Linux
curl -fsSL https://ollama.com/install.sh | sh

# バージョン確認
ollama --version
```

CTS は **Ollama 0.1.34 以上** を必要とします。

---

### モデルが見つからない (CTS-3001)

**症状:**

- エラーメッセージ: `[CTS-3001] モデル <model> が見つかりません。自動pullを試行します。`
- 自動 pull も失敗する場合: `Model "<model>" not found`

**原因:**

- 指定されたモデルがローカルにダウンロードされていない
- モデル名のスペルミス

**解決策:**

1. モデルを手動でダウンロードする:

   ```bash
   ollama pull qwen2.5-coder:7b
   ```

2. ダウンロード済みモデルの一覧を確認する:

   ```bash
   ollama list
   ```

3. CTS の `pull_model` ツールでもダウンロード可能:

   ```text
   pull_model({ model: "qwen2.5-coder:7b" })
   ```

> **ヒント:** `auto_setup` ツールを使えば、最適なモデルの推奨・ダウンロード・プリロードを自動実行できます。

---

### モデルのロードがタイムアウト (CTS-2001)

**症状:**

- エラーメッセージ: `[CTS-2001] First token not received within Xms`
- エラーメッセージ: `[CTS-2001] モデル <model> のロードが X秒 でタイムアウトしました。`
- 初回推論時に特に発生しやすい

**原因:**

- VRAM（GPU メモリ）が不足しており、モデルのロードに時間がかかる
- モデルサイズがハードウェアに対して大きすぎる
- 他のプロセスが GPU メモリを占有している

**解決策:**

1. より小さいモデルに切り替える:

   ```bash
   export TIER_OVERRIDE=1
   ```

   Tier 1 は最も軽量なモデルを使用します。

2. `firstTokenTimeout` を延長する（環境変数またはconfig）:

   ```bash
   export OLLAMA_TIMEOUT_MS=120000
   ```

3. `preload_model` ツールで事前にモデルをメモリにロードしておく:

   ```text
   preload_model({ model: "qwen2.5-coder:7b" })
   ```

   これにより、実際のリクエスト時にロード待ち時間がなくなります。

4. GPU メモリの使用状況を確認する:

   ```bash
   # NVIDIA GPU
   nvidia-smi

   # Ollama で現在ロード中のモデルを確認
   ollama ps
   ```

---

### 生成中にタイムアウト (CTS-2002)

**症状:**

- エラーメッセージ: `[CTS-2002] Request timed out after Xms`
- エラーメッセージ: `[CTS-2002] No data received for Xms (heartbeat timeout)`
- 長いテキストの生成中にタイムアウトする

**原因:**

- `requestTimeout` が短すぎる（大きなタスクに対して）
- `heartbeatTimeout` が短すぎる（生成速度が遅い場合）
- ハードウェア性能の制約

**解決策:**

1. タイムアウト値を延長する:

   ```bash
   export OLLAMA_TIMEOUT_MS=120000
   ```

   または設定ファイルで個別に指定:

   ```json
   {
     "ollama": {
       "requestTimeout": 120000,
       "heartbeatTimeout": 30000,
       "firstTokenTimeout": 60000
     }
   }
   ```

2. タスクを小さく分割する -- 大きなファイルは `compress_context` で先に要約してから処理する

3. より高速なモデルに切り替える（Tier を下げる）

---

### キューが満杯 (CTS-4001)

**症状:**

- エラーメッセージ: `[CTS-4001] キューが満杯です（X/Y）。クラウドAPIで直接処理してください。`
- 複数エージェントから同時にリクエストを送った際に発生

**原因:**

- 同時リクエスト数がキューの上限を超えた
- キュー内のリクエストがタイムアウトして滞留している

**解決策:**

1. キューの最大長を増やす:

   ```bash
   export QUEUE_MAX_SIZE=20
   ```

2. キュータイムアウトを延長する:

   ```bash
   export QUEUE_TIMEOUT_MS=120000
   ```

3. 設定ファイルでの指定:

   ```json
   {
     "queue": {
       "maxQueueLength": 20,
       "queueTimeoutMs": 120000
     }
   }
   ```

---

### レートリミット超過 (CTS-4002)

**症状:**

- エラーメッセージ: `[CTS-4002] レートリミット超過: Xリクエスト/分の上限に達しました。`
- 短時間に大量のリクエストを送信した際に発生

**原因:**

- 1分あたりのリクエスト数が設定上限を超えた

**解決策:**

1. `rateLimitPerMinute` を調整する（設定ファイルで指定）:

   ```json
   {
     "queue": {
       "rateLimitPerMinute": 60
     }
   }
   ```

2. リクエストの間隔を空ける -- このエラーは一時的なため、しばらく待てば自動的に解消されます

---

### プロンプトインジェクション検知 (CTS-5001)

**症状:**

- エラーメッセージ: `[CTS-5001] プロンプトインジェクションの疑いを検出しました: <pattern>`
- 正当なプロンプトがブロックされる

**原因:**

CTS はセキュリティのため、以下のカテゴリのパターンを検知・ブロックします:

| カテゴリ | 検知されるパターン例 |
|---|---|
| `direct-override` | "ignore previous instructions", "override system prompt" |
| `role-injection` | "system:", "[SYSTEM]", "<<SYS>>", "[INST]" |
| `prompt-leak` | "show me your system prompt", "reveal your instructions" |
| `role-switch` | "you are now", "act as", "pretend to be" |
| `encoding-evasion` | `\x41`, `\u0041`, `&#x41;` 等のエンコード文字列 |

**解決策:**

1. タスクの文面を書き換える -- "ignore", "override", "system:", "[INST]" などのキーワードを避ける
2. コード中にこれらのパターンが含まれる場合は、該当部分を別ファイルに分離して直接処理する
3. `encoding-evasion` カテゴリは `warn`（警告のみ）であり、ブロックされません。`block` 扱いのカテゴリのみが実際にブロックされます

---

### 入力サイズ超過 (CTS-5002)

**症状:**

- エラーメッセージ: `[CTS-5002] 入力トークン数 (X) がTier Y の上限 (Z) を超えています。`
- 大きなファイルやコンテキストが処理できない

**原因:**

- 入力テキストのトークン数が、選択された Tier のコンテキストウィンドウ上限を超えている

**解決策:**

1. `compress_context` ツールで先に要約してから `offload_work` に渡す:

   ```text
   compress_context({ content: "...(長いテキスト)..." })
   → 要約結果を offload_work に渡す
   ```

2. 入力テキストを手動で分割して、複数回に分けて処理する

3. より大きなコンテキストウィンドウを持つ Tier に切り替える:

   ```bash
   export TIER_OVERRIDE=3
   ```

   ただし、高い Tier はより多くのメモリを必要とします。

---

### 設定エラー (CTS-6001)

**症状:**

- エラーメッセージ: `[CTS-6001] 設定エラー: <configKey> — <reason>`
- サーバー起動時に発生することが多い

**原因:**

- 設定ファイルの JSON 構文エラー
- 設定値が許容範囲外

**解決策:**

1. 設定ファイルの JSON 構文を検証する:

   ```bash
   cat ~/.config/claude-token-saver/config.json | python3 -m json.tool
   ```

2. 設定ファイルの場所: `~/.config/claude-token-saver/config.json`

3. 設定を初期化したい場合は、設定ファイルを削除して再起動する（デフォルト値が使われます）:

   ```bash
   rm ~/.config/claude-token-saver/config.json
   ```

4. 環境変数で個別にオーバーライドできます（`.env.example` を参照）

---

## パフォーマンス改善のヒント

### 初回推論を速くする

- `preload_model` ツールを使って、事前にモデルを GPU メモリにロードしておく
- `PRELOAD_KEEP_ALIVE=-1` を設定すると、モデルがメモリから自動アンロードされなくなる

### メモリ不足への対処

- `TIER_OVERRIDE` で低い Tier（軽量モデル）を指定する:

  ```bash
  export TIER_OVERRIDE=1
  ```

- `ollama ps` で現在ロードされているモデルを確認し、不要なモデルをアンロードする

### GPU を最大限活用する

- Ollama がすべての GPU レイヤーを使用するよう設定する:

  ```bash
  export OLLAMA_NUM_GPU=999
  ```

- `nvidia-smi` で GPU 使用率を監視する

### 複数エージェントでの利用

- キューサイズとタイムアウトを適切に設定する
- レートリミットを環境に合わせて調整する
- 動的モデルセレクターを有効にする: `MODEL_SELECTOR_ENABLED=true`

---

## エラーコード一覧表

| コード | エラー名 | 説明 | HTTP | 再試行 | Cloud フォールバック |
|---|---|---|---|---|---|
| CTS-1001 | OllamaNotRunningError | Ollama に接続できない | 503 | 可 | あり |
| CTS-1002 | OllamaVersionError | Ollama バージョンが非対応 | 503 | 可 | あり |
| CTS-2001 | ModelLoadTimeoutError | モデルロードのタイムアウト | 504 | 不可 | あり |
| CTS-2002 | GenerationTimeoutError | 生成中のタイムアウト | 504 | 不可 | あり |
| CTS-3001 | ModelNotFoundError | モデルが見つからない | 404 | 可 | なし |
| CTS-4001 | QueueFullError | キューが満杯 | 429 | 不可 | あり |
| CTS-4002 | RateLimitError | レートリミット超過 | 429 | 可 | あり |
| CTS-5001 | PromptInjectionError | プロンプトインジェクション検知 | 400 | 不可 | なし |
| CTS-5002 | ContextOverflowError | 入力トークン数超過 | 400 | 不可 | なし |
| CTS-6001 | InvalidConfigError | 設定ファイルエラー | 500 | 不可 | なし |

**再試行について:**

- 「可」のエラーは一時的な問題であり、時間をおいて再試行できます
- エラーレスポンスに `RETRY: このエラーは一時的です。しばらく後に再試行できます。` と表示されます

**Cloud フォールバックについて:**

- 「あり」のエラーが発生した場合、CTS はクラウド API での直接処理を推奨します
- エラーレスポンスに `FALLBACK: このタスクはクラウドAPIで直接処理してください。` と表示されます

---

## ログの確認方法

CTS は **stderr** に [pino](https://getpino.io/) の JSON 形式でログを出力します。

### ログレベルの設定

```bash
# 詳細なデバッグログを有効にする
export LOG_LEVEL=debug

# 利用可能なレベル: trace, debug, info, warn, error, fatal
# デフォルト: info
```

### ログの確認コマンド

```bash
# リアルタイムでログを確認（人間が読みやすい形式に変換）
npx pino-pretty < /dev/stderr

# JSON ログから特定のエラーコードを検索
# CTS のログは stderr に出力されるため、リダイレクトして確認する
node dist/server.js 2>cts.log
cat cts.log | grep "CTS-" | npx pino-pretty

# 特定のエラーコードでフィルタ
cat cts.log | grep "CTS-1001"
```

### MCP クライアント（Claude Desktop 等）でのログ確認

Claude Desktop で利用している場合、MCP サーバーの stderr 出力はクライアント側のログに記録されます。クライアントのログファイルの場所はクライアントのドキュメントを参照してください。

---

## それでも解決しない場合

1. `LOG_LEVEL=debug` で詳細ログを取得し、エラーの詳細を確認する
2. Ollama 自体のログを確認する（`ollama serve` のターミナル出力）
3. GitHub Issues で同様の問題が報告されていないか確認する
4. 再現手順とエラーログを添えて Issue を作成する
