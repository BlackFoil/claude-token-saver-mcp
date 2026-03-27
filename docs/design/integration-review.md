# Phase 2 横断レビュー結果

**レビュー日:** 2026-02-15（初版） / 2026-03-16（v0.3.0更新）
**レビュー者:** PM / Claude Code (Leader)
**対象設計書:** 5件

---

## 1. レビュー対象

| # | 設計書 | 担当 | ファイル |
|:---:|:---|:---|:---|
| 1 | MCPサーバー基本設計 | Architect | `mcp-server-design.md` |
| 2 | インフラ・プロジェクト構造 | Infrastructure | `infrastructure-design.md` |
| 3 | セキュリティ実装設計 | Security | `security-design.md` |
| 4 | テスト戦略 | Tester | `test-strategy.md` |
| 5 | データフロー・エラー設計 | Coder | `data-flow-design.md` |

---

## 2. 整合性チェック結果

### 2.1 用語・命名の統一性

| チェック項目 | ステータス | 詳細 |
|:---|:---:|:---|
| エラーコードプレフィックス | **OK** | 全設計書で `CTS-XXXX` 形式を統一使用 |
| ツール名 | **OK** | `offload_work`, `compress_context` で統一 |
| Tier名称 | **OK** | Tier 1 (Light) / Tier 2 (Standard) / Tier 3 (Ultra) で統一 |
| モデル名 | **OK** | phi4:latest / qwen2.5-coder:7b / qwen2.5-coder:32b で統一 |
| キュー最大長 | **OK** | 全設計書で10件 |
| MCPレスポンス形式 | **OK** | `CallToolResult` の `content[]` + `isError` で統一 |
| プロジェクト名 | **P1修正** | 「claude-token-saver-mcp」と「claude-token-saver-mcp」が混在。設計書タイトルを統一する |

#### v0.3.0 追加コンポーネント名

| コンポーネント名 | ファイル | 説明 |
|:---|:---|:---|
| PriorityQueue | `src/queue/priority-queue.ts` | 優先度付きキュー |
| MetricsCollector | `src/metrics/collector.ts` | メトリクス収集 |
| PersistenceManager | `src/persistence/manager.ts` | 永続化管理 |
| RegistryUpdater | `src/model-selector/registry-updater.ts` | レジストリ自動更新 |
| OllamaLoadBalancer | `src/ollama/load-balancer.ts` | ロードバランサー |
| ToolLogContext | `src/logging/structured.ts` | 構造化ログコンテキスト |

### 2.2 エラーコード体系の一貫性

| カテゴリ | コード範囲 | mcp-server-design | data-flow-design | security-design |
|:---|:---|:---:|:---:|:---:|
| Ollama接続 | CTS-1xxx | OK | OK | OK |
| タイムアウト | CTS-2xxx | OK | OK | OK |
| モデル | CTS-3xxx | OK | OK | — |
| キュー | CTS-4xxx | OK | OK | OK |
| バリデーション | CTS-5xxx | OK | OK | OK |
| 設定 | CTS-6xxx | OK | OK | — |

**判定: OK** — エラーコード体系は3設計書間で完全に一致。

### 2.3 セキュリティ要件の反映状況

| Phase 1 セキュリティ要件 | mcp-server | infra | security | test | data-flow |
|:---|:---:|:---:|:---:|:---:|:---:|
| プロンプトインジェクション防御 | OK | — | OK | OK (29件) | OK |
| Ollama APIネットワーク隔離 | — | OK (Docker) | OK | — | — |
| FIFOキューDoS対策 | OK (max=10) | — | OK | OK (5件) | OK |
| System Promptバイパス防止 | OK | — | OK | OK (カナリア5件) | — |
| コスト計算データ整合性 | OK | — | OK | — | OK |
| 依存パッケージ監査 | — | OK (CI) | OK | — | — |
| Ollamaバージョン要件 | OK (≥0.1.29) | OK (Docker) | OK (≥0.1.34) | — | OK |

**P0修正: Ollamaバージョン要件の不一致**
- mcp-server-design: `≥ 0.1.29`
- security-design: `≥ 0.1.34`
- **解決:** security-designの `0.1.34` に統一する（より安全な方を採用）

### 2.4 テスト戦略によるモジュールカバレッジ

