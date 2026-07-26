// =========================================================
// firebase-config.js
// Firebase Consoleで作成したプロジェクトの設定値を貼り付けてください。
// 取得方法は README.md の「1. Firebaseプロジェクトの作成」を参照。
// =========================================================

export const firebaseConfig = {
  apiKey: "YOUR_FIREBASE_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};

// 設定を入力しない場合、ELITE AIは自動的に「ローカルのみモード」で動作します。
// （アカウント同期なし・全データはブラウザのlocalStorageに保存）
