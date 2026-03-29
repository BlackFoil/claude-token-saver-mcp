# コントリビューションガイド

claude-token-saver-mcp へのコントリビューションを歓迎します。

## 開発環境

```bash
git clone https://github.com/BlackFoil/claude-token-saver-mcp.git
cd claude-token-saver-mcp
npm ci
npm test          # 736 テスト
npm run typecheck # 型チェック
npm run lint      # ESLint
```

## コードスタイル

- TypeScript strict mode、ESM
- Prettier (設定は `.prettierrc`)
- 全ソースファイルに Apache-2.0 SPDX ヘッダー
- テストは Vitest (`tests/` ディレクトリ)

## PR の出し方

1. Issue で提案を議論 (大きな変更の場合)
2. feature ブランチを作成
3. テストを追加 (カバレッジ低下は NG)
4. `npm test && npm run typecheck && npm run lint` が通ることを確認
5. PR を作成

## アーキテクチャ

```text
src/
├── server.ts          # エントリポイント (全ツール登録)
├── config/            # Zod 設定スキーマ
├── tiering/           # RAM 自動ティアリング
├── ollama/            # Ollama クライアント & ロードバランサー
├── queue/             # FIFO & 優先度キュー
├── cost/              # コスト計算
├── tools/             # 11 MCP ツールハンドラー
├── model-selector/    # モデル推奨エンジン
├── metrics/           # Prometheus メトリクス
├── persistence/       # ファイル永続化
├── logging/           # 構造化ログ
├── validators/        # 入力バリデーション & PI 防御
└── errors.ts          # CTS-XXXX エラー体系
```

設計書は `docs/design/` にあります。意思決定ログは `docs/decisions.md` です。

## 歓迎するコントリビューション

- バグ修正
- テスト追加
- ドキュメント改善 (特に英語翻訳)
- モデルレジストリへの新モデル追加
- 新しい MCP ツール提案 (Issue で議論)
