# 設定リファレンス

claude-token-saver-mcp の全設定項目を解説します。

## 設定の優先順位

設定は以下の優先順位で適用されます。上位の設定が下位を上書きします。

1. **環境変数** (最優先)
2. **設定ファイル** (`~/.config/claude-token-saver/config.json`)
3. **デフォルト値**

---

## 環境変数一覧

| 変数名 | デフォルト | 説明 | 例 |
|---|---|---|---|
| `OLLAMA_BASE_URL` | `http://127.0.0.1:11434` | Ollama サーバーの接続先 URL | `http://192.168.1.100:11434` |
| `TIER_OVERRIDE` | (なし) | ティアレベルを強制指定 (1, 2, 3) | `2` |
| `MODEL_OVERRIDE` | (なし) | 使用するモデルを強制指定 | `qwen2.5-coder:7b` |
| `QUEUE_MAX_SIZE` | `10` | キューの最大長 (1-100) | `20` |
| `QUEUE_TIMEOUT_MS` | `60000` | キューのタイムアウト (ms, 最小 5000) | `120000` |
| `OLLAMA_TIMEOUT_MS` | (なし) | Ollama リクエストタイムアウト (ms, 最小 10000) | `90000` |
| `CLOUD_INPUT_PRICE_PER_MTOKEN` | (なし) | クラウドモデルの入力価格 ($/1Mトークン) | `3.0` |
| `CLOUD_OUTPUT_PRICE_PER_MTOKEN` | (なし) | クラウドモデルの出力価格 ($/1Mトークン) | `15.0` |
| `LOG_LEVEL` | `info` | ログレベル (fatal/error/warn/info/debug/trace) | `debug` |
| `MODEL_SELECTOR_ENABLED` | `true` | 動的モデルセレクターの有効/無効 | `false` |
| `MODEL_PREFER_QUALITY` | `false` | 品質優先モード | `true` |
| `PRELOAD_KEEP_ALIVE` | `-1` | プリロードモデルの keep-alive 設定 | `5m` |
| `MAX_SIMULTANEOUS_MODELS` | `auto` | 同時ロード可能なモデル数 (auto または 1-10) | `3` |

---

## 設定ファイル

### 設定ファイルの場所

```
~/.config/claude-token-saver/config.json
```

設定ファイルが存在しない場合はデフォルト値が使用されます。ファイルの読み込みに失敗した場合は警告が出力されます。

---

### 全設定項目

#### ollama (Ollama 接続設定)

| 項目 | 型 | デフォルト | 説明 |
|---|---|---|---|
| `baseUrl` | string (URL) | `"http://127.0.0.1:11434"` | Ollama サーバーの接続先 URL |

```json
{
  "ollama": {
    "baseUrl": "http://127.0.0.1:11434"
  }
}
```

---

#### tier (ティアオーバーライド)

ティアの動作を手動で上書きします。デフォルトは `null` (自動判定) です。

| 項目 | 型 | デフォルト | 説明 |
|---|---|---|---|
| `forceLevel` | `1 \| 2 \| 3` | (なし) | ティアレベルを強制指定 |
| `primaryModel` | string | (なし) | プライマリモデルを指定 |
| `fallbackModel` | string \| null | (なし) | フォールバックモデルを指定。`null` でフォールバック無効 |
| `contextLimit` | number | (なし) | コンテキスト上限 (1000-128000) |

```json
{
  "tier": {
    "forceLevel": 2,
    "primaryModel": "qwen2.5-coder:7b",
    "fallbackModel": "qwen2.5-coder:3b",
    "contextLimit": 32000
  }
}
```

---

#### timeout (タイムアウト設定)

各種タイムアウトを設定します。デフォルトは `null` (システムデフォルトを使用) です。

| 項目 | 型 | 最小値 | 説明 |
|---|---|---|---|
| `requestTimeout` | number (ms) | 10000 | Ollama リクエストの全体タイムアウト |
| `heartbeatTimeout` | number (ms) | 5000 | ハートビートのタイムアウト |
| `firstTokenTimeout` | number (ms) | 10000 | 最初のトークン受信までのタイムアウト |
| `queueTimeout` | number (ms) | 5000 | キュー内での待機タイムアウト |

```json
{
  "timeout": {
    "requestTimeout": 90000,
    "heartbeatTimeout": 15000,
    "firstTokenTimeout": 30000,
    "queueTimeout": 10000
  }
}
```

---

#### queue (キュー設定)

リクエストキューの動作を制御します。

