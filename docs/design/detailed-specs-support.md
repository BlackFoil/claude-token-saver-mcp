# サポートモジュール詳細関数仕様書

**プロジェクト:** claude-token-saver-mcp (PulseAgent Token Saver)
**バージョン:** v1.0
**作成日:** 2026-02-15
**作成者:** Coder 2 / Logic Agent
**フェーズ:** Phase 3 -- 詳細設計

---

## 目次

1. [src/cost/calculator.ts -- コスト計算](#1-srccostcalculatorts----コスト計算)
2. [src/cost/pricing.ts -- 価格定義](#2-srccostpricingts----価格定義)
3. [src/cost/reporter.ts -- stderr出力](#3-srccostreporterts----stderr出力)
4. [src/config/index.ts -- 設定ローダー](#4-srcconfigindexts----設定ローダー)
5. [src/config/schema.ts -- 設定スキーマ](#5-srcconfigschemats----設定スキーマ)
6. [src/validators/input-validator.ts -- 入力バリデーション](#6-srcvalidatorsinput-validatorts----入力バリデーション)
7. [src/validators/prompt-guard.ts -- プロンプトインジェクション防御](#7-srcvalidatorsprompt-guardts----プロンプトインジェクション防御)
8. [src/errors.ts -- エラークラス実装](#8-srcerrorsts----エラークラス実装)

---

## エラーコード体系に関する注記

セキュリティ設計書（`security-design.md`）とデータフロー設計書（`data-flow-design.md`）の間でエラーコードの割り当てに差異が存在する。本仕様書ではデータフロー設計書のエラーコード体系（`CTS-XXXX`）を正とし、以下のカテゴリ区分に準拠する。

| カテゴリ | 範囲 | 説明 |
|:---|:---|:---|
| CTS-1xxx | 1001 - 1099 | Ollama接続エラー |
| CTS-2xxx | 2001 - 2099 | Ollamaタイムアウトエラー |
| CTS-3xxx | 3001 - 3099 | モデル関連エラー |
| CTS-4xxx | 4001 - 4099 | キュー・レートリミットエラー |
| CTS-5xxx | 5001 - 5099 | 入力バリデーションエラー |
| CTS-6xxx | 6001 - 6099 | 設定エラー |

**セキュリティ設計書との対応:**
- セキュリティ設計書の `CTS-3001`（PI検出）は `CTS-5001`（PromptInjectionError）に統合
- セキュリティ設計書の `CTS-3002`（入力サイズ超過）は `CTS-5002`（ContextOverflowError）に統合
- セキュリティ設計書の `CTS-4003`（レートリミット超過）は `CTS-4002`（RateLimitError）に統合
- セキュリティ設計書の `CTS-4004`（処理タイムアウト）は `CTS-2002`（GenerationTimeoutError）に統合

---

## 1. src/cost/calculator.ts -- コスト計算

### 1.1 モジュール概要

ローカルLLMで処理されたリクエストが、もしクラウドAPI（Claude）で処理されていた場合に発生していたであろうコストを「節約額」として計算する。インメモリでセッション内の累計を管理し、永続化用のスナップショットを提供する。

### 1.2 依存モジュール

| モジュール | 用途 |
|:---|:---|
| `./pricing.ts` | `PricingTable`, `ModelPricing` 型, `loadPricing()` |
| `../errors.ts` | `InvalidConfigError` |

### 1.3 型定義

```typescript
// Copyright 2026 PulseAgent Team
// SPDX-License-Identifier: Apache-2.0

import type { PricingTable } from './pricing.js';

/**
 * 単一リクエストのコスト計算結果
 */
export interface CostResult {
  /** 今回の節約額（USD） */
  readonly savingsUsd: number;
  /** セッション累計の節約額（USD） */
  readonly cumulativeSavingsUsd: number;
  /** 入力トークン数（Ollamaから取得した実測値） */
  readonly inputTokens: number;
  /** 出力トークン数（Ollamaから取得した実測値） */
  readonly outputTokens: number;
  /** 比較対象のクラウドモデル名 */
  readonly comparisonModel: string;
}

/**
 * 累計コスト情報（永続化・レポート用）
 */
export interface CumulativeCost {
  /** 累計節約額（USD） */
  readonly totalSavingsUsd: number;
  /** 累計リクエスト数 */
  readonly totalRequests: number;
  /** 累計入力トークン数 */
  readonly totalInputTokens: number;
  /** 累計出力トークン数 */
  readonly totalOutputTokens: number;
  /** ツール別内訳 */
  readonly byTool: {
    readonly offload_work: { readonly requests: number; readonly savings: number };
    readonly compress_context: { readonly requests: number; readonly savings: number };
  };
  /** 最終更新日時（ISO 8601） */
  readonly lastUpdated: string;
}

/**
 * コスト計算に必要なパラメータ
 */
export interface CalculateSavingsParams {
  /** 入力トークン数 */
  readonly inputTokens: number;
  /** 出力トークン数 */
  readonly outputTokens: number;
  /** 比較対象のクラウドモデル名（省略時はデフォルト比較モデル） */
  readonly model?: string;
  /** ツール名（累計内訳の管理用） */
  readonly tool: 'offload_work' | 'compress_context';
}
```

### 1.4 CostCalculator クラス

```typescript
export class CostCalculator {
  private readonly pricing: PricingTable;
  private readonly defaultComparisonModel: string;

  // 累計データ（インメモリ）
  private totalSavingsUsd: number;
  private totalRequests: number;
  private totalInputTokens: number;
  private totalOutputTokens: number;
  private byTool: {
    offload_work: { requests: number; savings: number };
    compress_context: { requests: number; savings: number };
  };

  constructor(pricing: PricingTable, defaultComparisonModel: string);
}
```

### 1.5 メソッド仕様

#### 1.5.1 constructor

```typescript
constructor(pricing: PricingTable, defaultComparisonModel: string)
```

| 項目 | 内容 |
|:---|:---|
| **目的** | CostCalculatorインスタンスを初期化する |
| **引数** | `pricing`: 価格テーブル。`loadPricing()` の戻り値を渡す |
|  | `defaultComparisonModel`: デフォルトの比較対象クラウドモデル名（例: `'claude-sonnet-4-5'`） |
| **エラー条件** | `defaultComparisonModel` が `pricing` テーブルに存在しない場合 -> `InvalidConfigError` (CTS-6001): `"比較対象モデル '...' の価格情報が見つかりません"` |
| **初期化値** | 全累計カウンターを `0` で初期化。`byTool` の各サブカウンターも `{ requests: 0, savings: 0 }` |
| **対応テストID** | C-01 |

#### 1.5.2 calculateSavings

```typescript
calculateSavings(params: CalculateSavingsParams): CostResult
```

| 項目 | 内容 |
|:---|:---|
| **目的** | 指定されたトークン数から節約額を計算し、累計に加算する |
| **引数** | `params.inputTokens`: 入力トークン数（0以上の整数） |
|  | `params.outputTokens`: 出力トークン数（0以上の整数） |
|  | `params.model`: 比較対象モデル名（省略時は `defaultComparisonModel`） |
|  | `params.tool`: ツール名 `'offload_work' \| 'compress_context'` |
| **戻り値** | `CostResult` -- 今回の節約額と累計情報を含む |
| **計算式** | `savingsUsd = (inputTokens / 1_000_000) * pricing[model].inputPer1MTokens + (outputTokens / 1_000_000) * pricing[model].outputPer1MTokens` |
| **副作用** | 内部累計カウンター（`totalSavingsUsd`, `totalRequests`, `totalInputTokens`, `totalOutputTokens`, `byTool`）を更新する |
| **エラー条件** | `params.inputTokens < 0` または `params.outputTokens < 0` -> `InvalidConfigError` (CTS-6001): `"トークン数は0以上である必要があります"` |
|  | `params.model` が `pricing` テーブルに存在しない場合 -> `InvalidConfigError` (CTS-6001): `"モデル '...' の価格情報が見つかりません"` |
| **注意点** | 浮動小数点演算のため、累計値には微小な丸め誤差が蓄積する。表示時にのみ `toFixed(4)` で丸める。内部的には `number` のまま保持する |
| **対応テストID** | C-02, C-03, C-04, C-05 |

#### 1.5.3 getCumulativeSavings

```typescript
getCumulativeSavings(): CumulativeCost
```

| 項目 | 内容 |
|:---|:---|
| **目的** | 現在の累計コスト情報のスナップショットを取得する |
| **引数** | なし |
| **戻り値** | `CumulativeCost` -- 全フィールドが `readonly` のイミュータブルなオブジェクト |
| **副作用** | なし（読み取り専用） |
| **注意点** | `lastUpdated` は呼び出し時点の `new Date().toISOString()` を返す。戻り値はディープコピーとし、呼び出し元での変更が内部状態に影響しない |
| **対応テストID** | C-06 |

#### 1.5.4 reset

```typescript
reset(): void
```

| 項目 | 内容 |
|:---|:---|
| **目的** | 全累計カウンターをゼロにリセットする |
| **引数** | なし |
| **戻り値** | なし |
| **副作用** | `totalSavingsUsd`, `totalRequests`, `totalInputTokens`, `totalOutputTokens`, `byTool` の全カウンターを初期値に戻す |
| **用途** | テスト時のクリーンアップ、またはユーザーが明示的にリセットを要求した場合 |
| **対応テストID** | C-07 |

#### 1.5.5 restoreFromHistory

```typescript
restoreFromHistory(history: CumulativeCost): void
```

| 項目 | 内容 |
|:---|:---|
| **目的** | 永続化されたコスト履歴からセッション開始時に累計を復元する |
| **引数** | `history`: `cost-history.json` から読み込んだ `CumulativeCost` データ |
| **戻り値** | なし |
| **副作用** | 内部累計カウンターを `history` の値で上書きする |
| **エラー条件** | `history.totalSavingsUsd < 0` -> `InvalidConfigError` (CTS-6001): `"不正なコスト履歴データです"` |
| **注意点** | サーバー起動シーケンス（`startup.ts`）から一度だけ呼び出される。起動後の二重呼び出しは禁止（ガード不要、呼び出し元の責務） |
| **対応テストID** | C-08 |

---

## 2. src/cost/pricing.ts -- 価格定義

### 2.1 モジュール概要

クラウドLLM APIの価格テーブルを管理する。ハードコードされたデフォルト値と、設定ファイルからの上書き読み込みの二層構造で構成される。

### 2.2 依存モジュール

| モジュール | 用途 |
|:---|:---|
| `../config/index.ts` | `AppConfig` 型（設定ファイルから渡される価格上書き情報） |

### 2.3 型定義

```typescript
// Copyright 2026 PulseAgent Team
// SPDX-License-Identifier: Apache-2.0

/**
 * モデル単位の価格情報
 */
export interface ModelPricing {
  /** 入力トークン100万あたりの価格（USD） */
  readonly inputPer1MTokens: number;
  /** 出力トークン100万あたりの価格（USD） */
  readonly outputPer1MTokens: number;
}

/**
 * 価格テーブル（モデル名 -> 価格情報のマップ）
 */
export type PricingTable = Readonly<Record<string, ModelPricing>>;
```

### 2.4 定数定義

#### 2.4.1 DEFAULT_PRICING

```typescript
export const DEFAULT_PRICING: PricingTable = {
  'claude-sonnet-4-5': {
    inputPer1MTokens: 3.00,
    outputPer1MTokens: 15.00,
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
```

| 項目 | 内容 |
|:---|:---|
| **目的** | Anthropic CloudAPI価格のデフォルト値を定義する（2026年2月時点） |
| **不変性** | `as const` + `Readonly<Record>` で実行時改竄を防止 |
| **更新基準** | Anthropicが公式に価格変更を発表した場合にコード変更でリリースする。APIからの動的取得は行わない（公開APIが存在しないため） |
| **対応テストID** | P-01 |

#### 2.4.2 DEFAULT_COMPARISON_MODEL

```typescript
export const DEFAULT_COMPARISON_MODEL = 'claude-sonnet-4-5' as const;
```

| 項目 | 内容 |
|:---|:---|
| **目的** | 節約額計算のデフォルト比較対象モデルを指定する |
| **選定理由** | Claude Code Agent Teamsで最も一般的に使用されるモデルであるため |
| **対応テストID** | P-02 |

### 2.5 関数仕様

#### 2.5.1 loadPricing

```typescript
export function loadPricing(
  configPricing?: Record<string, { inputPer1MTokens: number; outputPer1MTokens: number }>,
): PricingTable
```

| 項目 | 内容 |
|:---|:---|
| **目的** | デフォルト価格テーブルに設定ファイルの上書き値をマージして返す |
| **引数** | `configPricing`: 設定ファイルの `cost.pricing` セクションから渡される上書き価格。省略時はデフォルト値のみ返す |
| **戻り値** | `PricingTable` -- マージ済みの価格テーブル |
| **マージルール** | 1. `DEFAULT_PRICING` をベースとする |
|  | 2. `configPricing` に存在するモデルはデフォルトを上書きする |
|  | 3. `configPricing` にのみ存在するモデルは追加される |
|  | 4. `DEFAULT_PRICING` にのみ存在するモデルは保持される |
| **バリデーション** | 各価格値に対して以下を検証する: |
|  | - `inputPer1MTokens > 0` かつ `outputPer1MTokens > 0`（0以下は除外しWARNログ出力） |
|  | - `inputPer1MTokens <= 1000` かつ `outputPer1MTokens <= 1000`（$1000/1M超は異常値として除外しWARNログ出力） |
| **エラー条件** | バリデーション失敗した個別エントリはスキップされるがエラーにはならない。全エントリが不正でもデフォルト値を返す |
| **注意点** | セキュリティ設計書 6.2.2 の価格データ妥当性検証に準拠。前回値との差分検証（300%閾値）はMVPでは対象外（永続化導入後に実装） |
| **対応テストID** | P-03, P-04, P-05, P-06 |

---

## 3. src/cost/reporter.ts -- stderr出力

### 3.1 モジュール概要

コスト計算結果をstderrに人間が読みやすい形式で出力する。MCPサーバーはstdioトランスポートを使用するため、stdoutはMCPプロトコル通信専用であり、ログやメトリクスはstderrに出力しなければならない。

### 3.2 依存モジュール

| モジュール | 用途 |
|:---|:---|
| `./calculator.ts` | `CostResult` 型 |

### 3.3 関数仕様

#### 3.3.1 reportCost

```typescript
export function reportCost(result: CostResult, toolName: string): void
```

| 項目 | 内容 |
|:---|:---|
| **目的** | コスト計算結果をstderrに出力する。Claude Code Agent TeamsのUIにコスト情報を表示するためのもの |
| **引数** | `result`: `CostResult` -- `calculateSavings()` の戻り値 |
|  | `toolName`: `string` -- 呼び出し元ツール名（`'offload_work'` or `'compress_context'`） |
| **戻り値** | なし |
| **出力先** | `process.stderr.write()` |
| **出力フォーマット** | `[CTS Cost] {toolName} \| 今回: ${savingsUsd} \| 累計: ${cumulativeSavingsUsd} \| tokens: {inputTokens}->{outputTokens}\n` |
| **出力例** | `[CTS Cost] offload_work \| 今回: $0.0234 \| 累計: $1.4567 \| tokens: 1200->450` |
| **数値フォーマット** | 金額は小数点以下4桁（`toFixed(4)`）、トークン数は整数 |
| **エラー条件** | なし。`process.stderr.write()` の失敗は無視する（I/Oエラーでサーバーを停止させない） |
| **注意点** | データフロー設計書 5.5 のフォーマットに準拠。pinoの構造化ログとは別に出力される |
| **対応テストID** | R-01, R-02 |

#### 3.3.2 formatCostLine（内部関数）

```typescript
function formatCostLine(result: CostResult, toolName: string): string
```

| 項目 | 内容 |
|:---|:---|
| **目的** | コスト出力行を組み立てる。テスト容易性のために `reportCost` から分離 |
| **引数** | `reportCost` と同一 |
| **戻り値** | フォーマット済みの1行文字列（改行なし） |
| **可視性** | モジュール内部（`export` しない）。テスト時は `reportCost` 経由で間接テスト、またはモジュール内テスト用に `@internal` として公開を検討 |
| **対応テストID** | R-03 |

---

## 4. src/config/index.ts -- 設定ローダー

### 4.1 モジュール概要

環境変数、設定ファイル（JSON）、デフォルト値の3層から設定を統合的にロードする。優先順位は **環境変数 > 設定ファイル > デフォルト値** である。

### 4.2 依存モジュール

| モジュール | 用途 |
|:---|:---|
| `node:fs` | 設定ファイルの読み込み（`readFileSync`） |
| `node:path` | パス結合 |
| `node:os` | ホームディレクトリ取得（`os.homedir()`） |
| `./schema.ts` | `appConfigSchema`（Zodスキーマ）、`AppConfig` 型 |
| `../errors.ts` | `InvalidConfigError` |

### 4.3 定数定義

```typescript
/** 設定ディレクトリのベースパス */
const CONFIG_DIR = path.join(os.homedir(), '.config', 'claude-token-saver');

/** 設定ファイルのフルパス */
export const CONFIG_FILE_PATH = path.join(CONFIG_DIR, 'config.json');

/** コスト履歴ファイルのフルパス */
export const COST_HISTORY_FILE_PATH = path.join(CONFIG_DIR, 'cost-history.json');
```

### 4.4 型定義

```typescript
// Copyright 2026 PulseAgent Team
// SPDX-License-Identifier: Apache-2.0

/**
 * アプリケーション全体の設定
 */
export interface AppConfig {
  /** Ollama接続設定 */
  readonly ollama: {
    readonly baseUrl: string;
  };

  /** ティアリング設定の上書き（null = 自動検出） */
  readonly tier: {
    readonly forceLevel?: 1 | 2 | 3;
    readonly primaryModel?: string;
    readonly fallbackModel?: string | null;
    readonly contextLimit?: number;
  } | null;

  /** タイムアウト設定の上書き（ms単位） */
  readonly timeout: {
    readonly requestTimeout?: number;
    readonly heartbeatTimeout?: number;
    readonly firstTokenTimeout?: number;
    readonly queueTimeout?: number;
  } | null;

  /** FIFOキュー設定 */
  readonly queue: {
    readonly maxQueueLength: number;
    readonly maxRequestSizeBytes: number;
    readonly queueTimeoutMs: number;
    readonly rateLimitPerMinute?: number;
  };

  /** コスト計算設定 */
  readonly cost: {
    readonly comparisonModel: string;
    readonly pricing?: Record<string, {
      readonly inputPer1MTokens: number;
      readonly outputPer1MTokens: number;
    }>;
  };

  /** セキュリティ設定 */
  readonly security: {
    readonly enableInputSanitization: boolean;
  };

  /** ログレベル */
  readonly logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';
}
```

### 4.5 関数仕様

#### 4.5.1 loadConfig

```typescript
export function loadConfig(configFilePath?: string): AppConfig
```

| 項目 | 内容 |
|:---|:---|
| **目的** | 環境変数、設定ファイル、デフォルト値を統合して `AppConfig` を返す |
| **引数** | `configFilePath`: 設定ファイルのパス。省略時は `CONFIG_FILE_PATH` を使用 |
| **戻り値** | `AppConfig` -- バリデーション済みの設定オブジェクト |
| **処理フロー** | 1. デフォルト値でベースの `AppConfig` を構築 |
|  | 2. 設定ファイルが存在する場合、JSONとして読み込み・パースする |
|  | 3. 設定ファイルの値をデフォルト値に深いマージ（deep merge）する |
|  | 4. 環境変数が存在する場合、対応するフィールドを上書きする |
|  | 5. 最終結果を `appConfigSchema`（Zod）で検証する |
|  | 6. バリデーション成功なら返す。失敗なら `InvalidConfigError` |
| **環境変数マッピング** | 下表参照 |
| **エラー条件** | 設定ファイルのJSONパース失敗 -> WARNログを出力しデフォルト値で続行（エラーにしない） |
|  | Zodバリデーション失敗 -> `InvalidConfigError` (CTS-6001): Zodエラーメッセージを含む |
| **注意点** | 設定ファイルが存在しない場合はエラーではなく、デフォルト値のみで動作する。これは設計書の「必須: いいえ」要件に準拠 |
| **対応テストID** | CF-01, CF-02, CF-03, CF-04, CF-05 |

**環境変数マッピング:**

| 環境変数 | 対応フィールド | 型変換 |
|:---|:---|:---|
| `OLLAMA_BASE_URL` | `ollama.baseUrl` | string |
| `TIER_OVERRIDE` | `tier.forceLevel` | `parseInt` -> 1\|2\|3 |
| `MODEL_OVERRIDE` | `tier.primaryModel` | string |
| `QUEUE_MAX_SIZE` | `queue.maxQueueLength` | `parseInt` |
| `QUEUE_TIMEOUT_MS` | `queue.queueTimeoutMs` | `parseInt` |
| `OLLAMA_TIMEOUT_MS` | `timeout.requestTimeout` | `parseInt` |
| `CLOUD_INPUT_PRICE_PER_MTOKEN` | `cost.pricing['claude-sonnet-4-5'].inputPer1MTokens` | `parseFloat` |
| `CLOUD_OUTPUT_PRICE_PER_MTOKEN` | `cost.pricing['claude-sonnet-4-5'].outputPer1MTokens` | `parseFloat` |
| `LOG_LEVEL` | `logLevel` | string |
| `NODE_ENV` | （直接マッピングなし。ログフォーマット切替に使用） | string |

#### 4.5.2 loadCostHistory

```typescript
export function loadCostHistory(configDir?: string): CumulativeCost | null
```

| 項目 | 内容 |
|:---|:---|
| **目的** | コスト履歴ファイルを読み込み、累計節約データを復元する |
| **引数** | `configDir`: 設定ディレクトリパス。省略時は `CONFIG_DIR` を使用 |
| **戻り値** | `CumulativeCost` -- 履歴データ。ファイルが存在しない、またはパース失敗時は `null` |
| **ファイルパス** | `{configDir}/cost-history.json` |
| **エラー条件** | ファイルが存在しない -> `null`（正常ケース、初回起動時） |
|  | JSONパース失敗 -> WARNログを出力し `null` を返す |
|  | データ構造が不正 -> WARNログを出力し `null` を返す |
| **注意点** | 読み込み失敗時にサーバー起動をブロックしない。累計は0から再開される |
| **対応テストID** | CF-06, CF-07 |

#### 4.5.3 saveCostHistory

```typescript
export function saveCostHistory(
  history: CumulativeCost,
  configDir?: string,
): void
```

| 項目 | 内容 |
|:---|:---|
| **目的** | 累計コスト情報をファイルに永続化する |
| **引数** | `history`: 保存するコスト履歴データ |
|  | `configDir`: 設定ディレクトリパス。省略時は `CONFIG_DIR` |
| **戻り値** | なし |
| **ファイルパス** | `{configDir}/cost-history.json` |
| **ディレクトリ作成** | 設定ディレクトリが存在しない場合は `mkdirSync(configDir, { recursive: true })` で作成する |
| **書き込み方式** | アトミック書き込み: 一時ファイルに書き込み後 `renameSync` で置換。書き込み途中のクラッシュによるデータ破損を防止 |
| **エラー条件** | 書き込み失敗 -> WARNログを出力（サーバー停止はしない） |
| **呼び出しタイミング** | サーバーシャットダウン時（SIGTERM受信時）、および一定リクエスト数（10件）ごとのバッチ保存 |
| **対応テストID** | CF-08, CF-09 |

---

## 5. src/config/schema.ts -- 設定スキーマ

### 5.1 モジュール概要

設定ファイルおよびマージ後の `AppConfig` オブジェクトに対するZodバリデーションスキーマを定義する。

### 5.2 依存モジュール

| モジュール | 用途 |
|:---|:---|
| `zod` | スキーマ定義・バリデーション |

### 5.3 スキーマ定義

```typescript
// Copyright 2026 PulseAgent Team
// SPDX-License-Identifier: Apache-2.0

import { z } from 'zod';

/**
 * 価格エントリのスキーマ
 */
const modelPricingSchema = z.object({
  inputPer1MTokens: z.number().positive().max(1000),
  outputPer1MTokens: z.number().positive().max(1000),
});

/**
 * Ollama設定スキーマ
 */
const ollamaConfigSchema = z.object({
  baseUrl: z.string().url().default('http://127.0.0.1:11434'),
});

/**
 * ティアリング上書きスキーマ
 */
const tierOverrideSchema = z.object({
  forceLevel: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
  primaryModel: z.string().min(1).optional(),
  fallbackModel: z.union([z.string().min(1), z.null()]).optional(),
  contextLimit: z.number().int().min(1000).max(128000).optional(),
}).nullable().default(null);

/**
 * タイムアウト上書きスキーマ
 */
const timeoutOverrideSchema = z.object({
  requestTimeout: z.number().int().min(10_000).optional(),
  heartbeatTimeout: z.number().int().min(5_000).optional(),
  firstTokenTimeout: z.number().int().min(10_000).optional(),
  queueTimeout: z.number().int().min(5_000).optional(),
}).nullable().default(null);

/**
 * キュー設定スキーマ
 */
const queueConfigSchema = z.object({
  maxQueueLength: z.number().int().min(1).max(100).default(10),
  maxRequestSizeBytes: z.number().int().min(1024).default(200 * 1024),
  queueTimeoutMs: z.number().int().min(5_000).default(60_000),
  rateLimitPerMinute: z.number().int().min(1).optional(),
});

/**
 * コスト設定スキーマ
 */
const costConfigSchema = z.object({
  comparisonModel: z.string().min(1).default('claude-sonnet-4-5'),
  pricing: z.record(z.string(), modelPricingSchema).optional(),
});

/**
 * セキュリティ設定スキーマ
 */
const securityConfigSchema = z.object({
  enableInputSanitization: z.boolean().default(true),
});

/**
 * ログレベルスキーマ
 */
const logLevelSchema = z.enum([
  'fatal', 'error', 'warn', 'info', 'debug', 'trace',
]).default('info');

/**
 * アプリケーション設定の統合スキーマ
 */
export const appConfigSchema = z.object({
  ollama: ollamaConfigSchema.default({}),
  tier: tierOverrideSchema,
  timeout: timeoutOverrideSchema,
  queue: queueConfigSchema.default({}),
  cost: costConfigSchema.default({}),
  security: securityConfigSchema.default({}),
  logLevel: logLevelSchema,
});

/**
 * Zodスキーマから推論される型
 * loadConfig() の戻り値はこの型と一致する
 */
export type AppConfigInput = z.input<typeof appConfigSchema>;
export type AppConfig = z.output<typeof appConfigSchema>;
```

### 5.4 デフォルト値一覧

| フィールド | デフォルト値 | 設計根拠 |
|:---|:---|:---|
| `ollama.baseUrl` | `'http://127.0.0.1:11434'` | Ollamaの標準ポート |
| `tier` | `null`（自動検出） | RAM量に基づく自動Tier判定 |
| `timeout` | `null`（Tier別デフォルト） | Tier定義の `TimeoutConfig` を使用 |
| `queue.maxQueueLength` | `10` | 5エージェント x 2バッファ |
| `queue.maxRequestSizeBytes` | `204800`（200KB） | task + context合計の上限 |
| `queue.queueTimeoutMs` | `60000`（60秒） | キュー待機の上限 |
| `cost.comparisonModel` | `'claude-sonnet-4-5'` | 最も一般的な比較対象 |
| `security.enableInputSanitization` | `true` | PI防御デフォルト有効 |
| `logLevel` | `'info'` | 標準ログレベル |

### 5.5 バリデーションルール詳細

| フィールド | 制約 | 理由 |
|:---|:---|:---|
| `ollama.baseUrl` | URL形式 | 不正なURLでHTTPクライアントがクラッシュすることを防止 |
| `tier.forceLevel` | `1 \| 2 \| 3` | 定義されたTier以外の値を拒否 |
| `tier.contextLimit` | `1000 <= x <= 128000` | 極端な値によるOOM防止 |
| `timeout.requestTimeout` | `>= 10000` | 10秒未満のタイムアウトは実用的でない |
| `timeout.heartbeatTimeout` | `>= 5000` | 5秒未満はモデルロード中の誤検出を招く |
| `queue.maxQueueLength` | `1 <= x <= 100` | 100超はメモリ圧迫リスク |
| `queue.maxRequestSizeBytes` | `>= 1024` | 1KB未満は実用的でない |
| `modelPricing.inputPer1MTokens` | `0 < x <= 1000` | 0以下は不正、$1000超は異常値 |

**対応テストID:** CS-01, CS-02, CS-03, CS-04, CS-05

---

## 6. src/validators/input-validator.ts -- 入力バリデーション

### 6.1 モジュール概要

MCPツール（`offload_work`, `compress_context`）への入力に対し、サイズ上限チェック、必須フィールドチェック、型チェックを行う。プロンプトインジェクション検出は `prompt-guard.ts` に委譲する。

### 6.2 依存モジュール

| モジュール | 用途 |
|:---|:---|
| `../errors.ts` | `InputValidationError`, `ContextOverflowError` |
| `../tiering/types.ts` | `TierConfig` 型（コンテキスト上限参照） |

### 6.3 型定義

```typescript
// Copyright 2026 PulseAgent Team
// SPDX-License-Identifier: Apache-2.0

import type { OffloadWorkInput, CompressContextInput } from '../tools/types.js';

/**
 * バリデーション成功時の戻り値
 * 元の入力に加え、バイト数やトークン推定値を付与する
 */
export interface ValidatedOffloadWorkInput {
  /** バリデーション済みの入力データ */
  readonly input: Readonly<Required<Pick<OffloadWorkInput, 'task'>> & Partial<Omit<OffloadWorkInput, 'task'>>>;
  /** 入力全体のバイト数 */
  readonly totalBytes: number;
  /** 推定トークン数 */
  readonly estimatedTokens: number;
}

export interface ValidatedCompressContextInput {
  /** バリデーション済みの入力データ */
  readonly input: Readonly<Required<Pick<CompressContextInput, 'content'>> & Partial<Omit<CompressContextInput, 'content'>>>;
  /** 入力全体のバイト数 */
  readonly totalBytes: number;
  /** 推定トークン数 */
  readonly estimatedTokens: number;
  /** コンテキスト上限で切り詰めが必要か */
  readonly requiresTruncation: boolean;
}
```

### 6.4 関数仕様

#### 6.4.1 validateOffloadWorkInput

```typescript
export function validateOffloadWorkInput(
  input: unknown,
  maxRequestSizeBytes: number,
): ValidatedOffloadWorkInput
```

| 項目 | 内容 |
|:---|:---|
| **目的** | `offload_work` ツールの入力を検証し、型安全な `ValidatedOffloadWorkInput` を返す |
| **引数** | `input`: MCPリクエストから受け取った未検証の入力オブジェクト |
|  | `maxRequestSizeBytes`: リクエストサイズ上限（バイト数）。`AppConfig.queue.maxRequestSizeBytes` から取得 |
| **戻り値** | `ValidatedOffloadWorkInput` |
| **検証項目** | 1. `input` が `object` であり `null` でないこと |
|  | 2. `input.task` が `string` であり空文字でないこと |
|  | 3. `input.task` の長さが `maxLength: 50000` 以内であること |
|  | 4. `input.context` が存在する場合、`string` かつ `maxLength: 100000` 以内 |
|  | 5. `input.language` が存在する場合、`SupportedLanguage` 型の列挙値であること |
|  | 6. `input.output_format` が存在する場合、`'code' \| 'diff' \| 'explanation' \| 'raw'` であること |
|  | 7. `task` + `context` の合計バイト数が `maxRequestSizeBytes` 以内であること |
| **エラー条件** | 検証1-6失敗 -> `InputValidationError` (CTS-5002): 具体的なフィールド名と原因を含むメッセージ |
|  | 検証7失敗 -> `ContextOverflowError` (CTS-5002): `"リクエストサイズ ({bytes}B) が上限 ({max}B) を超えています"` |
| **トークン推定** | `estimatedTokens = Math.ceil(totalBytes / 3)` -- 保守的推定（多言語対応、セキュリティ設計書 5.2 準拠） |
| **対応テストID** | V-01, V-02, V-03, V-04, V-05 |

#### 6.4.2 validateCompressContextInput

```typescript
export function validateCompressContextInput(
  input: unknown,
  maxRequestSizeBytes: number,
  contextLimitTokens: number,
): ValidatedCompressContextInput
```

| 項目 | 内容 |
|:---|:---|
| **目的** | `compress_context` ツールの入力を検証する |
| **引数** | `input`: 未検証の入力オブジェクト |
|  | `maxRequestSizeBytes`: リクエストサイズ上限 |
|  | `contextLimitTokens`: 現在のTierのコンテキストトークン上限（`TierConfig.contextLimit`） |
| **戻り値** | `ValidatedCompressContextInput` |
| **検証項目** | 1. `input` が `object` であり `null` でないこと |
|  | 2. `input.content` が `string` であり空文字でないこと |
|  | 3. `input.content` の長さが `maxLength: 200000` 以内であること |
|  | 4. `input.focus` が存在する場合、`string` かつ `maxLength: 500` 以内 |
|  | 5. `input.max_length` が存在する場合、`100 <= x <= 10000` の整数 |
|  | 6. `content` のバイト数が `maxRequestSizeBytes` 以内であること |
| **切り詰め判定** | `requiresTruncation = estimatedTokens > contextLimitTokens` |
| **エラー条件** | 検証1-5失敗 -> `InputValidationError` (CTS-5002) |
|  | 検証6失敗 -> `ContextOverflowError` (CTS-5002) |
| **注意点** | `requiresTruncation = true` の場合でもバリデーション自体は成功する。切り詰め処理はツールハンドラ側の責務。MCPサーバー設計書 1.2「コンテキスト上限超過時の処理」に準拠 |
| **対応テストID** | V-06, V-07, V-08, V-09, V-10 |

#### 6.4.3 estimateTokenCount（内部ヘルパー）

```typescript
function estimateTokenCount(text: string): number
```

| 項目 | 内容 |
|:---|:---|
| **目的** | テキストのトークン数を簡易推定する |
| **引数** | `text`: 推定対象テキスト |
| **戻り値** | 推定トークン数（正の整数） |
| **算出式** | `Math.ceil(text.length / 3)` |
| **選定理由** | 英語は約4文字/token、日本語は約2文字/token。多言語対応のため保守的に3文字/tokenで推定。tiktokenライブラリの依存を避けつつ安全マージンを確保 |
| **可視性** | モジュール内部（`export` しない） |
| **対応テストID** | V-11 |

---

## 7. src/validators/prompt-guard.ts -- プロンプトインジェクション防御

### 7.1 モジュール概要

MCPツールへの入力テキストに対するプロンプトインジェクション（PI）検出と、LLM出力に対する機密情報サニタイズを提供する。セキュリティ設計書 2.2（L1: 入力バリデーション）および 7.2（出力サニタイズ）に準拠する。

### 7.2 依存モジュール

| モジュール | 用途 |
|:---|:---|
| `../errors.ts` | `PromptInjectionError` |
| `pino` | 構造化ログ出力 |

### 7.3 型定義

```typescript
// Copyright 2026 PulseAgent Team
// SPDX-License-Identifier: Apache-2.0

/**
 * PI検出パターン定義
 */
interface InjectionPattern {
  /** 検出用正規表現 */
  readonly pattern: RegExp;
  /** 攻撃カテゴリ */
  readonly category: string;
  /** 検出時のアクション: 'block' = リクエスト拒否、'warn' = ログのみ */
  readonly severity: 'block' | 'warn';
}

/**
 * PI検出結果
 */
export interface InjectionResult {
  /** ブロック対象の脅威が含まれていたらtrue */
  readonly blocked: boolean;
  /** 検出された脅威の一覧 */
  readonly threats: ReadonlyArray<{
    readonly category: string;
    readonly severity: 'block' | 'warn';
    readonly matched: string;
  }>;
}

/**
 * 出力サニタイズ結果
 */
export interface SanitizeResult {
  /** サニタイズ後のテキスト */
  readonly sanitized: string;
  /** 検出された機密情報のカテゴリ一覧 */
  readonly detectedCategories: readonly string[];
  /** マスキング件数 */
  readonly redactionCount: number;
}
```

### 7.4 定数定義

#### 7.4.1 INJECTION_PATTERNS

```typescript
export const INJECTION_PATTERNS: readonly InjectionPattern[] = [
  // --- 直接インジェクション: システム命令の偽装 ---
  { pattern: /\bignore\s+(all\s+)?(previous|prior|above)\s+(instructions?|prompts?|rules?|commands?)/i,
    category: 'direct-override', severity: 'block' },
  { pattern: /\boverride\s+(system|previous|all)\s*(prompt|instruction|rule|command)?s?/i,
    category: 'direct-override', severity: 'block' },
  { pattern: /\bdisregard\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions?|prompts?)/i,
    category: 'direct-override', severity: 'block' },
  { pattern: /\bforget\s+(all\s+)?(previous|prior|your)\s+(instructions?|rules?|context)/i,
    category: 'direct-override', severity: 'block' },

  // --- ロール偽装: システムプロンプト境界の突破 ---
  { pattern: /\bsystem\s*:/i, category: 'role-injection', severity: 'block' },
  { pattern: /\[SYSTEM\]/i, category: 'role-injection', severity: 'block' },
  { pattern: /<<\s*SYS\s*>>/i, category: 'role-injection', severity: 'block' },
  { pattern: /###\s*Instruction\s*:/i, category: 'role-injection', severity: 'block' },
  { pattern: /\[INST\]/i, category: 'role-injection', severity: 'block' },
  { pattern: /<\|im_start\|>\s*system/i, category: 'role-injection', severity: 'block' },
  { pattern: /<\|system\|>/i, category: 'role-injection', severity: 'block' },
  { pattern: /\bBEGIN\s+SYSTEM\s+PROMPT\b/i, category: 'role-injection', severity: 'block' },
  { pattern: /\bEND\s+SYSTEM\s+PROMPT\b/i, category: 'role-injection', severity: 'block' },

  // --- プロンプトリーク誘発 ---
  { pattern: /\b(show|print|display|reveal|output|repeat|echo)\s+(me\s+)?(your|the|system)\s*(prompt|instruction|rule|config)/i,
    category: 'prompt-leak', severity: 'block' },
  { pattern: /\bwhat\s+(are|is)\s+your\s+(system\s+)?(prompt|instruction|rule)/i,
    category: 'prompt-leak', severity: 'block' },

  // --- エンコーディング回避 ---
  { pattern: /\\x[0-9a-fA-F]{2}/g, category: 'encoding-evasion', severity: 'warn' },
  { pattern: /\\u[0-9a-fA-F]{4}/g, category: 'encoding-evasion', severity: 'warn' },
  { pattern: /&#x?[0-9a-fA-F]+;/g, category: 'encoding-evasion', severity: 'warn' },

  // --- ロール切り替え試行 ---
  { pattern: /\b(you\s+are\s+now|act\s+as|pretend\s+(to\s+be|you\s+are)|from\s+now\s+on\s+you\s+are)\b/i,
    category: 'role-switch', severity: 'block' },
  { pattern: /\bnew\s+(persona|identity|role|character)\s*:/i,
    category: 'role-switch', severity: 'block' },
] as const;
```

| 項目 | 内容 |
|:---|:---|
| **パターン数** | 20パターン（block: 17, warn: 3） |
| **分類** | `direct-override`(4), `role-injection`(9), `prompt-leak`(2), `encoding-evasion`(3), `role-switch`(2) |
| **注意点** | 正規表現の `g` フラグ付きパターンは `exec()` 使用前に `lastIndex = 0` のリセットが必要 |
| **対応テストID** | PI-01, PI-02, PI-03, PI-04, PI-05 |

#### 7.4.2 SENSITIVE_PATTERNS（出力サニタイズ用）

```typescript
const SENSITIVE_PATTERNS: readonly {
  pattern: RegExp;
  category: string;
  replacement: string;
}[] = [
  // Anthropic APIキー
  { pattern: /\b(sk-[a-zA-Z0-9]{20,})\b/g,
    category: 'api-key-anthropic', replacement: '[REDACTED:API_KEY]' },
  // OpenAI APIキー
  { pattern: /\b(sk-proj-[a-zA-Z0-9_-]{20,})\b/g,
    category: 'api-key-openai', replacement: '[REDACTED:API_KEY]' },
  // GitHub PAT
  { pattern: /\b(ghp_[a-zA-Z0-9]{36,})\b/g,
    category: 'github-pat', replacement: '[REDACTED:GITHUB_TOKEN]' },
  // GitHub OAuth
  { pattern: /\b(gho_[a-zA-Z0-9]{36,})\b/g,
    category: 'github-oauth', replacement: '[REDACTED:GITHUB_TOKEN]' },
  // npm token
  { pattern: /\b(npm_[a-zA-Z0-9]{36,})\b/g,
    category: 'npm-token', replacement: '[REDACTED:NPM_TOKEN]' },
  // AWS Access Key
  { pattern: /\b(AKIA[0-9A-Z]{16})\b/g,
    category: 'aws-access-key', replacement: '[REDACTED:AWS_KEY]' },
  // パスワード
  { pattern: /(?:password|passwd|pwd)\s*[:=]\s*["']?([^\s"']{8,})["']?/gi,
    category: 'password', replacement: 'password=[REDACTED:PASSWORD]' },
  // 秘密鍵
  { pattern: /-----BEGIN\s+(RSA\s+)?PRIVATE\s+KEY-----[\s\S]*?-----END\s+(RSA\s+)?PRIVATE\s+KEY-----/g,
    category: 'private-key', replacement: '[REDACTED:PRIVATE_KEY]' },
  // 接続文字列
  { pattern: /(?:mongodb|postgres|mysql|redis):\/\/[^\s"']+/gi,
    category: 'connection-string', replacement: '[REDACTED:CONNECTION_STRING]' },
  // JWT
  { pattern: /\beyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\b/g,
    category: 'jwt', replacement: '[REDACTED:JWT]' },
  // ファイルパス（ホームディレクトリ漏洩防止）
  { pattern: /(?:\/Users\/|\/home\/|C:\\Users\\)[^\s"']+/g,
    category: 'file-path', replacement: '[REDACTED:FILE_PATH]' },
];
```

| 項目 | 内容 |
|:---|:---|
| **パターン数** | 11パターン |
| **可視性** | モジュール内部。テストは `sanitizeOutput()` 経由で間接検証 |
| **対応テストID** | SO-01 ~ SO-11 |

### 7.5 関数仕様

#### 7.5.1 detectPromptInjection

```typescript
export function detectPromptInjection(text: string): InjectionResult
```

| 項目 | 内容 |
|:---|:---|
| **目的** | 入力テキストに対してプロンプトインジェクションパターンを検出する |
| **引数** | `text`: 検査対象テキスト。`offload_work` の `task` + `context` 結合文字列、または `compress_context` の `content` |
| **戻り値** | `InjectionResult` -- `blocked: true` の場合、呼び出し元はリクエストを拒否すべき |
| **処理フロー** | 1. `INJECTION_PATTERNS` の各パターンに対して `text` をマッチング |
|  | 2. `g` フラグ付きパターンは `lastIndex = 0` にリセットしてから `exec()` |
|  | 3. マッチした脅威を `threats` 配列に追加 |
|  | 4. `severity === 'block'` の脅威が1つ以上あれば `blocked = true` |
| **ログ出力** | `threats.length > 0` の場合: `logger.warn({ threats, inputPreview: text.slice(0, 200) }, 'PI patterns detected')` |
|  | `blocked === true` の場合: `logger.error({ blockedCategories }, 'PI blocked')` |
| **エラー条件** | この関数自体はエラーを投げない。`blocked` フラグを返すのみ。呼び出し元が `PromptInjectionError` を投げる |
| **パフォーマンス** | 20パターンの正規表現マッチング。200KB入力で約1ms以下を想定（ベンチマークで検証が必要） |
| **注意点** | `g` フラグ付きの正規表現は内部状態（`lastIndex`）を持つため、各呼び出し前にリセットが必須。セキュリティ設計書 2.2.1 のパターン定義に完全準拠 |
| **対応テストID** | PI-06, PI-07, PI-08, PI-09, PI-10, PI-11 |

#### 7.5.2 sanitizeOutput

```typescript
export function sanitizeOutput(text: string): SanitizeResult
```

| 項目 | 内容 |
|:---|:---|
| **目的** | LLM出力テキストから機密情報パターンを検出し、マスキング文字列に置換する |
| **引数** | `text`: Ollamaからの生出力テキスト |
| **戻り値** | `SanitizeResult` -- `sanitized` フィールドがマスキング済みテキスト |
| **処理フロー** | 1. `SENSITIVE_PATTERNS` の各パターンに対して `text` をマッチング |
|  | 2. `g` フラグ付きパターンは `lastIndex = 0` にリセット |
|  | 3. マッチ箇所を対応する `replacement` 文字列に置換 |
|  | 4. 置換回数と検出カテゴリを記録 |
| **ログ出力** | `redactionCount > 0` の場合: `logger.warn({ detectedCategories, redactionCount }, 'Sensitive info redacted from LLM output')` |
| **エラー条件** | なし。空文字列入力に対しては `{ sanitized: '', detectedCategories: [], redactionCount: 0 }` を返す |
| **適用箇所** | 全LLM出力は `sanitizeOutput()` を経由してからMCPレスポンスに含まれる。ツールハンドラ（`offload-work.ts`, `compress-context.ts`）内でOllama応答受信後に呼び出す |
| **注意点** | 正規表現の順序が重要。先に長いパターン（秘密鍵）を処理してから短いパターン（APIキー）を処理する。`SENSITIVE_PATTERNS` は意図的にこの順序で定義されている |
| **対応テストID** | SO-01, SO-02, SO-03, SO-04, SO-05, SO-06, SO-07, SO-08, SO-09, SO-10, SO-11, SO-12 |

---

## 8. src/errors.ts -- エラークラス実装

### 8.1 モジュール概要

プロジェクト全体で使用するカスタムエラークラス階層を定義する。全エラーは `CTSError` 基底クラスを継承し、エラーコード（`CTS-XXXX`）、リトライ可否、クラウドフォールバック推奨の属性を持つ。

### 8.2 依存モジュール

なし（他モジュールへの依存を持たない独立モジュール）。

### 8.3 型定義

```typescript
// Copyright 2026 PulseAgent Team
// SPDX-License-Identifier: Apache-2.0

/**
 * エラーコードの型定義
 */
export type CTSErrorCode =
  | 'CTS-1001' | 'CTS-1002'  // OllamaConnection
  | 'CTS-2001' | 'CTS-2002'  // OllamaTimeout
  | 'CTS-3001'                // ModelNotFound
  | 'CTS-4001' | 'CTS-4002'  // Queue / RateLimit
  | 'CTS-5001' | 'CTS-5002'  // InputValidation
  | 'CTS-6001';               // Config

/**
 * MCPエラーレスポンスに変換する際のインターフェース
 */
export interface MCPErrorResponse {
  readonly code: CTSErrorCode;
  readonly message: string;
  readonly retryable: boolean;
}
```

### 8.4 CTSError 基底クラス

```typescript
export class CTSError extends Error {
  /** CTS-XXXX形式のエラーコード */
  readonly code: CTSErrorCode;
  /** HTTP相当のステータスコード（分類参考値） */
  readonly httpStatus: number;
  /** リトライ可能か（一時的障害か恒久的問題か） */
  readonly retryable: boolean;
  /** クラウドAPIへのフォールバックを推奨するか */
  readonly fallbackToCloud: boolean;
  /** エラー発生日時（ISO 8601） */
  readonly timestamp: string;

  constructor(
    code: CTSErrorCode,
    message: string,
    options?: {
      httpStatus?: number;
      retryable?: boolean;
      fallbackToCloud?: boolean;
      cause?: Error;
    },
  );

  /**
   * MCPレスポンス用のシリアライズ
   * CallToolResult の content テキストに含めるためのオブジェクトを返す
   */
  toMCPError(): MCPErrorResponse;
}
```

| 項目 | 内容 |
|:---|:---|
| **`code`** | `CTSErrorCode` -- エラーの一意識別子 |
| **`httpStatus`** | 整数 -- MCPはHTTPではないが、エラー分類の参考値として使用。デフォルト `500` |
| **`retryable`** | `boolean` -- 一時的障害（接続断、レートリミット）は `true`、恒久的問題（バリデーション失敗）は `false`。デフォルト `false` |
| **`fallbackToCloud`** | `boolean` -- ローカルLLM固有の問題は `true`、入力側の問題は `false`。デフォルト `true` |
| **`timestamp`** | ISO 8601形式の日時文字列。`new Date().toISOString()` で生成 |
| **`cause`** | ES2022 `Error.cause` による原因チェイン。`new Error(message, { cause })` |
| **対応テストID** | E-01, E-02 |

### 8.5 toMCPError メソッド

```typescript
toMCPError(): MCPErrorResponse {
  return {
    code: this.code,
    message: this.message,
    retryable: this.retryable,
  };
}
```

| 項目 | 内容 |
|:---|:---|
| **目的** | エラーをMCPの `CallToolResult` に埋め込む際のシリアライズ |
| **用途** | ツールハンドラ内で `catch (error)` した際に、`ctsErrorToCallToolResult()` ヘルパーに渡すためのデータ変換 |
| **対応テストID** | E-03 |

### 8.6 派生エラークラス一覧

#### 8.6.1 OllamaConnectionError (CTS-1xxx)

| クラス | コード | 属性 |
|:---|:---|:---|
| `OllamaNotRunningError` | CTS-1001 | `httpStatus: 503`, `retryable: true`, `fallbackToCloud: true` |
| `OllamaVersionError` | CTS-1002 | `httpStatus: 503`, `retryable: false`, `fallbackToCloud: true` |

**OllamaNotRunningError:**

```typescript
export class OllamaNotRunningError extends CTSError {
  constructor(cause?: Error);
}
```

| 項目 | 内容 |
|:---|:---|
| **メッセージ** | `'Ollamaが起動していません。\`ollama serve\` を実行してください。'` |
| **`retryable`** | `true` -- Ollamaを起動すれば解消する |
| **発生箇所** | `ollama/client.ts` の `healthCheck()` 失敗時 |
| **対応テストID** | E-04 |

**OllamaVersionError:**

```typescript
export class OllamaVersionError extends CTSError {
  constructor(currentVersion: string, requiredVersion: string);
}
```

| 項目 | 内容 |
|:---|:---|
| **メッセージ** | `'Ollamaバージョン {currentVersion} は非対応です。{requiredVersion} 以上が必要です。'` |
| **`retryable`** | `false` -- バージョンアップが必要 |
| **発生箇所** | `startup.ts` のバージョンチェック時 |
| **対応テストID** | E-05 |

#### 8.6.2 OllamaTimeoutError (CTS-2xxx)

| クラス | コード | 属性 |
|:---|:---|:---|
| `ModelLoadTimeoutError` | CTS-2001 | `httpStatus: 504`, `retryable: false`, `fallbackToCloud: true` |
| `GenerationTimeoutError` | CTS-2002 | `httpStatus: 504`, `retryable: false`, `fallbackToCloud: true` |

**ModelLoadTimeoutError:**

```typescript
export class ModelLoadTimeoutError extends CTSError {
  readonly timeoutMs: number;
  constructor(modelName: string, timeoutMs: number);
}
```

| 項目 | 内容 |
|:---|:---|
| **メッセージ** | `'モデル {modelName} のロードが {timeoutMs/1000}秒 でタイムアウトしました。'` |
| **発生箇所** | `ollama/client.ts` の `chat()` 内、初回トークンタイムアウト検出時 |
| **対応テストID** | E-06 |

**GenerationTimeoutError:**

```typescript
export class GenerationTimeoutError extends CTSError {
  readonly timeoutMs: number;
  readonly tier: number;
  constructor(timeoutMs: number, tier: number);
}
```

| 項目 | 内容 |
|:---|:---|
| **メッセージ** | `'Tier {tier} の生成が {timeoutMs/1000}秒 でタイムアウトしました。クラウドAPIで直接処理してください。'` |
| **発生箇所** | `ollama/streaming.ts` のリクエストタイムアウト検出時、またはハートビートタイムアウト検出時 |
| **対応テストID** | E-07 |

#### 8.6.3 ModelNotFoundError (CTS-3001)

```typescript
export class ModelNotFoundError extends CTSError {
  constructor(modelName: string);
}
```

| 項目 | 内容 |
|:---|:---|
| **コード** | CTS-3001 |
| **メッセージ** | `'モデル {modelName} が見つかりません。自動pullを試行します。'` |
| **属性** | `httpStatus: 404`, `retryable: true`, `fallbackToCloud: false` |
| **発生箇所** | `ollama/model-manager.ts` の `ensureModelAvailable()` 内 |
| **`retryable: true`** | 自動pullが成功すれば解消するため |
| **`fallbackToCloud: false`** | pullで解消可能なのでクラウドフォールバックは不要 |
| **対応テストID** | E-08 |

#### 8.6.4 QueueError (CTS-4xxx)

| クラス | コード | 属性 |
|:---|:---|:---|
| `QueueFullError` | CTS-4001 | `httpStatus: 429`, `retryable: false`, `fallbackToCloud: true` |
| `RateLimitError` | CTS-4002 | `httpStatus: 429`, `retryable: true`, `fallbackToCloud: true` |

**QueueFullError:**

```typescript
export class QueueFullError extends CTSError {
  constructor(currentSize: number, maxSize: number);
}
```

| 項目 | 内容 |
|:---|:---|
| **メッセージ** | `'キューが満杯です（{currentSize}/{maxSize}）。クラウドAPIで直接処理してください。'` |
| **`retryable: false`** | キュー消化を待つよりクラウドフォールバックの方が効率的 |
| **発生箇所** | `queue/fifo-queue.ts` の `enqueue()` 内 |
| **対応テストID** | E-09 |

**RateLimitError:**

```typescript
export class RateLimitError extends CTSError {
  constructor(limitPerMinute: number);
}
```

| 項目 | 内容 |
|:---|:---|
| **メッセージ** | `'レートリミット超過: {limitPerMinute}リクエスト/分の上限に達しました。'` |
| **`retryable: true`** | 時間経過で解消するため |
| **発生箇所** | `queue/fifo-queue.ts` の `enqueue()` 内、レートリミッターによる拒否時 |
| **対応テストID** | E-10 |

#### 8.6.5 InputValidationError (CTS-5xxx)

| クラス | コード | 属性 |
|:---|:---|:---|
| `PromptInjectionError` | CTS-5001 | `httpStatus: 400`, `retryable: false`, `fallbackToCloud: false` |
| `ContextOverflowError` | CTS-5002 | `httpStatus: 400`, `retryable: false`, `fallbackToCloud: false` |

**PromptInjectionError:**

```typescript
export class PromptInjectionError extends CTSError {
  constructor(detectedPattern: string);
}
```

| 項目 | 内容 |
|:---|:---|
| **メッセージ** | `'プロンプトインジェクションの疑いを検出しました: {detectedPattern}'` |
| **`retryable: false`** | 入力の修正が必要 |
| **`fallbackToCloud: false`** | PI疑いのある入力をクラウドに送ることも危険であるため、フォールバックも拒否 |
| **発生箇所** | ツールハンドラ（`tools/offload-work.ts`, `tools/compress-context.ts`）の入力検査後 |
| **注意点** | `detectedPattern` にはユーザー入力の部分文字列が含まれるが、ログには `inputPreview: text.slice(0, 200)` のみを出力し、入力全体のログ出力は行わない（情報漏洩防止） |
| **対応テストID** | E-11 |

**ContextOverflowError:**

```typescript
export class ContextOverflowError extends CTSError {
  constructor(inputTokens: number, maxTokens: number, tier: number);
}
```

| 項目 | 内容 |
|:---|:---|
| **メッセージ** | `'入力トークン数 ({inputTokens}) がTier {tier} の上限 ({maxTokens}) を超えています。'` |
| **`retryable: false`** | 入力の縮小が必要 |
| **`fallbackToCloud: false`** | 入力サイズの問題であり、クラウドに送っても問題は解決しない |
| **発生箇所** | `validators/input-validator.ts` のサイズチェック時 |
| **対応テストID** | E-12 |

#### 8.6.6 ConfigError (CTS-6xxx)

**InvalidConfigError:**

```typescript
export class InvalidConfigError extends CTSError {
  constructor(configKey: string, reason: string);
}
```

| 項目 | 内容 |
|:---|:---|
| **コード** | CTS-6001 |
| **メッセージ** | `'設定エラー: {configKey} -- {reason}'` |
| **属性** | `httpStatus: 500`, `retryable: false`, `fallbackToCloud: false` |
| **発生箇所** | `config/index.ts` の `loadConfig()` 内（Zodバリデーション失敗時）、`cost/calculator.ts` のコンストラクタ（不正な比較対象モデル指定時） |
| **対応テストID** | E-13 |

### 8.7 MCPレスポンス変換ヘルパー

```typescript
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

/**
 * CTSErrorをMCP CallToolResultに変換するヘルパー関数
 */
export function ctsErrorToCallToolResult(error: CTSError): CallToolResult
```

| 項目 | 内容 |
|:---|:---|
| **目的** | ツールハンドラの `catch` ブロックでキャッチした `CTSError` をMCPレスポンスに変換する |
| **引数** | `error`: キャッチした `CTSError` インスタンス |
| **戻り値** | `CallToolResult` -- `isError: true` 付きのレスポンス |
| **出力テキスト構造** | 1行目: `[{error.code}] {error.message}` |
|  | 2行目（`fallbackToCloud` 時）: `FALLBACK: このタスクはクラウドAPIで直接処理してください。` |
|  | 3行目（`retryable` 時）: `RETRY: このエラーは一時的です。しばらく後に再試行できます。` |
| **注意点** | `error` が `CTSError` でない場合（予期しないエラー）は、`CTS-0000` コードのジェネリックエラーとして変換する |
| **対応テストID** | E-14, E-15 |

---

## 付録A: テストID一覧

| ID | テスト概要 | 対象モジュール |
|:---|:---|:---|
| C-01 | CostCalculator コンストラクタ: 不正なモデル名でエラー | calculator.ts |
| C-02 | calculateSavings: 正常計算（Sonnet比較） | calculator.ts |
| C-03 | calculateSavings: 正常計算（Opus比較） | calculator.ts |
| C-04 | calculateSavings: トークン数0のエッジケース | calculator.ts |
| C-05 | calculateSavings: 負のトークン数でエラー | calculator.ts |
| C-06 | getCumulativeSavings: 累計が正しく蓄積される | calculator.ts |
| C-07 | reset: カウンターがゼロに戻る | calculator.ts |
| C-08 | restoreFromHistory: 履歴データから正しく復元 | calculator.ts |
| P-01 | DEFAULT_PRICING: 全モデルの価格が正値 | pricing.ts |
| P-02 | DEFAULT_COMPARISON_MODEL: デフォルトテーブルに存在 | pricing.ts |
| P-03 | loadPricing: 上書きなしでデフォルト返却 | pricing.ts |
| P-04 | loadPricing: 既存モデルの価格上書き | pricing.ts |
| P-05 | loadPricing: 新規モデルの追加 | pricing.ts |
| P-06 | loadPricing: 不正な価格値のスキップ | pricing.ts |
| R-01 | reportCost: 正しいフォーマットでstderr出力 | reporter.ts |
| R-02 | reportCost: 金額が4桁精度 | reporter.ts |
| R-03 | formatCostLine: フォーマット文字列の組み立て | reporter.ts |
| CF-01 | loadConfig: デフォルト値のみ | config/index.ts |
| CF-02 | loadConfig: 設定ファイルからの読み込み | config/index.ts |
| CF-03 | loadConfig: 環境変数による上書き | config/index.ts |
| CF-04 | loadConfig: 優先順位（環境変数 > ファイル > デフォルト） | config/index.ts |
| CF-05 | loadConfig: 不正なJSONファイルでWARN + デフォルト | config/index.ts |
| CF-06 | loadCostHistory: 正常な履歴ファイル読み込み | config/index.ts |
| CF-07 | loadCostHistory: ファイル不在でnull | config/index.ts |
| CF-08 | saveCostHistory: ファイル書き込み | config/index.ts |
| CF-09 | saveCostHistory: ディレクトリ自動作成 | config/index.ts |
| CS-01 | appConfigSchema: 全デフォルト値のバリデーション成功 | schema.ts |
| CS-02 | appConfigSchema: 不正なURL拒否 | schema.ts |
| CS-03 | appConfigSchema: 不正なTier番号拒否 | schema.ts |
| CS-04 | appConfigSchema: タイムアウト下限チェック | schema.ts |
| CS-05 | appConfigSchema: 価格上限チェック | schema.ts |
| V-01 | validateOffloadWorkInput: 正常入力 | input-validator.ts |
| V-02 | validateOffloadWorkInput: task未指定でエラー | input-validator.ts |
| V-03 | validateOffloadWorkInput: task文字数超過 | input-validator.ts |
| V-04 | validateOffloadWorkInput: 不正なlanguage値 | input-validator.ts |
| V-05 | validateOffloadWorkInput: サイズ超過 | input-validator.ts |
| V-06 | validateCompressContextInput: 正常入力 | input-validator.ts |
| V-07 | validateCompressContextInput: content未指定でエラー | input-validator.ts |
| V-08 | validateCompressContextInput: max_length範囲外 | input-validator.ts |
| V-09 | validateCompressContextInput: サイズ超過 | input-validator.ts |
| V-10 | validateCompressContextInput: 切り詰め判定 | input-validator.ts |
| V-11 | estimateTokenCount: 推定値の妥当性 | input-validator.ts |
| PI-01 | INJECTION_PATTERNS: direct-overrideパターン検出 | prompt-guard.ts |
| PI-02 | INJECTION_PATTERNS: role-injectionパターン検出 | prompt-guard.ts |
| PI-03 | INJECTION_PATTERNS: prompt-leakパターン検出 | prompt-guard.ts |
| PI-04 | INJECTION_PATTERNS: encoding-evasionパターン検出（warn） | prompt-guard.ts |
| PI-05 | INJECTION_PATTERNS: role-switchパターン検出 | prompt-guard.ts |
| PI-06 | detectPromptInjection: blockパターンでblocked=true | prompt-guard.ts |
| PI-07 | detectPromptInjection: warnパターンでblocked=false | prompt-guard.ts |
| PI-08 | detectPromptInjection: 正常なコード生成リクエスト（false positive回避） | prompt-guard.ts |
| PI-09 | detectPromptInjection: 複数パターン同時検出 | prompt-guard.ts |
| PI-10 | detectPromptInjection: 空文字列入力 | prompt-guard.ts |
| PI-11 | detectPromptInjection: 日本語入力（false positive回避） | prompt-guard.ts |
| SO-01 | sanitizeOutput: Anthropic APIキー検出・マスキング | prompt-guard.ts |
| SO-02 | sanitizeOutput: OpenAI APIキー検出 | prompt-guard.ts |
| SO-03 | sanitizeOutput: GitHub PAT検出 | prompt-guard.ts |
| SO-04 | sanitizeOutput: npm token検出 | prompt-guard.ts |
| SO-05 | sanitizeOutput: AWSキー検出 | prompt-guard.ts |
| SO-06 | sanitizeOutput: パスワード検出 | prompt-guard.ts |
| SO-07 | sanitizeOutput: 秘密鍵検出 | prompt-guard.ts |
| SO-08 | sanitizeOutput: 接続文字列検出 | prompt-guard.ts |
| SO-09 | sanitizeOutput: JWT検出 | prompt-guard.ts |
| SO-10 | sanitizeOutput: ファイルパス検出 | prompt-guard.ts |
| SO-11 | sanitizeOutput: クリーン出力は変更なし | prompt-guard.ts |
| SO-12 | sanitizeOutput: 複数パターン同時検出 | prompt-guard.ts |
| E-01 | CTSError: 基本プロパティ設定 | errors.ts |
| E-02 | CTSError: Error.cause チェイン | errors.ts |
| E-03 | toMCPError: シリアライズ結果 | errors.ts |
| E-04 | OllamaNotRunningError: プロパティ検証 | errors.ts |
| E-05 | OllamaVersionError: プロパティ検証 | errors.ts |
| E-06 | ModelLoadTimeoutError: プロパティ検証 | errors.ts |
| E-07 | GenerationTimeoutError: プロパティ検証 | errors.ts |
| E-08 | ModelNotFoundError: プロパティ検証 | errors.ts |
| E-09 | QueueFullError: プロパティ検証 | errors.ts |
| E-10 | RateLimitError: プロパティ検証 | errors.ts |
| E-11 | PromptInjectionError: プロパティ検証 | errors.ts |
| E-12 | ContextOverflowError: プロパティ検証 | errors.ts |
| E-13 | InvalidConfigError: プロパティ検証 | errors.ts |
| E-14 | ctsErrorToCallToolResult: フォールバック付き変換 | errors.ts |
| E-15 | ctsErrorToCallToolResult: 非CTSErrorの変換 | errors.ts |

---

## 付録B: モジュール依存関係図

```
src/errors.ts  (依存なし)
    ↑
    ├── src/cost/calculator.ts  ←── src/cost/pricing.ts
    ├── src/cost/reporter.ts    ←── src/cost/calculator.ts (型のみ)
    ├── src/config/index.ts     ←── src/config/schema.ts (zod)
    ├── src/validators/input-validator.ts
    └── src/validators/prompt-guard.ts (pino)
```

**循環依存なし**を設計上保証する。`errors.ts` は他モジュールに依存しない独立モジュールとし、依存グラフの根（ルート）に位置する。

---

## 付録C: 設計書間の参照マッピング

| 本仕様のセクション | 参照元設計書 | 参照セクション |
|:---|:---|:---|
| 1. cost/calculator.ts | mcp-server-design.md | 6. コスト計算モジュール |
| 2. cost/pricing.ts | mcp-server-design.md | 6.1 価格テーブル |
| 3. cost/reporter.ts | data-flow-design.md | 5.5 コスト計算のstderr出力フォーマット |
| 4. config/index.ts | mcp-server-design.md | 10. 設定ファイル仕様 |
| 5. config/schema.ts | mcp-server-design.md | 10.2 JSON Schema |
| 6. validators/input-validator.ts | security-design.md | 2.2 L1: 入力バリデーション |
| 7. validators/prompt-guard.ts | security-design.md | 2.2.1, 7.2 出力サニタイズ |
| 8. errors.ts | data-flow-design.md | 3. エラークラス階層 |
