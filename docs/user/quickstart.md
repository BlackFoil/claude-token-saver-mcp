# クイックスタートガイド

Claude Code のトークンコストを節約する MCP サーバーです。定型的なコーディングタスクをローカル LLM (Ollama) にオフロードし、Claude API の消費を抑えます。

---

## 前提条件

- **Node.js 20 以上** (`node -v` で確認)
- **Ollama** インストール済み — [https://ollama.com/](https://ollama.com/)

---

## ステップ 1: Ollama の準備 (2 分)

Ollama を起動します。

```bash
ollama serve
```

別のターミナルで、マシンの RAM に応じたモデルをプルします。

| RAM | Tier | コマンド |
|-----|------|---------|
| 16 GB 未満 | Light | `ollama pull phi4:latest` |
| 16 - 48 GB | Standard | `ollama pull qwen2.5-coder:7b` |
| 48 GB 以上 | Ultra | `ollama pull qwen2.5-coder:32b` |

```bash
# 例: 16GB マシンの場合
ollama pull qwen2.5-coder:7b
```

> RAM がわからない場合は、macOS なら `` > `このMacについて`、Linux なら `free -h` で確認できます。

---

## ステップ 2: MCP サーバーのインストール (1 分)

### npm からインストール (推奨)

```bash
npm install -g claude-token-saver-mcp
```

### ソースからビルド

```bash
git clone https://github.com/pulseagent/claude-token-saver-mcp.git
cd claude-token-saver-mcp
npm install
npm run build
```

---

## ステップ 3: Claude Code に登録 (1 分)

`~/.claude/claude_desktop_config.json` を編集し、`mcpServers` に追加します。

### npm 版

```json
{
  "mcpServers": {
    "token-saver": {
      "command": "claude-token-saver-mcp"
    }
  }
}
```

### ソースビルド版

```json
{
  "mcpServers": {
    "token-saver": {
      "command": "node",
      "args": ["/path/to/claude-token-saver-mcp/dist/server.js"]
    }
  }
}
```

> `/path/to/` は実際のクローン先パスに置き換えてください。

---

## ステップ 4: 動作確認 (1 分)

1. Claude Code を起動 (または再起動) します。

2. stderr に以下のようなログが出ることを確認します。

   ```
   [claude-token-saver-mcp v0.3.0] Tier 2 (Standard) — qwen2.5-coder:7b
   ```

3. 試しに以下のように依頼してみます。

   ```
   TypeScript で Hello World を書いて
   ```

   `offload_work` ツールが呼ばれ、ローカル LLM がコードを生成すれば成功です。

---

## 次のステップ

- **設定リファレンス** — `~/.config/claude-token-saver/config.json` で Tier 固定・モデル変更・タイムアウト調整などが可能です。詳しくは [設定リファレンス](../design/detailed-specs-core.md) を参照してください。
- **トラブルシューティング** — Ollama に接続できない場合は、`ollama serve` が起動中か、`OLLAMA_BASE_URL` 環境変数が正しいかを確認してください。