| 項目 | 型 | デフォルト | 制約 | 説明 |
|---|---|---|---|---|
| `maxQueueLength` | number | `10` | 1-100 | キューに入れられるリクエストの最大数 |
| `maxRequestSizeBytes` | number | `204800` (200KB) | 最小 1024 | 1 リクエストの最大サイズ (バイト) |
| `queueTimeoutMs` | number | `60000` | 最小 5000 | キュー内待機のタイムアウト (ms) |
| `rateLimitPerMinute` | number | (なし) | 最小 1 | 1 分あたりのリクエスト上限 |

```json
{
  "queue": {
    "maxQueueLength": 20,
    "maxRequestSizeBytes": 204800,
    "queueTimeoutMs": 60000,
    "rateLimitPerMinute": 30
  }
}
```

---

#### cost (コスト計算設定)

クラウド API との比較コストを計算するための設定です。

| 項目 | 型 | デフォルト | 説明 |
|---|---|---|---|
| `comparisonModel` | string | `"claude-sonnet-4-5"` | コスト比較対象のクラウドモデル名 |
| `pricing` | Record<string, Pricing> | (なし) | モデルごとの料金定義 |

`pricing` の各エントリ:

| 項目 | 型 | 制約 | 説明 |
|---|---|---|---|
| `inputPer1MTokens` | number | 0 より大きく 1000 以下 | 入力 1M トークンあたりの料金 ($) |
| `outputPer1MTokens` | number | 0 より大きく 1000 以下 | 出力 1M トークンあたりの料金 ($) |

```json
{
  "cost": {
    "comparisonModel": "claude-sonnet-4-5",
    "pricing": {
      "claude-sonnet-4-5": {
        "inputPer1MTokens": 3.0,
        "outputPer1MTokens": 15.0
      }
    }
  }
}
```

---

#### security (セキュリティ設定)

| 項目 | 型 | デフォルト | 説明 |
|---|---|---|---|
| `enableInputSanitization` | boolean | `true` | 入力のサニタイズ処理を有効にする |

```json
{
  "security": {
    "enableInputSanitization": true
  }
}
```

---

#### logLevel (ログレベル)

| 型 | デフォルト | 選択肢 |
|---|---|---|
| string | `"info"` | `fatal`, `error`, `warn`, `info`, `debug`, `trace` |

```json
{
  "logLevel": "debug"
}
```

---

#### modelSelector (モデルセレクター設定)

動的モデル選択機能の設定です。

| 項目 | 型 | デフォルト | 説明 |
|---|---|---|---|
| `enabled` | boolean | `true` | モデルセレクターの有効/無効 |
| `preferQuality` | boolean | `false` | 品質優先モード。`true` の場合、速度よりも品質の高いモデルを優先 |
| `preloadKeepAlive` | string | `"-1"` | プリロードモデルの keep-alive 設定。`"-1"` は無期限 |
| `maxSimultaneousModels` | `"auto"` \| number | `"auto"` | 同時にロード可能なモデル数。`"auto"` はシステムリソースに基づき自動判定。手動指定時は 1-10 |
| `customRecommendations` | Record<string, Record<string, string[]>> | `{}` | カスタムモデル推奨マッピング |
| `blockedModels` | string[] | `["codestral"]` | ブロックするモデルのリスト |
| `licenseFilter` | string[] | `["Apache-2.0", "MIT", "NVIDIA-Open"]` | 許可するライセンスのフィルター |

```json
{
  "modelSelector": {
    "enabled": true,
    "preferQuality": false,
    "preloadKeepAlive": "-1",
    "maxSimultaneousModels": "auto",
    "customRecommendations": {},
    "blockedModels": ["codestral"],
    "licenseFilter": ["Apache-2.0", "MIT", "NVIDIA-Open"]
  }
}
```

---

#### distributed (分散実行設定)

複数の Ollama ノードにリクエストを分散する設定です。

| 項目 | 型 | デフォルト | 説明 |
|---|---|---|---|
| `enabled` | boolean | `false` | 分散実行の有効/無効 |
| `nodes` | OllamaNode[] | `[]` | 接続先ノードのリスト |
| `strategy` | string | `"model-affinity"` | 分散戦略。`round-robin`, `least-connections`, `model-affinity` |
| `healthCheckIntervalMs` | number | `30000` | ヘルスチェック間隔 (ms, 最小 5000) |

`nodes` の各エントリ:

| 項目 | 型 | デフォルト | 説明 |
|---|---|---|---|
| `id` | string | (必須) | ノードの一意識別子 |
| `baseUrl` | string (URL) | (必須) | ノードの接続先 URL |
| `label` | string | (なし) | ノードの表示名 |
| `weight` | number | `1` | 負荷分散の重み (1-100) |

