# ガバナンス調査報告: 動的ローカルLLM推奨・選択機能

**調査日:** 2026-02-19
**調査担当:** Governance Agent
**対象機能:** 実行時にPCスペック・タスク用途に応じてローカルLLMを動的に推奨・選択する機能

---

## 1. 特許リスク分析

### 1.1 最も関連性の高い特許

#### WO2025159854A1 / US20250362963 — リスクレベル: **中**
- **タイトル:** "Dynamically Selecting Artificial Intelligence Models and Hardware Environments to Execute Tasks"
- **出願人:** **Dropbox Inc.**
- **発明者:** Ashok Pancily Poothiyot, Ali Zafar, Anthony Penta 他
- **出願日:** 2024-01-22 (仮出願), 2024-12-12 (PCT出願)
- **公開日:** 2025-11-27
- **概要:** タスクのワークロード特徴とタスクルーティングメトリクスに基づいて、複数のMLモデルから最適なモデルを動的に選択し、ハードウェア環境（ローカル/サードパーティ）も同時に選択するシステム。フォールバックモデルの自動割り当て機能を含む。

**claude-token-saver-mcpとの差分分析:**
| 観点 | Dropbox特許 | claude-token-saver-mcp構想 |
|:---|:---|:---|
| 対象 | クラウド/エンタープライズ向けMLタスク | ローカルPC上のLLM推奨 |
| 選択基準 | ワークロード特徴 + ルーティングメトリクス | PCスペック + タスク用途 |
| ハードウェア | GPU/CPUクラスタの動的割り当て | 単一PCのスペック検出 |
| モデル管理 | プラットフォーム管理のMLモデル群 | Ollama等で管理されるローカルLLM |
| フォールバック | サーバー障害時の冗長性 | 対象外（推奨のみ） |

**評価:** claude-token-saver-mcpの機能は「ローカルPCでの推奨UI」であり、Dropbox特許の「分散タスクルーティングプラットフォーム」とは技術的アプローチが大きく異なる。ただし、「タスク特徴に基づくモデル選択」という上位概念では重なりがある。**直接的な侵害リスクは低い**が、注視が必要。

#### US20210264025A1 — リスクレベル: **低**
- **タイトル:** "Dynamic Machine Learning Model Selection"
- **概要:** 受信ログの分類に基づいてMLモデルを選択するシステム
- **評価:** ログ分類に特化しており、LLM推奨機能との関連性は低い

#### US20240112068A1 — リスクレベル: **低**
- **タイトル:** "Runtime Control of AI Model Parameters in a Heterogeneous Computing Platform"
- **概要:** 異種コンピューティングプラットフォームでのAIモデルパラメータのランタイム制御
- **評価:** パラメータ制御に焦点であり、モデル推奨とは異なる

### 1.2 特許リスク総合評価: **低〜中**

**根拠:**
1. claude-token-saver-mcpの機能は「推奨」であり、自動実行ルーティングではない
2. ローカルPC上のスペック検出 + ユーザー向け推奨UIという組み合わせは、既存特許のクレーム範囲外と判断
3. ただし、AI特許は急速に増加中（2024年に33,234件）であり、未公開出願のリスクは残存
4. 「タスク特徴に基づく動的モデル選択」は広範なクレームとなる可能性があるため、設計時に以下の差別化を意識すべき:
   - **推奨のみ（自動選択ではない）** — ユーザーが最終判断
   - **ローカルハードウェア検出に特化** — クラスタ/クラウド環境は対象外
   - **オープンソースエコシステムとの統合** — Ollamaのモデルリストに基づく推奨

---

## 2. 類似サービス・先行技術

### 2.1 既存サービス比較

| サービス | ハードウェア検出 | モデル推奨 | 動的選択 | ライセンス |
|:---|:---:|:---:|:---:|:---|
| **LM Studio** | ○ (自動) | ○ (互換モデル推奨) | ○ (GPU/CPU自動分配) | プロプライエタリ |
| **GPT4All** | ○ (GPU自動検出) | △ (RAM要件表示) | × | MIT |
| **Jan.ai** | △ (手動設定) | × | × | AGPLv3 |
| **Ollama** | ○ (GPU自動検出) | × | × | MIT |
| **LLM Speed Check** | ○ (CPU/RAM/GPU) | ○ (ベンチマーク比較) | × | OSS |
| **llmfit** | ○ | ○ (ハードウェア適合推奨) | ○ (auto-configure) | OSS |
| **lmstudio-config-wizard** | ○ (システム分析) | ○ (最適設定提案) | × | OSS |

