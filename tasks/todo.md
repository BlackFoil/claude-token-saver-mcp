# claude-token-saver-mcp 実装タスクリスト

**現在のPhase:** 動的モデルセレクター Phase 1 (MVP)
**作成日:** 2026-02-15
**最終更新:** 2026-02-19 (Sprint 7-9 完了)
**管理者:** PM / Claude Code (Leader)
**設計書:** `docs/design/dynamic-model-selector-design.md`

---

## 進捗サマリー

### v0.1.0 初期実装（完了）

| Phase | ステータス | 完了日 |
|:---|:---:|:---:|
| Phase 1: 企画・調査 | ✅ | 2026-02-15 |
| Phase 2: 基本設計 | ✅ | 2026-02-15 |
| Phase 3: 詳細設計 | ✅ | 2026-02-15 |
| Phase 4: コーディング | ✅ | 2026-02-15 |
| Phase 5: テスト・検証 | ✅ | 2026-02-15 |
| Phase 6: 最終仕上げ | ✅ | 2026-02-15 |

### v0.2.0 動的モデルセレクター (DS-008)

| Phase | ステータス | 完了日 |
|:---|:---:|:---:|
| 設計・調査・ガバナンス | ✅ | 2026-02-19 |
| Phase 1: モデル推奨基盤 (MVP) | ✅ | 2026-02-19 |
| Phase 2: セッション固定 & プリロード | 🔲 | - |
| Phase 3: 自動pull & CLAUDE.md連携 | 🔲 | - |
| Phase 4: 高度な推奨 | 🔲 | - |

---

## テスト結果

| カテゴリ | テスト数 | ステータス |
|:---|:---:|:---:|
| ユニットテスト (tests/unit/) | 272 | ✅ 全パス |
| セキュリティテスト (tests/security/) | 65 | ✅ 全パス |
| 統合テスト (tests/integration/) | 12 | ✅ 全パス |
| **合計** | **349** | **✅ 全パス** |

### カバレッジ

| 指標 | 値 |
|:---|:---:|
| ステートメント | 97.19% |
| ブランチ | 88.82% |
| 関数 | 100% |

### 検証結果

| 項目 | ステータス |
|:---|:---:|
| ビルド (tsup) | ✅ 成功 |
| lint (ESLint) | ✅ 0エラー, 0警告 |
| 型チェック (tsc --noEmit) | ✅ 成功 |
| テスト (277件) | ✅ 全パス |

---

## Sprint 1: 基盤レイヤー — ✅ 完了

- [x] IMP-001: プロジェクト初期化
- [x] IMP-002: エラークラス階層の実装 (`src/errors.ts`)
- [x] IMP-003: 設定スキーマ定義 (`src/config/schema.ts`)
- [x] IMP-004: 設定ローダー実装 (`src/config/index.ts`)

## Sprint 2: コアロジック — ✅ 完了

- [x] IMP-005: ティアリング検出モジュール (`src/tiering/`)
- [x] IMP-006: Ollamaクライアント実装 (`src/ollama/client.ts`)
- [x] IMP-007: モデルマネージャー実装 (`src/ollama/model-manager.ts`)
- [x] IMP-008: FIFOキュー実装 (`src/queue/fifo-queue.ts`)

## Sprint 3: セキュリティ・バリデーション — ✅ 完了

- [x] IMP-009: 入力バリデーター実装 (`src/validators/input-validator.ts`)
- [x] IMP-010: プロンプトインジェクション防御実装 (`src/validators/prompt-guard.ts`)

## Sprint 4: コスト計算・ツール実装 — ✅ 完了

- [x] IMP-011: 価格テーブル定義 (`src/cost/pricing.ts`)
- [x] IMP-012: コスト計算エンジン実装 (`src/cost/calculator.ts`)
- [x] IMP-013: コストレポーター実装 (`src/cost/reporter.ts`)
- [x] IMP-014: offload_work ツール実装 (`src/tools/offload-work.ts`)
- [x] IMP-015: compress_context ツール実装 (`src/tools/compress-context.ts`)

## Sprint 5: サーバー統合・インフラ — ✅ 完了

- [x] IMP-016: MCPサーバーエントリポイント実装 (`src/server.ts`)
- [x] IMP-017: Docker Compose 環境構築 (`Dockerfile`, `docker-compose.yml`)
- [x] IMP-018: CI/CD パイプライン構築 (`.github/workflows/ci.yml`)
- [x] IMP-019: ライセンス・ドキュメント整備 (`LICENSE`, `NOTICE`, `docs/decisions.md`)