| モジュール | ユニットテスト | 統合テスト | セキュリティテスト |
|:---|:---:|:---:|:---:|
| ティアリング | OK (T-01〜T-12) | — | — |
| FIFOキュー | OK (Q-01〜Q-12) | OK | OK (DoS 5件) |
| コスト計算 | OK (C-01〜C-10) | — | — |
| 入力バリデーション | OK (V-01〜V-15) | — | OK (PI 15件) |
| Ollamaクライアント | OK (OC-01〜OC-10) | OK (モック8件) | — |
| MCPツール | OK (MT-01〜MT-06) | OK (stdio 6件) | — |
| System Prompt | OK (SP-01〜SP-04) | — | OK (カナリア5件) |
| 設定ファイル | OK (CF-01〜CF-06) | — | — |
| 出力サニタイズ | — | — | OK (4件) |

**判定: OK** — 全モジュールが少なくとも1テストレイヤーでカバー。

#### v0.3.0 テスト実績

| 指標 | 値 |
|:---|:---|
| 総テスト数 | 736 tests / 39 test files |
| ユニットテスト | ~603 tests |
| セキュリティテスト | 65 tests |
| 統合テスト | 19 tests |
| E2Eテスト | 13 tests（Ollama必須） |
| Statement coverage | 97.58% |
| Branch coverage | 93.8% |
| Function coverage | 100% |

### 2.5 インフラ設計とMCPサーバー設計の整合性

| チェック項目 | ステータス | 詳細 |
|:---|:---:|:---|
| ディレクトリ構造 ↔ モジュール | **OK** | infra設計のsrc/配下とmcp-server設計のモジュール分割が一致 |
| package.json依存 ↔ 使用ライブラリ | **OK** | pino, zod, @modelcontextprotocol/sdkが設計書間で一致 |
| ESM/NodeNext | **OK** | tsconfig, tsup, package.json全てESM前提 |
| Docker ↔ セキュリティ | **OK** | Docker内部ネットワーク隔離がinfra/security両設計書に記載 |
| CI/CD ↔ テスト | **OK** | GitHub ActionsでUnit+Integration(PR) + E2E(main)の実行フロー一致 |
| stderr出力 | **OK** | pinoロガー→stderr、MCPツール→stdout(stdio)で分離が全設計書で統一 |
| DB設計 | **OK** | MVP: インメモリ累計。v0.2.0以降でbetter-sqlite3追加（infra/mcp-server一致） |

### 2.6 v0.3.0 モジュール整合性

| インターフェース | ステータス | 詳細 |
|:---|:---:|:---|
| MetricsCollector ↔ server.ts | **OK** | ヘルスチェック時にメトリクス更新 ✅ |
| PersistenceManager ↔ server.ts | **OK** | 起動時loadAll、終了時saveAll、auto-save ✅ |
| RegistryUpdater ↔ registry.ts | **OK** | getAllRegisteredModelIds()で重複排除 ✅ |
| OllamaLoadBalancer ↔ OllamaClient | **OK** | 同一インターフェース（chat, healthCheck, listModels） ✅ |
| PriorityQueue ↔ FIFOQueue | **OK** | 同一エラー型（QueueFullError, RateLimitError） ✅ |
| batch_offload ↔ offload_work | **OK** | 同一ToolHandlerContext、同一バリデーション・PI検知 ✅ |
| auto_setup ↔ recommendModels + pullModel + preload | **OK** | 同一インターフェース ✅ |

### 2.7 v0.3.0 設定スキーマ整合性

| 設定セクション | ステータス | 詳細 |
|:---|:---:|:---|
| distributed | **OK** | Zod validated, nodes配列, strategy enum ✅ |
| persistence | **OK** | Zod validated, dataDir optional, autoSaveIntervalMs with min ✅ |
| registryUpdater | **OK** | Zod validated, updateIntervalMs with min ✅ |

### 2.8 Phase 1 決定事項の反映確認

