# claude-token-saver-mcp 実装タスクリスト

**現在のPhase:** v0.3.0 計画・タスク化
**作成日:** 2026-02-15
**最終更新:** 2026-03-16
**管理者:** PM / Claude Code (Leader)

---

## 完了済みサマリー

### v0.1.0 初期実装 — ✅ 完了 (2026-02-15)

MCPサーバーコア実装。Sprint 1-6 (IMP-001〜022)。
offload_work, compress_context, ティアリング, キュー, PI防御, コスト計算, Docker, CI。

### v0.2.0 動的モデルセレクター — ✅ 完了 (2026-02-19)

Sprint 7-13 (DMS-001〜033) + P1統合 + P3長期改善。
recommend_model, preload_model, list_loaded_models, pull_model, configure_model_selector, cost_dashboard。
ベンチマークDB, 実行トラッカー, 量子化選択, VRAM管理, CLAUDE.mdパーサー。

### v0.2.1 E2E・CI改善 — ✅ 完了 (2026-03-16)

E2Eテスト13件追加 (Ollama実サーバー統合 + 3層タイムアウト検証)。
CI改善 (format:check追加, カバレッジアーティファクト保存)。

### 現在の品質指標

| 指標 | 値 |
|:---|:---:|
| テスト合計 | 592 (unit: 490, security: 65, integration: 19, E2E: 13*) |
| ステートメントカバレッジ | 98.37% |
| ブランチカバレッジ | 95.35% |
| 関数カバレッジ | 100% |
| MCPツール数 | 8 |
| ビルド / lint / typecheck | ✅ 全パス |

*E2E はOllama起動時のみ実行

---

## 残タスク一覧

### P4: インフラ・公開準備

> **目的:** 設計書に定義済みだが未実装のインフラ整備と npm 公開ワークフロー

- [ ] P4-001: npm公開ワークフロー (`.github/workflows/publish.yml`)
  - GitHubリリース作成時に npm publish --provenance を自動実行
  - 設計書: `docs/design/infrastructure-design.md` §publish.yml
  - **担当:** PM

- [ ] P4-002: `.env.example` 作成
  - 全環境変数 (OLLAMA_BASE_URL, TIER_OVERRIDE, MODEL_OVERRIDE 等) のテンプレート
  - **担当:** PM

- [ ] P4-003: `.npmrc` 作成
  - npm公開設定 (registry, access=public)
  - **担当:** PM

- [ ] P4-004: `.eslintrc.cjs` / `.prettierrc` の明示的設定ファイル作成
  - 現在は暗黙のデフォルト設定に依存。明示化して再現性を確保
  - **担当:** PM

---

### P5: 運用・可観測性

> **目的:** 本番運用に必要なメトリクスエクスポートと監視機能

- [ ] P5-001: Prometheusメトリクスエクスポート
  - リクエスト数, レイテンシ, キュー長, コスト節約額をメトリクスとして公開
  - **担当:** Coder 2

- [ ] P5-002: ExecutionTracker / BenchmarkStore のファイル永続化接続
  - 現在はインメモリのみ。サーバー再起動時にデータを復元可能にする
  - **担当:** Coder 2

- [ ] P5-003: 構造化ログの拡充
  - tool_name, model, category, duration_ms, tokens をログフィールドに統一
  - **担当:** Coder 2

---

### P6: 機能拡張

> **目的:** ユーザー要望に基づく機能追加

- [ ] P6-001: バッチタスクサブミッション
  - 複数タスクを一括でキューに投入する `batch_offload` ツール
  - **担当:** Coder 2

- [ ] P6-002: 優先度付きキュー
  - エージェントロール別の優先度スケジューリング (PM > Coder > Tester)
  - 既存FIFOQueueの拡張
  - **担当:** Coder 2

- [ ] P6-003: モデルレジストリの自動更新
  - Ollama ライブラリから新規モデルを定期的にフェッチしてレジストリに反映
  - **担当:** Coder 2

- [ ] P6-004: 分散実行 (マルチノードOllama)
  - 複数のOllamaインスタンスへのロードバランシング
  - **担当:** Architect + Coder 2

---

### P7: Webダッシュボード (webapp)

> **目的:** CLAUDE.md §4.2 で設計済みのWebアプリケーション。コスト可視化とモデル管理のUI提供。
> **前提:** モノレポ化 (pnpm + Turborepo) が先行

- [ ] P7-001: モノレポ化
  - 現在の単一パッケージ → pnpm workspaces (`packages/mcp-server`, `packages/webapp`, `packages/shared`)
  - Turborepoによるビルドオーケストレーション
  - CI/CDの対応更新
  - **担当:** PM + Architect

- [ ] P7-002: shared パッケージ作成
  - MCP ↔ Webapp 共通の型定義 (TaskCategory, CostSummary, ModelRecommendation 等)
  - **担当:** PM

- [ ] P7-003: Webアプリ初期セットアップ
  - React 18 + Vite 6 + TypeScript 5 + Tailwind CSS 3 + Zustand 4
  - **担当:** PM + Architect

- [ ] P7-004: コストダッシュボードUI
  - cost_dashboard のデータをリアルタイム表示
  - SSE接続でMCPサーバーからイベント受信
  - **担当:** PM

- [ ] P7-005: モデル管理UI
  - インストール済みモデル一覧、プリロード/アンロード操作、推奨モデル表示
  - **担当:** PM

---

## 優先度マトリクス

| 優先度 | カテゴリ | タスク | 工数目安 | 依存 |
|:---:|:---|:---|:---:|:---:|
| **高** | P4 インフラ | P4-001 publish.yml | 小 | なし |
| **高** | P4 インフラ | P4-002 .env.example | 小 | なし |
| **高** | P4 インフラ | P4-003 .npmrc | 小 | なし |
| **中** | P4 インフラ | P4-004 lint/prettier設定 | 小 | なし |
| **中** | P5 運用 | P5-002 永続化接続 | 中 | なし |
| **中** | P5 運用 | P5-003 構造化ログ | 小 | なし |
| **低** | P5 運用 | P5-001 Prometheus | 大 | なし |
| **低** | P6 機能 | P6-001 バッチ | 中 | なし |
| **低** | P6 機能 | P6-002 優先度キュー | 中 | なし |
| **低** | P6 機能 | P6-003 レジストリ自動更新 | 中 | なし |
| **低** | P6 機能 | P6-004 分散実行 | 大 | なし |
| **将来** | P7 Web | P7-001〜005 | 特大 | P7-001 |