## Sprint 6: テスト実装 — ✅ 完了

- [x] IMP-020: ユニットテスト実装 (200テスト, 12ファイル)
- [x] IMP-021: セキュリティテスト実装 (65テスト, 3ファイル)
- [x] IMP-022: 統合テスト実装 (12テスト, 1ファイル)

---

## コミット履歴

| # | コミット | 内容 |
|:---:|:---|:---|
| 1 | `fd517b2` | Phase 4 初期実装 — 16モジュール, 90テスト |
| 2 | `1d627ff` | Phase 5 ユニットテスト — カバレッジ47%→95% |
| 3 | `e68924a` | カバレッジギャップ埋め — 95%→97.19% (200テスト) |
| 4 | `4d1aa1a` | セキュリティテスト65件 + 統合テスト12件 |
| 5 | (未コミット) | CI/CD, LICENSE, NOTICE, decisions.md, lint修正 |

---

# v0.2.0 動的モデルセレクター タスクリスト

**設計書:** `docs/design/dynamic-model-selector-design.md`
**意思決定:** DS-008 セッション固定方式 (`docs/decisions.md`)
**ガバナンス:** `docs/planning/governance-dynamic-model-selection.md`

---

## Sprint 7: Ollama API拡張 & 型定義 — ✅ 完了

> **目的:** 既存Ollamaクライアントを拡張し、モデル一覧・ロード状態・pullの各APIに対応する

- [x] DMS-001: TaskCategory / LicenseType 型定義 (`src/model-selector/types.ts`)
  - `TaskCategory`: 7カテゴリ (coding, coding-agent, japanese-text, japanese-coding, translation, summarization, general)
  - `LicenseType`: 6種別 (Apache-2.0, MIT, NVIDIA-Open, Meta-Community, PLaMo-Community, Other)
  - `ModelRecommendation` インターフェース（設計書§3.1準拠）
  - **担当:** Coder 2

- [x] DMS-002: Ollama `/api/tags` クライアント実装 (`src/ollama/client.ts` 拡張)
  - `listModels(): Promise<OllamaTagsResponse>` メソッド追加
  - インストール済みモデル名・サイズ・量子化情報の取得
  - エラーハンドリング（Ollama未接続時は `CTS-2001` エラー）
  - **担当:** Coder 2
  - **依存:** なし

- [x] DMS-003: Ollama `/api/ps` クライアント実装 (`src/ollama/client.ts` 拡張)
  - `listRunning(): Promise<OllamaPsResponse>` メソッド追加
  - 現在VRAMにロード中のモデル名・VRAM使用量・keep_alive情報の取得
  - **担当:** Coder 2
  - **依存:** なし

- [x] DMS-004: Ollama `/api/pull` クライアント実装 (`src/ollama/client.ts` 拡張)
  - `pullModel(model: string): Promise<OllamaPullResponse>` メソッド追加
  - NDJSONストリーミング対応（進捗パース）
  - タイムアウト: 10分（大型モデルのダウンロード考慮）
  - pull完了後のステータス返却（サイズ、所要時間）
  - **担当:** Coder 2
  - **依存:** なし

- [x] DMS-005: テスト — Ollama API拡張 (`tests/unit/ollama/`)
  - listModels / listRunning / pullModel の各ユニットテスト
  - Ollama未接続時のエラーハンドリングテスト
  - NDJSONストリーミングパーステスト
  - **担当:** Tester
  - **依存:** DMS-002, DMS-003, DMS-004

---

## Sprint 8: モデルレジストリ & 推奨エンジン — ✅ 完了

> **目的:** カテゴリ×Tier→推奨モデルの静的テーブルと、VRAM制約を考慮した推奨アルゴリズムを実装する

- [x] DMS-006: 推奨モデルテーブル定義 (`src/model-selector/registry.ts`)
  - 設計書§3.2〜§3.7の全マトリックスを静的JSONとして定義
  - カテゴリ: coding / coding-agent / japanese-text / translation / summarization / general
  - 各Tier (1/2/3) × カテゴリごとに優先順位付きモデルリスト
  - ベンチマークスコア (HumanEval, SWE-Bench, MT-Bench) を含む
  - ライセンス情報を全モデルに付与
  - **担当:** Coder 2

