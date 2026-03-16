# claude-token-saver-mcp 実装タスクリスト

**現在のPhase:** v0.3.0 完了
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

### v0.3.0 P4-P6 全実装 — ✅ 完了 (2026-03-16)

#### P4: インフラ・公開準備 (4件)
- [x] P4-001: npm公開ワークフロー (`publish.yml`) — provenance付きnpm publish
- [x] P4-002: `.env.example` 更新 — v0.2.0環境変数を全追加
- [x] P4-003: `.npmrc` 作成 — registry, access, provenance設定
- [x] P4-004: `.prettierrc` 明示化 — `endOfLine: "lf"` 追加

#### P5: 運用・可観測性 (3件)
- [x] P5-001: Prometheusメトリクスエクスポート — `MetricsCollector` + `get_metrics` MCPツール (28テスト)
- [x] P5-002: ExecutionTracker / BenchmarkStore ファイル永続化 — `PersistenceManager` (自動保存5分間隔, 10テスト)
- [x] P5-003: 構造化ログ — `createToolLogContext`, `createRequestId` (8テスト)

#### P6: 機能拡張 (4件)
- [x] P6-001: バッチタスクサブミッション — `batch_offload` MCPツール (17テスト)
- [x] P6-002: 優先度付きキュー — `PriorityQueue` (URGENT/HIGH/NORMAL/LOW, 15テスト)
- [x] P6-003: モデルレジストリ自動更新 — `RegistryUpdater` (9パターン分類, 33テスト)
- [x] P6-004: 分散実行 (マルチノードOllama) — `OllamaLoadBalancer` (3戦略+フェイルオーバー, 18テスト)

### 現在の品質指標

| 指標 | 値 |
|:---|:---:|
| テスト合計 | 736 (unit: 603, security: 65, integration: 19, E2E: 13*) |
| テストファイル | 39 |
| MCPツール数 | 11 (offload_work, compress_context, cost_dashboard, batch_offload, get_metrics, auto_setup + recommend_model, preload_model, list_loaded_models, pull_model, configure_model_selector) |
| ビルド / lint / typecheck | ✅ 全パス |
| バージョン | v0.3.0 |

*E2E はOllama起動時のみ実行

### 新規ファイル一覧 (v0.3.0)

| ファイル | 内容 |
|:---|:---|
| `.github/workflows/publish.yml` | npm公開ワークフロー |
| `.npmrc` | npm設定 |
| `src/metrics/collector.ts` | Prometheusメトリクス収集 |
| `src/tools/get-metrics.ts` | メトリクスMCPツール |
| `src/tools/batch-offload.ts` | バッチオフロードツール |
| `src/persistence/manager.ts` | 永続化マネージャー |
| `src/logging/structured.ts` | 構造化ログヘルパー |
| `src/queue/priority-queue.ts` | 優先度付きキュー |
| `src/model-selector/registry-updater.ts` | レジストリ自動更新 |
| `src/ollama/load-balancer.ts` | マルチノードロードバランサー |

---

## 残タスク一覧

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

### P8: 公開準備・エコシステム露出

> **目的:** OSS公開に向けた最終仕上げとコミュニティへの露出

- [ ] P8-001: デモGIF撮影・README埋め込み
  - 内容: Claude Code で offload_work 実行 → コード生成 → cost_dashboard で節約額表示
  - 仕様: 800x450px, 15-20秒, asciinema or vhs で録画
  - README.md / README.en.md の TODO コメント箇所に埋め込み
  - **担当:** PM

- [ ] P8-002: SECURITY.md 作成
  - 脆弱性報告プロセスの定義 (GitHub Security Advisories 推奨)
  - サポート対象バージョンの明記
  - **担当:** PM

- [ ] P8-003: awesome-mcp-servers への登録
  - [wong2/awesome-mcp-servers](https://github.com/wong2/awesome-mcp-servers) (42k+ stars) へPR
  - [punkpeye/awesome-mcp-servers](https://github.com/punkpeye/awesome-mcp-servers) へPR
  - **担当:** PM
