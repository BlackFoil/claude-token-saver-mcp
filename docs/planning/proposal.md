# claude-token-saver-mcp 企画書

**プロジェクト名:** claude-token-saver-mcp (PulseAgent Token Saver)
**バージョン:** v2.0
**作成日:** 2026-02-15
**作成者:** PM / Claude Code (Leader)
**フェーズ:** Phase 1 — 企画・調査・ガバナンス

---

## 1. プロジェクト概要・ビジョン

### ビジョン
Claude Code Agent Teamsの運用コストを劇的に削減し、個人開発者から中小チームまでが持続可能にAIエージェント開発を行える環境を実現する。

### 概要
claude-token-saver-mcpは、Claude Code（Agent Teams）におけるクラウドAPI（Claude Sonnet/Opus等）のトークン消費を抑制するMCPサーバーである。「高コストな推論・意思決定はクラウド」「定型作業・長文要約・コード量産はローカル」という役割分担を、**シングルモデル・シングルキュー方式**で実現する。

### 主要な数値目標
- クラウドAPIトークン消費量の **30-50%削減**
- Agent Teams運用コストの **月額$50-100の節約**（5エージェント構成時）
- ローカルLLMの応答遅延 **60秒以内**（Tier 2基準）

---

## 2. 解決する課題

### 2.1 Agent Teamsのコスト問題
Claude Code Agent Teamsでは5エージェント構成で最低**5倍のトークン消費**が発生する。各エージェントが独立してクラウドAPIを呼び出すため、定型作業（コード生成、テスト作成、ドキュメント要約等）にも高額なクラウドAPIトークンが消費される。

### 2.2 既存の対策の限界
Claude Code組み込みの最適化機能（プロンプトキャッシング、Auto-compaction、Tool Search）は存在するが、**定型タスクのローカルオフロード**は提供されていない。

### 2.3 ターゲットとするペインポイント

| ペインポイント | 影響度 | 本ツールでの解決 |
|:---|:---:|:---|
| Agent Teamsの月額API費用が高い | 大 | 定型タスクをローカルLLMにオフロード |
| コスト可視化が困難 | 中 | リアルタイム節約額表示 |
| ローカルLLM活用のハードルが高い | 中 | 自動ティアリング＋ワンコマンドセットアップ |

---

## 3. 提案ソリューション

### 3.1 アーキテクチャ概要

```
┌─────────────────────────────────────────────────┐
│              Claude Code Agent Teams             │
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐  │
│  │Agent1│ │Agent2│ │Agent3│ │Agent4│ │Agent5│  │
│  └──┬───┘ └──┬───┘ └──┬───┘ └──┬───┘ └──┬───┘  │
│     └────────┴────────┴───┬────┴────────┘       │
│                           │ MCP (stdio)          │
├───────────────────────────┼─────────────────────┤
│     claude-token-saver-mcp│                      │
│  ┌────────────────────────▼──────────────────┐  │
│  │            FIFO Queue (max=1)              │  │
│  └────────────────────┬──────────────────────┘  │
│  ┌────────────────────▼──────────────────────┐  │
│  │         Tier Detection (RAM-based)         │  │
│  │  T1:<16GB │ T2:16-48GB │ T3:>48GB         │  │
│  └────────────────────┬──────────────────────┘  │
│  ┌────────────────────▼──────────────────────┐  │
│  │           Ollama API (localhost:11434)      │  │
│  │  phi4 │ qwen2.5-coder:7b │ qwen2.5-coder:32b│
│  └───────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────┐  │
│  │       Cost Calculator (stderr output)      │  │
│  └───────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
```

### 3.2 MCPツール定義

| ツール名 | 機能 | 入力 | 出力 |
|:---|:---|:---|:---|
| `offload_work` | 定型コード生成、テスト作成、リファクタリング | タスク記述＋コンテキスト | 生成結果＋節約額 |
| `compress_context` | 巨大ファイルの要約 | ファイル内容 | 要約テキスト＋節約額 |

### 3.3 モデルティアリング