- [x] DMS-007: VRAM同時ロード上限の自動判定 (`src/model-selector/vram-calculator.ts`)
  - RAM → 推定VRAM変換ロジック（Apple Silicon統合メモリ / discrete GPU）
  - 同時ロード可能モデル数の算出（設計書§5.4テーブル準拠）
  - 環境変数 `MAX_SIMULTANEOUS_MODELS` でオーバーライド可能
  - **担当:** Coder 2
  - **依存:** 既存 `src/tiering/detector.ts` のRAM検出を利用

- [x] DMS-008: 推奨アルゴリズム実装 (`src/model-selector/recommender.ts`)
  - 入力: category, preferQuality, tier, installedModels
  - 設計書§5.3のアルゴリズム準拠:
    1. (category, tier) → 推奨テーブル照合
    2. preferQuality による並び替え（品質優先 vs 速度優先）
    3. インストール済み ✅ / 未インストール 📥 の分類
    4. ✅ を先頭、📥 を後尾にソート
    5. ライセンス情報付与
    6. 上位4件返却
  - ブロックリストフィルタ（Codestral等のMNPLモデル除外）
  - ライセンスフィルタ（Apache-2.0 / MIT / NVIDIA-Open のみデフォルト）
  - VRAM同時ロード制約チェック（1モデルのみ可の場合は `general` にフォールバック）
  - **担当:** Coder 2
  - **依存:** DMS-006, DMS-007

- [x] DMS-009: テスト — レジストリ & 推奨エンジン (`tests/unit/model-selector/`)
  - 全カテゴリ×全Tierの推奨結果テスト
  - preferQuality=true/false の並び替え検証
  - インストール済み/未インストールの分類テスト
  - ブロックリスト・ライセンスフィルタの動作テスト
  - VRAM制約による `general` フォールバックテスト
  - VRAM計算の境界値テスト
  - **担当:** Tester
  - **依存:** DMS-006, DMS-007, DMS-008

---

## Sprint 9: MCPツール — recommend_model — ✅ 完了

> **目的:** `recommend_model` MCPツールを実装し、ユーザーにモデル推奨を提供する

- [x] DMS-010: `recommend_model` ツール実装 (`src/tools/recommend-model.ts`)
  - inputSchema: `{ category: TaskCategory, prefer_quality?: boolean }` (設計書§4.1)
  - 処理フロー:
    1. Ollama `/api/tags` でインストール済みモデル取得 (DMS-002)
    2. Ollama `/api/ps` でロード中モデル取得 (DMS-003)
    3. RAM検出 + Tier判定（既存tiering利用）
    4. 推奨アルゴリズム実行 (DMS-008)
    5. ライセンス情報付きのMarkdownレスポンス生成
  - レスポンス形式: 設計書§4.1のレスポンス例準拠
  - エラー: ModelSelectorDisabled時は `CTS-1001` エラー
  - **担当:** Coder 1 (PM)
  - **依存:** DMS-002, DMS-003, DMS-008

- [x] DMS-011: `recommend_model` をMCPサーバーに登録 (`src/server.ts` 拡張)
  - ツール定義 (name, description, inputSchema) の追加
  - ハンドラーのルーティング追加
  - `modelSelector.enabled` が false の場合はツール非公開
  - **担当:** Coder 1 (PM)
  - **依存:** DMS-010

- [x] DMS-012: 設定スキーマ拡張 (`src/config/schema.ts` 拡張)
  - `modelSelector` セクション追加（設計書§8.1準拠）:
    - `enabled`, `preferQuality`, `preloadKeepAlive`, `maxSimultaneousModels`
    - `customRecommendations`, `blockedModels`, `licenseFilter`
  - 環境変数マッピング: `MODEL_SELECTOR_ENABLED`, `MODEL_PREFER_QUALITY`, `PRELOAD_KEEP_ALIVE`, `MAX_SIMULTANEOUS_MODELS`
  - 既存設定ローダー (`src/config/index.ts`) への統合
  - **担当:** Coder 1 (PM)
  - **依存:** なし

- [x] DMS-013: テスト — recommend_model (`tests/unit/tools/`, `tests/integration/`)
  - recommend_model ツールのユニットテスト（各カテゴリ、各Tier）
  - Ollama未接続時のフォールバックテスト
  - config無効時のツール非公開テスト
  - 統合テスト: MCP JSON-RPC経由での recommend_model 呼び出し
  - **担当:** Tester
  - **依存:** DMS-010, DMS-011, DMS-012

---

## Sprint 10: セッション固定 & プリロード — 🔲 未着手

