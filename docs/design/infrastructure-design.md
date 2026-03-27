# claude-token-saver-mcp インフラストラクチャ設計書

**バージョン:** 1.1 (v0.3.0対応)
**作成日:** 2026-02-15
**最終更新:** 2026-03-16
**担当:** Infrastructure Agent
**フェーズ:** Phase 2 — 基本設計

---

## 1. ディレクトリ構造

MCPサーバー単体パッケージとして、シンプルかつ拡張性のある構造を採用する。

```
claude-token-saver-mcp/
├── src/
│   ├── server.ts              # MCPサーバーエントリポイント（stdio transport）
│   ├── tools/
│   │   ├── index.ts           # ツール登録・ルーティング
│   │   ├── offload-work.ts    # offload_work ツール実装
│   │   ├── compress-context.ts # compress_context ツール実装
│   │   ├── batch-offload.ts   # バッチオフロードツール（複数タスク一括オフロード）
│   │   ├── get-metrics.ts     # メトリクスMCPツール（Prometheus形式メトリクス取得）
│   │   ├── cost-dashboard.ts  # コストダッシュボードツール（節約額サマリー表示）
│   │   ├── recommend-model.ts # モデル推薦ツール（タスクに最適なモデルを提案）
│   │   ├── preload-model.ts   # モデルプリロードツール（モデルを事前ロード）
│   │   ├── list-loaded-models.ts # ロード済みモデル一覧ツール
│   │   ├── pull-model.ts      # モデルプルツール（Ollamaモデルをダウンロード）
│   │   ├── configure-model-selector.ts # モデルセレクター設定ツール
│   │   └── auto-setup.ts      # auto_setup ツール（最適モデル推奨→DL→プリロード一括実行）
│   ├── queue/
│   │   ├── fifo-queue.ts      # FIFOキュー（同時実行数=1、レートリミット）
│   │   └── priority-queue.ts  # 優先度付きキュー（タスク優先度制御）
│   ├── ollama/
│   │   ├── client.ts          # Ollama API クライアント（/api/chat, /api/generate）
│   │   ├── model-manager.ts   # モデルpull確認・ヘルスチェック
│   │   └── load-balancer.ts   # マルチノードロードバランサー（分散Ollama対応）
│   ├── metrics/
│   │   └── collector.ts       # Prometheusメトリクス収集（リクエスト数、レイテンシ、トークン使用量等）
│   ├── persistence/
│   │   └── manager.ts         # 永続化マネージャー（コスト記録・セッションデータの永続化）
│   ├── logging/
│   │   └── structured.ts      # 構造化ログヘルパー（pino拡張、リクエストID付与等）
│   ├── model-selector/
│   │   └── registry-updater.ts # レジストリ自動更新（Ollamaモデル一覧の定期同期）
│   ├── tiering/
│   │   ├── detector.ts        # RAM自動検出・Tier判定
│   │   └── config.ts          # Tier別モデル・コンテキスト上限定義
│   ├── cost/
│   │   ├── calculator.ts      # 節約額計算ロジック
│   │   ├── pricing.ts         # クラウドAPI価格定義（ハードコード＋設定ファイル）
│   │   └── reporter.ts        # stderr出力（タスク毎/累計節約額）
│   ├── config/
│   │   ├── index.ts           # 設定ローダー（環境変数＋設定ファイル）
│   │   └── schema.ts          # 設定スキーマ定義（Zod）
│   └── validators/
│       ├── input-validator.ts  # 入力バリデーション（サイズ上限、メタ命令検出）
│       └── prompt-guard.ts     # プロンプトインジェクション防御
├── tests/
│   ├── unit/
│   │   ├── queue/
│   │   │   └── fifo-queue.test.ts
│   │   ├── ollama/
│   │   │   └── client.test.ts
│   │   ├── tiering/
│   │   │   └── detector.test.ts
│   │   ├── cost/
│   │   │   └── calculator.test.ts
│   │   └── validators/
│   │       └── input-validator.test.ts
│   └── integration/
│       ├── server.test.ts      # MCPサーバー統合テスト
│       └── ollama.test.ts      # Ollama API統合テスト
├── docs/
│   ├── design/                 # 設計書群（本ファイル含む）
│   ├── planning/               # 企画・調査レポート
│   └── decisions.md            # 意思決定ログ
├── .github/
│   └── workflows/
│       ├── ci.yml              # CI（lint→test→build→license-check）
│       └── publish.yml         # npm公開ワークフロー
├── docker/
│   ├── Dockerfile              # MCPサーバー用Dockerfile
│   └── docker-compose.yml      # 開発環境（MCPサーバー＋Ollama）
├── package.json
├── tsconfig.json
├── tsup.config.ts              # バンドル設定
├── vitest.config.ts            # テスト設定
├── .eslintrc.cjs               # ESLint設定
├── .prettierrc                 # Prettier設定
├── .npmrc                      # npm公開設定
├── .env.example                # 環境変数テンプレート
├── LICENSE                     # Apache 2.0
├── NOTICE                      # サードパーティライセンス帰属
├── CLAUDE.md                   # プロジェクト指示書
└── README.md                   # プロジェクト説明
```

