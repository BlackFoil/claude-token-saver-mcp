# claude-token-saver-mcp ガバナンス・特許リスク調査レポート

**調査日:** 2026-02-15
**調査担当:** Governance Agent
**対象プロジェクト:** claude-token-saver-mcp (claude-token-saver-mcp)

---

## 調査サマリー

| # | 調査項目 | リスクレベル | 判定 |
|:---:|:---|:---:|:---|
| 1 | LLMルーティング特許 | **中** | 直接的な侵害リスクは低いが、周辺特許の動向に継続注意 |
| 2 | トークンコスト最適化特許 | **低** | 特定の手法特許は確認されず、一般的手法の組合せで構成 |
| 3 | MCP ライセンス・利用規約 | **低** | MIT License、Linux Foundation傘下、商用利用制限なし |
| 4 | Ollama MIT ライセンス互換性 | **低** | MIT と Apache 2.0 は完全互換 |
| 5 | Apache 2.0 依存パッケージ競合 | **中** | 間接依存にGPL系が混入するリスクあり、定期監査が必要 |

**総合判定: プロジェクト続行に重大な法的障壁は確認されず。中リスク項目2件について継続モニタリングを推奨。**

---

## 1. LLMルーティング（クラウド/ローカル振り分け）に関する特許

### リスクレベル: 中

### 調査結果

#### 関連特許の存在
- **U.S. Patent #12,387,050**（2025年8月発行）: 大小LLMを組み合わせた「思考キャッシュ」アーキテクチャ。ルーターがプロンプトを大規模LLMまたは思考キャッシュに振り分ける仕組み。ローカル（エッジデバイス）とクラウドの両方でのキャッシュをサポート。
- **U.S. Patent #12,259,913**（2025年3月発行）: LLM応答のハイブリッド検索とReciprocal Rank Fusionによるキャッシング手法。

#### 学術研究・オープンソースの動向
- **Hybrid-LLM**（ICLR 2024）: クエリの品質ギャップに基づいてクラウド/ローカルにルーティングする手法。約22%のクエリを小規模モデルへ振り分け、品質低下1%未満。
- **OptiRoute**: ユーザー定義要件（精度、速度、コスト）に基づく動的LLM選択エンジン。
- **Router-R1**: 強化学習ベースのLLMルーティング最適化。

#### claude-token-saver-mcpへの影響分析
claude-token-saver-mcpのルーティング方式は「RAM量に基づくモデル自動選択（Tiering）」と「定型タスクのOllamaオフロード」であり、上記特許の「思考キャッシュ」や「品質推定ベースルーティング」とは技術的アプローチが異なる。ただし、LLMルーティング分野は特許出願が活発化しており、今後の特許動向に注意が必要。

### 推奨アクション
- claude-token-saver-mcpのルーティングロジックが「タスク種別による静的振り分け」であることを設計文書に明記し、品質推定ベースのルーティングとは異なることを記録
- 半年に1回、USPTO/Google Patentsで "LLM routing" "model selection" 関連特許を確認

---

## 2. トークンコスト最適化手法の特許

### リスクレベル: 低

### 調査結果

#### 特許状況
トークンコスト最適化に直接関連する特許は、調査範囲では確認されなかった。この分野の主要な手法は以下の通りで、いずれも広く公知となった一般的技術。

- **プロンプトキャッシング**: 処理済みトークン表現を保存し再利用（最大90%のコスト削減）
- **量子化（Quantization）**: FP4/INT4による推論コスト60-70%削減
- **投機的デコーディング（Speculative Decoding）**: レイテンシ2-3倍削減

#### claude-token-saver-mcpへの影響分析
claude-token-saver-mcpのコスト最適化は「動的API価格フェッチによるコスト計算」と「ローカルLLMへのオフロード」で構成される。これらは公知の手法の組合せであり、特許侵害リスクは極めて低い。

#### 市場動向
LLM推論コストは年間10倍の速度で低下（GPT-4相当の性能が2022年末の$20/Mトークンから$0.40/Mトークンへ）。コスト最適化は業界全体の共通課題であり、特定企業の独占的な特許支配は見られない。

### 推奨アクション
- 現状のアプローチで特許リスクは低いため、特段の対応は不要
- 独自のコスト最適化アルゴリズムを開発する場合は、先行特許調査を実施

---

## 3. MCP（Model Context Protocol）のライセンス・利用規約

