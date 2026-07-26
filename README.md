# ELITE AI

**ChatGPT級の会話力 × Geminiの高速マルチモーダル × Claude的な思考の深さ**を目指した、個人用の統合AIチャットアプリです。
白黒基調のシンプル・モダンなUIで、ブラウザだけで動作します（サーバー不要）。

---

## ✨ 主な機能

- 🔐 Firebase Authによるアカウント作成・ログイン（メール／Google／ローカルのみモード）
- ☁️ Firestoreによる会話履歴のクラウド同期（任意）
- ⚙️ 設定画面：APIキー管理、テーマ（ダーク/ライト/システム）、フォント、パーソナルインテリジェンス、履歴管理
- 💬 チャット画面：
  - 表示/非表示切り替え可能な会話履歴サイドバー
  - 会話メニュー（🔗共有 / 📌ピン留め / ⬇️ダウンロード / ✏️名前変更 / 🗑️削除）
  - ファイルアップロード＋プレビュー
  - モデル切り替え（Gemini 3.5 Flash-Lite / Gemini 3.6 Flash）
  - 思考度切り替え（Ⅰ〜Ⅴ、Ⅳ・Ⅴは3.6 Flash限定の二段階思考）
  - Markdown・シンタックスハイライト付きコードブロック表示
  - HTML／PDF／ZIP形式でのファイル出力

---

## 📦 ファイル構成

```
elite-ai/
├── index.html          # 画面構造
├── style.css           # デザイン（白黒基調・モダン）
├── app.js              # アプリ本体ロジック
├── firebase-config.js  # あなたのFirebase設定を入れるファイル
└── README.md           # このファイル
```

---

## 🚀 セットアップ手順（初心者向け）

### ステップ1：Gemini APIキーを取得する（必須）

1. [Google AI Studio](https://aistudio.google.com/app/apikey) にアクセスし、Googleアカウントでログインします。
2. 「Create API key」をクリックしてAPIキーを発行します。
3. 発行されたキー（`AIza...`から始まる文字列）をコピーしておきます。

> このキーはアプリ起動後、設定画面から入力します。ファイルを直接編集する必要はありません。

### ステップ2：Firebaseプロジェクトを作る（任意・アカウント同期をしたい場合）

Firebaseを設定しなくても、ELITE AIは自動的に「ローカルのみモード」で動作します（全データはブラウザ内に保存）。
複数端末で同期したい場合のみ、以下を行ってください。

1. [Firebase Console](https://console.firebase.google.com/) にアクセスし、「プロジェクトを追加」をクリック
2. プロジェクト名を入力して作成（Googleアナリティクスは任意）
3. 左メニューの「Authentication」→「Sign-in method」タブで、以下を有効化：
   - **メール/パスワード**
   - **Google**
4. 左メニューの「Firestore Database」→「データベースの作成」→ 本番環境モードで作成
5. 左メニューの「Firestore Database」→「ルール」タブに以下を貼り付けて公開：

   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /users/{userId}/conversations/{convId} {
         allow read, write: if request.auth != null && request.auth.uid == userId;
       }
     }
   }
   ```

6. 左メニューの「プロジェクトの概要」→ 歯車アイコン →「プロジェクトの設定」→「マイアプリ」→ `</>`（ウェブ）アイコンをクリックしてアプリを登録
7. 表示された `firebaseConfig` オブジェクトの値をコピー
8. このリポジトリの `firebase-config.js` を開き、以下のように値を貼り付けます：

   ```js
   export const firebaseConfig = {
     apiKey: "ここに貼り付け",
     authDomain: "ここに貼り付け",
     projectId: "ここに貼り付け",
     storageBucket: "ここに貼り付け",
     messagingSenderId: "ここに貼り付け",
     appId: "ここに貼り付け"
   };
   ```

9. 保存すれば設定完了です。

### ステップ3：ローカルで動作確認する

`index.html` を直接ダブルクリックで開いても動きますが、Firebase（ESモジュール）を使う場合はブラウザのセキュリティ制限により、簡易サーバー経由での起動を推奨します。

```bash
# Python がインストールされている場合
cd elite-ai
python3 -m http.server 8000
```

ブラウザで `http://localhost:8000` を開いてください。

### ステップ4：GitHub Pagesで公開する

1. このフォルダの中身をGitHubの新規リポジトリにpushします。
2. リポジトリの **Settings → Pages** を開きます。
3. 「Build and deployment」の Source を **Deploy from a branch** に設定。
4. Branch を `main`（フォルダは `/root`）に設定して保存。
5. 数分後、`https://あなたのユーザー名.github.io/リポジトリ名/` でアクセスできるようになります。

> ⚠️ `firebase-config.js` にAPIキーを含めて公開リポジトリにpushする場合、FirebaseのAPIキー自体は「公開されても比較的安全」な設計ですが、必ず上記のFirestoreセキュリティルールを設定し、Authentication側のドメイン制限（承認済みドメイン）も確認してください。
> Gemini APIキーは各ユーザーが自分の設定画面で入力する方式のため、リポジトリには含まれません。

---

## 🎛️ 使い方のヒント

- **モデル切り替え**：入力欄のピルボタンから「3.5 Flash-Lite」（高速・軽量）と「3.6 Flash」（高精度・コーディング向け）を切り替えられます。
- **思考度Ⅰ〜Ⅴ**：数字が大きいほどじっくり考えます。ⅣとⅤを選ぶと自動的に3.6 Flashに切り替わり、内部で2回AIを呼び出す「二段階思考」（下書き→最終回答の精査）が行われます。
- **ファイル出力**：AIの回答にHTMLコードが含まれる場合、自動的にダウンロードカードが表示されます。「〜をPDF化して」のように依頼すると、その場でPDFを生成します。
- **パーソナルインテリジェンス**：設定画面であなたの呼び方や好みを登録すると、以降の会話に反映されます。

---

## 🛠️ 技術構成

- Vanilla JavaScript（フレームワークなし・ESモジュール）
- Firebase v10（Auth / Firestore）
- Google Gemini API（`gemini-3.5-flash-lite` / `gemini-3.6-flash`）
- marked.js（Markdown）＋ highlight.js（シンタックスハイライト）＋ DOMPurify（サニタイズ）
- jsPDF（PDF出力）／ JSZip（ZIP出力の土台）

---

## ❓ トラブルシューティング

| 症状 | 対処 |
|---|---|
| 「APIキーが設定されていません」と出る | 設定 → API タブでGemini APIキーを保存してください |
| ログインできない | Firebaseの「Authentication → Sign-in method」でメール/PasswordまたはGoogleが有効か確認 |
| 会話が同期されない | 設定 → 履歴管理 →「クラウド同期」がONになっているか確認（Firebase未設定時は使えません） |
| 白い画面のまま | ブラウザのコンソール（F12）でエラーを確認。ローカルファイルを直接開いている場合はステップ3の簡易サーバー経由での起動をお試しください |

---

Made with ELITE AI 🤖
