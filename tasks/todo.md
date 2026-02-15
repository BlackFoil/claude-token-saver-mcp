# claude-token-saver-mcp 実装タスクリスト

**Phase:** 4 — コーディング・相互レビュー
**作成日:** 2026-02-15
**管理者:** PM / Claude Code (Leader)

---

## 実装順序の方針

依存関係に基づくトポロジカルソート:
```
errors.ts → config/ → tiering/ → ollama/ → queue/ → validators/ → cost/ → tools/ → server.ts
```

セキュリティモジュール（validators/）は各モジュールと並行して実装可能。

---

## Sprint 1: 基盤レイヤー（依存なし）

### IMP-001: プロジェクト初期化
- **対象:** package.json, tsconfig.json, tsup.config.ts, vitest.config.ts, .eslintrc.cjs, .prettierrc
- **優先度:** P0
- **依存:** なし
- **受け入れ基準:** `npm install && npm run build` が成功する
- **参照:** infrastructure-design.md §1-4
- **担当ロール:** Coder 1 (PM)

### IMP-002: エラークラス階層の実装
- **対象:** `src/errors.ts`
- **優先度:** P0
- **依存:** IMP-001
- **受け入れ基準:** 全10エラークラス（CTS-1001〜CTS-6001）実装、`toMCPError()` メソッド動作
- **テストID:** E-01〜E-15
- **参照:** data-flow-design.md §3-4, detailed-specs-support.md §8
- **担当ロール:** Coder 2

### IMP-003: 設定スキーマ定義
- **対象:** `src/config/schema.ts`
- **優先度:** P0
- **依存:** IMP-001
- **受け入れ基準:** Zodスキーマで全設定項目のバリデーション、デフォルト値定義
- **テストID:** CF-01〜CF-09 (CS-01〜CS-05)
- **参照:** mcp-server-design.md §10, detailed-specs-support.md §5
- **担当ロール:** Coder 2

### IMP-004: 設定ローダー実装
- **対象:** `src/config/index.ts`
- **優先度:** P0
- **依存:** IMP-003
- **受け入れ基準:** 環境変数 > 設定ファイル > デフォルト値の3層統合、`~/.config/claude-token-saver/config.json` 読込
- **テストID:** CF-01〜CF-09
- **参照:** mcp-server-design.md §10, detailed-specs-support.md §4
- **担当ロール:** Coder 2

---

## Sprint 2: コアロジック

### IMP-005: ティアリング検出モジュール
- **対象:** `src/tiering/detector.ts`, `src/tiering/config.ts`
- **優先度:** P0
- **依存:** IMP-004
- **受け入れ基準:** RAM自動検出→Tier判定→モデル/コンテキスト上限選択、設定上書き対応、phi4-miniフォールバック
- **テストID:** T-01〜T-12
- **参照:** mcp-server-design.md §3, detailed-specs-core.md §5
- **担当ロール:** Architect

### IMP-006: Ollamaクライアント実装
- **対象:** `src/ollama/client.ts`
- **優先度:** P0
- **依存:** IMP-002, IMP-004
- **受け入れ基準:**
  - `chat()`: /api/chat (stream:true) NDJSONパース、ハートビート検出
  - `healthCheck()`: 5秒タイムアウト接続確認
  - `getVersion()`: バージョン検証 (≥0.1.34)
  - `listModels()`: モデル一覧取得
- **テストID:** OC-01〜OC-10
- **参照:** mcp-server-design.md §2, detailed-specs-core.md §4
- **担当ロール:** Coder 2

### IMP-007: モデルマネージャー実装
- **対象:** `src/ollama/model-manager.ts`
- **優先度:** P0
- **依存:** IMP-006
- **受け入れ基準:** モデル存在確認、`pullModel()` 進捗付きダウンロード、初回起動フロー
- **テストID:** OC-01〜OC-10 (統合)
- **参照:** mcp-server-design.md §9, detailed-specs-core.md §4
- **担当ロール:** Coder 2

### IMP-008: FIFOキュー実装
- **対象:** `src/queue/fifo-queue.ts`
- **優先度:** P0
- **依存:** IMP-002
- **受け入れ基準:**
  - Promise-basedキュー（同時実行数=1）
  - 最大キュー長10、超過時CTS-4001
  - レートリミット（10 req/min per agent）
  - リクエストサイズ上限
- **テストID:** Q-01〜Q-12
- **参照:** mcp-server-design.md §4, detailed-specs-core.md §6
- **担当ロール:** Coder 2

---

## Sprint 3: セキュリティ・バリデーション

### IMP-009: 入力バリデーター実装
- **対象:** `src/validators/input-validator.ts`
- **優先度:** P0
- **依存:** IMP-002, IMP-003
- **受け入れ基準:** offload_work / compress_context 入力のサイズ・型・必須フィールド検証
- **テストID:** V-01〜V-11
- **参照:** security-design.md §2, detailed-specs-support.md §6
- **担当ロール:** Security