### リスクレベル: 低

### 調査結果

#### ライセンス
- **MCP仕様**: MIT License
- **@modelcontextprotocol/sdk（TypeScript SDK）**: MIT License
- **ガバナンス**: 2025年12月にAnthropicがMCPをAgentic AI Foundation（AAIF）に寄贈。AAIFはLinux Foundation傘下の有向ファンドで、Anthropic、Block、OpenAIが共同設立。Google、Microsoft、AWS、Cloudflare、Bloombergが支援。

#### 利用条件
- MIT Licenseにより、商用利用、改変、再配布、サブライセンスが自由
- 特許条項なし（MIT Licenseには明示的な特許付与がないが、暗黙の特許ライセンスが一般に認められる）
- 帰属表示（著作権表示とライセンス文の保持）のみ必須

#### claude-token-saver-mcpへの影響分析
claude-token-saver-mcpはMCPサーバーとして`@modelcontextprotocol/sdk`を利用するが、MIT Licenseであるため利用制限は実質的にない。Linux Foundation傘下への移管により、プロトコルの長期的な安定性と中立性も担保されている。

### 推奨アクション
- MCP SDKのMITライセンス表記をプロジェクトのNOTICEファイルまたはLICENSE-THIRD-PARTYに含める
- AAIF/Linux Foundationの今後のガバナンスポリシー変更を注視（現時点では問題なし）

---

## 4. Ollama MIT ライセンスとの互換性

### リスクレベル: 低

### 調査結果

#### Ollamaのライセンス
- **Ollama CLI/Server**: MIT License（GitHub公式リポジトリで確認済み）
- **注意**: Ollama GUIアプリは別ソフトウェアとして異なるライセンスの可能性あり（本プロジェクトではCLI/Serverのみ使用するため影響なし）
- **内部依存**: llama.cppなどのコンポーネントも含まれるが、MIT Licenseで統合されている

#### MIT と Apache 2.0 の互換性
- MIT License は最も寛容なパーミッシブライセンスの一つ
- MIT ライセンスのコードを Apache 2.0 のプロジェクトに含めることは完全に合法
- MIT コードを Apache 2.0 プロジェクトに統合した場合、派生物は Apache 2.0 として配布可能
- Apache 2.0 は MIT にない「明示的特許付与」条項を持つが、これは互換性の障壁にならない

#### claude-token-saver-mcpへの影響分析
claude-token-saver-mcpはOllamaをAPI経由で呼び出す形態（ネットワーク接続）であり、コードの直接統合ではない。したがってライセンスの「派生物」には該当せず、互換性の問題は生じない。仮にコードを直接統合する場合でも、MIT → Apache 2.0 への組み込みは法的に問題ない。

### 推奨アクション
- Ollamaとの連携がAPI呼び出し（ネットワーク経由）であることを設計書に明記
- Ollamaの利用に関するライセンス表記は任意だが、NOTICE等に記載するとベストプラクティス

---

## 5. Apache 2.0 ライセンスでの公開における注意点

### リスクレベル: 中

### 調査結果

#### Apache 2.0 の基本要件
1. **著作権表示**: ソースファイルにライセンスヘッダーを含める
2. **変更の明示**: 元のコードに対する変更を明示する
3. **NOTICE ファイル**: 帰属情報を含むNOTICEファイルの維持
4. **特許付与**: コントリビューターは暗黙的に特許ライセンスを付与
5. **商標非付与**: Apache 2.0 は商標権を付与しない

#### 依存パッケージのライセンス競合リスク

##### 互換性のあるライセンス（問題なし）
- MIT License
- BSD 2-Clause / 3-Clause（広告条項なし）
- ISC License
- CC0 / Unlicense

##### 互換性に注意が必要なライセンス
- **GPL-2.0**: Apache 2.0 との**非互換**（最も一般的な違法ライセンスペア）
- **GPL-3.0**: Apache 2.0 との互換性あり（ただし制約が厳しくなる）
- **LGPL-3.0**: Apache 2.0 プロジェクトでの利用に制約あり
- **MPL-1.1**: 互換性なし
- **AGPL-3.0**: 最も制約が厳しく、SaaS提供時にソースコード公開義務

##### npm依存における特有のリスク
調査によると、npm エコシステムでは `(GPL-2.0, Apache-2.0)` が最も一般的な非互換ライセンスペアであり、特に間接依存（transitive dependencies）においてこの問題が顕著。依存の深いレベルほどApache 2.0ライセンスのパッケージが多くなり、GPLとの衝突リスクが増大する。

