# MCPサーバー基本設計書

**プロジェクト:** claude-token-saver-mcp
**バージョン:** v0.3.0
**作成日:** 2026-02-15
**作成者:** Architect Agent
**フェーズ:** Phase 2 — 基本設計

---

## 目次

1. [MCPツール詳細定義](#1-mcpツール詳細定義)
2. [Ollamaクライアント設計](#2-ollamaクライアント設計)
3. [ティアリングモジュール設計](#3-ティアリングモジュール設計)
4. [FIFOキュー設計](#4-fifoキュー設計)
5. [System Prompt管理](#5-system-prompt管理)
6. [コスト計算モジュール](#6-コスト計算モジュール)
7. [タイムアウト設計](#7-タイムアウト設計)
8. [フォールバック設計](#8-フォールバック設計)
9. [初回起動フロー](#9-初回起動フロー)
10. [設定ファイル仕様](#10-設定ファイル仕様)
11. [メトリクス & 永続化](#11-メトリクス--永続化)

---

## 1. MCPツール詳細定義

### 1.1 offload_work

Claude Code Agent Teamsから定型タスク（コード生成、テスト作成、リファクタリング等）をローカルLLMにオフロードするツール。

#### Claudeへの提示テキスト

```
(Cost-Saver) Executes coding tasks on local LLM to save cloud API tokens.
Use this tool for routine coding tasks: code generation, unit test creation,
refactoring, boilerplate generation, and code translation. The task will be
processed by a local LLM (Ollama) at zero cloud API cost.
```

#### inputSchema (JSON Schema)

```json
{
  "type": "object",
  "properties": {
    "task": {
      "type": "string",
      "description": "Task description. Be specific about what code to generate, what to refactor, etc.",
      "maxLength": 50000
    },
    "context": {
      "type": "string",
      "description": "Relevant code context, file contents, or reference material.",
      "maxLength": 100000
    },
    "language": {
      "type": "string",
      "description": "Target programming language (e.g., 'typescript', 'python', 'go').",
      "enum": ["typescript", "javascript", "python", "go", "rust", "java", "c", "cpp", "ruby", "swift", "kotlin", "other"]
    },
    "output_format": {
      "type": "string",
      "description": "Expected output format.",
      "enum": ["code", "diff", "explanation", "raw"],
      "default": "code"
    }
  },
  "required": ["task"]
}
```

#### TypeScriptインターフェース

```typescript
interface OffloadWorkInput {
  task: string;
  context?: string;
  language?: SupportedLanguage;
  output_format?: 'code' | 'diff' | 'explanation' | 'raw';
}

type SupportedLanguage =
  | 'typescript' | 'javascript' | 'python' | 'go'
  | 'rust' | 'java' | 'c' | 'cpp' | 'ruby'
  | 'swift' | 'kotlin' | 'other';

interface OffloadWorkResult {
  content: Array<{
    type: 'text';
    text: string;
  }>;
  isError?: boolean;
  _meta?: {
    savings_usd: number;
    cumulative_savings_usd: number;
    input_tokens: number;
    output_tokens: number;
    model: string;
    tier: TierLevel;
    processing_time_ms: number;
    queue_wait_ms: number;
  };
}
```

#### レスポンス形式

**成功時:**
```json
{
  "content": [
    {
      "type": "text",
      "text": "<生成されたコード or テキスト>"
    }
  ],
  "_meta": {
    "savings_usd": 0.0042,
    "cumulative_savings_usd": 0.1523,
    "input_tokens": 1200,
    "output_tokens": 800,
    "model": "qwen2.5-coder:7b",
    "tier": 2,
    "processing_time_ms": 3400,
    "queue_wait_ms": 0
  }
}
```

**エラー時（フォールバック）:**
```json
{
  "content": [
    {
      "type": "text",
      "text": "[FALLBACK_TO_CLOUD] Local LLM timed out after 90s. Please process this task directly."
    }
  ],
  "isError": true
}
```

### 1.2 compress_context

巨大なファイル内容やログをローカルLLMで要約し、要点のみをクラウドに返すツール。

#### Claudeへの提示テキスト

```
(Cost-Saver) Compresses/summarizes large text content using local LLM.
Use this tool to summarize large files, logs, documentation, or code before
sending to cloud API. Reduces token consumption by extracting key information.
```

#### inputSchema (JSON Schema)

```json
{
  "type": "object",
  "properties": {
    "content": {
      "type": "string",
      "description": "The text content to compress/summarize.",
      "maxLength": 200000
    },
    "focus": {
      "type": "string",
      "description": "What aspect to focus on in the summary (e.g., 'error messages', 'API changes', 'security issues').",
      "maxLength": 500
    },
    "max_length": {
      "type": "number",
      "description": "Target maximum length of the summary in characters.",
      "minimum": 100,
      "maximum": 10000,
      "default": 2000
    }
  },
  "required": ["content"]
}
```

#### TypeScriptインターフェース

```typescript
interface CompressContextInput {
  content: string;
  focus?: string;
  max_length?: number;
}

interface CompressContextResult {
  content: Array<{
    type: 'text';
    text: string;
  }>;
  isError?: boolean;
  _meta?: {
    savings_usd: number;
    cumulative_savings_usd: number;
    input_tokens: number;
    output_tokens: number;
    original_length: number;
    compressed_length: number;
    compression_ratio: number;
    model: string;
    tier: TierLevel;
    processing_time_ms: number;
    truncated: boolean;
  };
}
```

#### コンテキスト上限超過時の処理

Tierごとのコンテキスト上限を超える入力が送られた場合:

1. 入力テキストを先頭からコンテキスト上限まで切り詰める
2. 警告メッセージを応答に付与する

```typescript
// 切り詰め処理の擬似コード
function truncateToContextLimit(content: string, tier: TierConfig): {
  text: string;
  truncated: boolean;
} {
  const estimatedTokens = estimateTokenCount(content);
  if (estimatedTokens <= tier.contextLimit) {
    return { text: content, truncated: false };
  }

  // トークン上限の90%をコンテンツに、10%をシステムプロンプト+応答用に確保
  const contentLimit = Math.floor(tier.contextLimit * 0.9);
  const truncated = truncateByTokens(content, contentLimit);
  return { text: truncated, truncated: true };
}
```

**切り詰め時のレスポンス:**
```json
{
  "content": [
    {
      "type": "text",
      "text": "[WARNING: Input truncated from ~15000 to ~3600 tokens due to Tier 1 context limit (4000 tokens). Only the first portion was summarized.]\n\n<要約テキスト>"
    }
  ]
}
```

### 1.3 recommend_model

タスクカテゴリに最適なOllamaモデルを推薦するツール。インストール済みモデル・VRAM状態・ベンチマークスコアを考慮して推薦リストを生成する。

#### Claudeへの提示テキスト

```
(Cost-Saver) Recommends the best local LLM model for a given task category.
Analyzes installed models, VRAM capacity, and benchmark scores to suggest
the optimal model for coding, general, or specialized tasks.
```

#### inputSchema (JSON Schema)

```json
{
  "type": "object",
  "properties": {
    "category": {
      "type": "string",
      "description": "Task category for model recommendation.",
      "enum": ["coding", "coding-agent", "general", "japanese"]
    },
    "prefer_quality": {
      "type": "boolean",
      "description": "If true, prefer higher quality models over speed.",
      "default": false
    }
  },
  "required": ["category"]
}
```

### 1.4 preload_model

モデルをVRAMにプリロードし、推論時のコールドスタートを回避するツール。空のchatリクエストを送信してモデルをメモリに載せる。

#### Claudeへの提示テキスト

```
(Cost-Saver) Preloads a model into VRAM for warm inference.
Use this tool to pre-warm a model before running tasks, avoiding cold start delays.
```

#### inputSchema (JSON Schema)

```json
{
  "type": "object",
  "properties": {
    "model": {
      "type": "string",
      "description": "Model name to preload (e.g., 'qwen2.5-coder:7b')."
    },
    "keep_alive": {
      "type": "string",
      "description": "How long to keep the model loaded (e.g., '5m', '1h', '-1' for permanent).",
      "default": "5m"
    }
  },
  "required": ["model"]
}
```

### 1.5 list_loaded_models

現在VRAMにロードされているモデルの一覧をVRAM使用量・有効期限付きで表示するツール。

#### Claudeへの提示テキスト

```
(Cost-Saver) Lists models currently loaded in VRAM with usage details.
Shows VRAM consumption, expiry time, and available model slots.
```

#### inputSchema (JSON Schema)

```json
{
  "type": "object",
  "properties": {},
  "required": []
}
```

### 1.6 pull_model

Ollamaレジストリからモデルをダウンロードするツール。

#### Claudeへの提示テキスト

```
(Cost-Saver) Downloads a model from the Ollama registry to local storage.
Use this tool to install new models for local inference.
```

#### inputSchema (JSON Schema)

```json
{
  "type": "object",
  "properties": {
    "model": {
      "type": "string",
      "description": "Model name to pull (e.g., 'qwen2.5-coder:7b')."
    }
  },
  "required": ["model"]
}
```

### 1.7 batch_offload

複数タスクを一括でキューに投入するツール。1〜10タスクをsequential（逐次）またはparallel（並列）モードで処理する。タスクはPriority.LOWで実行され、部分失敗時も残タスクを継続する。

#### Claudeへの提示テキスト

```
(Cost-Saver) Batch-submits multiple tasks to the local LLM queue.
Supports 1-10 tasks in sequential or parallel mode. Tasks run at LOW priority.
Partial failures do not abort remaining tasks.
```

#### inputSchema (JSON Schema)

```json
{
  "type": "object",
  "properties": {
    "tasks": {
      "type": "array",
      "description": "List of tasks to process (1-10).",
      "minItems": 1,
      "maxItems": 10,
      "items": {
        "type": "object",
        "properties": {
          "task": {
            "type": "string",
            "description": "Task description.",
            "maxLength": 50000
          },
          "language": { "type": "string" },
          "context": { "type": "string", "maxLength": 100000 },
          "output_format": {
            "type": "string",
            "enum": ["code", "diff", "explanation", "raw"]
          },
          "model": { "type": "string" },
          "category": { "type": "string" }
        },
        "required": ["task"]
      }
    },
    "sequential": {
      "type": "boolean",
      "description": "If true, tasks run sequentially with previous result as context. If false (default), tasks run in parallel.",
      "default": false
    }
  },
  "required": ["tasks"]
}
```

#### レスポンス形式

**成功時（部分失敗含む）:**
```
## Batch Results: 3/4 succeeded
(1 failed)

### Task 1
<生成結果>

### Task 2
ERROR: [CTS-5001] ...

### Task 3
<生成結果>

### Task 4
<生成結果>

---
Total tokens: 3200 in / 1800 out | Total savings: $0.0312 | Mode: parallel
```

### 1.8 get_metrics

Prometheus text形式またはJSONでサーバーメトリクスを返すツール。リクエスト数、レイテンシ（p50/p95/p99）、キュー状態、コスト節約額、Ollama健全性を含む。

#### Claudeへの提示テキスト

```
(Cost-Saver) Returns server metrics in Prometheus text or JSON format.
Includes request counts, latency percentiles, queue status, cost savings, and Ollama health.
```

#### inputSchema (JSON Schema)

```json
{
  "type": "object",
  "properties": {
    "format": {
      "type": "string",
      "description": "Output format.",
      "enum": ["prometheus", "json"],
      "default": "json"
    }
  },
  "required": []
}
```

#### レスポンス形式

**JSON形式:**
```json
{
  "requestsTotal": 42,
  "requestsByTool": { "offload_work": 30, "compress_context": 12 },
  "errorsTotal": 2,
  "errorsByCode": { "TIMEOUT_REQUEST": 1, "QUEUE_FULL": 1 },
  "queueLength": 0,
  "ollamaHealthy": true,
  "loadedModelsCount": 2,
  "latencyQuantiles": { "p50": 3200, "p95": 8500, "p99": 12000 },
  "totalSavingsUsd": 0.4523,
  "totalInputTokens": 52000,
  "totalOutputTokens": 28000,
  "uptimeMs": 3600000
}
```

### 1.9 configure_model_selector

ランタイムでモデルセレクターの設定を管理するツール。ブロックモデル・ライセンスフィルタ・カスタム推奨を動的に変更できる。

#### Claudeへの提示テキスト

```
(Cost-Saver) Manages model selector settings at runtime.
Configure blocked models, license filters, and custom model recommendations
without restarting the server.
```

#### inputSchema (JSON Schema)

```json
{
  "type": "object",
  "properties": {
    "setting": {
      "type": "string",
      "description": "Which setting to manage.",
      "enum": ["blocked_models", "license_filter", "custom_recommendations"]
    },
    "action": {
      "type": "string",
      "description": "Action to perform.",
      "enum": ["get", "set", "add", "remove"]
    },
    "values": {
      "type": "array",
      "items": { "type": "string" },
      "description": "Values for set/add/remove actions."
    },
    "custom_config": {
      "type": "object",
      "description": "Custom recommendations config for 'set' action on custom_recommendations. Structure: { category: { tier: modelId[] } }"
    }
  },
  "required": ["setting", "action"]
}
```

### 1.10 cost_dashboard

累計コスト節約額とモデル使用統計を表示するツール。ExecutionTrackerのデータからカテゴリ別・モデル別の成功率・平均処理時間を集計する。

#### Claudeへの提示テキスト

```
(Cost-Saver) Displays cumulative cost savings and model usage statistics.
Shows total savings, token counts, and per-model performance metrics.
```

#### inputSchema (JSON Schema)

```json
{
  "type": "object",
  "properties": {},
  "required": []
}
```

#### レスポンス形式

```
## Cost Savings Dashboard

**Total Savings:** $0.4523
**Total Requests:** 42
**Total Tokens:** 52000 input / 28000 output

### Model Usage Statistics
| Model | Category | Requests | Avg Time | Success Rate |
|:---|:---|:---:|:---:|:---:|
| qwen2.5-coder:7b | coding | 30 | 3.2s | 96.7% |
| phi4:latest | general | 12 | 2.1s | 100.0% |
```

### 1.11 auto_setup (v0.3.0)

- 機能: 最適モデルの推奨→ダウンロード→VRAMプリロードをワンステップで実行
- 入力: category (optional, default "general"), prefer_quality (optional), skip_pull (optional), skip_preload (optional)
- 処理フロー:
  1. Ollama健全性チェック (不健全→再チェック→エラー)
  2. インストール済み/ロード済みモデル取得
  3. recommendModels()で最適モデル選択
  4. 未インストール & !skip_pull → pullModel()
  5. 未ロード & !skip_preload → chat()でプリロード
  6. 結果をMarkdown形式で返却
- エラー処理: pull/preload失敗は部分成功として継続
- 条件: modelSelector.enabled=true の場合のみ公開

---

## 2. Ollamaクライアント設計

### 2.1 APIエンドポイントの使い分け

| エンドポイント | 用途 | 採用理由 |
|:---|:---|:---|
| `POST /api/chat` | **offload_work, compress_context 両方** | system/user/assistantロール分離が可能。マルチターン非使用でも構造化されたプロンプト管理が容易 |
| `POST /api/generate` | **使用しない** | ロール分離不可。System Promptの強制適用が困難 |
| `GET /api/tags` | モデル一覧取得（起動時） | インストール済みモデルの確認 |
| `POST /api/pull` | モデルダウンロード（初回起動時） | 未インストールモデルの自動取得 |
| `GET /api/ps` | 実行中モデル確認 | ヘルスチェック |
| `GET /` | ヘルスチェック | Ollama稼働確認 |

**設計判断:** `/api/chat`に統一する。`/api/generate`はsystem/userのロール分離ができないため、System Prompt固定の要件を満たせない。

### 2.2 ストリーミング設計

全リクエストで `stream: true` を使用する。理由:

1. **初回モデルロード対策**: Ollamaはモデルを初回利用時にメモリにロードする。この間（数秒〜数十秒）、`stream: false`では応答が無く、タイムアウトと区別できない
2. **ハートビート検出**: ストリーミング中のチャンク到着間隔を監視し、「処理中」と「ハング」を区別する
3. **進捗把握**: トークン生成の進捗をリアルタイムで把握できる

#### ストリーミングレスポンスのパース

```typescript
interface OllamaChatStreamChunk {
  model: string;
  created_at: string;
  message: {
    role: 'assistant';
    content: string;  // 差分テキスト（1トークン分）
  };
  done: false;
}

interface OllamaChatStreamFinal {
  model: string;
  created_at: string;
  message: {
    role: 'assistant';
    content: '';
  };
  done: true;
  total_duration: number;     // ナノ秒
  load_duration: number;      // モデルロード時間（ナノ秒）
  prompt_eval_count: number;  // 入力トークン数
  prompt_eval_duration: number;
  eval_count: number;         // 出力トークン数
  eval_duration: number;
}
```

### 2.3 Ollamaクライアント TypeScript設計

```typescript
interface OllamaClientConfig {
  baseUrl: string;         // デフォルト: 'http://127.0.0.1:11434'
  requestTimeout: number;  // ティア別動的タイムアウト（ms）
  heartbeatTimeout: number; // チャンク間の最大許容間隔（ms）
}

interface OllamaChatRequest {
  model: string;
  messages: OllamaChatMessage[];
  stream: true;
  options?: {
    num_ctx?: number;        // コンテキストウィンドウサイズ
    temperature?: number;    // デフォルト: 0.1（コード生成向けに低め）
    top_p?: number;
    num_predict?: number;    // 最大出力トークン数
  };
}

interface OllamaChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

class OllamaClient {
  private config: OllamaClientConfig;

  constructor(config: OllamaClientConfig) { /* ... */ }

  /**
   * /api/chat にストリーミングリクエストを送信し、
   * 全チャンクを結合した最終結果を返す。
   * ハートビートタイムアウト監視を内蔵。
   */
  async chat(request: OllamaChatRequest): Promise<OllamaChatResponse> { /* ... */ }

  /** Ollamaサーバーの稼働確認 */
  async healthCheck(): Promise<boolean> { /* ... */ }

  /** インストール済みモデル一覧を取得 */
  async listModels(): Promise<OllamaModelInfo[]> { /* ... */ }

  /** モデルをダウンロード（プログレス付き） */
  async pullModel(modelName: string): Promise<void> { /* ... */ }

  /** 現在ロード中のモデルを確認 */
  async listRunningModels(): Promise<OllamaRunningModel[]> { /* ... */ }
}

interface OllamaChatResponse {
  text: string;                // 結合済み全文テキスト
  inputTokens: number;         // prompt_eval_count
  outputTokens: number;        // eval_count
  totalDurationMs: number;     // total_duration / 1_000_000
  loadDurationMs: number;      // load_duration / 1_000_000
  model: string;
}

interface OllamaModelInfo {
  name: string;
  size: number;
  digest: string;
  modified_at: string;
}

interface OllamaRunningModel {
  name: string;
  size: number;
  size_vram: number;
}
```

### 2.4 ストリーミングハートビート検出

```typescript
/**
 * ストリーミング中のハートビート監視ロジック。
 * 最後のチャンク受信から heartbeatTimeout (ms) 以内に
 * 次のチャンクが届かなければ AbortError をスローする。
 */
async function streamWithHeartbeat(
  response: Response,
  heartbeatTimeout: number,
  abortController: AbortController,
): Promise<OllamaChatResponse> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullText = '';
  let lastChunkTime = Date.now();
  let finalChunk: OllamaChatStreamFinal | null = null;

  // ハートビート監視タイマー
  const heartbeatInterval = setInterval(() => {
    if (Date.now() - lastChunkTime > heartbeatTimeout) {
      clearInterval(heartbeatInterval);
      abortController.abort();
    }
  }, 1000);

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      lastChunkTime = Date.now();
      buffer += decoder.decode(value, { stream: true });

      // NDJSONパース（改行区切りJSON）
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.trim()) continue;
        const chunk = JSON.parse(line);
        if (chunk.done) {
          finalChunk = chunk;
        } else {
          fullText += chunk.message.content;
        }
      }
    }
  } finally {
    clearInterval(heartbeatInterval);
  }

  if (!finalChunk) {
    throw new Error('Stream ended without final chunk');
  }

  return {
    text: fullText,
    inputTokens: finalChunk.prompt_eval_count,
    outputTokens: finalChunk.eval_count,
    totalDurationMs: finalChunk.total_duration / 1_000_000,
    loadDurationMs: finalChunk.load_duration / 1_000_000,
    model: finalChunk.model,
  };
}
```

### 2.5 OllamaLoadBalancer（マルチノード対応）

複数のOllamaインスタンスへのロードバランシングを提供するモジュール。分散実行により処理能力を水平スケールする。

#### 設計方針

- **マルチノード対応:** 複数Ollamaインスタンスを束ねて単一のクライアントとして利用可能
- **3戦略:** `round-robin`, `least-connections`, `model-affinity`（デフォルト）
- **自動フェイルオーバー:** 選択ノード失敗時、次の健全ノードに自動切り替え
- **ヘルスチェック:** 定期的にノード状態を更新（デフォルト30秒間隔）
- **有効化:** 設定ファイルの `distributed` セクションで有効化

#### TypeScriptインターフェース

```typescript
interface OllamaNode {
  id: string;
  baseUrl: string;
  label?: string;
  weight?: number;  // デフォルト: 1
}

type LoadBalancerStrategy = 'round-robin' | 'least-connections' | 'model-affinity';

interface LoadBalancerConfig {
  nodes: OllamaNode[];
  strategy: LoadBalancerStrategy;
  healthCheckIntervalMs?: number;  // デフォルト: 30000
  clientConfig: Omit<OllamaClientConfig, 'baseUrl'>;
}

interface NodeStatus {
  id: string;
  baseUrl: string;
  healthy: boolean;
  activeConnections: number;
  loadedModels: string[];
}

class OllamaLoadBalancer {
  /** リクエストに最適なノードを戦略に基づいて選択 */
  selectNode(request: OllamaChatRequest): NodeState | null;

  /** 自動フェイルオーバー付きchatリクエスト */
  async chat(request: OllamaChatRequest): Promise<OllamaChatResponse>;

  /** 全ノードのヘルスチェック（少なくとも1つ健全ならtrue） */
  async healthCheck(): Promise<boolean>;

  /** 定期ヘルスチェック開始（デフォルト30秒間隔） */
  startHealthChecks(): void;

  /** 定期ヘルスチェック停止 */
  stopHealthChecks(): void;

  /** 全ノードのステータスを取得 */
  getNodesStatus(): NodeStatus[];

  /** 全健全ノードから重複排除したモデル一覧を取得 */
  async listModels(): Promise<OllamaModelInfo[]>;

  /** 特定ノードまたは全健全ノードでモデルをpull */
  async pullModel(name: string, nodeId?: string): Promise<void>;
}
```

#### 戦略詳細

| 戦略 | 動作 | ユースケース |
|:---|:---|:---|
| `round-robin` | ノードを順番に選択 | 均等な負荷分散 |
| `least-connections` | アクティブ接続数が最少のノードを選択（weight考慮） | 不均一な処理時間のタスク |
| `model-affinity` | 対象モデルがロード済みのノードを優先し、なければleast-connectionsにフォールバック | コールドスタート回避（**デフォルト**） |

---

## 3. ティアリングモジュール設計

### 3.1 Tier定義

| Tier | RAM条件 | プライマリモデル | フォールバックモデル | コンテキスト上限 |
|:---|:---|:---|:---|:---|
| **Tier 1 (Light)** | < 16GB | `phi4:latest` (14B) | `phi4-mini:latest` (3.8B) | 4,000 tokens |
| **Tier 2 (Standard)** | 16GB - 48GB | `qwen2.5-coder:7b` | - | 12,000 tokens |
| **Tier 3 (Ultra)** | > 48GB | `qwen2.5-coder:32b` | - | 32,000 tokens |

### 3.2 TypeScriptインターフェース

```typescript
type TierLevel = 1 | 2 | 3;

interface TierConfig {
  level: TierLevel;
  name: string;
  primaryModel: string;
  fallbackModel: string | null;
  contextLimit: number;  // トークン数
  ramRange: {
    min: number;  // GB（このTierの下限、inclusive）
    max: number;  // GB（このTierの上限、exclusive。Infinity可）
  };
  timeout: TimeoutConfig;
}

interface TimeoutConfig {
  requestTimeout: number;     // リクエスト全体のタイムアウト（ms）
  heartbeatTimeout: number;   // チャンク間最大間隔（ms）
  firstTokenTimeout: number;  // 初回トークン到着までの猶予（ms）
}

const TIER_DEFINITIONS: readonly TierConfig[] = [
  {
    level: 1,
    name: 'Light',
    primaryModel: 'phi4:latest',
    fallbackModel: 'phi4-mini:latest',
    contextLimit: 4_000,
    ramRange: { min: 0, max: 16 },
    timeout: {
      requestTimeout: 60_000,
      heartbeatTimeout: 30_000,
      firstTokenTimeout: 120_000,
    },
  },
  {
    level: 2,
    name: 'Standard',
    primaryModel: 'qwen2.5-coder:7b',
    fallbackModel: null,
    contextLimit: 12_000,
    ramRange: { min: 16, max: 48 },
    timeout: {
      requestTimeout: 90_000,
      heartbeatTimeout: 30_000,
      firstTokenTimeout: 120_000,
    },
  },
  {
    level: 3,
    name: 'Ultra',
    primaryModel: 'qwen2.5-coder:32b',
    fallbackModel: null,
    contextLimit: 32_000,
    ramRange: { min: 48, max: Infinity },
    timeout: {
      requestTimeout: 180_000,
      heartbeatTimeout: 45_000,
      firstTokenTimeout: 180_000,
    },
  },
] as const;
```

### 3.3 RAM検出とTier判定

```typescript
import os from 'node:os';

class TieringModule {
  private currentTier: TierConfig;
  private configOverrides: Partial<TierConfig> | null;

  constructor(configOverrides?: Partial<TierConfig>) {
    this.configOverrides = configOverrides ?? null;
    this.currentTier = this.detectTier();
  }

  /**
   * システムRAM量からTierを自動判定する。
   * 設定ファイルでの上書きがある場合はそちらを優先。
   */
  private detectTier(): TierConfig {
    const totalRamGB = os.totalmem() / (1024 ** 3);

    const tier = TIER_DEFINITIONS.find(
      t => totalRamGB >= t.ramRange.min && totalRamGB < t.ramRange.max
    );

    if (!tier) {
      // フォールバック: 最低Tierを使用
      return this.applyOverrides(TIER_DEFINITIONS[0]);
    }

    return this.applyOverrides(tier);
  }

  /**
   * 設定ファイルの上書き値を適用する。
   * 上書き可能: モデル名、コンテキスト上限、タイムアウト値。
   * Tier番号とRAM範囲は上書き不可。
   */
  private applyOverrides(baseTier: TierConfig): TierConfig {
    if (!this.configOverrides) return baseTier;
    return {
      ...baseTier,
      primaryModel: this.configOverrides.primaryModel ?? baseTier.primaryModel,
      fallbackModel: this.configOverrides.fallbackModel !== undefined
        ? this.configOverrides.fallbackModel
        : baseTier.fallbackModel,
      contextLimit: this.configOverrides.contextLimit ?? baseTier.contextLimit,
      timeout: {
        ...baseTier.timeout,
        ...this.configOverrides.timeout,
      },
    };
  }

  getTier(): TierConfig {
    return this.currentTier;
  }

  getModel(): string {
    return this.currentTier.primaryModel;
  }

  getFallbackModel(): string | null {
    return this.currentTier.fallbackModel;
  }

  getContextLimit(): number {
    return this.currentTier.contextLimit;
  }

  /** stderr出力用のTier情報サマリー */
  getSummary(): string {
    const ramGB = (os.totalmem() / (1024 ** 3)).toFixed(1);
    return `[Tier ${this.currentTier.level}/${this.currentTier.name}] RAM: ${ramGB}GB | Model: ${this.currentTier.primaryModel} | Context: ${this.currentTier.contextLimit} tokens`;
  }
}
```

---

## 4. FIFOキュー設計

### 4.1 設計方針

- **同時実行数:** 1（シングルモデル・シングルキュー方式）
- **最大キュー長:** 10
- **リクエストサイズ上限:** 200KB（task + context合計）
- **エージェント別レートリミット:** 設定ファイルで指定可能（デフォルト: 制限なし）

### 4.2 TypeScriptインターフェース

```typescript
interface QueueConfig {
  maxQueueLength: number;      // デフォルト: 10
  maxRequestSizeBytes: number; // デフォルト: 200 * 1024 (200KB)
  queueTimeoutMs: number;      // キュー待ちタイムアウト（デフォルト: 60_000）
  rateLimits?: {
    maxRequestsPerMinute?: number;  // エージェント別（デフォルト: 制限なし）
  };
}

interface QueueItem<T> {
  id: string;
  payload: T;
  enqueuedAt: number;  // Date.now()
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

interface QueueStats {
  currentLength: number;
  isProcessing: boolean;
  totalProcessed: number;
  totalRejected: number;
  averageWaitMs: number;
  averageProcessingMs: number;
}
```

### 4.3 Promise-basedキュー実装

```typescript
class FIFOQueue<T, R> {
  private queue: QueueItem<T>[] = [];
  private isProcessing = false;
  private config: QueueConfig;
  private processor: (item: T) => Promise<R>;
  private stats = {
    totalProcessed: 0,
    totalRejected: 0,
    totalWaitMs: 0,
    totalProcessingMs: 0,
  };

  constructor(
    config: QueueConfig,
    processor: (item: T) => Promise<R>,
  ) {
    this.config = config;
    this.processor = processor;
  }

  /**
   * リクエストをキューに追加し、処理完了まで待機するPromiseを返す。
   * キュー満杯時は即座にリジェクトする。
   */
  async enqueue(payload: T, requestSizeBytes: number): Promise<R> {
    // リクエストサイズチェック
    if (requestSizeBytes > this.config.maxRequestSizeBytes) {
      this.stats.totalRejected++;
      throw new QueueError(
        'REQUEST_TOO_LARGE',
        `Request size ${requestSizeBytes} bytes exceeds limit of ${this.config.maxRequestSizeBytes} bytes`,
      );
    }

    // キュー長チェック
    if (this.queue.length >= this.config.maxQueueLength) {
      this.stats.totalRejected++;
      throw new QueueError(
        'QUEUE_FULL',
        `Queue is full (${this.config.maxQueueLength} items). Try again later.`,
      );
    }

    return new Promise<R>((resolve, reject) => {
      const item: QueueItem<T> = {
        id: crypto.randomUUID(),
        payload,
        enqueuedAt: Date.now(),
        resolve: resolve as (value: unknown) => void,
        reject,
      };

      // キュー待ちタイムアウト
      const queueTimer = setTimeout(() => {
        const index = this.queue.indexOf(item);
        if (index !== -1) {
          this.queue.splice(index, 1);
          this.stats.totalRejected++;
          reject(new QueueError(
            'QUEUE_TIMEOUT',
            `Request waited in queue for ${this.config.queueTimeoutMs}ms without being processed.`,
          ));
        }
      }, this.config.queueTimeoutMs);

      // タイムアウトクリーンアップ用にタイマーIDを保持
      (item as QueueItem<T> & { _timer: NodeJS.Timeout })._timer = queueTimer;

      this.queue.push(item);
      this.processNext();
    });
  }

  private async processNext(): Promise<void> {
    if (this.isProcessing || this.queue.length === 0) return;

    this.isProcessing = true;
    const item = this.queue.shift()!;
    const waitMs = Date.now() - item.enqueuedAt;
    this.stats.totalWaitMs += waitMs;

    // キュー待ちタイムアウトタイマーをクリア
    clearTimeout((item as QueueItem<T> & { _timer: NodeJS.Timeout })._timer);

    const processingStart = Date.now();
    try {
      const result = await this.processor(item.payload);
      this.stats.totalProcessed++;
      this.stats.totalProcessingMs += Date.now() - processingStart;
      item.resolve(result);
    } catch (error) {
      this.stats.totalRejected++;
      item.reject(error);
    } finally {
      this.isProcessing = false;
      // 次のアイテムを処理（非同期で即座に）
      queueMicrotask(() => this.processNext());
    }
  }

  getStats(): QueueStats {
    const processed = this.stats.totalProcessed || 1; // ゼロ除算防止
    return {
      currentLength: this.queue.length,
      isProcessing: this.isProcessing,
      totalProcessed: this.stats.totalProcessed,
      totalRejected: this.stats.totalRejected,
      averageWaitMs: this.stats.totalWaitMs / processed,
      averageProcessingMs: this.stats.totalProcessingMs / processed,
    };
  }
}

class QueueError extends Error {
  constructor(
    public readonly code: 'QUEUE_FULL' | 'QUEUE_TIMEOUT' | 'REQUEST_TOO_LARGE',
    message: string,
  ) {
    super(message);
    this.name = 'QueueError';
  }
}
```

### 4.4 エージェント別レートリミット

Agent Teams環境では、複数エージェントが同時にMCPツールを呼び出す。レートリミットを設けることで特定エージェントによるキュー独占を防止する。

```typescript
class RateLimiter {
  private windows: Map<string, number[]> = new Map();
  private maxRequestsPerMinute: number;

  constructor(maxRequestsPerMinute: number) {
    this.maxRequestsPerMinute = maxRequestsPerMinute;
  }

  /**
   * レートリミットチェック。
   * agentId は MCP リクエストの _meta から取得（存在しない場合は 'default'）。
   */
  check(agentId: string): boolean {
    const now = Date.now();
    const windowStart = now - 60_000;

    let timestamps = this.windows.get(agentId) ?? [];
    // 1分以上前のエントリを削除
    timestamps = timestamps.filter(t => t > windowStart);

    if (timestamps.length >= this.maxRequestsPerMinute) {
      return false; // レート超過
    }

    timestamps.push(now);
    this.windows.set(agentId, timestamps);
    return true;
  }
}
```

### 4.5 PriorityQueue

FIFOQueueを拡張し、優先度付きキューイングを提供する。既存のFIFOQueueは互換性のため維持する。

#### Priority enum

| Priority | 値 | 用途 |
|:---|:---:|:---|
| **URGENT** | 0 | 緊急タスク（将来拡張用） |
| **HIGH** | 1 | 高優先度タスク |
| **NORMAL** | 2 | 通常のoffload_work/compress_context（デフォルト） |
| **LOW** | 3 | batch_offloadのタスク |

#### 設計方針

- 同一優先度内はFIFO順（先入れ先出し）を維持
- `getStatus()` に `byPriority` 統計を追加（優先度別のpending/processed数）
- concurrency=1、最大キュー長・レートリミットはFIFOQueueと同一仕様

#### TypeScriptインターフェース

```typescript
enum Priority {
  URGENT = 0,
  HIGH = 1,
  NORMAL = 2,
  LOW = 3,
}

interface PriorityQueueStats {
  currentLength: number;
  isProcessing: boolean;
  totalProcessed: number;
  totalRejected: number;
  averageWaitMs: number;
  averageProcessingMs: number;
  byPriority: Record<Priority, { pending: number; processed: number }>;
}

class PriorityQueue<T, R> {
  constructor(
    config: PriorityQueueConfig,
    processor: (item: T) => Promise<R>,
    rateLimiter?: RateLimiter,
  );

  /**
   * 優先度付きでキューに追加。
   * 同一優先度内はFIFO順を維持し、高優先度アイテムは前方に挿入される。
   */
  async enqueue(
    payload: T,
    requestSizeBytes: number,
    options?: { priority?: Priority; agentId?: string },
  ): Promise<R>;

  /** 優先度別統計を含むキュー状態を返す */
  getStatus(): PriorityQueueStats;
}
```

---

## 5. System Prompt管理

### 5.1 固定System Prompt

ローカルLLMに対して以下のSystem Promptを全リクエストに強制付与する。ユーザー入力やMCPリクエストからの上書きは不可。

```typescript
const SYSTEM_PROMPT = `You are a specialized code/text processing worker.
RETURN ONLY the requested result.
NO conversational filler (e.g., 'Sure', 'Here is the code').
NO explanations unless explicitly asked.
Use raw text or raw code blocks without extra commentary.` as const;
```

### 5.2 適用方式

#### A. APIレベルでの強制（プライマリ）

全ての `/api/chat` リクエストに対して、systemロールのメッセージとして先頭に挿入する。ユーザー提供のsystemメッセージは除去する。

```typescript
function buildChatMessages(
  userTask: string,
  userContext?: string,
): OllamaChatMessage[] {
  const messages: OllamaChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: formatUserPrompt(userTask, userContext) },
  ];
  return messages;
}

function formatUserPrompt(task: string, context?: string): string {
  if (!context) return task;
  return `${task}\n\n---\nContext:\n${context}`;
}
```

#### B. Modelfileレベルでの設定（セカンダリ）

Ollama Modelfileでもデフォルトのsystem promptを設定し、二重の防御とする。ただし、APIリクエストのsystemメッセージがModelfileの設定を上書きするため、実質的にはAの方式が適用される。これはOllamaの仕様に依存しない追加の安全策。

```dockerfile
# Modelfile（参考: ユーザーが独自モデルを作成する場合）
FROM qwen2.5-coder:7b
SYSTEM """You are a specialized code/text processing worker.
RETURN ONLY the requested result.
NO conversational filler (e.g., 'Sure', 'Here is the code').
NO explanations unless explicitly asked.
Use raw text or raw code blocks without extra commentary."""
PARAMETER temperature 0.1
PARAMETER num_ctx 12000
```

### 5.3 上書き防止

```typescript
/**
 * ユーザー入力からSystem Promptの上書き試行を検出・除去する。
 * プロンプトインジェクション対策の入口。
 */
function sanitizeUserInput(input: string): string {
  // systemロール偽装パターンの検出
  const suspiciousPatterns = [
    /\[SYSTEM\]/gi,
    /\[INST\]/gi,
    /<\|system\|>/gi,
    /<<SYS>>/gi,
    /### System:/gi,
    /You are now/gi,
    /Ignore previous instructions/gi,
    /Forget your instructions/gi,
  ];

  let sanitized = input;
  for (const pattern of suspiciousPatterns) {
    if (pattern.test(sanitized)) {
      // ログ出力（セキュリティイベント）
      process.stderr.write(
        `[SECURITY] Suspicious pattern detected and sanitized: ${pattern.source}\n`
      );
      sanitized = sanitized.replace(pattern, '[FILTERED]');
    }
  }
  return sanitized;
}
```

---

## 6. コスト計算モジュール

### 6.1 価格テーブル

Anthropic APIに価格取得エンドポイントは存在しないため、ハードコードされたデフォルト価格と設定ファイルによる上書きの二層構造とする。

```typescript
/** ハードコードされたデフォルト価格（2026年2月時点） */
const DEFAULT_CLOUD_PRICING: CloudPricing = {
  'claude-sonnet-4-5': {
    inputPer1MTokens: 3.00,   // $3.00 / 1M input tokens
    outputPer1MTokens: 15.00, // $15.00 / 1M output tokens
  },
  'claude-opus-4': {
    inputPer1MTokens: 15.00,
    outputPer1MTokens: 75.00,
  },
  'claude-haiku-3-5': {
    inputPer1MTokens: 0.80,
    outputPer1MTokens: 4.00,
  },
} as const;

/** デフォルトの比較対象モデル */
const DEFAULT_COMPARISON_MODEL = 'claude-sonnet-4-5';

interface CloudPricing {
  [modelId: string]: {
    inputPer1MTokens: number;
    outputPer1MTokens: number;
  };
}

interface CostConfig {
  comparisonModel: string;  // 節約額計算の比較対象
  pricing: CloudPricing;    // 設定ファイルで上書き可能
}
```

### 6.2 計算式

```
節約額($) = (ローカル入力トークン数 * クラウド入力単価/1M) + (ローカル出力トークン数 * クラウド出力単価/1M)
```

### 6.3 TypeScript実装

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

class CostCalculator {
  private config: CostConfig;
  private records: CostRecord[] = [];
  private cumulativeSavings = 0;

  constructor(config: CostConfig) {
    this.config = config;
  }

  /**
   * ローカルLLM処理結果から節約額を計算する。
   */
  calculate(params: {
    tool: 'offload_work' | 'compress_context';
    model: string;
    inputTokens: number;
    outputTokens: number;
    processingTimeMs: number;
  }): { savings: number; cumulative: number } {
    const pricing = this.config.pricing[this.config.comparisonModel];
    if (!pricing) {
      throw new Error(`Pricing not found for model: ${this.config.comparisonModel}`);
    }

    const inputCost = (params.inputTokens / 1_000_000) * pricing.inputPer1MTokens;
    const outputCost = (params.outputTokens / 1_000_000) * pricing.outputPer1MTokens;
    const savings = inputCost + outputCost;

    this.cumulativeSavings += savings;

    const record: CostRecord = {
      timestamp: Date.now(),
      tool: params.tool,
      model: params.model,
      inputTokens: params.inputTokens,
      outputTokens: params.outputTokens,
      savingsUsd: savings,
      processingTimeMs: params.processingTimeMs,
    };
    this.records.push(record);

    return { savings, cumulative: this.cumulativeSavings };
  }

  getCumulativeSavings(): number {
    return this.cumulativeSavings;
  }

  getRecords(): readonly CostRecord[] {
    return this.records;
  }
}
```

### 6.4 stderr出力フォーマット

コスト情報はstderrに出力する。MCPサーバーはstdioトランスポートを使用するため、stdoutはMCPプロトコル通信専用であり、ログやメトリクスはstderrに出力しなければならない。

```typescript
function logCostToStderr(params: {
  tool: string;
  savings: number;
  cumulative: number;
  inputTokens: number;
  outputTokens: number;
  model: string;
  processingTimeMs: number;
}): void {
  const line = [
    `[COST]`,
    `tool=${params.tool}`,
    `model=${params.model}`,
    `in=${params.inputTokens}`,
    `out=${params.outputTokens}`,
    `saved=$${params.savings.toFixed(4)}`,
    `total=$${params.cumulative.toFixed(4)}`,
    `time=${params.processingTimeMs}ms`,
  ].join(' ');

  process.stderr.write(line + '\n');
}
```

**出力例:**
```
[COST] tool=offload_work model=qwen2.5-coder:7b in=1200 out=800 saved=$0.0156 total=$0.1523 time=3400ms
[COST] tool=compress_context model=qwen2.5-coder:7b in=8500 out=400 saved=$0.0315 total=$0.1838 time=5200ms
```

### 6.5 累計記録の永続化

セッション間で累計節約額を保持するため、設定ファイルと同じディレクトリにJSON形式で保存する。

```typescript
interface CostHistory {
  version: 1;
  lastUpdated: string;      // ISO 8601
  cumulativeSavings: number; // USD
  totalRequests: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  byTool: {
    offload_work: { requests: number; savings: number };
    compress_context: { requests: number; savings: number };
  };
}

// 保存先: ~/.config/claude-token-saver/cost-history.json
```

---

## 7. タイムアウト設計

### 7.1 ティア別動的タイムアウト

モデルサイズが大きいほど初回ロードと推論に時間がかかるため、Tier別に異なるタイムアウト値を設定する。

| パラメータ | Tier 1 (Light) | Tier 2 (Standard) | Tier 3 (Ultra) | 説明 |
|:---|:---:|:---:|:---:|:---|
| **requestTimeout** | 60s | 90s | 180s | リクエスト全体の最大処理時間 |
| **heartbeatTimeout** | 30s | 30s | 45s | ストリーミング中のチャンク間最大間隔 |
| **firstTokenTimeout** | 120s | 120s | 180s | 最初のトークンが生成されるまでの猶予 |
| **queueTimeout** | 60s | 60s | 60s | キュー待ちの最大時間（全Tier共通） |

### 7.2 タイムアウトの種類と判定フロー

```
リクエスト受信
    │
    ├─[1] キュー待ちタイムアウト (queueTimeout)
    │     └─ キューに入ってから処理開始まで
    │
    ├─[2] 初回トークンタイムアウト (firstTokenTimeout)
    │     └─ Ollamaへリクエスト送信〜最初のチャンク受信まで
    │     └─ モデルロード時間を含む（初回アクセス時に長くなる）
    │
    ├─[3] ハートビートタイムアウト (heartbeatTimeout)
    │     └─ ストリーミング中、前のチャンクから次のチャンクまで
    │
    └─[4] リクエストタイムアウト (requestTimeout)
          └─ 処理開始〜完了までの全体時間
```

### 7.3 TypeScript実装

```typescript
interface TimeoutState {
  abortController: AbortController;
  requestTimer: NodeJS.Timeout | null;
  firstTokenTimer: NodeJS.Timeout | null;
  heartbeatTimer: NodeJS.Timeout | null;
  firstTokenReceived: boolean;
}

function createTimeoutManager(config: TimeoutConfig): {
  state: TimeoutState;
  onFirstToken: () => void;
  onChunk: () => void;
  cleanup: () => void;
} {
  const abortController = new AbortController();
  const state: TimeoutState = {
    abortController,
    requestTimer: null,
    firstTokenTimer: null,
    heartbeatTimer: null,
    firstTokenReceived: false,
  };

  // [4] リクエスト全体タイムアウト
  state.requestTimer = setTimeout(() => {
    abortController.abort(new TimeoutError('REQUEST_TIMEOUT', config.requestTimeout));
  }, config.requestTimeout);

  // [2] 初回トークンタイムアウト
  state.firstTokenTimer = setTimeout(() => {
    if (!state.firstTokenReceived) {
      abortController.abort(new TimeoutError('FIRST_TOKEN_TIMEOUT', config.firstTokenTimeout));
    }
  }, config.firstTokenTimeout);

  return {
    state,
    onFirstToken: () => {
      state.firstTokenReceived = true;
      if (state.firstTokenTimer) {
        clearTimeout(state.firstTokenTimer);
        state.firstTokenTimer = null;
      }
    },
    onChunk: () => {
      // [3] ハートビートリセット
      if (state.heartbeatTimer) clearTimeout(state.heartbeatTimer);
      state.heartbeatTimer = setTimeout(() => {
        abortController.abort(new TimeoutError('HEARTBEAT_TIMEOUT', config.heartbeatTimeout));
      }, config.heartbeatTimeout);
    },
    cleanup: () => {
      if (state.requestTimer) clearTimeout(state.requestTimer);
      if (state.firstTokenTimer) clearTimeout(state.firstTokenTimer);
      if (state.heartbeatTimer) clearTimeout(state.heartbeatTimer);
    },
  };
}

class TimeoutError extends Error {
  constructor(
    public readonly code: 'REQUEST_TIMEOUT' | 'FIRST_TOKEN_TIMEOUT' | 'HEARTBEAT_TIMEOUT',
    public readonly timeoutMs: number,
  ) {
    super(`${code}: Timed out after ${timeoutMs}ms`);
    this.name = 'TimeoutError';
  }
}
```

---

## 8. フォールバック設計

### 8.1 フォールバックトリガー条件

| # | 条件 | エラーコード | 説明 |
|:---|:---|:---|:---|
| 1 | リクエストタイムアウト | `TIMEOUT_REQUEST` | requestTimeout超過 |
| 2 | 初回トークンタイムアウト | `TIMEOUT_FIRST_TOKEN` | firstTokenTimeout超過（モデルロード含む） |
| 3 | ハートビートタイムアウト | `TIMEOUT_HEARTBEAT` | ストリーミング中のハング |
| 4 | キュータイムアウト | `TIMEOUT_QUEUE` | queueTimeout超過 |
| 5 | キュー満杯 | `QUEUE_FULL` | maxQueueLength到達 |
| 6 | Ollama接続エラー | `OLLAMA_UNREACHABLE` | ヘルスチェック失敗 |
| 7 | Ollamaランタイムエラー | `OLLAMA_ERROR` | 500系エラー |
| 8 | リクエストサイズ超過 | `REQUEST_TOO_LARGE` | maxRequestSizeBytes超過 |

### 8.2 フォールバックレスポンス形式

フォールバック時はMCPの `isError: true` フラグを設定し、Claudeが自身でタスクを処理するよう誘導するメッセージを返す。

```typescript
interface FallbackResponse {
  content: Array<{
    type: 'text';
    text: string;
  }>;
  isError: true;
}

function createFallbackResponse(
  errorCode: string,
  details: string,
  originalTask?: string,
): FallbackResponse {
  const message = [
    `[FALLBACK_TO_CLOUD]`,
    `Local LLM processing failed: ${errorCode}`,
    details,
    `Please process this task directly using cloud API.`,
    originalTask ? `\nOriginal task:\n${originalTask}` : '',
  ].filter(Boolean).join('\n');

  return {
    content: [{ type: 'text', text: message }],
    isError: true,
  };
}
```

### 8.3 Tier 1 モデルフォールバック

Tier 1ではphi4(14B)がRAM不足で起動できない場合、phi4-mini(3.8B)にフォールバックする。

```typescript
async function executeWithModelFallback(
  client: OllamaClient,
  tier: TierConfig,
  request: OllamaChatRequest,
): Promise<OllamaChatResponse> {
  try {
    return await client.chat({ ...request, model: tier.primaryModel });
  } catch (error) {
    if (tier.fallbackModel && isModelLoadError(error)) {
      process.stderr.write(
        `[FALLBACK] Primary model ${tier.primaryModel} failed, trying ${tier.fallbackModel}\n`
      );
      return await client.chat({ ...request, model: tier.fallbackModel });
    }
    throw error;
  }
}

function isModelLoadError(error: unknown): boolean {
  if (error instanceof Error) {
    return error.message.includes('out of memory')
      || error.message.includes('failed to load');
  }
  return false;
}
```

### 8.4 フォールバックフロー図

```
リクエスト受信
    │
    ├─ キュー満杯? ──Yes──> FALLBACK (QUEUE_FULL)
    │
    ├─ サイズ超過? ──Yes──> FALLBACK (REQUEST_TOO_LARGE)
    │
    ├─ キュー投入 ─── キュー待ちタイムアウト? ──Yes──> FALLBACK (TIMEOUT_QUEUE)
    │
    ├─ Ollamaリクエスト送信
    │   │
    │   ├─ 接続エラー? ──Yes──> FALLBACK (OLLAMA_UNREACHABLE)
    │   │
    │   ├─ 初回トークンタイムアウト?
    │   │   └─Yes─> Tier 1かつfallbackModel有り?
    │   │            ├─Yes─> fallbackModelで再試行
    │   │            └─No──> FALLBACK (TIMEOUT_FIRST_TOKEN)
    │   │
    │   ├─ ハートビートタイムアウト? ──Yes──> FALLBACK (TIMEOUT_HEARTBEAT)
    │   │
    │   ├─ リクエストタイムアウト? ──Yes──> FALLBACK (TIMEOUT_REQUEST)
    │   │
    │   └─ Ollamaエラー? ──Yes──> FALLBACK (OLLAMA_ERROR)
    │
    └─ 成功 ──> レスポンス返却 + コスト計算
```

---

## 9. 初回起動フロー

### 9.1 起動シーケンス

```
MCPサーバー起動
    │
    ├─[1] 設定ファイル読み込み
    │     └─ ~/.config/claude-token-saver/config.json
    │
    ├─[2] RAM検出 & Tier判定
    │     └─ os.totalmem() → TierConfig確定
    │
    ├─[3] GPU検出 & Metal最適化
    │     └─ macOS: OLLAMA_NUM_GPU環境変数の自動設定
    │
    ├─[4] Ollamaヘルスチェック
    │     ├─ OK → 続行
    │     └─ NG → stderr警告 → MCPサーバー起動（ツール呼び出し時にフォールバック）
    │
    ├─[5] モデル存在確認
    │     ├─ 存在 → 続行
    │     └─ 不在 → stderr通知 → MCPサーバー起動（ツール呼び出し時に自動pull or フォールバック）
    │
    ├─[6] コスト履歴読み込み
    │     └─ cost-history.json → 累計節約額のリストア
    │
    └─[7] MCPサーバー開始（stdio transport）
          └─ stderr: Tier情報 + 起動メッセージ
```

### 9.2 TypeScript実装

```typescript
async function startupSequence(config: ServerConfig): Promise<StartupResult> {
  const steps: string[] = [];

  // [1] 設定読み込み
  const userConfig = loadConfig(config.configPath);
  steps.push('Config loaded');

  // [2] Tier判定
  const tiering = new TieringModule(userConfig?.tier);
  const tier = tiering.getTier();
  process.stderr.write(`${tiering.getSummary()}\n`);
  steps.push(`Tier ${tier.level} detected`);

  // [3] GPU検出（macOS Metal）
  const gpuInfo = await detectGPU();
  if (gpuInfo.hasMetal) {
    setMetalEnvironment(gpuInfo);
    steps.push('Metal GPU configured');
  }

  // [4] Ollamaヘルスチェック
  const client = new OllamaClient({
    baseUrl: userConfig?.ollamaUrl ?? 'http://127.0.0.1:11434',
    requestTimeout: tier.timeout.requestTimeout,
    heartbeatTimeout: tier.timeout.heartbeatTimeout,
  });

  const ollamaHealthy = await client.healthCheck();
  if (!ollamaHealthy) {
    process.stderr.write(
      '[WARN] Ollama is not running. Tools will return fallback responses.\n'
    );
    process.stderr.write(
      '[WARN] Start Ollama with: ollama serve\n'
    );
    steps.push('Ollama: NOT RUNNING');
  } else {
    steps.push('Ollama: healthy');

    // [5] モデル存在確認
    const models = await client.listModels();
    const modelNames = models.map(m => m.name);

    const requiredModel = tier.primaryModel;
    if (!modelNames.includes(requiredModel)) {
      process.stderr.write(
        `[INFO] Model "${requiredModel}" not found. It will be pulled on first use.\n`
      );
      process.stderr.write(
        `[INFO] To pre-download: ollama pull ${requiredModel}\n`
      );
      steps.push(`Model ${requiredModel}: NOT INSTALLED`);
    } else {
      steps.push(`Model ${requiredModel}: ready`);
    }

    // Tier 1のフォールバックモデルも確認
    if (tier.fallbackModel && !modelNames.includes(tier.fallbackModel)) {
      process.stderr.write(
        `[INFO] Fallback model "${tier.fallbackModel}" not found.\n`
      );
    }
  }

  // [6] コスト履歴読み込み
  const costHistory = loadCostHistory(config.configPath);
  steps.push(`Cost history: $${costHistory.cumulativeSavings.toFixed(4)} saved`);

  return {
    tier,
    client,
    ollamaHealthy,
    costHistory,
    steps,
  };
}
```

### 9.3 GPU検出とMetal最適化

```typescript
import { execSync } from 'node:child_process';

interface GPUInfo {
  hasMetal: boolean;
  gpuMemoryMB: number | null;
  platform: string;
}

async function detectGPU(): Promise<GPUInfo> {
  const platform = process.platform;

  if (platform === 'darwin') {
    // macOS: Metal GPUの検出
    try {
      const output = execSync(
        'system_profiler SPDisplaysDataType -json',
        { encoding: 'utf-8', timeout: 5000 }
      );
      const data = JSON.parse(output);
      const gpus = data.SPDisplaysDataType ?? [];

      const hasMetal = gpus.some((gpu: Record<string, unknown>) =>
        gpu.sppci_metal_supported === 'sppci_metal_supported'
        || gpu.spdisplays_metal === 'spdisplays_supported'
      );

      return { hasMetal, gpuMemoryMB: null, platform };
    } catch {
      return { hasMetal: false, gpuMemoryMB: null, platform };
    }
  }

  return { hasMetal: false, gpuMemoryMB: null, platform };
}

function setMetalEnvironment(gpuInfo: GPUInfo): void {
  if (gpuInfo.hasMetal) {
    // OllamaがMetal GPUを最大限利用するよう設定
    // OLLAMA_NUM_GPU=999 は「利用可能な全GPUレイヤーを使用」の意味
    if (!process.env.OLLAMA_NUM_GPU) {
      process.env.OLLAMA_NUM_GPU = '999';
      process.stderr.write('[GPU] Metal detected. Set OLLAMA_NUM_GPU=999\n');
    }
  }
}
```

### 9.4 初回モデルpull

モデルが存在しない場合、ツール初回呼び出し時に自動pullを試みる。MCPサーバーはstdioで動作するため、ユーザーへのインタラクティブな確認（y/n）はstderrの通知に置き換える。

```typescript
async function ensureModelAvailable(
  client: OllamaClient,
  modelName: string,
): Promise<boolean> {
  const models = await client.listModels();
  if (models.some(m => m.name === modelName)) {
    return true;
  }

  process.stderr.write(`[INFO] Pulling model "${modelName}"... This may take several minutes.\n`);

  try {
    await client.pullModel(modelName);
    process.stderr.write(`[INFO] Model "${modelName}" pulled successfully.\n`);
    return true;
  } catch (error) {
    process.stderr.write(
      `[ERROR] Failed to pull model "${modelName}": ${error instanceof Error ? error.message : String(error)}\n`
    );
    return false;
  }
}
```

---

## 10. 設定ファイル仕様

### 10.1 ファイルパスと形式

- **パス:** `~/.config/claude-token-saver/config.json`
- **形式:** JSON
- **エンコーディング:** UTF-8
- **必須:** いいえ（設定ファイルが存在しない場合は全てデフォルト値で動作）

### 10.2 JSON Schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "claude-token-saver-mcp Configuration",
  "type": "object",
  "properties": {
    "ollama": {
      "type": "object",
      "description": "Ollama接続設定",
      "properties": {
        "baseUrl": {
          "type": "string",
          "description": "Ollama APIのベースURL",
          "default": "http://127.0.0.1:11434"
        }
      }
    },
    "tier": {
      "type": "object",
      "description": "ティアリング設定の上書き",
      "properties": {
        "forceLevel": {
          "type": "integer",
          "enum": [1, 2, 3],
          "description": "Tierを強制指定（RAM自動検出を無視）"
        },
        "primaryModel": {
          "type": "string",
          "description": "プライマリモデル名の上書き"
        },
        "fallbackModel": {
          "type": ["string", "null"],
          "description": "フォールバックモデル名の上書き（nullで無効化）"
        },
        "contextLimit": {
          "type": "integer",
          "minimum": 1000,
          "maximum": 128000,
          "description": "コンテキスト上限トークン数の上書き"
        }
      }
    },
    "timeout": {
      "type": "object",
      "description": "タイムアウト設定の上書き（ms単位）",
      "properties": {
        "requestTimeout": {
          "type": "integer",
          "minimum": 10000,
          "description": "リクエスト全体のタイムアウト"
        },
        "heartbeatTimeout": {
          "type": "integer",
          "minimum": 5000,
          "description": "ストリーミングチャンク間タイムアウト"
        },
        "firstTokenTimeout": {
          "type": "integer",
          "minimum": 10000,
          "description": "初回トークン到着までの猶予"
        },
        "queueTimeout": {
          "type": "integer",
          "minimum": 5000,
          "description": "キュー待ちタイムアウト"
        }
      }
    },
    "queue": {
      "type": "object",
      "description": "FIFOキュー設定",
      "properties": {
        "maxLength": {
          "type": "integer",
          "minimum": 1,
          "maximum": 100,
          "default": 10,
          "description": "最大キュー長"
        },
        "maxRequestSizeBytes": {
          "type": "integer",
          "minimum": 1024,
          "default": 204800,
          "description": "リクエストサイズ上限（バイト）"
        },
        "rateLimitPerMinute": {
          "type": "integer",
          "minimum": 1,
          "description": "エージェント別レートリミット（リクエスト/分）"
        }
      }
    },
    "cost": {
      "type": "object",
      "description": "コスト計算設定",
      "properties": {
        "comparisonModel": {
          "type": "string",
          "default": "claude-sonnet-4-5",
          "description": "節約額計算の比較対象モデル"
        },
        "pricing": {
          "type": "object",
          "description": "クラウドAPI価格の上書き",
          "additionalProperties": {
            "type": "object",
            "properties": {
              "inputPer1MTokens": {
                "type": "number",
                "minimum": 0,
                "description": "入力トークン100万あたりの価格（USD）"
              },
              "outputPer1MTokens": {
                "type": "number",
                "minimum": 0,
                "description": "出力トークン100万あたりの価格（USD）"
              }
            },
            "required": ["inputPer1MTokens", "outputPer1MTokens"]
          }
        }
      }
    },
    "security": {
      "type": "object",
      "description": "セキュリティ設定",
      "properties": {
        "enableInputSanitization": {
          "type": "boolean",
          "default": true,
          "description": "プロンプトインジェクション検出の有効/無効"
        }
      }
    }
  }
}
```

### 10.3 設定ファイル例

```json
{
  "ollama": {
    "baseUrl": "http://127.0.0.1:11434"
  },
  "tier": {
    "primaryModel": "codellama:13b",
    "contextLimit": 8000
  },
  "timeout": {
    "requestTimeout": 120000,
    "firstTokenTimeout": 180000
  },
  "queue": {
    "maxLength": 5,
    "rateLimitPerMinute": 10
  },
  "cost": {
    "comparisonModel": "claude-sonnet-4-5",
    "pricing": {
      "claude-sonnet-4-5": {
        "inputPer1MTokens": 3.00,
        "outputPer1MTokens": 15.00
      }
    }
  }
}
```

### 10.4 設定読み込みロジック

```typescript
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const CONFIG_DIR = path.join(os.homedir(), '.config', 'claude-token-saver');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const COST_HISTORY_FILE = path.join(CONFIG_DIR, 'cost-history.json');

interface ServerConfig {
  configPath: string;
  ollama: { baseUrl: string };
  tier: Partial<TierConfig> | null;
  timeout: Partial<TimeoutConfig> | null;
  queue: QueueConfig;
  cost: CostConfig;
  security: { enableInputSanitization: boolean };
}

function loadConfig(configPath?: string): ServerConfig {
  const filePath = configPath ?? CONFIG_FILE;

  const defaults: ServerConfig = {
    configPath: filePath,
    ollama: { baseUrl: 'http://127.0.0.1:11434' },
    tier: null,
    timeout: null,
    queue: {
      maxQueueLength: 10,
      maxRequestSizeBytes: 200 * 1024,
      queueTimeoutMs: 60_000,
    },
    cost: {
      comparisonModel: DEFAULT_COMPARISON_MODEL,
      pricing: DEFAULT_CLOUD_PRICING,
    },
    security: { enableInputSanitization: true },
  };

  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    // 深いマージ（省略: 実装時にdeepmergeライブラリまたは自前実装）
    return deepMerge(defaults, parsed);
  } catch {
    // ファイルが存在しないか読み込めない場合はデフォルトを返す
    return defaults;
  }
}
```

### 10.5 distributed（分散実行設定）

```json
{
  "distributed": {
    "enabled": false,
    "nodes": [
      {
        "id": "node-1",
        "baseUrl": "http://192.168.1.10:11434",
        "label": "GPU Server",
        "weight": 2
      },
      {
        "id": "node-2",
        "baseUrl": "http://192.168.1.11:11434",
        "label": "CPU Server",
        "weight": 1
      }
    ],
    "strategy": "model-affinity",
    "healthCheckIntervalMs": 30000
  }
}
```

| プロパティ | 型 | デフォルト | 説明 |
|:---|:---|:---|:---|
| `enabled` | boolean | `false` | 分散実行の有効/無効 |
| `nodes` | OllamaNode[] | `[]` | Ollamaノード一覧 |
| `strategy` | string | `"model-affinity"` | ロードバランシング戦略 |
| `healthCheckIntervalMs` | number | `30000` | ヘルスチェック間隔（ms） |

### 10.6 persistence（永続化設定）

```json
{
  "persistence": {
    "enabled": true,
    "dataDir": "~/.config/claude-token-saver/",
    "autoSaveIntervalMs": 300000
  }
}
```

| プロパティ | 型 | デフォルト | 説明 |
|:---|:---|:---|:---|
| `enabled` | boolean | `true` | 永続化の有効/無効 |
| `dataDir` | string | `"~/.config/claude-token-saver/"` | データ保存ディレクトリ |
| `autoSaveIntervalMs` | number | `300000` | 自動保存間隔（ms、5分） |

### 10.7 registryUpdater（レジストリ自動更新設定）

```json
{
  "registryUpdater": {
    "enabled": false,
    "updateIntervalMs": 1800000
  }
}
```

| プロパティ | 型 | デフォルト | 説明 |
|:---|:---|:---|:---|
| `enabled` | boolean | `false` | 自動更新の有効/無効 |
| `updateIntervalMs` | number | `1800000` | 更新間隔（ms、30分） |

---

## 11. メトリクス & 永続化

### 11.1 MetricsCollector

Prometheus互換のメトリクス収集モジュール。全リクエストのパフォーマンスデータを収集し、`get_metrics` ツールで公開する。

#### 収集メトリクス

| 種別 | メトリクス名 | 型 | 説明 |
|:---|:---|:---|:---|
| カウンター | `cts_requests_total` | counter | ツール別リクエスト総数 |
| カウンター | `cts_errors_total` | counter | エラーコード別エラー総数 |
| カウンター | `cts_savings_usd_total` | counter | コスト節約累計（USD） |
| カウンター | `cts_tokens_total` | counter | 入出力トークン累計 |
| ゲージ | `cts_queue_length` | gauge | 現在のキュー長 |
| ゲージ | `cts_ollama_healthy` | gauge | Ollama健全性（0/1） |
| ゲージ | `cts_loaded_models_count` | gauge | ロード中モデル数 |
| ヒストグラム | `cts_request_duration_ms` | summary | レイテンシ p50/p95/p99 |

#### TypeScriptインターフェース

```typescript
interface MetricsSnapshot {
  requestsTotal: number;
  requestsByTool: Record<string, number>;
  errorsTotal: number;
  errorsByCode: Record<string, number>;
  queueLength: number;
  ollamaHealthy: boolean;
  loadedModelsCount: number;
  latencyQuantiles: { p50: number; p95: number; p99: number };
  totalSavingsUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  uptimeMs: number;
}

class MetricsCollector {
  /** リクエスト記録（ツール名、処理時間、成否、エラーコード） */
  recordRequest(toolName: string, durationMs: number, success: boolean, errorCode?: string): void;

  /** トークン使用量記録 */
  recordTokens(inputTokens: number, outputTokens: number): void;

  /** コスト節約額記録 */
  recordSavings(savingsUsd: number): void;

  /** ゲージ更新 */
  updateQueueLength(length: number): void;
  updateOllamaHealth(healthy: boolean): void;
  updateLoadedModels(count: number): void;

  /** Prometheus text exposition形式でエクスポート */
  toPrometheusText(): string;

  /** JSONスナップショットでエクスポート */
  toJSON(): MetricsSnapshot;
}
```

### 11.2 PersistenceManager

ExecutionTrackerとBenchmarkStoreのファイルI/Oを管理するモジュール。サーバー起動時にデータをロードし、5分間隔で自動保存する。

#### 設計方針

- **保存対象:** `execution-history.json`（実行履歴）、`benchmark-data.json`（ベンチマークデータ）
- **保存先:** `~/.config/claude-token-saver/`（`persistence.dataDir` で変更可能）
- **auto-save:** デフォルト5分間隔（`persistence.autoSaveIntervalMs` で変更可能）
- **起動時ロード:** 初回起動時はファイル不在でもエラーにせず、空状態で開始
- **シャットダウン時:** `saveAll()` で最終保存を実行

#### TypeScriptインターフェース

```typescript
interface PersistenceManagerConfig {
  dataDir?: string;            // デフォルト: ~/.config/claude-token-saver/
  autoSaveIntervalMs?: number; // デフォルト: 300000 (5分)
}

class PersistenceManager {
  /** コンポーネント登録 */
  register(components: {
    executionTracker?: ExecutionTracker;
    benchmarkStore?: BenchmarkStore;
    logger?: Logger;
  }): void;

  /** 起動時: ディスクからデータをロード */
  async loadAll(): Promise<void>;

  /** シャットダウン時: ディスクにデータを保存 */
  async saveAll(): Promise<void>;

  /** auto-saveタイマー開始 */
  startAutoSave(): void;

  /** auto-saveタイマー停止 */
  stopAutoSave(): void;
}
```

### 11.3 RegistryUpdater

30分間隔でOllamaにインストール済みモデルを問い合わせ、静的レジストリに未登録のモデルを自動分類するモジュール。

#### 分類パターン（9パターン）

| パターン | カテゴリ | ライセンス |
|:---|:---|:---|
| `qwen.*coder` | coding | Apache-2.0 |
| `deepseek.*coder` | coding | MIT |
| `codellama` | coding | Meta-Community |
| `devstral` | coding-agent | Apache-2.0 |
| `qwen3` | general | Apache-2.0 |
| `qwen2.5` | general | Apache-2.0 |
| `gemma` | general | MIT |
| `phi` | general | MIT |
| `llama` | general | Meta-Community |

#### 自動推定

- **Tier推定:** パラメータ数から判定（≤8B→Tier1, ≤16B→Tier2, >16B→Tier3）
- **VRAM推定:** ファイルサイズ * 1.2（ランタイムオーバーヘッド）
- **最小RAM推定:** VRAM + 2GB（バッファ）

#### TypeScriptインターフェース

```typescript
interface RegistryUpdaterConfig {
  updateIntervalMs?: number; // デフォルト: 1800000 (30分)
  enabled?: boolean;         // デフォルト: false
}

class RegistryUpdater {
  /** 定期更新開始（即時実行 + interval） */
  start(): void;

  /** 定期更新停止 */
  stop(): void;

  /** 単一更新サイクル実行: 新規発見モデルを返す */
  async update(): Promise<ModelRecommendation[]>;

  /** 発見済みモデル一覧を取得 */
  getDiscoveredModels(): ModelRecommendation[];

  /** モデルをパターンマッチで分類 */
  classifyModel(model: OllamaModelInfo): ModelRecommendation | null;
}
```

---

## 付録A: モジュール構成

```
packages/mcp-server/
├── src/
│   ├── index.ts                  # エントリーポイント（MCPサーバー起動）
│   ├── server.ts                 # MCPサーバー定義（ツール登録）
│   ├── tools/
│   │   ├── offload-work.ts       # offload_workツール実装
│   │   ├── compress-context.ts   # compress_contextツール実装
│   │   ├── recommend-model.ts    # recommend_modelツール実装
│   │   ├── preload-model.ts      # preload_modelツール実装
│   │   ├── list-loaded-models.ts # list_loaded_modelsツール実装
│   │   ├── pull-model.ts         # pull_modelツール実装
│   │   ├── batch-offload.ts      # batch_offloadツール実装
│   │   ├── get-metrics.ts        # get_metricsツール実装
│   │   ├── configure-model-selector.ts # configure_model_selectorツール実装
│   │   └── cost-dashboard.ts     # cost_dashboardツール実装
│   ├── ollama/
│   │   ├── client.ts             # Ollamaクライアント
│   │   ├── streaming.ts          # ストリーミングパーサー
│   │   └── load-balancer.ts      # マルチノードロードバランサー
│   ├── tiering/
│   │   ├── detector.ts           # RAM検出 & Tier判定
│   │   ├── gpu.ts                # GPU検出 & Metal最適化
│   │   └── types.ts              # Tier型定義
│   ├── queue/
│   │   ├── fifo.ts               # FIFOキュー実装
│   │   ├── priority-queue.ts     # 優先度付きキュー実装
│   │   └── rate-limiter.ts       # レートリミッター
│   ├── cost/
│   │   ├── calculator.ts         # コスト計算
│   │   ├── pricing.ts            # 価格テーブル
│   │   └── history.ts            # 累計記録の永続化
│   ├── metrics/
│   │   └── collector.ts          # Prometheus互換メトリクス収集
│   ├── persistence/
│   │   └── manager.ts            # ExecutionTracker/BenchmarkStore永続化
│   ├── model-selector/
│   │   ├── registry.ts           # 静的モデルレジストリ
│   │   ├── registry-updater.ts   # モデル自動分類・更新
│   │   ├── recommender.ts        # モデル推薦エンジン
│   │   ├── execution-tracker.ts  # 実行履歴トラッカー
│   │   ├── benchmark-db.ts       # ベンチマークストア
│   │   └── vram-calculator.ts    # VRAM容量計算
│   ├── security/
│   │   └── input-sanitizer.ts    # プロンプトインジェクション対策
│   ├── config/
│   │   ├── loader.ts             # 設定ファイル読み込み
│   │   └── schema.ts             # Zodスキーマ定義
│   └── startup.ts                # 初回起動シーケンス
├── tests/
│   ├── tools/
│   ├── ollama/
│   ├── tiering/
│   ├── queue/
│   ├── cost/
│   ├── metrics/
│   ├── persistence/
│   ├── model-selector/
│   └── security/
├── package.json
└── tsconfig.json
```

---

## 付録B: MCPサーバー登録設定

Claude Codeの `~/.claude.json` または `mcp_servers` に以下を追加:

```json
{
  "mcpServers": {
    "claude-token-saver": {
      "command": "node",
      "args": ["<path-to>/packages/mcp-server/dist/index.js"],
      "env": {
        "OLLAMA_HOST": "127.0.0.1:11434",
        "OLLAMA_NUM_GPU": "999"
      }
    }
  }
}
```

---

## 付録C: シーケンス図

### offload_work 正常系

```
Agent        MCPサーバー        FIFOキュー       OllamaClient       Ollama
  │               │                │                │                 │
  │──offload_work─>│                │                │                 │
  │               │──入力検証──────>│                │                 │
  │               │               │──enqueue───────>│                 │
  │               │               │  (待機中...)    │                 │
  │               │               │<─dequeue────────│                 │
  │               │               │                │──/api/chat──────>│
  │               │               │                │  stream:true      │
  │               │               │                │<─chunk(token1)───│
  │               │               │                │<─chunk(token2)───│
  │               │               │                │<─...─────────────│
  │               │               │                │<─final(done)─────│
  │               │<──────────────│<───result───────│                 │
  │               │──コスト計算──>│                │                 │
  │               │──stderr出力──>│                │                 │
  │<──result──────│                │                │                 │
```

### offload_work フォールバック系

```
Agent        MCPサーバー        FIFOキュー       OllamaClient       Ollama
  │               │                │                │                 │
  │──offload_work─>│                │                │                 │
  │               │──入力検証──────>│                │                 │
  │               │               │──enqueue───────>│                 │
  │               │               │<─dequeue────────│                 │
  │               │               │                │──/api/chat──────>│
  │               │               │                │  (タイムアウト)   │
  │               │               │                │──abort──────────>│
  │               │<──────────────│<─TimeoutError───│                 │
  │               │──stderr警告──>│                │                 │
  │<──FALLBACK────│                │                │                 │
  │  isError:true  │                │                │                 │
```