### モジュール責務一覧

| モジュール | 責務 | 依存先 |
|:---|:---|:---|
| `server.ts` | MCPサーバー起動、stdio transport確立、ツール登録 | tools/, config/ |
| `tools/` | MCPツール定義（offload_work, compress_context, batch_offload, get_metrics, cost_dashboard, recommend_model, preload_model, list_loaded_models, pull_model, configure_model_selector, auto_setup）、引数スキーマ | queue/, ollama/, cost/, validators/, metrics/, model-selector/ |
| `queue/` | FIFOキュー管理、優先度付きキュー、同時実行制御、レートリミット | なし |
| `ollama/` | Ollama APIとの通信、モデル管理、ヘルスチェック、マルチノードロードバランシング | config/ |
| `tiering/` | RAM検出、Tier判定、モデル選択 | config/ |
| `cost/` | 節約額計算、価格管理、stderr出力 | config/ |
| `config/` | 環境変数＋設定ファイルの統合ロード | なし |
| `validators/` | 入力検証、プロンプトインジェクション検出 | config/ |
| `metrics/` | Prometheusメトリクス収集・集計（リクエスト数、レイテンシ、トークン使用量、キュー深度等） | config/ |
| `persistence/` | コスト記録・セッションデータのファイルシステム永続化、自動保存 | config/ |
| `logging/` | 構造化ログヘルパー（pinoラッパー）、リクエストID自動付与、ログレベル制御 | config/ |
| `model-selector/` | Ollamaモデルレジストリの定期同期・自動更新 | ollama/, config/ |

---

## 2. package.json 設計

```json
{
  "name": "claude-token-saver-mcp",
  "version": "0.1.0",
  "description": "MCP server that offloads coding tasks to local LLM (Ollama) to save Claude API tokens",
  "license": "Apache-2.0",
  "author": "claude-token-saver-mcp Contributors",
  "repository": {
    "type": "git",
    "url": "https://github.com/hiko99/claude-token-saver-mcp"
  },
  "keywords": [
    "mcp",
    "claude",
    "ollama",
    "token-saver",
    "local-llm",
    "agent-teams"
  ],
  "type": "module",
  "main": "./dist/server.js",
  "bin": {
    "claude-token-saver-mcp": "./dist/server.js"
  },
  "files": [
    "dist",
    "LICENSE",
    "NOTICE",
    "README.md"
  ],
  "engines": {
    "node": ">=20.0.0"
  },
  "scripts": {
    "build": "tsup",
    "dev": "tsx watch src/server.ts",
    "start": "node dist/server.js",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "lint": "eslint src/ tests/ --ext .ts",
    "lint:fix": "eslint src/ tests/ --ext .ts --fix",
    "format": "prettier --write \"src/**/*.ts\" \"tests/**/*.ts\"",
    "format:check": "prettier --check \"src/**/*.ts\" \"tests/**/*.ts\"",
    "typecheck": "tsc --noEmit",
    "license:check": "license-checker --production --failOn 'GPL-2.0;GPL-3.0;AGPL-3.0;LGPL-2.1;LGPL-3.0'",
    "clean": "rm -rf dist",
    "prepublishOnly": "npm run clean && npm run build && npm run test && npm run license:check"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "pino": "^9.0.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "eslint": "^8.57.0",
    "@typescript-eslint/eslint-plugin": "^7.0.0",
    "@typescript-eslint/parser": "^7.0.0",
    "prettier": "^3.3.0",
    "tsup": "^8.0.0",
    "tsx": "^4.0.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0",
    "@vitest/coverage-v8": "^2.0.0",
    "license-checker": "^25.0.0"
  }
}
```

### 依存パッケージの選定理由

