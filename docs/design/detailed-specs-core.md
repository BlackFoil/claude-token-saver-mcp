# コアモジュール詳細関数仕様書

**プロジェクト:** claude-token-saver-mcp (PulseAgent Token Saver)
**バージョン:** v1.1
**作成日:** 2026-02-15
**作成者:** Architect Agent
**フェーズ:** Phase 3 -- 詳細設計

---

## 目次

1. [src/server.ts -- MCPサーバーエントリポイント](#1-srcserverts--mcpサーバーエントリポイント)
2. [src/tools/offload-work.ts](#2-srctoolsoffload-workts)
3. [src/tools/compress-context.ts](#3-srctoolscompress-contextts)
4. [src/ollama/client.ts -- OllamaClient](#4-srcollamaclientts--ollamaclient)
5. [src/tiering/detector.ts -- Tier判定](#5-srctieringdetectorts--tier判定)
6. [src/queue/fifo-queue.ts -- FIFOQueue](#6-srcqueuefifo-queuets--fifoqueue)
7. [server.ts 初期化フロー (v0.3.0追加)](#7-serverts-初期化フロー-v030追加)
8. [src/tools/batch-offload.ts (P6-001)](#8-srctoolsbatch-offloadts-p6-001)
9. [src/queue/priority-queue.ts (P6-002)](#9-srcqueuepriority-queuets-p6-002)
10. [src/ollama/load-balancer.ts (P6-004)](#10-srcollamaload-balancerts-p6-004)
11. [src/tools/auto-setup.ts (v0.3.0)](#11-srctoolsauto-setupts-v030)
12. [型定義一覧](#12-型定義一覧)
13. [エラーコード対応表](#13-エラーコード対応表)
14. [モジュール依存関係図](#14-モジュール依存関係図)

---

## 1. src/server.ts -- MCPサーバーエントリポイント

MCPサーバーのライフサイクル管理を行うモジュール。初期化、ツール登録、シャットダウンの3つの責務を持つ。

### 1.1 依存モジュール

| モジュール | インポート対象 |
|:---|:---|
| `@modelcontextprotocol/sdk` | `Server`, `StdioServerTransport` |
| `src/tools/offload-work.ts` | `handleOffloadWork` |
| `src/tools/compress-context.ts` | `handleCompressContext` |
| `src/ollama/client.ts` | `OllamaClient` |
| `src/tiering/detector.ts` | `detectTier` |
| `src/queue/fifo-queue.ts` | `FIFOQueue` |
| `src/cost/calculator.ts` | `CostCalculator` |
| `src/config/loader.ts` | `loadConfig` |
| `pino` | `Logger` |

### 1.2 main()

```typescript
async function main(): Promise<void>
```

**責務:** MCPサーバーのエントリポイント。初期化シーケンスを実行し、stdioトランスポートでサーバーを起動する。

**処理フロー:**

1. `loadConfig()` で設定ファイル (`~/.config/claude-token-saver/config.json`) を読み込む
2. `detectTier()` でシステムRAMからTier判定を行う
3. `OllamaClient` を生成し `healthCheck()` を実行する
4. `FIFOQueue` を生成する
5. `CostCalculator` を生成し、既存のコスト履歴をロードする
6. `registerTools()` でMCPツールを登録する
7. `StdioServerTransport` を生成し `server.connect(transport)` を呼び出す
8. `handleShutdown()` でシグナルハンドラを登録する
9. stderrにTier情報・起動メッセージを出力する

**エラー条件:**

| 条件 | エラークラス | コード | 処理 |
|:---|:---|:---|:---|
| 設定ファイルのJSONが不正 | `InvalidConfigError` | CTS-6001 | stderrに警告を出力し、デフォルト設定で続行 |
| Ollamaが未起動 | `OllamaNotRunningError` | CTS-1001 | stderrに警告を出力し、MCPサーバーは起動する（ツール呼出時にフォールバック） |
| Ollamaバージョン不足 (< 0.1.34) | `OllamaVersionError` | CTS-1002 | stderrに警告を出力し、MCPサーバーは起動する |

**実装上の注意点:**
- `main()` 内でのエラーはMCPサーバーの起動を妨げてはならない。Ollamaが利用不可でもサーバー自体は起動し、ツール呼出時にフォールバックレスポンスを返す
- pinoロガーの出力先は必ずstderr (fd=2) とする。stdoutはMCPプロトコル通信専用
- top-level awaitを使用してESMモジュールとして起動する

**対応テストID:** I-07 (設定ファイル反映), MS-01 (MCP初期化ハンドシェイク), CF-01~CF-06 (設定読み込み)

---

### 1.3 registerTools()

```typescript
function registerTools(
  server: Server,
  dependencies: {
    ollamaClient: OllamaClient;
    queue: FIFOQueue<OllamaTaskPayload, OllamaChatResponse>;
    tierConfig: TierConfig;
    costCalculator: CostCalculator;
    logger: Logger;
    ollamaHealthy: boolean;
  },
): void
```

**責務:** MCPサーバーに `offload_work` と `compress_context` の2ツールを登録する。

**処理フロー:**

1. `server.setRequestHandler(ListToolsRequestSchema, ...)` でツール一覧を定義
2. `server.setRequestHandler(CallToolRequestSchema, ...)` でツール呼び出しハンドラを定義
3. ツール呼び出しハンドラ内で `name` に基づいてルーティング:
   - `"offload_work"` -> `handleOffloadWork()`
   - `"compress_context"` -> `handleCompressContext()`
   - その他 -> `MethodNotFoundError`

**引数の説明:**

| 引数 | 型 | 説明 |
|:---|:---|:---|
| `server` | `Server` | MCP SDKのサーバーインスタンス |
| `dependencies.ollamaClient` | `OllamaClient` | Ollama APIクライアント |
| `dependencies.queue` | `FIFOQueue` | リクエストキュー |
| `dependencies.tierConfig` | `TierConfig` | 現在のTier設定 |
| `dependencies.costCalculator` | `CostCalculator` | コスト計算器 |
| `dependencies.logger` | `Logger` | pinoロガー |
| `dependencies.ollamaHealthy` | `boolean` | Ollamaの初期化時ヘルスチェック結果 |

**エラー条件:**

| 条件 | エラークラス | コード |
|:---|:---|:---|
| 未知のツール名が指定された | `McpError` (SDK組込) | `-32601` (MethodNotFound) |

**実装上の注意点:**
- `ollamaHealthy === false` の場合でもツール登録は行う。ツール呼出時に `handleOffloadWork` / `handleCompressContext` 内でOllamaの再チェックを行い、不可であればフォールバックを返す
- ツール定義のJSON Schemaは `mcp-server-design.md` セクション1.1, 1.2で定義された `inputSchema` をそのまま使用する

**対応テストID:** MT-06 (ツール一覧の返却), MS-02 (ツール一覧取得), MS-06 (未知のツール呼び出し)

---

### 1.4 handleShutdown()

```typescript
function handleShutdown(
  server: Server,
  dependencies: {
    costCalculator: CostCalculator;
    logger: Logger;
  },
): void
```

**責務:** SIGTERM / SIGINT シグナルを受信した際に、グレースフルシャットダウンを実行する。

**処理フロー:**

1. `process.on('SIGTERM', ...)` と `process.on('SIGINT', ...)` を登録
2. シグナル受信時:
   a. stderrに停止ログを出力（累計リクエスト数、累計節約額）
   b. `costCalculator` の累計データを `cost-history.json` に永続化
   c. `server.close()` を呼び出しMCPサーバーを停止
   d. `process.exit(0)` で終了

**エラー条件:**

| 条件 | 処理 |
|:---|:---|
| コスト履歴の書き込みに失敗 | stderrにエラーログを出力し、`process.exit(0)` で終了（書き込み失敗でも終了をブロックしない） |

**実装上の注意点:**
- シグナルハンドラは1回のみ実行されるようガード（二重呼び出し防止）
- `process.exit(0)` の前に非同期処理の完了を最大5秒間待機する

**対応テストID:** -- (ユニットテスト対象外。統合テストで暗黙的に確認)

---

## 2. src/tools/offload-work.ts

Claude Code Agent Teamsから定型タスクをローカルLLMにオフロードするツールのハンドラ。

### 2.1 依存モジュール

| モジュール | インポート対象 |
|:---|:---|
| `src/ollama/client.ts` | `OllamaClient`, `OllamaChatResponse` |
| `src/queue/fifo-queue.ts` | `FIFOQueue` |
| `src/cost/calculator.ts` | `CostCalculator` |
| `src/tiering/detector.ts` | `TierConfig` |
| `src/validators/input-validator.ts` | `validateInput` |
| `src/validators/prompt-guard.ts` | `sanitizeUserInput` |
| `src/config/schema.ts` | `SYSTEM_PROMPT`, `buildChatMessages`, `formatUserPrompt` |
| `pino` | `Logger` |

### 2.2 handleOffloadWork()

```typescript
async function handleOffloadWork(
  input: OffloadWorkInput,
  context: ToolHandlerContext,
): Promise<CallToolResult>
```

**責務:** `offload_work` ツール呼び出しのメイン処理。入力バリデーションからOllama呼出、コスト計算、レスポンス構築までの全ステップを実行する。

**引数:**

| 引数 | 型 | 説明 |
|:---|:---|:---|
| `input` | `OffloadWorkInput` | MCPツールの入力パラメータ。`task` (必須), `context` (任意), `language` (任意), `output_format` (任意) |
| `context` | `ToolHandlerContext` | 共有依存オブジェクト（後述） |

**戻り値:** `CallToolResult` (MCP SDK型)

```typescript
interface ToolHandlerContext {
  ollamaClient: OllamaClient;
  queue: FIFOQueue<OllamaTaskPayload, OllamaChatResponse>;
  tierConfig: TierConfig;
  costCalculator: CostCalculator;
  logger: Logger;
  ollamaHealthy: boolean;
}
```

**処理フロー（10ステップ）:**

```
Step 1: Ollama可用性チェック
  ├─ ollamaHealthy === false → Ollamaに再度 healthCheck() を試行
  ├─ 再チェック成功 → 続行
  └─ 再チェック失敗 → createFallbackResponse("OLLAMA_UNREACHABLE", ...) を返却

Step 2: 入力バリデーション
  ├─ input.task が空文字 → CTS-5002 エラーレスポンス
  ├─ input.task 長さが 50,000 文字超 → CTS-5002 エラーレスポンス
  └─ input.context 長さが 100,000 文字超 → CTS-5002 エラーレスポンス

Step 3: プロンプトインジェクション検査
  ├─ sanitizeUserInput(input.task) → 疑わしいパターン検出
  │   └─ 検出 → CTS-5001 エラーレスポンス（ログ出力あり）
  └─ sanitizeUserInput(input.context) → 同上

Step 4: リクエストサイズ計算
  ├─ requestSizeBytes = Buffer.byteLength(input.task + (input.context ?? ''), 'utf-8')
  └─ requestSizeBytes > maxRequestSizeBytes → CTS-4001 エラーレスポンス

Step 5: チャットメッセージ構築
  ├─ system: SYSTEM_PROMPT（固定、上書き不可）
  └─ user: formatUserPrompt(input.task, input.context)

Step 6: キュー投入
  ├─ queue.enqueue(ollamaPayload, requestSizeBytes)
  ├─ キュー満杯 → createFallbackResponse("QUEUE_FULL", ...) を返却
  ├─ レートリミット超過 → createFallbackResponse("RATE_LIMITED", ...) を返却
  └─ キュー待ちタイムアウト → createFallbackResponse("TIMEOUT_QUEUE", ...) を返却

Step 7: Ollama呼び出し（キューのprocessor内）
  ├─ ollamaClient.chat({ model, messages, stream: true, options })
  ├─ Tier 1かつprimaryModel失敗 → fallbackModelで再試行
  ├─ 初回トークンタイムアウト → createFallbackResponse("TIMEOUT_FIRST_TOKEN", ...) を返却
  ├─ ハートビートタイムアウト → createFallbackResponse("TIMEOUT_HEARTBEAT", ...) を返却
  ├─ リクエストタイムアウト → createFallbackResponse("TIMEOUT_REQUEST", ...) を返却
  └─ Ollamaエラー (5xx) → createFallbackResponse("OLLAMA_ERROR", ...) を返却

Step 8: コスト計算
  ├─ costCalculator.calculate({ tool: 'offload_work', model, inputTokens, outputTokens, processingTimeMs })
  └─ { savings, cumulative } を取得

Step 9: stderrログ出力
  ├─ pinoロガーでinfo: リクエスト完了ログ
  └─ emitCostToStderr(): "[CTS Cost] offload_work | 今回: $X.XXXX | 累計: $X.XXXX | tokens: N→M"

Step 10: レスポンス構築
  └─ buildToolResponse(ollamaResponse.text, { thisSavingUSD, totalSavingUSD, model, inputTokens, outputTokens, durationMs })
```

**エラー条件と対応:**

| # | 条件 | エラーコード | 処理 | フォールバック |
|:---|:---|:---|:---|:---:|
| 1 | Ollama未起動 | CTS-1001 | `createFallbackResponse` | Yes |
| 2 | 入力が空 | CTS-5002 | `isError: true` レスポンス | No |
| 3 | 入力サイズ超過 | CTS-5002 | `isError: true` レスポンス | No |
| 4 | PI検出 | CTS-5001 | `isError: true` レスポンス + セキュリティログ | No |
| 5 | リクエストサイズ超過 | CTS-4001 (QUEUE) | `createFallbackResponse` | Yes |
| 6 | キュー満杯 | CTS-4001 | `createFallbackResponse` | Yes |
| 7 | レートリミット超過 | CTS-4002 | `createFallbackResponse` | Yes |
| 8 | キュー待ちタイムアウト | CTS-4001 (TIMEOUT) | `createFallbackResponse` | Yes |
| 9 | 初回トークンタイムアウト | CTS-2001 | `createFallbackResponse` (Tier1はモデルフォールバック試行) | Yes |
| 10 | ハートビートタイムアウト | CTS-2002 | `createFallbackResponse` | Yes |
| 11 | リクエストタイムアウト | CTS-2002 | `createFallbackResponse` | Yes |
| 12 | Ollamaランタイムエラー | CTS-1001 | `createFallbackResponse` | Yes |

**実装上の注意点:**
- `isError: true` のフォールバックレスポンスには `[FALLBACK_TO_CLOUD]` プレフィックスを含め、Claudeが自身でタスクを処理するよう誘導する
- フォールバック時は `input.task` の原文を含め、Claudeが再処理に必要な情報を失わないようにする
- `try-catch` で全ステップを囲み、予期しないエラーもフォールバックとして処理する

**対応テストID:** MT-01 (offload_work正常実行), MT-04 (スキーマバリデーション), I-01 (完全フロー), I-04 (タイムアウト->フォールバック), I-05 (接続失敗->フォールバック), V-01~V-15 (バリデーション), PI-01~PI-15 (PI検出), TO-04 (タイムアウトフォールバック)

---

## 3. src/tools/compress-context.ts

巨大なファイル内容やログをローカルLLMで要約し、要点のみをクラウドに返すツールのハンドラ。

### 3.1 依存モジュール

| モジュール | インポート対象 |
|:---|:---|
| `src/ollama/client.ts` | `OllamaClient`, `OllamaChatResponse` |
| `src/queue/fifo-queue.ts` | `FIFOQueue` |
| `src/cost/calculator.ts` | `CostCalculator` |
| `src/tiering/detector.ts` | `TierConfig` |
| `src/validators/input-validator.ts` | `validateInput` |
| `src/validators/prompt-guard.ts` | `sanitizeUserInput` |
| `src/config/schema.ts` | `SYSTEM_PROMPT`, `buildChatMessages` |
| `pino` | `Logger` |

### 3.2 handleCompressContext()

```typescript
async function handleCompressContext(
  input: CompressContextInput,
  context: ToolHandlerContext,
): Promise<CallToolResult>
```

**責務:** `compress_context` ツール呼び出しのメイン処理。コンテキスト長チェック、切り詰め処理を含む。

**引数:**

| 引数 | 型 | 説明 |
|:---|:---|:---|
| `input` | `CompressContextInput` | MCPツールの入力パラメータ。`content` (必須), `focus` (任意), `max_length` (任意, デフォルト2000) |
| `context` | `ToolHandlerContext` | 共有依存オブジェクト（`handleOffloadWork` と同一型） |

**戻り値:** `CallToolResult` (MCP SDK型)

**処理フロー（11ステップ）:**

```
Step 1: Ollama可用性チェック
  └─ handleOffloadWork Step 1 と同一

Step 2: 入力バリデーション
  ├─ input.content が空文字 → CTS-5002 エラーレスポンス
  ├─ input.content 長さが 200,000 文字超 → CTS-5002 エラーレスポンス
  ├─ input.focus 長さが 500 文字超 → CTS-5002 エラーレスポンス
  └─ input.max_length が範囲外 (100未満 or 10000超) → CTS-5002 エラーレスポンス

Step 3: プロンプトインジェクション検査
  ├─ sanitizeUserInput(input.content) → 疑わしいパターン検出
  └─ sanitizeUserInput(input.focus) → 同上

Step 4: コンテキスト長チェック & 切り詰め
  ├─ estimatedTokens = estimateTokenCount(input.content)
  ├─ estimatedTokens <= tierConfig.contextLimit → そのまま続行（truncated = false）
  └─ estimatedTokens > tierConfig.contextLimit →
      ├─ contentLimit = Math.floor(tierConfig.contextLimit * 0.9)
      ├─ truncatedContent = truncateByTokens(input.content, contentLimit)
      ├─ truncated = true
      └─ logger.warn("コンテキストカットオフ発生", { inputTokens, maxTokens, truncatedTokens })

Step 5: リクエストサイズ計算
  └─ handleOffloadWork Step 4 と同一

Step 6: 要約プロンプト構築
  ├─ system: SYSTEM_PROMPT（固定）
  └─ user: buildCompressPrompt(truncatedContent, input.focus, input.max_length)

Step 7: キュー投入
  └─ handleOffloadWork Step 6 と同一

Step 8: Ollama呼び出し
  └─ handleOffloadWork Step 7 と同一

Step 9: コスト計算
  └─ costCalculator.calculate({ tool: 'compress_context', ... })

Step 10: stderrログ出力
  └─ handleOffloadWork Step 9 と同一

Step 11: レスポンス構築
  ├─ truncated === true の場合 →
  │   テキスト先頭に警告メッセージを付与:
  │   "[WARNING: Input truncated from ~{original}to ~{truncated} tokens due to Tier {N} context limit ({limit} tokens). Only the first portion was summarized.]"
  └─ buildToolResponse(responseText, { ..., truncated, originalLength, compressedLength, compressionRatio })
```

**追加ヘルパー関数:**

#### 3.2.1 estimateTokenCount()

```typescript
function estimateTokenCount(text: string): number
```

**責務:** テキストの推定トークン数を算出する。正確なトークナイザは使用せず、ヒューリスティックで近似する。

**アルゴリズム:**
- 英語テキスト: `Math.ceil(text.length / 4)` (1トークン ≈ 4文字)
- 日本語テキスト: `Math.ceil(text.length / 1.5)` (1トークン ≈ 1.5文字)
- 判定方法: テキスト先頭256文字のCJK文字率が50%以上なら日本語扱い

**実装上の注意点:**
- これは近似値であり、実際のOllamaトークナイザとは異なる。安全マージンとして10%のバッファを設ける
- `tierConfig.contextLimit * 0.9` をコンテンツ用上限とすることで、System Prompt + レスポンス用の余裕を確保

**対応テストID:** MT-03 (コンテキスト上限超過時のカットオフ)

#### 3.2.2 truncateByTokens()

```typescript
function truncateByTokens(text: string, maxTokens: number): string
```

**責務:** テキストを指定トークン数に収まるよう先頭から切り詰める。

**処理:**
1. `estimateTokenCount(text)` が `maxTokens` 以下ならそのまま返す
2. 超過する場合、文字数ベースで切り詰め位置を計算
3. 切り詰め位置を単語境界（空白 or 改行）に調整

**対応テストID:** MT-03 (カットオフ), I-06 (コンテキスト上限超過の処理)

#### 3.2.3 buildCompressPrompt()

```typescript
function buildCompressPrompt(
  content: string,
  focus?: string,
  maxLength?: number,
): string
```

**責務:** compress_context用のユーザープロンプトを構築する。

**出力フォーマット:**

```
Summarize the following content.
{focus ? `Focus on: ${focus}` : ''}
{maxLength ? `Target maximum length: ${maxLength} characters.` : ''}

---
Content:
{content}
```

**対応テストID:** MT-02 (compress_context正常実行), MT-05 (スキーマバリデーション)

**handleCompressContext エラー条件:**

`handleOffloadWork` のエラー条件に加えて:

| # | 条件 | エラーコード | 処理 |
|:---|:---|:---|:---|
| 追加1 | コンテキスト長が Tier上限超過 | -- (エラーではない) | 切り詰めて続行 + 警告メッセージ付与 |
| 追加2 | max_length が範囲外 | CTS-5002 | `isError: true` レスポンス |

**対応テストID:** MT-02 (compress_context正常実行), MT-03 (カットオフ), MT-05 (スキーマバリデーション), I-02 (完全フロー), I-06 (コンテキスト上限超過の処理)

---

## 4. src/ollama/client.ts -- OllamaClient

Ollama APIとの通信を担うクライアントクラス。全てのAPIリクエストにストリーミング (`stream: true`) を使用する。

### 4.1 依存モジュール

| モジュール | インポート対象 |
|:---|:---|
| `node:crypto` | `randomUUID` |
| `pino` | `Logger` |
| `src/tiering/detector.ts` | `TierConfig`, `TimeoutConfig` |

### 4.2 OllamaClient クラス設計

```typescript
class OllamaClient {
  private readonly config: OllamaClientConfig;
  private readonly logger: Logger;

  constructor(config: OllamaClientConfig, logger: Logger);

  async chat(request: OllamaChatRequest): Promise<OllamaChatResponse>;
  async healthCheck(): Promise<boolean>;
  async getVersion(): Promise<string>;
  async listModels(): Promise<OllamaModelInfo[]>;
  async pullModel(name: string): Promise<void>;
}
```

### 4.3 constructor()

```typescript
constructor(config: OllamaClientConfig, logger: Logger)
```

**引数:**

| 引数 | 型 | 説明 |
|:---|:---|:---|
| `config` | `OllamaClientConfig` | 接続設定 |
| `logger` | `Logger` | pinoロガーインスタンス |

```typescript
interface OllamaClientConfig {
  baseUrl: string;           // デフォルト: 'http://127.0.0.1:11434'
  requestTimeout: number;    // Tier別動的タイムアウト（ms）
  heartbeatTimeout: number;  // チャンク間最大許容間隔（ms）
  firstTokenTimeout: number; // 初回トークン到着までの猶予（ms）
}
```

**実装上の注意点:**
- `baseUrl` の末尾スラッシュは正規化して除去する
- タイムアウト値は `TierConfig.timeout` から渡される

### 4.4 chat()

```typescript
async chat(request: OllamaChatRequest): Promise<OllamaChatResponse>
```

**責務:** `/api/chat` エンドポイントにストリーミングリクエストを送信し、全チャンクを結合した最終結果を返す。ハートビートタイムアウト監視を内蔵する。

**引数:**

```typescript
interface OllamaChatRequest {
  model: string;
  messages: OllamaChatMessage[];
  stream: true;              // 常にtrue
  options?: {
    num_ctx?: number;        // コンテキストウィンドウサイズ（Tier別）
    temperature?: number;    // デフォルト: 0.1（コード生成向け低温度）
    top_p?: number;
    num_predict?: number;    // 最大出力トークン数
  };
}

interface OllamaChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}
```

**戻り値:**

```typescript
interface OllamaChatResponse {
  text: string;                // 結合済み全文テキスト
  inputTokens: number;         // prompt_eval_count
  outputTokens: number;        // eval_count
  totalDurationMs: number;     // total_duration / 1_000_000（ナノ秒→ミリ秒）
  loadDurationMs: number;      // load_duration / 1_000_000
  model: string;
}
```

**処理フロー:**

```
1. AbortController を生成
2. タイムアウトマネージャーを生成（requestTimeout, firstTokenTimeout, heartbeatTimeout）
3. fetch(baseUrl + '/api/chat', {
     method: 'POST',
     headers: { 'Content-Type': 'application/json' },
     body: JSON.stringify(request),
     signal: abortController.signal,
   })
4. レスポンスステータスの検証
   ├─ 200以外 → OllamaConnectionError をスロー
   └─ 200 → ストリーミングパースを開始
5. NDJSONストリーミングパース:
   ├─ response.body を ReadableStream として取得
   ├─ TextDecoder でデコード
   ├─ 改行区切りでJSONをパース
   ├─ 各チャンクについて:
   │   ├─ 初回チャンク → onFirstToken() (firstTokenTimerをクリア)
   │   ├─ done === false → fullText += chunk.message.content; onChunk() (ハートビートリセット)
   │   └─ done === true → finalChunk として保持
   └─ ストリーム終了
6. finalChunk が null → Error('Stream ended without final chunk')
7. タイムアウトマネージャーの cleanup()
8. OllamaChatResponse を構築して返却
```

**エラー条件:**

| # | 条件 | エラークラス | コード |
|:---|:---|:---|:---|
| 1 | fetch が `TypeError` (接続拒否) | `OllamaNotRunningError` | CTS-1001 |
| 2 | HTTPステータスが 200以外 | `OllamaConnectionError` | CTS-1001 |
| 3 | 初回トークンタイムアウト | `ModelLoadTimeoutError` | CTS-2001 |
| 4 | ハートビートタイムアウト | `GenerationTimeoutError` | CTS-2002 |
| 5 | リクエスト全体タイムアウト | `GenerationTimeoutError` | CTS-2002 |
| 6 | `AbortError` (シグナルによる中断) | 元のタイムアウトエラーに変換 | CTS-2001/CTS-2002 |
| 7 | NDJSONパースエラー | `OllamaConnectionError` | CTS-1001 |
| 8 | finalChunkがnull (ストリーム不完全終了) | `OllamaConnectionError` | CTS-1001 |

**実装上の注意点:**
- Node.js 20のネイティブ `fetch` を使用する（サードパーティライブラリ不要）
- `AbortController.abort()` に `TimeoutError` インスタンスを渡し、`catch` ブロックで `signal.reason` から元のエラーを復元する
- NDJSONパースでは改行区切りでバッファリングし、不完全な行は次のチャンクと結合する
- ナノ秒→ミリ秒変換は `/ 1_000_000` で行う（`BigInt` は不要、`number` の精度で十分）

**対応テストID:** OC-01 (chat呼び出し成功), OC-03 (System Prompt付与確認), OC-04 (stream:true設定), OC-06 (接続エラーハンドリング), OC-07 (HTTPエラーハンドリング), OC-08 (トークン数抽出), I-08 (ストリーミングレスポンス処理), TO-05 (ハートビート検出), TO-06 (ハートビート途絶)

---

### 4.5 healthCheck()

```typescript
async healthCheck(): Promise<boolean>
```

**責務:** Ollamaサーバーの稼働確認を行う。

**処理:**
1. `GET {baseUrl}/` に対してfetchリクエストを送信（タイムアウト: 5000ms）
2. レスポンスが "Ollama is running" を含むか検証

**戻り値:** `true`（稼働中）/ `false`（接続不可）

**エラー条件:** エラーはスローせず、全て `false` を返す。

**実装上の注意点:**
- `AbortController` と `setTimeout(5000)` で5秒のタイムアウトを設定
- ネットワークエラーは `try-catch` で捕捉し `false` を返す

**対応テストID:** OC-05 (ベースURL設定), OC-06 (接続エラー)

---

### 4.6 getVersion()

```typescript
async getVersion(): Promise<string>
```

**責務:** Ollamaのバージョンを取得し、最低要件 (>= 0.1.34) を検証する。

**処理:**
1. `GET {baseUrl}/api/version` を呼び出す
2. レスポンスJSONから `version` フィールドを取得
3. セマンティックバージョン比較で `>= 0.1.34` を検証

**戻り値:** バージョン文字列 (例: `"0.5.4"`)

**エラー条件:**

| 条件 | エラークラス | コード |
|:---|:---|:---|
| 接続エラー | `OllamaNotRunningError` | CTS-1001 |
| バージョン < 0.1.34 | `OllamaVersionError` | CTS-1002 |

**実装上の注意点:**
- バージョン比較は `semver` ライブラリを使わず、シンプルな文字列分割 + 数値比較で実装する（依存を増やさない）
- CVE-2024-28224 (パストラバーサル) と CVE-2024-37032 (RCE) の修正を含む 0.1.34 以上を要件とする

**対応テストID:** OC-09 (モデル存在確認)

---

### 4.7 listModels()

```typescript
async listModels(): Promise<OllamaModelInfo[]>
```

**責務:** Ollamaにインストール済みのモデル一覧を取得する。

**処理:**
1. `GET {baseUrl}/api/tags` を呼び出す
2. レスポンスJSONの `models` 配列をパース

**戻り値:**

```typescript
interface OllamaModelInfo {
  name: string;       // 例: "qwen2.5-coder:7b"
  size: number;       // バイト数
  digest: string;     // SHA256ダイジェスト
  modified_at: string; // ISO 8601タイムスタンプ
}
```

**エラー条件:**

| 条件 | エラークラス | コード |
|:---|:---|:---|
| 接続エラー | `OllamaNotRunningError` | CTS-1001 |

**対応テストID:** OC-09 (モデル存在確認)

---

### 4.8 pullModel()

```typescript
async pullModel(name: string): Promise<void>
```

**責務:** 指定モデルをOllamaにダウンロードする。進捗をstderrに出力する。

**処理:**
1. `POST {baseUrl}/api/pull` に `{ name, stream: true }` を送信
2. NDJSONストリーミングで進捗を読み取る
3. 各チャンクの `status` / `completed` / `total` フィールドからパーセンテージを計算
4. stderrに進捗を出力: `[INFO] Pulling model "name"... XX%`
5. `status === "success"` でpull完了

**エラー条件:**

| 条件 | エラークラス | コード |
|:---|:---|:---|
| 接続エラー | `OllamaNotRunningError` | CTS-1001 |
| モデル名不正 | `ModelNotFoundError` | CTS-3001 |
| pull途中のエラー | `OllamaConnectionError` | CTS-1001 |

**実装上の注意点:**
- pullはモデルサイズによって数分〜数十分かかるため、専用のタイムアウト（10分）を設定する
- `stream: true` で進捗を監視し、5分間進捗が無い場合はタイムアウトとする
- MCPサーバーはstdioで動作するため、ユーザーへの確認ダイアログは出せない。stderrへの通知で代替する

**対応テストID:** OC-10 (モデルpull確認), E-03 (モデル自動pull確認)

---

## 5. src/tiering/detector.ts -- Tier判定

システムのRAM量に基づいてTier (Light / Standard / Ultra) を自動判定するモジュール。

### 5.1 依存モジュール

| モジュール | インポート対象 |
|:---|:---|
| `node:os` | `totalmem` |
| `src/config/loader.ts` | `ServerConfig` |

### 5.2 detectTier()

```typescript
function detectTier(totalMemoryGB?: number): TierConfig
```

**責務:** システムRAM量からTierを判定し、対応する設定を返す。

**引数:**

| 引数 | 型 | デフォルト値 | 説明 |
|:---|:---|:---|:---|
| `totalMemoryGB` | `number \| undefined` | `os.totalmem() / (1024 ** 3)` | テスト用にRAM量を外部注入可能 |

**戻り値:**

```typescript
interface TierConfig {
  level: TierLevel;         // 1 | 2 | 3
  name: string;             // 'Light' | 'Standard' | 'Ultra'
  primaryModel: string;     // Tier別プライマリモデル名
  fallbackModel: string | null; // Tier 1のみ 'phi4-mini:latest'
  contextLimit: number;     // トークン数上限
  ramRange: {
    min: number;            // GB（inclusive）
    max: number;            // GB（exclusive, Tier 3は Infinity）
  };
  timeout: TimeoutConfig;
}

type TierLevel = 1 | 2 | 3;

interface TimeoutConfig {
  requestTimeout: number;     // リクエスト全体のタイムアウト（ms）
  heartbeatTimeout: number;   // チャンク間最大間隔（ms）
  firstTokenTimeout: number;  // 初回トークン到着までの猶予（ms）
}
```

**判定ロジック:**

| 条件 | Tier | モデル | コンテキスト | タイムアウト (req/hb/first) |
|:---|:---|:---|:---|:---|
| RAM < 16GB | 1 (Light) | `phi4:latest` (FB: `phi4-mini:latest`) | 4,000 | 60s / 30s / 120s |
| 16GB <= RAM < 48GB | 2 (Standard) | `qwen2.5-coder:7b` | 12,000 | 90s / 30s / 120s |
| RAM >= 48GB | 3 (Ultra) | `qwen2.5-coder:32b` | 32,000 | 180s / 45s / 180s |

**エラー条件:**

| 条件 | エラークラス | コード |
|:---|:---|:---|
| totalMemoryGB <= 0 | `InvalidConfigError` | CTS-6001 |
| totalMemoryGB が NaN | `InvalidConfigError` | CTS-6001 |

**実装上の注意点:**
- `os.totalmem()` はバイト単位で返すため `/ (1024 ** 3)` でGB変換する
- 境界値の判定は `min <= RAM < max` とする（16GBちょうどはTier 2）
- テスト容易性のために `totalMemoryGB` パラメータを受け付ける。省略時は `os.totalmem()` を使用
- TIER_DEFINITIONS は `as const` で定義し、イミュータブルとする

**対応テストID:** T-01~T-12 (全ティアリングテスト)

---

### 5.3 applyConfigOverrides()

```typescript
function applyConfigOverrides(
  baseTier: TierConfig,
  overrides: Partial<TierConfigOverrides> | null,
): TierConfig
```

**責務:** 設定ファイルによるTier設定の上書きを適用する。

**引数:**

```typescript
interface TierConfigOverrides {
  primaryModel: string;
  fallbackModel: string | null;
  contextLimit: number;
  timeout: Partial<TimeoutConfig>;
}
```

**処理:**
1. `overrides` が `null` → `baseTier` をそのまま返す
2. `overrides` の各フィールドが定義されていればマージ（`baseTier` のフィールドを上書き）
3. `level`, `name`, `ramRange` は上書き不可（常に自動検出値を使用）

**上書き可能/不可フィールド:**

| フィールド | 上書き | 理由 |
|:---|:---:|:---|
| `level` | 不可 | RAM検出結果に基づく。強制変更は `forceLevel` で対応 |
| `name` | 不可 | `level` に連動 |
| `primaryModel` | 可 | カスタムモデルの使用を許可 |
| `fallbackModel` | 可 | `null` 設定でフォールバック無効化も可能 |
| `contextLimit` | 可 | モデルの実際のコンテキストサイズに合わせる |
| `ramRange` | 不可 | 判定ロジックの一貫性を維持 |
| `timeout.*` | 可 | 環境に応じた調整 |

**対応テストID:** T-10 (設定上書きでカスタムモデル), T-11 (Tier 1フォールバックモデル)

---

## 6. src/queue/fifo-queue.ts -- FIFOQueue

リクエストをFIFO順序で処理するPromise-basedキュー。同時実行数1、最大キュー長10。

### 6.1 依存モジュール

| モジュール | インポート対象 |
|:---|:---|
| `node:crypto` | `randomUUID` |
| `src/queue/rate-limiter.ts` | `RateLimiter` |
| `pino` | `Logger` |

### 6.2 FIFOQueue クラス設計

```typescript
class FIFOQueue<T, R> {
  private queue: QueueItem<T>[];
  private isProcessing: boolean;
  private config: QueueConfig;
  private processor: (item: T) => Promise<R>;
  private rateLimiter: RateLimiter | null;
  private logger: Logger;
  private stats: QueueInternalStats;

  constructor(
    config: QueueConfig,
    processor: (item: T) => Promise<R>,
    logger: Logger,
    rateLimiter?: RateLimiter,
  );

  async enqueue(payload: T, requestSizeBytes: number, agentId?: string): Promise<R>;
  getStatus(): QueueStats;
}
```

**ジェネリクスの説明:**

| 型パラメータ | 用途 | 実際の型 |
|:---|:---|:---|
| `T` | キューに投入されるペイロードの型 | `OllamaTaskPayload` |
| `R` | 処理結果の型 | `OllamaChatResponse` |

### 6.3 constructor()

```typescript
constructor(
  config: QueueConfig,
  processor: (item: T) => Promise<R>,
  logger: Logger,
  rateLimiter?: RateLimiter,
)
```

**引数:**

| 引数 | 型 | 説明 |
|:---|:---|:---|
| `config` | `QueueConfig` | キュー設定 |
| `processor` | `(item: T) => Promise<R>` | キューから取り出されたアイテムを処理するコールバック |
| `logger` | `Logger` | pinoロガー |
| `rateLimiter` | `RateLimiter \| undefined` | エージェント別レートリミッター（省略時はレートリミット無効） |

```typescript
interface QueueConfig {
  maxQueueLength: number;       // デフォルト: 10
  maxRequestSizeBytes: number;  // デフォルト: 200 * 1024 (200KB)
  queueTimeoutMs: number;       // キュー待ちタイムアウト（デフォルト: 60_000）
}
```

### 6.4 enqueue()

```typescript
async enqueue(
  payload: T,
  requestSizeBytes: number,
  agentId?: string,
): Promise<R>
```

**責務:** リクエストをキューに追加し、処理完了まで待機するPromiseを返す。

**引数:**

| 引数 | 型 | 説明 |
|:---|:---|:---|
| `payload` | `T` | キューに投入するペイロード |
| `requestSizeBytes` | `number` | リクエストサイズ（バイト）。`maxRequestSizeBytes` と比較 |
| `agentId` | `string \| undefined` | MCPリクエストの `_meta` から取得したエージェントID。レートリミットに使用 |

**戻り値:** `Promise<R>` -- 処理結果。`processor` コールバックの戻り値。

**処理フロー:**

```
1. リクエストサイズチェック
   └─ requestSizeBytes > config.maxRequestSizeBytes → QueueError('REQUEST_TOO_LARGE') をスロー

2. レートリミットチェック（rateLimiter が設定されている場合）
   └─ rateLimiter.check(agentId) === false → RateLimitError をスロー

3. キュー長チェック
   └─ queue.length >= config.maxQueueLength → QueueFullError をスロー

4. Promiseの生成
   ├─ new Promise<R>((resolve, reject) => { ... })
   ├─ QueueItem を生成: { id: randomUUID(), payload, enqueuedAt: Date.now(), resolve, reject }
   ├─ キュー待ちタイムアウトタイマーを設定: setTimeout(config.queueTimeoutMs)
   │   └─ タイムアウト発火 → キューからアイテムを除去 → reject(QueueError('QUEUE_TIMEOUT'))
   └─ queue.push(item)

5. processNext() を呼び出す（キュー処理ループの開始トリガー）

6. Promise が resolve/reject されるまで待機
```

**エラー条件:**

| # | 条件 | エラークラス | コード | retryable |
|:---|:---|:---|:---|:---:|
| 1 | リクエストサイズ超過 | `QueueError('REQUEST_TOO_LARGE')` | -- | No |
| 2 | レートリミット超過 | `RateLimitError` | CTS-4002 | Yes |
| 3 | キュー満杯 | `QueueFullError` | CTS-4001 | No |
| 4 | キュー待ちタイムアウト | `QueueError('QUEUE_TIMEOUT')` | -- | No |
| 5 | processor がスロー | 元のエラーをそのまま reject | -- | -- |

**実装上の注意点:**
- `resolve` / `reject` の型は `(value: unknown) => void` で `QueueItem` に保持する。型安全性は `Promise<R>` の外側で担保
- キュー待ちタイムアウトタイマーは、アイテムが `processNext` で取り出された時点で `clearTimeout` する
- `processNext()` はキューが空になるまで再帰的に呼び出す。ただし `queueMicrotask` で非同期にスケジュールし、コールスタックのオーバーフローを防止する

**対応テストID:** Q-01 (enqueue/dequeue), Q-02 (FIFO順序), Q-03 (同時実行数=1), Q-04 (キュー最大長超過), Q-07 (Promise解決), Q-08 (Promise拒否), Q-09 (キュー待ちタイムアウト), Q-10 (レートリミット), Q-11 (リクエストサイズ上限), DOS-01~DOS-05 (DoSテスト)

---

### 6.5 processNext() (private)

```typescript
private async processNext(): Promise<void>
```

**責務:** キューの先頭アイテムを取り出し、`processor` で処理する。同時実行数1を保証する。

**処理フロー:**

```
1. isProcessing === true || queue.length === 0 → 即座にreturn
2. isProcessing = true
3. item = queue.shift()
4. item のキュー待ちタイムアウトタイマーを clearTimeout
5. waitMs = Date.now() - item.enqueuedAt （キュー待ち時間の計測）
6. try:
     result = await processor(item.payload)
     stats.totalProcessed++
     item.resolve(result)
   catch (error):
     stats.totalRejected++
     item.reject(error)
   finally:
     isProcessing = false
     stats に処理時間を加算
     queueMicrotask(() => this.processNext())  // 次のアイテムを非同期で処理
```

**対応テストID:** Q-03 (同時実行数=1), Q-05 (空キュー), Q-06 (処理中のキューサイズ)

---

### 6.6 getStatus()

```typescript
getStatus(): QueueStats
```

**責務:** キューの現在の状態を返す。

**戻り値:**

```typescript
interface QueueStats {
  currentLength: number;      // 現在のキュー内アイテム数
  isProcessing: boolean;      // 処理中のアイテムがあるか
  totalProcessed: number;     // 処理成功の累計数
  totalRejected: number;      // 拒否（エラー含む）の累計数
  averageWaitMs: number;      // 平均キュー待ち時間（ms）
  averageProcessingMs: number; // 平均処理時間（ms）
}
```

**実装上の注意点:**
- ゼロ除算防止: `totalProcessed` が0の場合は平均値を0として返す

**対応テストID:** Q-06 (処理中のキューサイズ)

---

## 7. server.ts 初期化フロー (v0.3.0追加)

v0.3.0で追加されたモジュール群に伴う、`main()` 初期化シーケンスの拡張。既存のStep 1〜5（設定読み込み、Tier判定、OllamaClient生成、FIFOQueue生成、CostCalculator生成）に続く追加ステップ。

### 7.1 追加初期化ステップ

```
Step 5d: MetricsCollector作成、ollamaHealthy初期値設定
  ├─ MetricsCollector インスタンスを生成
  └─ metricsCollector.updateOllamaHealth(ollamaHealthy) で初期状態を反映

Step 5e: PersistenceManager作成・register・loadAll・startAutoSave
  ├─ PersistenceManager インスタンスを生成（dataDir, autoSaveIntervalMs は設定から取得）
  ├─ persistenceManager.register() で ExecutionTracker, BenchmarkStore, Logger を登録
  ├─ await persistenceManager.loadAll() で永続化データを読み込み
  └─ persistenceManager.startAutoSave() で自動保存タイマーを開始

Step 5f: RegistryUpdater作成、ollamaHealthy時にstart()
  ├─ RegistryUpdater インスタンスを生成
  └─ ollamaHealthy === true の場合のみ registryUpdater.start() を呼び出し
```

### 7.2 シャットダウン拡張

既存の `handleShutdown()` に以下の処理を追加:

```
シグナル受信時（既存処理に追加）:
  a. registryUpdater.stop() -- 定期更新タイマーを停止
  b. persistenceManager.stopAutoSave() -- 自動保存タイマーを停止
  c. await persistenceManager.saveAll() -- 全データを即時永続化
  d. （既存）costCalculator の累計データ永続化
  e. （既存）server.close()
  f. （既存）process.exit(0)
```

### 7.3 ヘルスチェック連携

ツール呼び出し時にメトリクスを更新:

```
各リクエスト処理時:
  ├─ metricsCollector.updateOllamaHealth(healthCheckResult) -- Ollama可用性状態を更新
  └─ metricsCollector.updateQueueLength(queue.getStatus().currentLength) -- キュー長を更新
```

---

## 8. src/tools/batch-offload.ts (P6-001)

複数タスクを一括でローカルLLMにオフロードするバッチ処理ツール。

### 8.1 入力スキーマ

```typescript
interface BatchOffloadInput {
  tasks: Array<{
    task: string;              // 必須。タスク内容
    language?: string;         // 任意。プログラミング言語
    context?: string;          // 任意。コンテキスト情報
    output_format?: string;    // 任意。出力フォーマット
    model?: string;            // 任意。使用モデル指定
    category?: string;         // 任意。タスクカテゴリ
  }>;                          // 1〜10件
  sequential: boolean;         // default false
}
```

### 8.2 処理フロー

```
1. Zod バリデーション (1-10タスク)
   └─ tasks配列の要素数が1未満または10超 → CTS-5002 エラーレスポンス

2. Ollama健全性チェック
   └─ ollamaHealthy === false → 再チェック → 失敗時はフォールバック

3. 各タスク: 入力バリデーション → PI検知 → モデル解決 → キュー投入
   ├─ バリデーション失敗 → 該当タスクをスキップ（部分失敗）
   ├─ PI検出 → 該当タスクをスキップ + セキュリティログ
   └─ モデル解決 → TierConfig or タスク指定modelから決定

4. parallel (sequential === false):
   └─ 全タスクを同時にキュー投入 (concurrency=1で順次処理)

5. sequential (sequential === true):
   └─ 1件ずつ処理、前の結果をcontextとして次に渡す

6. 部分失敗: 失敗タスクをスキップし残りを継続
   └─ 失敗タスクのエラー情報はレスポンスに含める

7. コスト: 各タスクのsavingsを個別計算、合計を表示

8. 全タスク失敗時のみ isError: true
   └─ 1件以上成功 → isError: false（部分成功レスポンス）
```

### 8.3 レスポンス構造

各タスクの結果を配列で返却。成功・失敗の混在を許容する。

```
{
  content: [{
    type: 'text',
    text: JSON.stringify({
      results: [
        { index: 0, status: 'success', text: '...', savings: 0.0012 },
        { index: 1, status: 'error', error: 'CTS-5001', message: '...' },
        ...
      ],
      summary: {
        total: 5,
        succeeded: 4,
        failed: 1,
        totalSavingsUsd: 0.0048,
        totalDurationMs: 12345
      }
    })
  }],
  isError: false  // 全タスク失敗時のみ true
}
```

---

## 9. src/queue/priority-queue.ts (P6-002)

優先度付きキュー。FIFOQueueを拡張し、タスクの優先度に基づいた処理順序を提供する。

### 9.1 Priority enum

```typescript
enum Priority {
  URGENT = 0,
  HIGH = 1,
  NORMAL = 2,
  LOW = 3,
}
```

### 9.2 動作仕様

```
挿入: 優先度順にソート、同一優先度内はFIFO
  └─ enqueue時にPriorityを指定、配列内の適切な位置に挿入

処理: concurrency=1、processNext()で最高優先度アイテムを取得
  └─ queue[0] が常に最高優先度（数値が小さい方が高優先度）

統計: byPriority[priority].pending / .processed
  └─ 各優先度レベルごとの待機中・処理済みカウントを提供

タイムアウト・レート制限: FIFOQueueと同一仕様
  └─ QueueConfig, RateLimiter をそのまま適用
```

### 9.3 クラス設計

```typescript
class PriorityQueue<T, R> {
  constructor(
    config: QueueConfig,
    processor: (item: T) => Promise<R>,
    logger: Logger,
    rateLimiter?: RateLimiter,
  );

  async enqueue(
    payload: T,
    requestSizeBytes: number,
    priority?: Priority,    // デフォルト: Priority.NORMAL
    agentId?: string,
  ): Promise<R>;

  getStatus(): PriorityQueueStats;
}

interface PriorityQueueStats extends QueueStats {
  byPriority: Record<Priority, {
    pending: number;
    processed: number;
  }>;
}
```

---

## 10. src/ollama/load-balancer.ts (P6-004)

複数Ollamaノードへの負荷分散を行うロードバランサー。

### 10.1 NodeState

```typescript
interface OllamaNode {
  url: string;          // 例: 'http://192.168.1.10:11434'
  weight?: number;      // デフォルト: 1
  name?: string;        // 表示名
}

interface NodeState {
  client: OllamaClient;
  node: OllamaNode;
  healthy: boolean;
  activeConnections: number;
  loadedModels: Set<string>;
}
```

### 10.2 負荷分散戦略

```
round-robin:
  └─ 循環インデックスで健全ノードを順次選択

least-connections:
  └─ activeConnections / weight で最小のノードを選択

model-affinity:
  ├─ request.model がloadedModelsに含まれるノードを優先
  └─ 該当ノードがない場合はleast-connections戦略にフォールバック
```

### 10.3 フェイルオーバー

```
選択ノード失敗 → 残りの健全ノードを順次試行
  ├─ 失敗ノードを unhealthy にマーク
  ├─ 次の健全ノードでリクエストを再試行
  └─ 全健全ノードが失敗 → OllamaNotRunningError をスロー
```

### 10.4 ヘルスチェック

```
healthCheck():
  ├─ 各ノードに対して client.healthCheck() を実行
  ├─ listRunning() で現在ロード中のモデル一覧を取得
  └─ loadedModels を更新
```

### 10.5 モデル操作

```
listModels():
  ├─ 全健全ノードから client.listModels() を呼び出し
  └─ 重複排除してマージした結果を返却

pullModel(name: string, targetNode?: string):
  ├─ targetNode 指定あり → 指定ノードでのみ pull 実行
  └─ targetNode 指定なし → 全健全ノードで pull 実行
```

### 10.6 クラス設計

```typescript
type LoadBalanceStrategy = 'round-robin' | 'least-connections' | 'model-affinity';

class LoadBalancer {
  constructor(
    nodes: OllamaNode[],
    strategy: LoadBalanceStrategy,
    logger: Logger,
  );

  async selectNode(request?: { model?: string }): Promise<NodeState>;
  async chat(request: OllamaChatRequest): Promise<OllamaChatResponse>;
  async healthCheck(): Promise<void>;
  async listModels(): Promise<OllamaModelInfo[]>;
  async pullModel(name: string, targetNode?: string): Promise<void>;
  getNodeStates(): ReadonlyArray<Readonly<NodeState>>;
}
```

---

## 11. src/tools/auto-setup.ts (v0.3.0)

最適モデルの推奨・ダウンロード・VRAMプリロードをワンステップで実行するツール。

### auto-setup.ts

- AutoSetupContext: ollamaClient, tierConfig, config, logger, ollamaHealthy, benchmarkStore
- 入力バリデーション: category → TASK_CATEGORIES (default "general"), prefer_quality (boolean), skip_pull (boolean), skip_preload (boolean)
- フロー: healthCheck → listModels/listRunning → recommendModels → pull → preload
- 部分失敗: pullFailed → preloadスキップ、preloadFailed → 警告表示
- レスポンス: Markdown (System info, Selected model, Steps, Usage instructions, Warnings)

---

## 12. 型定義一覧

全モジュールで共有される型定義をまとめる。実際の配置先は `src/types.ts` または各モジュールの型定義ファイル。

### 11.1 MCPツール入出力型

```typescript
// --- offload_work ---
interface OffloadWorkInput {
  task: string;                                    // 必須。最大50,000文字
  context?: string;                                // 任意。最大100,000文字
  language?: SupportedLanguage;                    // 任意
  output_format?: 'code' | 'diff' | 'explanation' | 'raw'; // 任意。デフォルト: 'code'
}

type SupportedLanguage =
  | 'typescript' | 'javascript' | 'python' | 'go'
  | 'rust' | 'java' | 'c' | 'cpp' | 'ruby'
  | 'swift' | 'kotlin' | 'other';

// --- compress_context ---
interface CompressContextInput {
  content: string;     // 必須。最大200,000文字
  focus?: string;      // 任意。最大500文字
  max_length?: number; // 任意。100-10,000。デフォルト: 2,000
}

// --- 共通レスポンス ---
// MCP SDKの CallToolResult を使用
// { content: Array<{ type: 'text'; text: string }>; isError?: boolean; }
```

### 11.2 Ollamaストリーミング型

```typescript
interface OllamaChatStreamChunk {
  model: string;
  created_at: string;
  message: {
    role: 'assistant';
    content: string;      // 差分テキスト（1トークン分）
  };
  done: false;
}

interface OllamaChatStreamFinal {
  model: string;
  created_at: string;
  message: {
    role: 'assistant';
    content: '';           // 最終チャンクのcontentは空
  };
  done: true;
  total_duration: number;      // ナノ秒
  load_duration: number;       // モデルロード時間（ナノ秒）
  prompt_eval_count: number;   // 入力トークン数
  prompt_eval_duration: number;
  eval_count: number;          // 出力トークン数
  eval_duration: number;
}
```

### 11.3 キュー内部型

```typescript
interface QueueItem<T> {
  id: string;                              // crypto.randomUUID()
  payload: T;
  enqueuedAt: number;                      // Date.now()
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  _timer: NodeJS.Timeout;                  // キュー待ちタイムアウトタイマー
}

interface QueueInternalStats {
  totalProcessed: number;
  totalRejected: number;
  totalWaitMs: number;
  totalProcessingMs: number;
}
```

### 11.4 Ollamaタスクペイロード型

```typescript
interface OllamaTaskPayload {
  request: OllamaChatRequest;
  tierConfig: TierConfig;
}
```

### 11.5 コスト関連型

```typescript
interface CostRecord {
  timestamp: number;
  tool: 'offload_work' | 'compress_context';
  model: string;
  inputTokens: number;
  outputTokens: number;
  savingsUsd: number;
  processingTimeMs: number;
}

interface CostHistory {
  version: 1;
  lastUpdated: string;       // ISO 8601
  cumulativeSavings: number; // USD
  totalRequests: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  byTool: {
    offload_work: { requests: number; savings: number };
    compress_context: { requests: number; savings: number };
  };
}
```

---

## 13. エラーコード対応表

各関数がスローまたは返却するエラーコードと、対応するフォールバック動作の一覧。

| コード | エラー名 | 発生モジュール | フォールバック | 対応テストID |
|:---|:---|:---|:---:|:---|
| CTS-1001 | OllamaNotRunningError | `ollama/client.ts` | Yes | OC-06, I-05 |
| CTS-1002 | OllamaVersionError | `ollama/client.ts` | Yes | -- |
| CTS-2001 | ModelLoadTimeoutError | `ollama/client.ts` | Yes (Tier1: モデルFB) | TO-04, TO-06 |
| CTS-2002 | GenerationTimeoutError | `ollama/client.ts` | Yes | TO-04, TO-05, TO-06 |
| CTS-3001 | ModelNotFoundError | `ollama/client.ts` | No (auto-pull) | OC-10, E-03 |
| CTS-4001 | QueueFullError | `queue/fifo-queue.ts` | Yes | Q-04, DOS-01, DOS-02 |
| CTS-4002 | RateLimitError | `queue/rate-limiter.ts` | Yes | Q-10, DOS-05 |
| CTS-5001 | PromptInjectionError | `validators/prompt-guard.ts` | No | V-03~V-15, PI-01~PI-15 |
| CTS-5002 | ContextOverflowError | `validators/input-validator.ts` | No | V-09, V-10, MT-04, MT-05 |
| CTS-6001 | InvalidConfigError | `config/loader.ts` | No (デフォルトFB) | CF-03 |

---

## 14. モジュール依存関係図

```
src/server.ts (エントリポイント)
├── src/tools/offload-work.ts
│   ├── src/ollama/client.ts
│   ├── src/queue/fifo-queue.ts
│   │   └── src/queue/rate-limiter.ts
│   ├── src/cost/calculator.ts
│   ├── src/tiering/detector.ts
│   ├── src/validators/input-validator.ts
│   └── src/validators/prompt-guard.ts
├── src/tools/compress-context.ts
│   ├── src/ollama/client.ts
│   ├── src/queue/fifo-queue.ts
│   ├── src/cost/calculator.ts
│   ├── src/tiering/detector.ts
│   ├── src/validators/input-validator.ts
│   └── src/validators/prompt-guard.ts
├── src/ollama/client.ts
│   └── (node:crypto, pino)
├── src/tiering/detector.ts
│   └── (node:os)
├── src/queue/fifo-queue.ts
│   ├── src/queue/rate-limiter.ts
│   └── (node:crypto)
├── src/cost/calculator.ts
│   └── src/cost/pricing.ts
├── src/config/loader.ts
│   ├── src/config/schema.ts (Zodスキーマ)
│   └── (node:fs, node:path, node:os)
└── (pino, @modelcontextprotocol/sdk)
```

**依存の方向:**
- 上位モジュール（server, tools）は下位モジュール（ollama, queue, cost, tiering, validators, config）に依存する
- 下位モジュール間の相互依存は存在しない（一方向依存）
- 全モジュールは `pino` ロガーを `Logger` インターフェース経由で受け取る（DIパターン）

---

## 付録A: 設計書間の整合確認

本仕様書の関数定義が参照した設計書との整合性。

| 本仕様書の関数/型 | 参照設計書 | 参照セクション |
|:---|:---|:---|
| `OffloadWorkInput` | mcp-server-design.md | 1.1 inputSchema |
| `CompressContextInput` | mcp-server-design.md | 1.2 inputSchema |
| `OllamaClient.chat()` | mcp-server-design.md | 2.2, 2.3, 2.4 |
| `OllamaChatStreamChunk/Final` | mcp-server-design.md | 2.2 ストリーミング設計 |
| `TierConfig` / `detectTier()` | mcp-server-design.md | 3.1, 3.2, 3.3 |
| `FIFOQueue` / `QueueConfig` | mcp-server-design.md | 4.1, 4.2, 4.3 |
| `CostCalculator` | mcp-server-design.md | 6.1, 6.2, 6.3 |
| タイムアウト設計 | mcp-server-design.md | 7.1, 7.2, 7.3 |
| フォールバック | mcp-server-design.md | 8.1, 8.2, 8.3, 8.4 |
| エラークラス階層 | data-flow-design.md | 3.1, 3.2 |
| エラーコード体系 | data-flow-design.md | 4.1, 4.2, 4.3 |
| ロギング設計 | data-flow-design.md | 5.1, 5.2, 5.3 |
| MCPレスポンス | data-flow-design.md | 6.1, 6.2, 6.3 |
| ディレクトリ構造 | infrastructure-design.md | 1 |
| テストID | test-strategy.md | 2.x, 3.x, 4.x |

---

## 付録B: 実装チェックリスト

Phase 4 のコーディング開始時に、各関数の実装完了を確認するためのチェックリスト。

- [ ] `src/server.ts` -- `main()`, `registerTools()`, `handleShutdown()`
- [ ] `src/tools/offload-work.ts` -- `handleOffloadWork()`
- [ ] `src/tools/compress-context.ts` -- `handleCompressContext()`, `estimateTokenCount()`, `truncateByTokens()`, `buildCompressPrompt()`
- [ ] `src/ollama/client.ts` -- `OllamaClient` クラス全メソッド
- [ ] `src/tiering/detector.ts` -- `detectTier()`, `applyConfigOverrides()`
- [ ] `src/queue/fifo-queue.ts` -- `FIFOQueue` クラス全メソッド
- [ ] 型定義ファイル (`src/types.ts` or 各モジュール内)
- [ ] エラークラス (`src/errors.ts`)
- [ ] テスト: T-01~T-12, Q-01~Q-12, C-01~C-10, V-01~V-15, TO-01~TO-10, OC-01~OC-10, MT-01~MT-06