> **目的:** `preload_model`, `list_loaded_models` ツールと、`offload_work`/`compress_context` の `model` パラメータ対応

- [ ] DMS-014: `preload_model` ツール実装 (`src/tools/preload-model.ts`)
  - inputSchema: `{ model: string, keep_alive?: string }` (設計書§4.4)
  - 処理: Ollama `/api/chat` に空プロンプト + `keep_alive` 送信
  - `/api/ps` でロード確認、VRAM使用量をレスポンスに含める
  - VRAM同時ロード制約チェック（上限超過時はエラー）
  - モデル未インストール時は `CTS-2002` エラー
  - **担当:** Coder 2
  - **依存:** DMS-003, DMS-007

- [ ] DMS-015: `list_loaded_models` ツール実装 (`src/tools/list-loaded-models.ts`)
  - inputSchema: `{}` (設計書§4.5)
  - Ollama `/api/ps` からロード中モデル取得
  - Markdown テーブル形式でVRAM使用量・ロード時間・keep_alive情報を返却
  - **担当:** Coder 2
  - **依存:** DMS-003

- [ ] DMS-016: `offload_work` に `model` / `category` パラメータ追加 (`src/tools/offload-work.ts` 拡張)
  - inputSchema拡張: `model?: string`, `category?: TaskCategory` (設計書§4.2)
  - `model` 指定時: そのモデルでOllamaリクエスト送信
  - `model` 未指定 + `category` 指定: 推奨エンジンで最適モデル自動選択
  - 両方未指定: 既存動作（Tier自動検出モデル）を維持
  - 既存の全テストが引き続きパスすること（後方互換性）
  - **担当:** Coder 1 (PM)
  - **依存:** DMS-008

- [ ] DMS-017: `compress_context` に `model` パラメータ追加 (`src/tools/compress-context.ts` 拡張)
  - inputSchema拡張: `model?: string` (設計書§4.3)
  - `model` 指定時: そのモデルでOllamaリクエスト送信
  - 未指定時: 既存動作を維持
  - **担当:** Coder 1 (PM)
  - **依存:** なし

- [ ] DMS-018: `preload_model`, `list_loaded_models` をMCPサーバーに登録 (`src/server.ts`)
  - ツール定義 + ハンドラーのルーティング追加
  - **担当:** Coder 1 (PM)
  - **依存:** DMS-014, DMS-015

- [ ] DMS-019: テスト — セッション固定 & プリロード (`tests/unit/`, `tests/integration/`)
  - preload_model: 正常系、VRAM超過エラー、未インストールエラー
  - list_loaded_models: 正常系、モデル未ロード時
  - offload_work: model指定、category指定、両方未指定（後方互換性）
  - compress_context: model指定、未指定（後方互換性）
  - 統合テスト: preload → offload_work のパイプライン
  - **担当:** Tester
  - **依存:** DMS-014〜DMS-018

---

## Sprint 11: 自動pull & CLAUDE.md連携 — 🔲 未着手

> **目的:** 未インストールモデルの自動pull機能と、CLAUDE.md `LLM用途` 列の参考パーサーを実装

- [ ] DMS-020: `pull_model` ツール実装 (`src/tools/pull-model.ts`)
  - inputSchema: `{ model: string }` (設計書§7.1)
  - Ollama `/api/pull` NDJSONストリーミング呼び出し (DMS-004)
  - pull完了後のステータス返却（モデルサイズ、所要時間）
  - タイムアウト: 10分
  - 既にインストール済みの場合はスキップ（"already up to date"）
  - **担当:** Coder 2
  - **依存:** DMS-004

- [ ] DMS-021: `pull_model` をMCPサーバーに登録 (`src/server.ts`)
  - ツール定義 + ハンドラーのルーティング追加
  - **担当:** Coder 1 (PM)
  - **依存:** DMS-020

- [ ] DMS-022: CLAUDE.md `LLM用途` 列パーサー（参考実装） (`src/model-selector/claude-md-parser.ts`)
  - Markdownテーブルから `LLM用途` 列を抽出するユーティリティ
  - Claude Code側での使用を想定した参考実装
  - 抽出結果: `Array<{ role: string, category: TaskCategory }>`
  - パース失敗時は空配列を返却（エラーにしない）
  - **担当:** Coder 2
  - **依存:** DMS-001