| パッケージ | バージョン | 選定理由 |
|:---|:---|:---|
| `@modelcontextprotocol/sdk` | ^1.0.0 | MCP公式SDK。stdio transport対応。MIT License |
| `pino` | ^9.0.0 | 高性能構造化ロガー。JSON出力でCI/CD連携容易。MIT License |
| `zod` | ^3.23.0 | TypeScript-first スキーマバリデーション。設定・入力検証に使用。MIT License |
| `tsup` | ^8.0.0 | esbuildベースの高速TypeScriptバンドラー。ESM出力対応。MIT License |
| `tsx` | ^4.0.0 | TypeScript実行ランタイム。開発時のホットリロードに使用。MIT License |

**注意:** `better-sqlite3` はコスト記録永続化が必要になった段階（v0.2.0以降）で追加する。MVP時点ではインメモリでの累計計算のみとする。

---

## 3. TypeScript 設定

### tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "isolatedModules": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "exactOptionalPropertyTypes": false,
    "noImplicitReturns": true,
    "noUncheckedIndexedAccess": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

### 設定の意図

| オプション | 値 | 理由 |
|:---|:---|:---|
| `target: ES2022` | ES2022 | Node.js 20 LTSが完全サポート。top-level await、Error.cause等を利用可能 |
| `module: NodeNext` | NodeNext | ESM + package.json `"type": "module"` との整合性。`.js`拡張子付きimportを強制 |
| `moduleResolution: NodeNext` | NodeNext | `module: NodeNext` と対。`exports`フィールド解決を有効化 |
| `strict: true` | true | strictNullChecks, noImplicitAny等を一括有効化。型安全性の担保 |
| `noUncheckedIndexedAccess: true` | true | 配列・オブジェクトのインデックスアクセスに`undefined`チェックを強制 |
| `isolatedModules: true` | true | tsup（esbuild）との互換性確保。ファイル単位のトランスパイルを前提 |
| `declaration: true` | true | npm公開時に型定義ファイルを配布 |

---

## 4. ビルド設計

### tsup.config.ts

```typescript
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/server.ts"],
  format: ["esm"],
  target: "node20",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  dts: true,
  splitting: false,
  banner: {
    js: "#!/usr/bin/env node",
  },
  external: [
    // Node.js built-in modules
    "node:os",
    "node:path",
    "node:fs",
    "node:child_process",
    "node:crypto",
  ],
  esbuildOptions(options) {
    options.platform = "node";
  },
});
```

### ビルドパイプライン

```
src/server.ts
    │
    ▼ tsup (esbuild)
    │
    ├── dist/server.js        # ESMバンドル（shebang付き）
    ├── dist/server.js.map    # ソースマップ
    └── dist/server.d.ts      # 型定義
```

### 設計判断

| 項目 | 選択 | 理由 |
|:---|:---|:---|
| バンドラー | tsup (esbuild) | tscより10-100倍高速。shebang挿入、外部モジュール除外を宣言的に設定可能 |
| 出力形式 | ESM only | `"type": "module"` との整合性。Node.js 20はESMを安定サポート |
| エントリポイント | 単一（server.ts） | MCPサーバーは単一プロセスで起動。コード分割不要 |
| shebang | `#!/usr/bin/env node` | `npx claude-token-saver-mcp` でダイレクト実行するために必須 |
| ソースマップ | 有効 | 本番エラーのスタックトレースをソースコードにマッピング |

### CLIエントリポイント

ビルド後の `dist/server.js` は以下の構造を持つ:

```javascript
#!/usr/bin/env node
// ... バンドルされたコード ...
// MCPサーバーをstdio transportで起動
```

`npx` または直接実行で利用可能:

```bash
# npx経由
npx claude-token-saver-mcp

# グローバルインストール後
claude-token-saver-mcp

# Claude Code settings.json での設定
# {
#   "mcpServers": {
#     "token-saver": {
#       "command": "npx",
#       "args": ["-y", "claude-token-saver-mcp"]
#     }
#   }
# }
```

---

## 5. Docker Compose 設計

### docker/Dockerfile

```dockerfile
# ============================================================
# claude-token-saver-mcp Dockerfile
# Multi-stage build: Node.js 20 LTS (Alpine)
# ============================================================

# --- Stage 1: Build ---
FROM node:20-alpine AS builder

WORKDIR /app

# 依存関係のインストール（キャッシュ活用）
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

# ソースコードのコピーとビルド
COPY tsconfig.json tsup.config.ts ./
COPY src/ ./src/
RUN npm run build

# 本番依存のみ再インストール
RUN npm ci --omit=dev --ignore-scripts

# --- Stage 2: Production ---
FROM node:20-alpine AS production

# セキュリティ: non-rootユーザーで実行
RUN addgroup -g 1001 -S mcp && \
    adduser -S mcp -u 1001 -G mcp

WORKDIR /app

# ビルド成果物と本番依存のみコピー
COPY --from=builder --chown=mcp:mcp /app/dist ./dist
COPY --from=builder --chown=mcp:mcp /app/node_modules ./node_modules
COPY --from=builder --chown=mcp:mcp /app/package.json ./

USER mcp

# ヘルスチェック（プロセス生存確認）
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD pgrep -f "node dist/server.js" || exit 1

# MCPサーバー起動（stdio transport）
ENTRYPOINT ["node", "dist/server.js"]
```