### 2.2 先行技術としての意義 — リスクレベル: **低**

LM Studio、GPT4All、llmfit等が既にハードウェア検出 + モデル推奨機能を実装しており、**十分な先行技術（prior art）が存在**する。これはclaude-token-saver-mcpにとって有利な要素:
- 他社が特許を取得しても、先行技術により無効化できる可能性が高い
- claude-token-saver-mcpが同様の機能を実装しても、先行技術の範囲内と主張できる

### 2.3 MCP関連の先行実装

| プロジェクト | 概要 |
|:---|:---|
| **mcp-client-for-ollama** | Ollama用MCPクライアント、モデルスイッチング機能搭載 |
| **ollama-mcp-bridge** | Ollama APIをMCPツールで拡張するブリッジ |
| **ollama-mcp** | Ollama SDKをMCPツールとして公開するサーバー |
| **MCP CLI (chuk-llm)** | 動的モデル発見、能力ベース選択機能 |

**評価:** MCPエコシステムでのOllama統合は活発だが、「PCスペックに基づくモデル推奨」をMCPツールとして実装した前例は確認されなかった。**claude-token-saver-mcpの差別化ポイントになりうる。**

---

## 3. ローカルLLMの商用利用ライセンス制約

### 3.1 ライセンス一覧

| モデル | ライセンス | 商用利用 | 制限事項 | リスク |
|:---|:---|:---:|:---|:---:|
| **Qwen2.5** (7B/14B/32B等) | Apache 2.0 | ○ | なし | **低** |
| **Qwen2.5-Max** | 非公開 | × | ウェイト非公開 | N/A |
| **DeepSeek-R1** | MIT | ○ | なし。蒸留・商用利用を明示的に許可 | **低** |
| **DeepSeek-V3/V3.1** | MIT | ○ | なし | **低** |
| **Llama 3/3.1/3.3** | Meta Community License | △ | MAU 7億以上で要個別ライセンス、他のLLM学習への使用禁止 | **中** |
| **NVIDIA Nemotron** | NVIDIA Open Model License | ○ | 帰属表示不要、商用・派生自由 | **低** |
| **Nemotron 3 Nano** | NVIDIA Open Model License | ○ | 同上 | **低** |
| **ELYZA (Llama 3ベース)** | Meta Llama 3 License 準拠 | △ | Llama 3のライセンス制限を継承 | **中** |
| **ELYZA (Qwen 32Bベース)** | 要確認 | 要確認 | 最新モデル(ELYZA-Shortcut-1.0-Qwen-32B)は要ライセンス確認 | **中** |
| **Swallow (Llama 2ベース)** | Llama 2 Community License | △ | MAU 7億以上で要個別ライセンス | **中** |
| **Swallow (Llama 3ベース)** | Meta Llama 3 License | △ | Llama 3のライセンス制限を継承 | **中** |
| **TinySwallow-1.5B** | Apache 2.0 | ○ (研究目的のみの可能性) | 要詳細確認 | **低〜中** |

### 3.2 ライセンスリスクへの対応方針

**claude-token-saver-mcpが推奨機能で考慮すべき事項:**

1. **推奨時のライセンス情報表示を必須とする**
   - ユーザーにモデル推奨時、ライセンス種別と商用利用条件を明示
   - 特にMeta Community Licenseモデルは制限事項を表示

2. **claude-token-saver-mcp自体のライセンスリスク:** **低**
   - claude-token-saver-mcpはモデルを再配布しない（推奨のみ）
   - Ollamaが管理するモデルを参照するだけ
   - Apache 2.0ライセンスのclaude-token-saver-mcp自体と、推奨するモデルのライセンスは独立

3. **安全な推奨対象 (Apache 2.0 / MIT):**
   - Qwen2.5シリーズ、DeepSeekシリーズ、NVIDIA Nemotronシリーズ

---

## 4. MCP仕様上の前例