| Tier | RAM条件 | モデル | コンテキスト上限 | 主な用途 |
|:---|:---|:---|:---|:---|
| Tier 1 (Light) | < 16GB | `phi4:latest` (14B) | 4,000 tokens | 短いコード補完、簡易要約 |
| Tier 2 (Standard) | 16-48GB | `qwen2.5-coder:7b` | 12,000 tokens | コード生成、テスト作成 |
| Tier 3 (Ultra) | > 48GB | `qwen2.5-coder:32b` | 32,000 tokens | 大規模リファクタリング、長文要約 |

### 3.4 コスト計算

$$Savings (\$) = (InputTokens_{local} \times Price_{cloud\_in}) + (OutputTokens_{local} \times Price_{cloud\_out})$$

各タスク終了時にstderrへ「今回の節約額 / 累計節約額」を出力。

---

## 4. 競合分析と差別化戦略

### 4.1 主要競合

| ツール | Stars | アプローチ | MCPサーバー | Agent Teams対応 |
|:---|:---:|:---|:---:|:---:|
| **LocalLama MCP** | ~41 | コーディングタスクのルーティング（Ollama/LM Studio/OpenRouter） | Yes | No |
| **TOON MCP** | 小規模 | JSON→TOON変換でトークン50-70%削減 | Yes | No |
| **RouteLLM** | 3,000+ | 学術的LLMルーター（Python SDK） | No | No |
| **LiteLLM** | 35,000+ | 100+ LLM統合ゲートウェイ | No | No |
| **rawveg/ollama-mcp** | ~47 | Ollamaの全機能MCP化 | Yes | No |

### 4.2 差別化ポイント

1. **Claude Code Agent Teams専用設計** — 既存ツールは汎用MCPクライアント向け。マルチエージェントワークフローに特化した最適化は存在しない
2. **タスクタイプ別ルーティング** — コーディングだけでなく、調査・テスト生成・ドキュメント作成・コードレビュー等の定型処理をオフロード
3. **ゼロコンフィグ自動ティアリング** — RAM量を自動検出し、最適モデルを選択。ユーザー設定不要
4. **MCP Native** — stdio transportでClaude Codeとシームレス統合。追加プロキシ層不要
5. **リアルタイムコスト可視化** — 節約額をタスクごとに即座にフィードバック

### 4.3 競合リスク
- LocalLama MCPがAgent Teams対応に拡張する可能性（現時点でCline/Roo Code中心）
- Claude Code自体のコスト最適化機能の進化（Tool Search等）
- クラウドLLM価格の継続的な低下（年間10倍ペース）による差別化縮小

---

## 5. ターゲットユーザー

### 5.1 プライマリターゲット
- **個人開発者** — Claude Code Agent Teamsを使用し、月額APIコストを$50-200支出しているユーザー
- **スタートアップ/小規模チーム** — AI開発ツールのコスト最適化を求めるチーム

### 5.2 セカンダリターゲット
- **OSS開発者** — MCPエコシステムに貢献し、ローカルLLM活用を推進するコミュニティ
- **教育・研究機関** — 限られた予算でLLM活用を学習する環境

### 5.3 ユーザーペルソナ

> **田中太郎（28歳）** — フリーランスのフルスタック開発者。Claude Code Agent Teamsで個人開発を行っているが、月額$150のAPI費用が負担。Apple Silicon Mac（M2, 16GB RAM）を使用。ローカルLLMに興味はあるが設定が面倒で導入していない。

---

## 6. 技術的実現性サマリー

### 6.1 検証結果

| # | 検証項目 | 判定 | 備考 |
|:---|:---|:---:|:---|
| 1 | Ollama API仕様 | **◎** | `/api/chat`, `/api/generate`で全要件充足 |
| 2 | モデル性能特性 | **◎** | Tier 1のphi4(14B)のRAM要件のみ要微調整 |
| 3 | FIFOキュー実装 | **○** | Promise-basedキューで実現可能 |
| 4 | Metal GPU自動検出 | **◎** | 自動検出＋`os` moduleでRAM判定も容易 |
| 5 | Anthropic価格取得 | **△** | 価格表APIなし。ハードコード＋設定ファイルで対応 |
| 6 | タイムアウト設計 | **○** | ティア別動的タイムアウト推奨 |