### docker/docker-compose.yml

```yaml
# ============================================================
# claude-token-saver-mcp 開発環境
# 2コンテナ構成: MCPサーバー + Ollama
# ============================================================
version: "3.9"

services:
  # -------------------------------------------------------
  # Ollama サーバー
  # -------------------------------------------------------
  ollama:
    image: ollama/ollama:latest
    container_name: cts-ollama
    restart: unless-stopped
    ports: []  # 外部公開しない（内部ネットワークのみ）
    volumes:
      - ollama-models:/root/.ollama  # モデルデータ永続化
    networks:
      - cts-internal
    environment:
      - OLLAMA_HOST=0.0.0.0:11434         # コンテナ内でリッスン
      - OLLAMA_NUM_PARALLEL=1             # 並列リクエスト数=1（FIFOキューと整合）
      - OLLAMA_MAX_LOADED_MODELS=1        # ロード済みモデル数=1（メモリ節約）
      - OLLAMA_KEEP_ALIVE=10m             # モデルアンロードまでの待機時間
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia             # NVIDIA GPU利用時（Linuxのみ）
              count: all
              capabilities: [gpu]
    # Apple Silicon (macOS) ではGPUパススルーはDocker非対応。
    # macOSではネイティブOllamaの使用を推奨（後述の開発環境セットアップ参照）。
    healthcheck:
      test: ["CMD-SHELL", "curl -sf http://localhost:11434/api/tags || exit 1"]
      interval: 15s
      timeout: 5s
      retries: 5
      start_period: 10s

  # -------------------------------------------------------
  # MCP サーバー
  # -------------------------------------------------------
  mcp-server:
    build:
      context: ..
      dockerfile: docker/Dockerfile
    container_name: cts-mcp-server
    restart: unless-stopped
    depends_on:
      ollama:
        condition: service_healthy
    networks:
      - cts-internal
    environment:
      - OLLAMA_BASE_URL=http://ollama:11434   # 内部ネットワーク経由でOllamaに接続
      - LOG_LEVEL=info
      - NODE_ENV=production
    # stdio transport のため、stdin/stdout をアタッチ
    stdin_open: true
    tty: false

# -------------------------------------------------------
# ネットワーク定義
# -------------------------------------------------------
networks:
  cts-internal:
    driver: bridge
    internal: true  # 外部インターネットへのアクセスを遮断

# -------------------------------------------------------
# ボリューム定義
# -------------------------------------------------------
volumes:
  ollama-models:
    driver: local  # Ollamaモデルの永続化（~4-20GB）
```

### ネットワーク構成図

```
┌──────────────────────────────────────────────────┐
│                Docker Network                     │
│              cts-internal (bridge)                │
│              internal: true                        │
│                                                    │
│  ┌──────────────────┐   ┌──────────────────────┐ │
│  │   mcp-server     │   │      ollama          │ │
│  │                  │──▶│  :11434 (internal)   │ │
│  │  node:20-alpine  │   │  ollama/ollama       │ │
│  │  stdio transport │   │                      │ │
│  └──────────────────┘   └──────────────────────┘ │
│          │                        │               │
│      stdin/stdout            ollama-models        │
│      (host attach)           (volume)             │
│                                                    │
│  ❌ 外部ネットワークアクセス不可                    │
└──────────────────────────────────────────────────┘
```

### セキュリティ設計

| 対策 | 実装 | 理由 |
|:---|:---|:---|
| ネットワーク隔離 | `internal: true` | Ollama APIを外部に公開しない（CVE-2024-28224対策） |
| 外部ポート非公開 | `ports: []` | Ollamaのポートをホストにバインドしない |
| non-rootユーザー | `USER mcp` | コンテナ内での権限昇格を防止 |
| multi-stage build | builder → production | ビルドツール・ソースコードを本番イメージに含めない |
| ヘルスチェック | Ollama: curl, MCP: pgrep | 異常時の自動リスタート |

### macOS (Apple Silicon) での制約と対応

Docker Desktop for macOSはGPUパススルーをサポートしていない。Apple Siliconの統合GPU（Metal）を活用するには、OllamaをホストOSにネイティブインストールする必要がある。