### 4.1 MCPプロトコルでのモデル選択パターン — リスクレベル: **低**

**調査結果:**
- MCPプロトコル仕様では、サーバーが「モデル選好（model preferences）」「システムプロンプト」「温度設定」「トークン制限」などの推論パラメータをリクエストできる仕組みが存在する
- ただし、クライアント側が最終的な権限を持ち、不正なリクエストを拒否できる設計
- ツールパラメータとしてモデル選択を含めるパターンは、`inputSchema`のJSON Schemaで定義可能

**前例となるMCPプロジェクト:**
- `ollama-mcp`: Ollama SDKの全機能をMCPツールとして公開（モデルリスト取得含む）
- `mcp-client-for-ollama`: 動的モデルスイッチング機能
- `MCP CLI (chuk-llm)`: 動的モデル発見 + 能力ベース選択

**評価:** MCPプロトコルの設計思想は「ツールが機能を公開し、LLMが判断する」であるため、モデル推奨ツールは自然なユースケース。仕様上の制約はない。

---

## 5. 総合リスク評価サマリ

| カテゴリ | リスクレベル | 詳細 |
|:---|:---:|:---|
| **特許侵害** | **低〜中** | Dropbox特許(WO2025159854A1)が最も関連するが、技術的アプローチの差異が大きい。先行技術も豊富 |
| **類似サービス競合** | **低** | LM Studio等が先行だが、MCP統合での推奨機能は差別化可能 |
| **ライセンス制約** | **低** | 推奨するだけで再配布しないため、直接的なライセンスリスクは最小 |
| **MCP仕様適合** | **低** | 前例あり。仕様上の障害なし |

### 推奨アクション

1. **設計原則として「推奨」に留め、「自動選択・自動実行」は避ける** — 特許リスク軽減
2. **ユーザーの最終判断を必ず介在させるUI設計** — 特許クレーム回避
3. **推奨UIにライセンス情報を常に表示** — コンプライアンス確保
4. **先行技術ログを保持** — 万一の紛争時の防御資料（本文書が該当）
5. **Apache 2.0 / MITモデルをデフォルト推奨** — ライセンスリスク最小化

---

## 参考リンク

### 特許関連
- [WO2025159854A1 - Dropbox Patent (Google Patents)](https://patents.google.com/patent/WO2025159854A1/en)
- [US20250362963 (Justia)](https://patents.justia.com/patent/20250362963)
- [US20210264025A1 - Dynamic ML Model Selection](https://patents.google.com/patent/US20210264025A1/en)
- [US20240112068A1 - Runtime AI Control](https://patents.google.com/patent/US20240112068A1/en)

### LLMルーティング研究
- [Dynamic LLM Routing (arXiv)](https://arxiv.org/abs/2502.16696)
- [Multi-LLM Routing on AWS](https://aws.amazon.com/blogs/machine-learning/multi-llm-routing-strategies-for-generative-ai-applications-on-aws/)
- [NVIDIA LLM Router Blueprint](https://github.com/NVIDIA-AI-Blueprints/llm-router)

### 類似ツール
- [LM Studio](https://lmstudio.ai/)
- [llmfit](https://github.com/AlexsJones/llmfit)
- [LLM Speed Check](https://www.llmspeedcheck.com/)
- [lmstudio-config-wizard](https://github.com/ghaffaria/lmstudio-config-wizard)

### MCP関連
- [MCP Tools Specification](https://modelcontextprotocol.io/docs/concepts/tools)
- [mcp-client-for-ollama](https://github.com/jonigl/mcp-client-for-ollama)
- [ollama-mcp-bridge](https://github.com/jonigl/ollama-mcp-bridge)
- [ollama-mcp](https://github.com/rawveg/ollama-mcp)

### ライセンス
- [Meta Llama 3 License](https://www.llama.com/llama3/license/)
- [NVIDIA Nemotron Open Model License](https://www.nvidia.com/en-us/agreements/enterprise-software/nvidia-nemotron-open-model-license/)
- [Qwen2.5 License (Apache 2.0)](https://huggingface.co/Qwen/Qwen2.5-7B/blob/main/LICENSE)
- [DeepSeek-R1 MIT License](https://github.com/deepseek-ai/DeepSeek-R1/blob/main/LICENSE)