### 6.2 設計変更の提案

Architectの検証に基づき、以下の仕様変更を提案する。

| 項目 | 当初仕様 | 変更提案 | 理由 |
|:---|:---|:---|:---|
| Tier 1モデル | phi4 (14B) | phi4-mini (3.8B) をフォールバックに追加 | 14Bは16GB未満でギリギリ |
| 価格取得 | API自動フェッチ | ハードコード＋設定ファイル上書き | 価格表APIが存在しない |
| タイムアウト | 固定30秒/60秒 | ティア別動的タイムアウト | モデルサイズで応答時間が大きく異なる |
| ストリーミング | 未定義 | `stream: true`＋ハートビート検出 | 初回ロード遅延への対策 |

---

## 7. 特許・ガバナンス確認結果

### 7.1 総合判定
**プロジェクト続行に重大な法的障壁は確認されず。**

### 7.2 リスク一覧

| # | 調査項目 | リスク | 判定 |
|:---|:---|:---:|:---|
| 1 | LLMルーティング特許 | **中** | PulseAgentの「RAM量ベース静的Tiering」は既存特許と技術的に異なる |
| 2 | トークンコスト最適化特許 | **低** | 公知の手法の組合せ、特許侵害リスク極めて低い |
| 3 | MCPライセンス | **低** | MIT License、Linux Foundation傘下、商用制限なし |
| 4 | Ollama MITライセンス互換性 | **低** | MIT⇔Apache 2.0完全互換、API呼び出しのため派生物にも非該当 |
| 5 | Apache 2.0依存パッケージ競合 | **中** | npm間接依存のGPL-2.0混入リスク、CI自動監査で対応 |

### 7.3 P0アクション
- `license-checker`をCI/CDに組み込み、依存パッケージのライセンス自動監査
- NOTICEファイルを作成し、サードパーティライセンス表記を集約

---

## 8. セキュリティ要件

### 8.1 リスクサマリー

| # | リスク | レベル | OWASP LLM Top 10 |
|:---|:---|:---:|:---|
| 1 | プロンプトインジェクション | **High** | LLM01: Prompt Injection |
| 2 | Ollama APIネットワーク露出 | **High** | LLM06: Excessive Agency |
| 3 | FIFOキューDoS | **High** | LLM10: Unbounded Consumption |
| 4 | コスト計算データ改竄 | **Medium** | A08: Data Integrity Failures |
| 5 | System Promptバイパス | **Medium** | LLM01/LLM07 |

### 8.2 P0セキュリティ対策（設計フェーズで必須）

1. **Ollama APIネットワーク隔離** — Docker内部ネットワークでMCPサーバーコンテナからのみアクセス可能にする。`OLLAMA_HOST=127.0.0.1`固定
2. **FIFOキューのレートリミット** — キュー最大長（10件）、エージェント別レートリミット、リクエストサイズ上限
3. **プロンプトインジェクション多層防御** — 入力バリデーション（メタ命令パターン検出）、system/userロール厳格分離、出力サニタイズ
4. **System Prompt固定の強化** — Modelfileレベルでの`SYSTEM`設定、API経由の上書き防止、コンテキスト溢れ対策

### 8.3 既知の脆弱性への対応
- CVE-2024-28224（Ollama DNS Rebinding）→ Ollama v0.1.29以降を必須に
- CVE-2024-37032（Probllama RCE）→ 最新版Ollamaへの固定

---

## 9. スコープとマイルストーン

### 9.1 MVP（Minimum Viable Product）スコープ

**In Scope:**
- MCPサーバー（stdio transport）
- `offload_work` ツール（コード生成、テスト作成）
- `compress_context` ツール（ファイル要約）
- RAM自動検出＋モデルティアリング
- FIFOキュー（同時実行数=1）
- コスト計算＋stderr出力
- 初回起動時のモデル自動pull確認