**推奨構成（macOS開発時）:**
- Ollama: ホストOSにネイティブインストール（`brew install ollama`）
- MCPサーバー: `npm run dev` でホスト上で直接実行
- `OLLAMA_BASE_URL=http://127.0.0.1:11434` を環境変数に設定

**Docker構成の用途:**
- Linux本番環境でのデプロイ
- CI/CD環境でのテスト実行
- GPU不要な軽量テスト

---

## 6. CI/CD 設計

### .github/workflows/ci.yml

```yaml
# ============================================================
# CI: lint → typecheck → test → build → license-check
# ============================================================
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

permissions:
  contents: read

jobs:
  ci:
    name: Lint → Test → Build
    runs-on: ubuntu-latest
    timeout-minutes: 15

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: "npm"

      - name: Install dependencies
        run: npm ci

      - name: Lint
        run: npm run lint

      - name: Format check
        run: npm run format:check

      - name: Type check
        run: npm run typecheck

      - name: Unit tests
        run: npm run test:coverage

      - name: Build
        run: npm run build

      - name: License check
        run: npm run license:check

      - name: Upload coverage
        if: github.event_name == 'pull_request'
        uses: actions/upload-artifact@v4
        with:
          name: coverage-report
          path: coverage/
          retention-days: 7

  # -----------------------------------------------------------
  # Integration tests (Ollama 必要)
  # -----------------------------------------------------------
  integration:
    name: Integration Tests
    runs-on: ubuntu-latest
    timeout-minutes: 20
    needs: ci

    services:
      ollama:
        image: ollama/ollama:latest
        ports:
          - 11434:11434
        options: >-
          --health-cmd "curl -sf http://localhost:11434/api/tags || exit 1"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 10
          --health-start-period 30s

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: "npm"

      - name: Install dependencies
        run: npm ci

      - name: Build
        run: npm run build

      - name: Pull test model
        run: |
          curl -sf http://localhost:11434/api/pull -d '{"name": "phi4-mini"}'
        env:
          OLLAMA_BASE_URL: http://localhost:11434

      - name: Run integration tests
        run: npx vitest run tests/integration/
        env:
          OLLAMA_BASE_URL: http://localhost:11434
          NODE_ENV: test
```

### .github/workflows/publish.yml

```yaml
# ============================================================
# npm公開ワークフロー
# トリガー: GitHubリリース作成時
# ============================================================
name: Publish to npm

on:
  release:
    types: [published]

permissions:
  contents: read
  id-token: write  # npm provenance

jobs:
  publish:
    name: Publish
    runs-on: ubuntu-latest
    timeout-minutes: 10

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: "20"
          registry-url: "https://registry.npmjs.org"

      - name: Install dependencies
        run: npm ci

      - name: Build
        run: npm run build

      - name: Test
        run: npm run test

      - name: License check
        run: npm run license:check

      - name: Publish
        run: npm publish --provenance --access public
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

### CI/CD ワークフロー概要

| ワークフロー | トリガー | 主要ステップ |
|:---|:---|:---|
| `ci.yml` | push/PR to main | lint, **format:check**, typecheck, test:coverage, build, license-check, **カバレッジレポートをartifactとして保存** |
| `publish.yml` | GitHubリリース作成時 | npm ci, build, test, license-check, **`npm publish --provenance --access public`** を自動実行 |

### CI/CDパイプライン図

```
Pull Request / Push to main
    │
    ▼
┌─────────────────────────────────────────────┐
│  CI Job                                      │
│  ┌─────────┐  ┌──────────┐  ┌─────────────┐│
│  │  Lint   │→│ Typecheck │→│  Unit Test  ││
│  │ ESLint  │  │   tsc    │  │   Vitest    ││
│  │Prettier │  │ --noEmit │  │ + coverage  ││
│  └─────────┘  └──────────┘  └─────────────┘│
│       │                           │          │
│       ▼                           ▼          │
│  ┌─────────┐              ┌──────────────┐  │
│  │  Build  │              │License Check │  │
│  │  tsup   │              │license-checker│  │
│  └─────────┘              └──────────────┘  │
└─────────────────────┬───────────────────────┘
                      │ (on success)
                      ▼
┌─────────────────────────────────────────────┐
│  Integration Job                             │
│  ┌─────────────┐  ┌───────────────────────┐ │
│  │ Ollama起動  │→│ Integration Tests     │ │
│  │(service)    │  │ Vitest (tests/integ/) │ │
│  └─────────────┘  └───────────────────────┘ │
└─────────────────────────────────────────────┘