### IMP-010: プロンプトインジェクション防御実装
- **対象:** `src/validators/prompt-guard.ts`
- **優先度:** P0
- **依存:** IMP-002
- **受け入れ基準:**
  - 20パターンのPI検出（block: 17, warn: 3）
  - 11パターンの機密情報マスキング（出力サニタイズ）
  - メタ命令パターン: "ignore all previous", "[SYSTEM]", "<<SYS>>" 等
- **テストID:** PI-01〜PI-11, SO-01〜SO-12
- **参照:** security-design.md §2, §7, detailed-specs-support.md §7
- **担当ロール:** Security

---

## Sprint 4: コスト計算・ツール実装

### IMP-011: 価格テーブル定義
- **対象:** `src/cost/pricing.ts`
- **優先度:** P1
- **依存:** IMP-004
- **受け入れ基準:** ハードコード価格（Sonnet 4.5: $3/$15, Opus 4: $15/$75, Haiku 4.5: $1/$5）、設定ファイル上書き
- **テストID:** P-01〜P-06
- **参照:** mcp-server-design.md §6, detailed-specs-support.md §2
- **担当ロール:** Coder 2

### IMP-012: コスト計算エンジン実装
- **対象:** `src/cost/calculator.ts`
- **優先度:** P1
- **依存:** IMP-011
- **受け入れ基準:** 節約額計算（InputTokens×Price_in + OutputTokens×Price_out）、累計管理、浮動小数点精度保証
- **テストID:** C-01〜C-08
- **参照:** mcp-server-design.md §6, detailed-specs-support.md §1
- **担当ロール:** Coder 2

### IMP-013: コストレポーター実装
- **対象:** `src/cost/reporter.ts`
- **優先度:** P1
- **依存:** IMP-012
- **受け入れ基準:** stderr出力フォーマット `[CTS Cost] tool | 今回: $X.XX | 累計: $X.XX | tokens: N→M`
- **テストID:** R-01〜R-03
- **参照:** data-flow-design.md §5, detailed-specs-support.md §3
- **担当ロール:** Coder 2

### IMP-014: offload_work ツール実装
- **対象:** `src/tools/offload-work.ts`, `src/tools/index.ts`
- **優先度:** P0
- **依存:** IMP-006, IMP-008, IMP-009, IMP-010, IMP-012, IMP-013
- **受け入れ基準:**
  - 入力バリデーション→PI検査→キュー投入→Ollama呼び出し→コスト計算→レスポンス構築
  - 12エラー条件のハンドリング
  - フォールバック（[FALLBACK_TO_CLOUD]）レスポンス
  - _meta付きレスポンス
- **テストID:** MT-01〜MT-06
- **参照:** mcp-server-design.md §1.1, detailed-specs-core.md §2
- **担当ロール:** Coder 1 (PM)

### IMP-015: compress_context ツール実装
- **対象:** `src/tools/compress-context.ts`
- **優先度:** P0
- **依存:** IMP-006, IMP-008, IMP-009, IMP-010, IMP-012, IMP-013
- **受け入れ基準:**
  - コンテキスト長チェック→切り詰め→PI検査→キュー投入→Ollama呼び出し→レスポンス構築
  - `estimateTokenCount()`: 英語/日本語ヒューリスティック
  - `truncateByTokens()`: 単語境界考慮の切り詰め
  - 切り詰め時の[WARNING]メッセージ付与
- **テストID:** MT-01〜MT-06
- **参照:** mcp-server-design.md §1.2, detailed-specs-core.md §3
- **担当ロール:** Coder 1 (PM)

---

## Sprint 5: サーバー統合・インフラ

### IMP-016: MCPサーバーエントリポイント実装
- **対象:** `src/server.ts`
- **優先度:** P0
- **依存:** IMP-005, IMP-007, IMP-014, IMP-015
- **受け入れ基準:**
  - `main()`: config読込→Tier判定→Ollamaヘルスチェック→モデル確認→MCP起動
  - `registerTools()`: offload_work / compress_context 登録
  - `handleShutdown()`: SIGTERM/SIGINTグレースフルシャットダウン
  - stdio transport 確立
- **テストID:** (統合テスト)
- **参照:** mcp-server-design.md §9, detailed-specs-core.md §1
- **担当ロール:** Coder 1 (PM)

### IMP-017: Docker Compose 環境構築
- **対象:** `docker/Dockerfile`, `docker/docker-compose.yml`
- **優先度:** P1
- **依存:** IMP-016
- **受け入れ基準:**
  - MCPサーバー + Ollama 2コンテナ構成
  - 内部ネットワーク隔離（`internal: true`）
  - non-rootユーザー実行
  - モデルボリューム永続化