- [ ] DMS-023: テスト — pull_model & CLAUDE.mdパーサー
  - pull_model: 正常系、タイムアウト、既インストール済みスキップ
  - CLAUDE.mdパーサー: 正常テーブル、LLM用途列なし、不正Markdown
  - **担当:** Tester
  - **依存:** DMS-020, DMS-022

---

## Sprint 12: 品質保証 & ドキュメント — 🔲 未着手

> **目的:** 全機能の統合テスト、手動テスト手順の更新、READMEの更新

- [ ] DMS-024: 全体統合テスト (`tests/integration/model-selector.test.ts`)
  - Agent Team起動シーケンスの模擬テスト:
    1. recommend_model → 2. pull_model → 3. preload_model → 4. offload_work(model=xxx)
  - VRAM制約によるフォールバックシナリオ
  - 既存277テストの回帰テスト確認
  - **担当:** Tester
  - **依存:** DMS-019, DMS-023

- [ ] DMS-025: 手動テスト手順更新 (`docs/manual-test-ollama.md` 拡張)
  - recommend_model 手動テスト手順
  - preload_model / list_loaded_models 手動テスト手順
  - pull_model 手動テスト手順
  - offload_work + model指定の手動テスト手順
  - **担当:** Coder 1 (PM)
  - **依存:** DMS-024

- [ ] DMS-026: README.md 更新
  - 新ツール4種（recommend_model, preload_model, list_loaded_models, pull_model）の使い方
  - 環境変数・設定ファイルの更新
  - Agent Team連携のセットアップ例
  - **担当:** Coder 1 (PM)
  - **依存:** DMS-024

- [ ] DMS-027: CLAUDE.md 更新（プロジェクト用）
  - ロールテーブルに `LLM用途` 列を追加
  - 設計書一覧にdynamic-model-selector-design.mdを追加
  - **担当:** Coder 1 (PM)
  - **依存:** なし

---

## Sprint 13: 高度な推奨（P2 / 将来） — 🔲 未着手

> **目的:** 推奨精度の向上とカスタマイズ性の拡充。MVP完了後に着手。

- [ ] DMS-028: ベンチマークデータベース（定期更新機構）
- [ ] DMS-029: 実行履歴に基づく推奨精度向上
- [ ] DMS-030: カスタム推奨テーブルの設定対応
- [ ] DMS-031: 量子化バリアント自動選択
- [ ] DMS-032: ブロックリスト・ライセンスフィルタの設定UI

---

## 依存関係グラフ

```
Sprint 7 (Ollama API)          Sprint 8 (レジストリ)
  DMS-001 (型定義)               DMS-006 (テーブル) ─┐
  DMS-002 (tags) ──────┐        DMS-007 (VRAM) ────┤
  DMS-003 (ps) ────────┤        DMS-008 (推奨) ←───┘
  DMS-004 (pull) ──────┤            │
  DMS-005 (テスト) ←───┘            │
                                DMS-009 (テスト) ←─ DMS-006,007,008
        │                          │
        ▼                          ▼
Sprint 9 (recommend_model)     Sprint 10 (セッション固定)
  DMS-010 ←── DMS-002,003,008   DMS-014 (preload) ←── DMS-003,007
  DMS-011 ←── DMS-010           DMS-015 (list) ←── DMS-003
  DMS-012 (設定)                 DMS-016 (offload拡張) ←── DMS-008
  DMS-013 (テスト)               DMS-017 (compress拡張)
                                 DMS-018 (サーバー登録) ←── DMS-014,015
        │                        DMS-019 (テスト)
        ▼                          │
Sprint 11 (pull & CLAUDE.md)       │
  DMS-020 (pull_model) ←── DMS-004│
  DMS-021 (サーバー登録)            │
  DMS-022 (CLAUDE.mdパーサー)      │
  DMS-023 (テスト)                 │
        │                          │
        ▼                          ▼
Sprint 12 (品質保証)
  DMS-024 (統合テスト) ←── DMS-019, DMS-023
  DMS-025 (手動テスト手順)
  DMS-026 (README更新)
  DMS-027 (CLAUDE.md更新)
```

---

## v0.1.0 初期実装（完了済み・アーカイブ）

> 以下は v0.1.0 で完了した初期実装タスク。参照用に保持。

---

## 今後の改善タスク（P2以降）

| タスク | 優先度 | 備考 |
|:---|:---:|:---|
| E2Eテスト | P2 | 実Ollamaサーバーとの統合テスト (CI Ollama container) |
| client.tsタイムアウトテスト | P2 | AbortController + ReadableStreamの統合テスト |