GitHub Release 作成
    │
    ▼
┌─────────────────────────────────────────────┐
│  Publish Job                                 │
│  npm ci → build → test → license-check      │
│       → npm publish --provenance             │
└─────────────────────────────────────────────┘
```

---

## 7. 開発環境セットアップ

### 7.1 前提条件

| 項目 | 要件 | 確認コマンド |
|:---|:---|:---|
| Node.js | v20.0.0 以上 | `node --version` |
| npm | v10.0.0 以上 | `npm --version` |
| Ollama | v0.1.34 以上（CVE-2024-28224/CVE-2024-37032修正版） | `ollama --version` |
| Git | v2.39 以上 | `git --version` |
| OS | macOS (Apple Silicon/Intel), Linux | `uname -m` |

### 7.2 インストール手順

```bash
# 1. リポジトリのクローン
git clone https://github.com/hiko99/claude-token-saver-mcp.git
cd claude-token-saver-mcp

# 2. 依存パッケージのインストール
npm install

# 3. 環境変数の設定
cp .env.example .env
# 必要に応じて .env を編集

# 4. ビルド確認
npm run build

# 5. テスト実行
npm run test
```

### 7.3 Ollama セットアップ

```bash
# --- macOS ---
brew install ollama

# Ollamaサーバー起動（バックグラウンド）
ollama serve &

# モデルのダウンロード（Tier 2: 16-48GB RAM環境の場合）
ollama pull qwen2.5-coder:7b

# モデルの動作確認
ollama run qwen2.5-coder:7b "Hello, respond with just 'OK'"

# --- Linux ---
curl -fsSL https://ollama.com/install.sh | sh

# systemdで起動
sudo systemctl enable ollama
sudo systemctl start ollama

# モデルのダウンロード
ollama pull qwen2.5-coder:7b
```

### 7.4 Tier別推奨モデル

| 環境RAM | Tier | モデル | ダウンロードコマンド | サイズ |
|:---|:---|:---|:---|:---|
| < 16GB | Tier 1 | phi4:latest | `ollama pull phi4` | ~8.5GB |
| 16-48GB | Tier 2 | qwen2.5-coder:7b | `ollama pull qwen2.5-coder:7b` | ~4.7GB |
| > 48GB | Tier 3 | qwen2.5-coder:32b | `ollama pull qwen2.5-coder:32b` | ~19GB |

### 7.5 開発サーバー起動

```bash
# 開発モード（ホットリロード付き）
npm run dev

# または直接実行
npx tsx src/server.ts

# Claude Code での接続テスト（settings.json に追加）
# {
#   "mcpServers": {
#     "token-saver": {
#       "command": "node",
#       "args": ["/path/to/claude-token-saver-mcp/dist/server.js"],
#       "env": {
#         "OLLAMA_BASE_URL": "http://127.0.0.1:11434",
#         "LOG_LEVEL": "debug"
#       }
#     }
#   }
# }
```

### 7.6 環境変数一覧

#### .env.example

```bash
# ============================================================
# claude-token-saver-mcp 環境変数
# ============================================================

# --- Ollama ---
OLLAMA_BASE_URL=http://127.0.0.1:11434     # Ollama APIのベースURL
OLLAMA_TIMEOUT_MS=60000                      # Ollamaリクエストタイムアウト（ミリ秒）

# --- Tiering ---
TIER_OVERRIDE=                               # Tier強制指定（1/2/3、空欄で自動検出）
MODEL_OVERRIDE=                              # モデル強制指定（例: llama3.2:3b）

# --- Queue ---
QUEUE_MAX_SIZE=10                            # FIFOキュー最大長（優先度付きキュー含む）
QUEUE_TIMEOUT_MS=60000                       # キュー待ち時間上限（ミリ秒）

# --- 注意: 以下の機能は設定ファイル（config.json）のみで制御 ---
# distributed（マルチノード分散）: config.jsonの distributed セクション
# persistence（永続化）: config.jsonの persistence セクション
# registryUpdater（レジストリ自動更新）: config.jsonの registryUpdater セクション

# --- Cost ---
CLOUD_INPUT_PRICE_PER_MTOKEN=3.00           # クラウドAPI入力価格（$/1M tokens）
CLOUD_OUTPUT_PRICE_PER_MTOKEN=15.00         # クラウドAPI出力価格（$/1M tokens）

# --- Logging ---
LOG_LEVEL=info                               # ログレベル（debug/info/warn/error）

