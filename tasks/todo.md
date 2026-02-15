# claude-token-saver-mcp 実装タスクリスト

**Phase:** 5 — テスト・検証 ✅ 完了
**作成日:** 2026-02-15
**管理者:** PM / Claude Code (Leader)

---

## 進捗サマリー

| Phase | ステータス | 完了日 |
|:---|:---:|:---:|
| Phase 1: 企画・調査 | ✅ | 2026-02-15 |
| Phase 2: 基本設計 | ✅ | 2026-02-15 |
| Phase 3: 詳細設計 | ✅ | 2026-02-15 |
| Phase 4: コーディング | ✅ | 2026-02-15 |
| Phase 5: テスト・検証 | ✅ | 2026-02-15 |

---

## テスト結果

| カテゴリ | テスト数 | ステータス |
|:---|:---:|:---:|
| ユニットテスト (tests/unit/) | 200 | ✅ 全パス |
| セキュリティテスト (tests/security/) | 65 | ✅ 全パス |
| 統合テスト (tests/integration/) | 12 | ✅ 全パス |
| **合計** | **277** | **✅ 全パス** |

### カバレッジ

| 指標 | 値 |
|:---|:---:|
| ステートメント | 97.19% |
| ブランチ | 88.82% |
| 関数 | 100% |

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
- [ ] IMP-018: CI/CD パイプライン構築 (`.github/workflows/`) — 次フェーズ
- [ ] IMP-019: ライセンス・ドキュメント整備 — 次フェーズ

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
| 4 | (未コミット) | セキュリティテスト65件 + 統合テスト12件 |

---

## 残タスク（次フェーズ以降）

| タスク | 優先度 | 備考 |
|:---|:---:|:---|
| IMP-018: CI/CD | P1 | GitHub Actions (lint→typecheck→test→build) |
| IMP-019: ドキュメント | P2 | README.md, LICENSE, NOTICE |
| E2Eテスト | P2 | 実Ollamaサーバーとの統合テスト (CI Ollama container) |
| client.tsタイムアウトテスト | P2 | AbortController + ReadableStreamの統合テスト |