#### claude-token-saver-mcpへの影響分析
claude-token-saver-mcpはNode.js/TypeScriptプロジェクトであり、npm依存パッケージの数は多くなる可能性が高い。特に以下の主要依存パッケージのライセンスは確認が必要：

| パッケージ | 想定ライセンス | 互換性 |
|:---|:---|:---|
| `@modelcontextprotocol/sdk` | MIT | 互換 |
| `better-sqlite3` | MIT | 互換 |
| `drizzle-orm` | Apache 2.0 | 互換（同一） |
| `react` | MIT | 互換 |
| `vite` | MIT | 互換 |
| `zustand` | MIT | 互換 |
| `tailwindcss` | MIT | 互換 |
| `pino` | MIT | 互換 |

### 推奨アクション
1. **ライセンス監査ツールの導入**: `license-checker` または `license-report` をCI/CDパイプラインに組み込み、GPL系ライセンスの混入を自動検出
2. **NOTICEファイルの作成**: 全サードパーティライセンスの帰属情報を集約
3. **ライセンスヘッダーの統一**: 全ソースファイルにApache 2.0ヘッダーを付与
4. **CLA（Contributor License Agreement）の検討**: 外部コントリビューター受け入れ時にCLAを用意

---

## 総合評価と推奨事項

### 結論
claude-token-saver-mcpプロジェクトの開発・公開において、**即座にプロジェクトを中止すべき重大な法的リスクは確認されなかった**。

### 優先対応事項（P0）
1. `license-checker` または同等ツールをCI/CDに組み込み、依存パッケージのライセンス監査を自動化
2. NOTICEファイルを作成し、主要依存パッケージのライセンス表記を集約

### 継続モニタリング事項（P1）
1. LLMルーティング分野の特許動向を半年ごとに確認
2. MCP/AAIFのガバナンスポリシー変更の追跡
3. Ollamaのライセンス変更の有無を確認（GUIアプリの動向含む）

### 参考情報
- claude-token-saver-mcpのルーティング方式（タスク種別・RAM量による静的Tiering）は、既存特許の「品質推定ベースの動的ルーティング」とは技術的に異なり、特許侵害リスクは低い
- Apache 2.0 + MIT の組み合わせは、オープンソースプロジェクトで最も一般的かつ安全なライセンス構成の一つ

---

## 調査に使用したソース

- [U.S. Patent #12,387,050 - Multi-stage LLM](https://patents.justia.com/patent/12387050)
- [U.S. Patent #12,259,913 - LLM Response Caching](https://patents.justia.com/patent/12259913)
- [Hybrid-LLM: Cost-Efficient and Quality-Aware (ICLR 2024)](https://proceedings.iclr.cc/paper_files/paper/2024/file/b47d93c99fa22ac0b377578af0a1f63a-Paper-Conference.pdf)
- [Dynamic LLM Routing and Selection (arXiv)](https://arxiv.org/abs/2502.16696)
- [Router-R1 and LLM Routing Research](https://champaignmagazine.com/2025/10/16/router-r1-and-llm-routing-research/)
- [MCP Specification](https://modelcontextprotocol.io/specification/2025-11-25)
- [MCP GitHub Repository](https://github.com/modelcontextprotocol/modelcontextprotocol)
- [Anthropic - Donating MCP to AAIF](https://www.anthropic.com/news/donating-the-model-context-protocol-and-establishing-of-the-agentic-ai-foundation)
- [@modelcontextprotocol/sdk (npm)](https://www.npmjs.com/package/@modelcontextprotocol/sdk)
- [Ollama GitHub License](https://github.com/ollama/ollama/blob/main/LICENSE)
- [Apache vs MIT License Comparison](https://soos.io/apache-vs-mit-license)
- [Apache License Top 10 Questions](https://www.mend.io/blog/top-10-apache-license-questions-answered/)
- [npm License Violation Prevalence Study](https://soft.vub.ac.be/Publications/2022/vub-tr-soft-22-08.pdf)
- [Open Source License Risk](https://www.aikido.dev/blog/open-source-license-risk)
- [Linux Foundation - AAIF Announcement](https://www.linuxfoundation.org/press/linux-foundation-announces-the-formation-of-the-agentic-ai-foundation)