# --- Node ---
NODE_ENV=development                         # 実行環境（development/production/test）
```

### 7.7 設定ファイルスキーマ（v0.3.0追加）

環境変数に加え、`config.json` で以下の高度な設定を制御する。分散構成・永続化・レジストリ自動更新は設定ファイルのみで制御し、環境変数は提供しない。

```json
{
  "distributed": {
    "enabled": false,
    "nodes": [
      "http://ollama-node1:11434",
      "http://ollama-node2:11434"
    ],
    "strategy": "model-affinity",
    "healthCheckIntervalMs": 30000
  },
  "persistence": {
    "enabled": true,
    "dataDir": "./data",
    "autoSaveIntervalMs": 300000
  },
  "registryUpdater": {
    "enabled": false,
    "updateIntervalMs": 1800000
  }
}
```

| セクション | フィールド | 型 | デフォルト | 説明 |
|:---|:---|:---|:---|:---|
| `distributed` | `enabled` | boolean | `false` | マルチノードロードバランシングの有効化 |
| | `nodes` | string[] | `[]` | OllamaノードURLリスト |
| | `strategy` | string | `"model-affinity"` | 負荷分散戦略（`model-affinity` / `round-robin` / `least-connections`） |
| | `healthCheckIntervalMs` | number | `30000` | ノードヘルスチェック間隔（ミリ秒） |
| `persistence` | `enabled` | boolean | `true` | コスト記録・セッションデータの永続化有効化 |
| | `dataDir` | string | `"./data"` | 永続化データの保存先ディレクトリ |
| | `autoSaveIntervalMs` | number | `300000` | 自動保存間隔（ミリ秒） |
| `registryUpdater` | `enabled` | boolean | `false` | Ollamaモデルレジストリ自動更新の有効化 |
| | `updateIntervalMs` | number | `1800000` | レジストリ更新間隔（ミリ秒、デフォルト30分） |

---

## 8. npm 公開設計

### 8.1 パッケージ情報

| 項目 | 値 |
|:---|:---|
| パッケージ名 | `claude-token-saver-mcp` |
| スコープ | なし（公開パッケージ） |
| レジストリ | https://registry.npmjs.org |
| アクセス | public |
| Provenance | 有効（GitHub Actions OIDC） |

### 8.2 .npmrc

```ini
# npm公開設定
registry=https://registry.npmjs.org/
access=public
provenance=true
```

### 8.3 公開フロー

```
1. バージョン更新
   npm version patch/minor/major

2. CHANGELOG更新
   手動で変更内容を記述

3. GitHubにプッシュ
   git push origin main --tags

4. GitHubリリース作成
   gh release create v0.1.0 --generate-notes

5. 自動公開（GitHub Actions）
   publish.yml が自動実行
   → npm publish --provenance --access public
```

### 8.4 npm provenance

npm provenanceを有効にすることで、パッケージがGitHub Actionsの信頼されたCI/CD環境からビルド・公開されたことを暗号学的に証明できる。

```
npm publish --provenance
```

これにより、npmjs.comのパッケージページに「Published from GitHub Actions」のバッジが表示される。

### 8.5 インストール方法（利用者向け）

```bash
# npx で直接実行（インストール不要）
npx claude-token-saver-mcp

# グローバルインストール
npm install -g claude-token-saver-mcp

# Claude Code の設定（~/.claude/settings.json）
{
  "mcpServers": {
    "token-saver": {
      "command": "npx",
      "args": ["-y", "claude-token-saver-mcp"]
    }
  }
}
```

---

## 9. ライセンス設計

### 9.1 Apache License 2.0

プロジェクト全体に Apache License 2.0 を適用する。

#### LICENSE ファイル

プロジェクトルートに Apache License 2.0 の全文を `LICENSE` ファイルとして配置する。
（全文は https://www.apache.org/licenses/LICENSE-2.0.txt を参照）

#### 選定理由

| 観点 | Apache 2.0 の利点 |
|:---|:---|
| 特許保護 | 明示的な特許付与条項により、コントリビューターの特許権を自動的にライセンス |
| 商用利用 | 制限なし。企業での採用障壁が低い |
| MIT互換性 | 主要依存パッケージ（MCP SDK, Ollama等）のMITライセンスと完全互換 |
| コミュニティ標準 | Linux Foundation傘下プロジェクトで広く採用 |

### 9.2 NOTICE ファイル

```
claude-token-saver-mcp
Copyright 2026 claude-token-saver-mcp Contributors

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

============================================================
Third-Party Notices
============================================================

This product includes software developed by third parties.

- @modelcontextprotocol/sdk: MIT License
  Copyright (c) Anthropic, PBC
  https://github.com/modelcontextprotocol/typescript-sdk