**Out of Scope（v2.1以降）:**
- Web UI（ダッシュボード）
- 複数モデル同時ロード
- カスタムルーティングルール
- チーム別コスト分析
- SSE/WebSocketストリーミング

### 9.2 マイルストーン

| Phase | 内容 | 主要成果物 |
|:---|:---|:---|
| **Phase 1** (現在) | 企画・調査・ガバナンス | 本企画書、ガバナンスレポート |
| **Phase 2** | 基本設計・UI設計 | アーキテクチャ設計書、MCPツール仕様書 |
| **Phase 3** | 詳細設計・タスク化 | 実装タスクリスト、テスト設計書 |
| **Phase 4** | コーディング・レビュー | MCPサーバー実装、テストコード |
| **Phase 5** | テスト・検証 | テスト結果レポート、リリースビルド |

---

## 10. リスクと対策

| # | リスク | 影響度 | 発生確率 | 対策 |
|:---|:---|:---:|:---:|:---|
| 1 | ローカルLLMの品質不足 | 高 | 中 | Tier別品質テスト、フォールバックでクラウドへ戻す設計 |
| 2 | クラウドLLM価格の急激な低下 | 高 | 中 | ローカルLLMの品質優位性（プライバシー、レイテンシ）を訴求 |
| 3 | LocalLama MCPの機能拡張 | 中 | 中 | Agent Teams専用最適化で差別化維持 |
| 4 | Tier 1マシンでの性能不足 | 中 | 高 | phi4-miniフォールバック、CPU-onlyモード |
| 5 | Ollama APIの仕様変更 | 低 | 低 | APIバージョン固定、抽象化レイヤー |
| 6 | MCP仕様のブレーキングチェンジ | 低 | 低 | AAIF/Linux Foundation傘下で安定化の方向 |

---

## 付録A: キックオフミーティング議事録

**日時:** 2026-02-15
**参加者:** PM (Claude Code), Researcher, Governance, Architect, Security

### 議題と結論

1. **競合状況** — 直接競合はLocalLama MCP（Stars ~41）のみ。Agent Teams専用ツールは市場に存在しない。差別化機会は十分にある。

2. **法的リスク** — 重大な特許・ライセンスリスクなし。LLMルーティング特許の動向は半年毎に確認。npm依存のライセンス監査をCI/CDに組み込む。

3. **技術的実現性** — 6検証項目中4項目が◎、2項目が○、1項目が△。全項目が代替手段で対応可能。最大の課題はAnthropic価格表APIの不在（ハードコード＋設定ファイルで対応）。

4. **セキュリティ** — High 3件、Medium 2件。P0対策としてOllama APIのDocker隔離とFIFOキューのレートリミットを設計フェーズで実装。

### 決定事項
- **プロジェクト続行を承認**
- Phase 2（基本設計）に移行
- Tier 1モデルにphi4-miniフォールバックを追加
- タイムアウトをティア別動的設定に変更
- 価格取得はハードコード＋設定ファイル方式に変更

---

## 付録B: 参考資料

### 競合・類似サービス
- [LocalLama MCP](https://github.com/Heratiki/locallama-mcp)
- [TOON MCP Server](https://github.com/WithTOON/toon-mcp-server)
- [RouteLLM](https://github.com/lm-sys/RouteLLM)
- [LiteLLM](https://github.com/BerriAI/litellm)
- [rawveg/ollama-mcp](https://github.com/rawveg/ollama-mcp)

### セキュリティ
- [OWASP Top 10 for LLM Applications 2025](https://genai.owasp.org/resource/owasp-top-10-for-llm-applications-2025/)
- [CVE-2024-28224: Ollama DNS Rebinding](https://github.com/advisories/GHSA-5jx5-hqx5-2vrj)
- [CVE-2024-37032: Probllama RCE](https://www.wiz.io/blog/probllama-ollama-vulnerability-cve-2024-37032)

### 特許・ガバナンス
- [U.S. Patent #12,387,050](https://patents.justia.com/patent/12387050)
- [MCP - Agentic AI Foundation (Linux Foundation)](https://www.linuxfoundation.org/press/linux-foundation-announces-the-formation-of-the-agentic-ai-foundation)