```json
{
  "distributed": {
    "enabled": true,
    "nodes": [
      {
        "id": "node-1",
        "baseUrl": "http://192.168.1.101:11434",
        "label": "GPU Server 1",
        "weight": 2
      },
      {
        "id": "node-2",
        "baseUrl": "http://192.168.1.102:11434",
        "label": "GPU Server 2",
        "weight": 1
      }
    ],
    "strategy": "model-affinity",
    "healthCheckIntervalMs": 30000
  }
}
```

---

#### persistence (永続化設定)

実行履歴やベンチマークデータの永続化設定です。

| 項目 | 型 | デフォルト | 説明 |
|---|---|---|---|
| `enabled` | boolean | `true` | 永続化の有効/無効 |
| `dataDir` | string | (なし) | データ保存先ディレクトリ。省略時はデフォルトの設定ディレクトリ |
| `autoSaveIntervalMs` | number | `300000` (5分) | 自動保存間隔 (ms, 最小 10000) |

```json
{
  "persistence": {
    "enabled": true,
    "dataDir": "/path/to/data",
    "autoSaveIntervalMs": 300000
  }
}
```

---

#### registryUpdater (レジストリ自動更新設定)

Ollama モデルレジストリの自動更新設定です。

| 項目 | 型 | デフォルト | 説明 |
|---|---|---|---|
| `enabled` | boolean | `false` | 自動更新の有効/無効 |
| `updateIntervalMs` | number | `1800000` (30分) | 更新間隔 (ms, 最小 60000) |

```json
{
  "registryUpdater": {
    "enabled": false,
    "updateIntervalMs": 1800000
  }
}
```

---

### 完全な設定ファイル例

以下はすべてのセクションを含む設定ファイルの例です。実際の使用時には必要な項目のみを記述してください。

```json
{
  // Ollama サーバー接続
  "ollama": {
    "baseUrl": "http://127.0.0.1:11434"
  },

  // ティアオーバーライド (null で自動判定)
  "tier": {
    "forceLevel": 2,
    "primaryModel": "qwen2.5-coder:7b",
    "fallbackModel": "qwen2.5-coder:3b",
    "contextLimit": 32000
  },

  // タイムアウト設定 (null でシステムデフォルト)
  "timeout": {
    "requestTimeout": 90000,
    "heartbeatTimeout": 15000,
    "firstTokenTimeout": 30000,
    "queueTimeout": 10000
  },

  // キュー設定
  "queue": {
    "maxQueueLength": 10,
    "maxRequestSizeBytes": 204800,
    "queueTimeoutMs": 60000,
    "rateLimitPerMinute": 30
  },

  // コスト計算
  "cost": {
    "comparisonModel": "claude-sonnet-4-5",
    "pricing": {
      "claude-sonnet-4-5": {
        "inputPer1MTokens": 3.0,
        "outputPer1MTokens": 15.0
      }
    }
  },

  // セキュリティ
  "security": {
    "enableInputSanitization": true
  },

  // ログレベル
  "logLevel": "info",

  // 動的モデルセレクター
  "modelSelector": {
    "enabled": true,
    "preferQuality": false,
    "preloadKeepAlive": "-1",
    "maxSimultaneousModels": "auto",
    "customRecommendations": {},
    "blockedModels": ["codestral"],
    "licenseFilter": ["Apache-2.0", "MIT", "NVIDIA-Open"]
  },

  // 分散実行
  "distributed": {
    "enabled": false,
    "nodes": [],
    "strategy": "model-affinity",
    "healthCheckIntervalMs": 30000
  },

  // 永続化
  "persistence": {
    "enabled": true,
    "autoSaveIntervalMs": 300000
  },

  // レジストリ自動更新
  "registryUpdater": {
    "enabled": false,
    "updateIntervalMs": 1800000
  }
}
```

> **注意**: JSON 仕様ではコメントはサポートされていません。上記のコメントは説明用です。実際の設定ファイルではコメントを除去してください。

---

## データファイル

以下のファイルは `~/.config/claude-token-saver/` ディレクトリに自動的に作成・管理されます。手動での編集は推奨しません。

| ファイル | 説明 |
|---|---|
| `~/.config/claude-token-saver/cost-history.json` | コスト削減額の累積履歴 |
| `~/.config/claude-token-saver/execution-history.json` | リクエスト実行履歴 |
| `~/.config/claude-token-saver/benchmark-data.json` | モデルベンチマーク結果データ |

`persistence.dataDir` を設定した場合、`execution-history.json` と `benchmark-data.json` は指定したディレクトリに保存されます。`cost-history.json` は常にデフォルトの設定ディレクトリに保存されます。