- pino: MIT License
  Copyright (c) 2016-2024 Matteo Collina and David Mark Clements
  https://github.com/pinojs/pino

- zod: MIT License
  Copyright (c) 2020 Colin McDonnell
  https://github.com/colinhacks/zod

- Ollama: MIT License (API client usage only, not bundled)
  Copyright (c) Ollama
  https://github.com/ollama/ollama
```

### 9.3 ソースファイル ライセンスヘッダー

全ての `.ts` ソースファイルの先頭に以下のヘッダーを付与する:

```typescript
// Copyright 2026 claude-token-saver-mcp Contributors
// SPDX-License-Identifier: Apache-2.0
```

SPDX短縮形式を採用し、ファイルの可読性を維持しつつライセンス情報を明確にする。

### 9.4 依存パッケージ ライセンス監査

CI/CDパイプラインで `license-checker` を実行し、以下のライセンスを検出した場合にビルドを失敗させる:

```bash
npm run license:check
# = license-checker --production --failOn 'GPL-2.0;GPL-3.0;AGPL-3.0;LGPL-2.1;LGPL-3.0'
```

**禁止ライセンス:**

| ライセンス | 理由 |
|:---|:---|
| GPL-2.0 | Apache 2.0 と非互換 |
| GPL-3.0 | 制約が厳しすぎる（全体がGPLに汚染される） |
| AGPL-3.0 | SaaS利用時のソースコード公開義務 |
| LGPL-2.1 / LGPL-3.0 | 動的リンクの解釈がnpmで曖昧 |

---

## 10. 補足設計

### 10.1 vitest.config.ts

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/integration/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: ["src/**/*.ts"],
      exclude: ["src/server.ts"],
      thresholds: {
        statements: 80,
        branches: 80,
        functions: 80,
        lines: 80,
      },
    },
    testTimeout: 10000,
  },
});
```

### 10.2 .eslintrc.cjs

```javascript
module.exports = {
  root: true,
  env: {
    node: true,
    es2022: true,
  },
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: "module",
    project: "./tsconfig.json",
  },
  plugins: ["@typescript-eslint"],
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:@typescript-eslint/recommended-requiring-type-checking",
  ],
  rules: {
    "@typescript-eslint/no-unused-vars": [
      "error",
      { argsIgnorePattern: "^_" },
    ],
    "@typescript-eslint/explicit-function-return-type": "warn",
    "@typescript-eslint/no-floating-promises": "error",
    "@typescript-eslint/strict-boolean-expressions": "warn",
    "no-console": ["error", { allow: ["error"] }],
  },
};
```

### 10.3 .prettierrc

```json
{
  "semi": true,
  "singleQuote": false,
  "tabWidth": 2,
  "trailingComma": "all",
  "printWidth": 100,
  "endOfLine": "lf",
  "arrowParens": "always"
}
```

### 10.4 .gitignore

```
# Dependencies
node_modules/

# Build output
dist/

# Coverage
coverage/

# Environment
.env
.env.local

# OS
.DS_Store
Thumbs.db

# IDE
.vscode/
.idea/
*.swp
*.swo

# Logs
*.log

# Docker volumes
ollama-models/
```

---

## 付録A: 設計判断ログ

| # | 判断事項 | 選択肢 | 決定 | 理由 |
|:---|:---|:---|:---|:---|
| 1 | パッケージマネージャー | pnpm / npm | npm | シングルパッケージではpnpmの利点が薄い。npxとの互換性を優先 |
| 2 | バンドラー | tsup / tsc / esbuild直接 | tsup | 宣言的設定、shebang挿入、dts生成を統合的に管理可能 |
| 3 | テストフレームワーク | Vitest / Jest | Vitest | ESMネイティブ対応、TypeScript設定不要、Viteエコシステムとの一貫性 |
| 4 | ロガー | pino / winston / console | pino | 最高性能のJSON構造化ロガー。stderrへの出力（MCPのstdioを汚染しない） |
| 5 | Docker GPU | パススルー / なし | 条件付き | LinuxではNVIDIA GPUパススルー。macOSではネイティブOllama推奨 |
| 6 | モノレポ | pnpm workspaces / 単体 | 単体 | MCPサーバー単体プロジェクト。モノレポの複雑さは不要 |
| 7 | DB（MVP） | SQLite / インメモリ | インメモリ | MVP時点ではセッション内の累計のみ。永続化はv0.2.0以降 |
| 8 | ESM/CJS | ESM / CJS / Dual | ESM only | Node.js 20はESMを安定サポート。CJS互換の複雑さを排除 |