| Phase 1 決定事項 | 反映先 | ステータス |
|:---|:---|:---:|
| Tier 1にphi4-miniフォールバック追加 | mcp-server-design §3, §8 | **OK** |
| タイムアウトをティア別動的設定に変更 | mcp-server-design §7, data-flow §1.3 | **OK** |
| 価格取得はハードコード＋設定ファイル方式 | mcp-server-design §6, §10 | **OK** |
| license-checker CI統合 | infrastructure-design §6, security-design §8 | **OK** |
| NOTICEファイル作成 | infrastructure-design §9 | **OK** |

**判定: OK** — Phase 1の全決定事項が設計書に反映済み。

---

## 3. 検出された不一致・課題

### P0（設計フェーズ内で修正必須）

| # | 内容 | 関連設計書 | 対応方針 |
|:---:|:---|:---|:---|
| P0-1 | Ollamaバージョン要件: mcp-server `≥0.1.29` vs security `≥0.1.34` | mcp-server, security | **`≥0.1.34`に統一**（security設計を優先、CVE対応の網羅性） |

### P1（Phase 3 開始前に修正推奨）

| # | 内容 | 関連設計書 | 対応方針 |
|:---:|:---|:---|:---|
| P1-1 | プロジェクト名の混在（「claude-token-saver-mcp」vs「claude-token-saver-mcp」） | security, test | npm パッケージ名は `claude-token-saver-mcp`、プロジェクトコードネームは `claude-token-saver-mcp` と明確に区別する |
| P1-2 | テスト設計のパス表記が `packages/mcp-server/src/` （モノレポ前提）になっている | test-strategy | シングルパッケージ構成（`src/`直下）に修正 |
| P1-3 | テスト設計のパッケージマネージャーが `pnpm` だがインフラ設計は `npm` | test-strategy, infrastructure | `npm` に統一 |

### P2（実装フェーズで対応可）

| # | 内容 | 関連設計書 | 対応方針 |
|:---:|:---|:---|:---|
| P2-1 | Ollamaクライアントの `/api/chat` vs `/api/generate` 使い分けがmcp-serverとdata-flowで若干異なる記述 | mcp-server, data-flow | mcp-server設計の「/api/chat統一」を正とする |

---

## 4. 総合判定

### 設計品質スコア

| 評価項目 | スコア | 備考 |
|:---|:---:|:---|
| 用語・命名の統一性 | **9/10** | P1-1のプロジェクト名混在のみ |
| エラーコード体系 | **10/10** | 完全一致 |
| セキュリティ要件の反映 | **9/10** | P0-1のバージョン不一致のみ |
| テストカバレッジ | **10/10** | 全モジュールをカバー |
| インフラ整合性 | **9/10** | P1-2, P1-3のパス・パッケージマネージャー差異 |
| Phase 1 決定事項の反映 | **10/10** | 全項目反映済み |
| **総合** | **9.5/10** | |

### 結論

**Phase 2（基本設計）の品質は十分であり、Phase 3（詳細設計・タスク化）への移行を承認する。**

P0-1（Ollamaバージョン統一）は即座に修正し、P1項目はPhase 3開始時に対応する。

---

## 5. Phase 2 成果物一覧

| # | ファイル | 行数 | 内容 |
|:---:|:---|:---:|:---|
| 1 | `docs/design/mcp-server-design.md` | ~1000 | MCPツール定義、Ollamaクライアント、ティアリング、キュー、コスト計算 |
| 2 | `docs/design/infrastructure-design.md` | ~1120 | ディレクトリ構造、package.json、Docker、CI/CD |
| 3 | `docs/design/security-design.md` | ~1000 | STRIDE脅威モデル、4層PI防御、DoS対策、35項目チェックリスト |
| 4 | `docs/design/test-strategy.md` | ~800 | 736テスト / 39ファイル（Unit ~603/Integration 19/Security 65/E2E 13） |
| 5 | `docs/design/data-flow-design.md` | ~985 | Mermaid図8枚、エラークラス階層、CTS-XXXXコード体系、ロギング設計 |
| 6 | `docs/design/integration-review.md` | — | 本横断レビュー結果 |

---

## 6. v0.3.0 統合ステータス

**更新日:** 2026-03-16

| チェック項目 | ステータス |
|:---|:---:|
| 新規11モジュール全てがserver.tsに統合済み | **OK** |
| 全736テストがパス | **OK** |
| lint / typecheck / build 全パス | **OK** |
| 既存テストに破壊的変更なし | **OK** |