- **参照:** infrastructure-design.md §5, security-design.md §3
- **担当ロール:** Architect

### IMP-018: CI/CD パイプライン構築
- **対象:** `.github/workflows/ci.yml`, `.github/workflows/publish.yml`
- **優先度:** P1
- **依存:** IMP-016
- **受け入れ基準:**
  - ci.yml: lint→typecheck→test→build→license-check
  - publish.yml: GitHubリリース→npm publish (provenance)
  - Ollama service containerでの統合テスト
- **参照:** infrastructure-design.md §6, test-strategy.md §6
- **担当ロール:** Architect

### IMP-019: ライセンス・ドキュメント整備
- **対象:** `LICENSE`, `NOTICE`, `README.md`, `.env.example`
- **優先度:** P2
- **依存:** IMP-016
- **受け入れ基準:** Apache 2.0 LICENSE、NOTICEファイル、README（インストール・使い方・設定）、環境変数テンプレート
- **参照:** infrastructure-design.md §9
- **担当ロール:** Coder 1 (PM)

---

## Sprint 6: テスト実装

### IMP-020: ユニットテスト実装
- **対象:** `tests/unit/`
- **優先度:** P0
- **依存:** IMP-002〜IMP-015
- **受け入れ基準:**
  - ティアリング: T-01〜T-12 (12件)
  - FIFOキュー: Q-01〜Q-12 (12件)
  - コスト計算: C-01〜C-08 (8件)
  - 入力バリデーション: V-01〜V-11 (11件)
  - タイムアウト: TO-01〜TO-10 (10件)
  - Ollamaクライアント: OC-01〜OC-10 (10件)
  - カバレッジ目標: 80%以上
- **参照:** test-strategy.md §2
- **担当ロール:** Tester

### IMP-021: セキュリティテスト実装
- **対象:** `tests/security/`
- **優先度:** P0
- **依存:** IMP-009, IMP-010
- **受け入れ基準:**
  - PIテスト（直接）: 12件
  - PIテスト（間接・誤検知回避）: 3件
  - カナリアテスト: 5件
  - DoSテスト: 5件
  - 出力サニタイズ: 4件
  - 計29件全パス
- **参照:** test-strategy.md §4
- **担当ロール:** Security

### IMP-022: 統合テスト実装
- **対象:** `tests/integration/`
- **優先度:** P1
- **依存:** IMP-016
- **受け入れ基準:**
  - Ollamaモック統合: 8件
  - MCP stdio統合: 6件
  - 実Ollama E2E: 5件
- **参照:** test-strategy.md §3
- **担当ロール:** Tester

---

## タスク依存関係図

```
IMP-001 (プロジェクト初期化)
├── IMP-002 (エラークラス)
│   ├── IMP-006 (Ollamaクライアント)
│   │   ├── IMP-007 (モデルマネージャー)
│   │   ├── IMP-014 (offload_work) ←── IMP-008, IMP-009, IMP-010, IMP-012, IMP-013
│   │   └── IMP-015 (compress_context) ←── IMP-008, IMP-009, IMP-010, IMP-012, IMP-013
│   ├── IMP-008 (FIFOキュー)
│   └── IMP-010 (PI防御)
├── IMP-003 (設定スキーマ)
│   ├── IMP-004 (設定ローダー)
│   │   ├── IMP-005 (ティアリング)
│   │   └── IMP-011 (価格テーブル)
│   │       └── IMP-012 (コスト計算)
│   │           └── IMP-013 (レポーター)
│   └── IMP-009 (入力バリデーター)
└── IMP-016 (サーバー統合) ←── IMP-005, IMP-007, IMP-014, IMP-015
    ├── IMP-017 (Docker)
    ├── IMP-018 (CI/CD)
    ├── IMP-019 (ドキュメント)
    ├── IMP-020 (ユニットテスト)
    ├── IMP-021 (セキュリティテスト)
    └── IMP-022 (統合テスト)
```

---

## サマリー

| Sprint | タスク数 | P0 | P1 | P2 |
|:---|:---:|:---:|:---:|:---:|
| Sprint 1: 基盤レイヤー | 4 | 4 | 0 | 0 |
| Sprint 2: コアロジック | 4 | 4 | 0 | 0 |
| Sprint 3: セキュリティ | 2 | 2 | 0 | 0 |
| Sprint 4: コスト・ツール | 5 | 2 | 3 | 0 |
| Sprint 5: サーバー統合 | 4 | 1 | 2 | 1 |
| Sprint 6: テスト | 3 | 2 | 1 | 0 |
| **合計** | **22** | **15** | **6** | **1** |

| 担当ロール | タスク数 |
|:---|:---:|
| Coder 1 (PM) | 5 |
| Coder 2 | 9 |
| Architect | 3 |
| Security | 3 |
| Tester | 2 |
