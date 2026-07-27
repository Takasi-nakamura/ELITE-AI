
---

## 💻 Codeモードについて（VSCode風エディタ）

チャット画面上部の「Code」ボタンから、ファイルツリー・Monaco Editor（VSCodeと同じエディタ）・ターミナル・プレビューを備えた開発環境を開けます。

### ⚠️ GitHub Pagesでは動作しません

Codeモードの「本格的なターミナル実行（npm install / npm run dev など）」は **WebContainer API** を使用しています。これは技術的な制約として、サイト全体に以下のHTTPヘッダーが必要です：

```
Cross-Origin-Embedder-Policy: require-corp
Cross-Origin-Opener-Policy: same-origin
```

**GitHub Pagesはこれらのヘッダーをカスタム設定できないため、Codeモードのターミナル機能は動作しません。**
（エディタでのファイル編集自体は動きますが、ターミナル・プレビューが起動しません）

### ✅ 推奨：VercelまたはNetlifyでのデプロイ

このプロジェクトには、両サービス向けの設定ファイルが同梱されています。

#### Vercelの場合

1. [vercel.com](https://vercel.com) にGitHubアカウントでログイン
2. 「Add New → Project」からこのリポジトリを選択してインポート
3. Framework Presetは「Other」のままでOK（Build Command不要）
4. Deployをクリック
5. `vercel.json` が自動的にCOOP/COEPヘッダーを設定します

#### Netlifyの場合

1. [netlify.com](https://netlify.com) にGitHubアカウントでログイン
2. 「Add new site → Import an existing project」からこのリポジトリを選択
3. Build settingsは空欄のままでOK（Publish directoryは `/`）
4. Deployをクリック
5. `_headers` ファイルが自動的にCOOP/COEPヘッダーを設定します

どちらも無料プランで問題なく動作します。

### Codeモードの使い方

- **エディタ**：ファイルツリーからファイルを選択して編集（VSCode相当のシンタックスハイライト・補完あり）
- **プレビュー**：`npm run dev` 相当のサーバーが起動すると自動的に表示されます
- **ターミナル**：本物のシェル（jsh）が動作し、`npm install` なども実行可能
- **チャット（Codeモード内）**：
  - 💡 **アドバイスタグ**：現在開いているファイルの内容を踏まえて質問に回答
  - ✏️ **改変タグ**：コードの変更を依頼すると、Before/After形式の差分確認画面が表示され、「この変更を適用」ボタンを押すまでファイルは書き換わりません。既存コードの該当箇所のみを変更する指示をAIに出しているため、全く新しいコードに置き換えられてしまう問題を防ぎます。
