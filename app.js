/* =========================================================
   ELITE AI — app.js
   Firebase Auth/Firestore + Gemini API + チャットUI 全機能
   単一スクリプト構成（type="module"、Firebase SDKをESM importするため）
   ========================================================= */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, signInWithPopup, GoogleAuthProvider,
  signOut, updateProfile
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, doc, setDoc, getDoc, collection, addDoc, updateDoc,
  deleteDoc, onSnapshot, query, orderBy, serverTimestamp, getDocs, writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/* ============================================================
   0. モデル / 思考度 定義
   ============================================================ */
const MODELS = {
  "gemini-3.5-flash-lite": { label: "3.5 Flash-Lite", supportsDeepThink: false },
  "gemini-3.6-flash": { label: "3.6 Flash", supportsDeepThink: true }
};
const THINKING_LEVELS = {
  1: { label: "即答",     roman: "Ⅰ", budget: 0,     twoStage: false },
  2: { label: "軽い思考",  roman: "Ⅱ", budget: 1024,  twoStage: false },
  3: { label: "標準思考",  roman: "Ⅲ", budget: 8192,  twoStage: false },
  4: { label: "深い思考",  roman: "Ⅳ", budget: 16384, twoStage: true  },
  5: { label: "最深思考",  roman: "Ⅴ", budget: 24576, twoStage: true  }
};

/* ============================================================
   1. Firebase 初期化（未設定ならローカルモードへ自動フォールバック）
   ============================================================ */
let firebaseApp = null, auth = null, db = null, GoogleProvider = null;
let firebaseEnabled = false;

async function initFirebase() {
  try {
    const mod = await import("./firebase-config.js");
    const config = mod.firebaseConfig;
    if (!config || !config.apiKey || String(config.apiKey).includes("YOUR_")) {
      console.warn("[ELITE AI] firebase-config.js が未設定のため、ローカルモードで起動します。");
      return false;
    }
    firebaseApp = initializeApp(config);
    auth = getAuth(firebaseApp);
    db = getFirestore(firebaseApp);
    GoogleProvider = new GoogleAuthProvider();
    firebaseEnabled = true;
    return true;
  } catch (e) {
    console.warn("[ELITE AI] Firebase初期化に失敗。ローカルモードで起動します。", e);
    return false;
  }
}

/* ============================================================
   2. グローバル状態
   ============================================================ */
const state = {
  user: null,                 // { uid, name, email, isLocal, photo }
  conversations: [],          // [{id, title, messages:[], pinned, createdAt, updatedAt}]
  currentConvId: null,
  attachedFiles: [],          // [{name, mimeType, size, dataUrl, base64, isImage}]
  selectedModel: "gemini-3.5-flash-lite",
  thinkingLevel: 1,
  settings: {
    theme: "dark",
    fontFamily: "'Inter', 'Noto Sans JP', sans-serif",
    fontSize: 15,
    apiKey: "",
    personalIntelligence: { nickname: "", style: "", memoryNotes: "", autoLearn: true },
    cloudSync: false,
    sidebarCollapsed: false
  },
  isGenerating: false,
  pendingDeleteConvId: null,
  unsubscribeConversations: null,
};

const LS = {
  conversations: "eliteai_conversations",
  settings: "eliteai_settings",
  guestUid: "eliteai_guest_uid"
};

/* ============================================================
   3. ローカルストレージ ヘルパー
   ============================================================ */
function loadLocal(key, fallback) {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; }
  catch { return fallback; }
}
function saveLocal(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { console.error(e); }
}
function loadSettings() {
  const saved = loadLocal(LS.settings, null);
  if (saved) {
    state.settings = {
      ...state.settings, ...saved,
      personalIntelligence: { ...state.settings.personalIntelligence, ...(saved.personalIntelligence || {}) }
    };
  }
}
function persistSettings() { saveLocal(LS.settings, state.settings); }
function loadConversationsLocal() { state.conversations = loadLocal(LS.conversations, []); }
function persistConversationsLocal() { saveLocal(LS.conversations, state.conversations); }

/* ============================================================
   4. Toast / DOM ショートハンド / 汎用ユーティリティ
   ============================================================ */
function toast(message, duration = 2400) {
  const container = document.getElementById("toast-container");
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => el.remove(), duration);
}
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 9); }
function escapeHtml(str) { const d = document.createElement("div"); d.textContent = str; return d.innerHTML; }
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
function formatBytes(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}
function $(sel) { return document.querySelector(sel); }
function $all(sel) { return Array.from(document.querySelectorAll(sel)); }
function nowLabel() {
  const d = new Date();
  return d.toLocaleString("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

/* ============================================================
   5. 認証まわり
   ============================================================ */
function setUserFromFirebase(fbUser) {
  state.user = {
    uid: fbUser.uid,
    name: fbUser.displayName || (fbUser.email ? fbUser.email.split("@")[0] : "ユーザー"),
    email: fbUser.email || "",
    isLocal: false,
    photo: fbUser.photoURL || null
  };
}
function ensureGuestUser() {
  let guestUid = loadLocal(LS.guestUid, null);
  if (!guestUid) { guestUid = "guest_" + uid(); saveLocal(LS.guestUid, guestUid); }
  state.user = { uid: guestUid, name: "ゲスト", email: "", isLocal: true, photo: null };
}
async function handleLogin(email, password) {
  if (!firebaseEnabled) { toast("Firebaseが未設定のため、クラウドログインは使えません"); return; }
  await signInWithEmailAndPassword(auth, email, password);
}
async function handleSignup(name, email, password) {
  if (!firebaseEnabled) { toast("Firebaseが未設定のため、アカウント作成は使えません"); return; }
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  await updateProfile(cred.user, { displayName: name });
  setUserFromFirebase({ ...cred.user, displayName: name });
}
async function handleGoogleSignin() {
  if (!firebaseEnabled) { toast("Firebaseが未設定のため、Googleログインは使えません"); return; }
  await signInWithPopup(auth, GoogleProvider);
}
async function handleLogout() {
  if (firebaseEnabled && auth && auth.currentUser) { await signOut(auth); }
  if (state.unsubscribeConversations) { state.unsubscribeConversations(); state.unsubscribeConversations = null; }
  ensureGuestUser();
  loadConversationsLocal();
  closeModal("settings-modal");
  state.currentConvId = null;
  renderSidebar();
  renderEmptyChat();
  showAuthOverlay();
  toast("ログアウトしました");
}

/* ============================================================
   6. 会話データ層（ローカル / Firestore 両対応）
   ============================================================ */
function newConversation() {
  const conv = {
    id: uid(),
    title: "新しいチャット",
    messages: [],
    pinned: false,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  state.conversations.unshift(conv);
  state.currentConvId = conv.id;
  persistConversationsIfLocal();
  return conv;
}
function getCurrentConv() {
  return state.conversations.find(c => c.id === state.currentConvId) || null;
}
function persistConversationsIfLocal() {
  if (!state.settings.cloudSync || !firebaseEnabled || !state.user || state.user.isLocal) {
    persistConversationsLocal();
  }
}
async function persistConversationCloud(conv) {
  if (!(state.settings.cloudSync && firebaseEnabled && state.user && !state.user.isLocal)) return;
  try {
    const ref = doc(db, "users", state.user.uid, "conversations", conv.id);
    await setDoc(ref, { ...conv, updatedAt: Date.now() }, { merge: true });
  } catch (e) { console.error("Firestore保存エラー", e); }
}
async function deleteConversationCloud(convId) {
  if (!(state.settings.cloudSync && firebaseEnabled && state.user && !state.user.isLocal)) return;
  try { await deleteDoc(doc(db, "users", state.user.uid, "conversations", convId)); }
  catch (e) { console.error("Firestore削除エラー", e); }
}
function subscribeCloudConversations() {
  if (!(state.settings.cloudSync && firebaseEnabled && state.user && !state.user.isLocal)) return;
  if (state.unsubscribeConversations) state.unsubscribeConversations();
  const qy = query(collection(db, "users", state.user.uid, "conversations"), orderBy("updatedAt", "desc"));
  state.unsubscribeConversations = onSnapshot(qy, (snap) => {
    state.conversations = snap.docs.map(d => d.data());
    renderSidebar();
    if (state.currentConvId) renderMessages(getCurrentConv());
  }, (err) => console.error("Firestore購読エラー", err));
}
function touchConversation(conv) {
  conv.updatedAt = Date.now();
  state.conversations.sort((a, b) => (b.pinned - a.pinned) || (b.updatedAt - a.updatedAt));
  persistConversationsIfLocal();
  persistConversationCloud(conv);
}
function deleteConversation(convId) {
  state.conversations = state.conversations.filter(c => c.id !== convId);
  persistConversationsIfLocal();
  deleteConversationCloud(convId);
  if (state.currentConvId === convId) {
    state.currentConvId = null;
    renderEmptyChat();
  }
  renderSidebar();
}
function autoTitleFromMessage(text) {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > 28 ? clean.slice(0, 28) + "…" : (clean || "新しいチャット");
}

/* ============================================================
   7. Gemini API 呼び出し
   ============================================================ */
function buildSystemInstruction() {
  const pi = state.settings.personalIntelligence;
  let sys = "あなたは「ELITE AI」という統合AIアシスタントです。自然な日本語で、親しみやすくも的確に応答してください。";
  if (pi.nickname) sys += ` ユーザーのことは「${pi.nickname}」と呼んでください。`;
  if (pi.style) sys += ` 応答スタイルの指定: ${pi.style}`;
  if (pi.memoryNotes) sys += ` ユーザーに関する既知の情報: ${pi.memoryNotes}`;
  sys += " コードを書く場合は必ずMarkdownのコードブロック（```言語名）で囲んでください。HTMLファイルやPDF化に適した文書の作成を依頼された場合は、その旨を明確に示してください。";
  return sys;
}

function convertHistoryToGeminiContents(messages) {
  return messages
    .filter(m => m.role === "user" || m.role === "assistant")
    .map(m => {
      const parts = [];
      if (m.text) parts.push({ text: m.text });
      if (m.files && m.files.length) {
        m.files.forEach(f => {
          if (f.base64 && f.mimeType) {
            parts.push({ inline_data: { mime_type: f.mimeType, data: f.base64 } });
          }
        });
      }
      return { role: m.role === "assistant" ? "model" : "user", parts };
    });
}

async function callGeminiOnce(model, contents, systemInstruction, thinkingBudget) {
  const apiKey = state.settings.apiKey;
  if (!apiKey) throw new Error("NO_API_KEY");

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const body = {
    contents,
    systemInstruction: { parts: [{ text: systemInstruction }] },
    generationConfig: {}
  };
  if (thinkingBudget && thinkingBudget > 0) {
    body.generationConfig.thinkingConfig = { thinkingBudget };
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`API_ERROR_${res.status}: ${errText.slice(0, 300)}`);
  }
  const data = await res.json();
  const candidate = data.candidates && data.candidates[0];
  const text = (candidate && candidate.content && candidate.content.parts)
    ? candidate.content.parts.map(p => p.text || "").join("")
    : "";
  return text || "（応答が空でした）";
}

/**
 * 二段階思考（レベルⅣ・Ⅴ限定・3.6 Flash限定）
 *  Stage1: 深く分析・下書きを作らせる
 *  Stage2: 下書きを踏まえて最終回答として整形させる
 */
async function callGeminiTwoStage(contents, systemInstruction, thinkingBudget) {
  const stage1System = systemInstruction + "\n\n【内部思考モード】これは最終回答ではありません。ユーザーの意図を深く分析し、複数の観点から検討した下書きを作成してください。";
  const draft = await callGeminiOnce("gemini-3.6-flash", contents, stage1System, thinkingBudget);

  const stage2Contents = [
    ...contents,
    { role: "model", parts: [{ text: "[内部下書き]\n" + draft }] },
    { role: "user", parts: [{ text: "上記の内部下書きを踏まえて、ユーザーに提示する最終的で洗練された回答だけを出力してください。内部下書きへの言及は不要です。" }] }
  ];
  const stage2System = systemInstruction + "\n\n【最終回答モード】これまでの内部検討を踏まえ、簡潔で質の高い最終回答のみを出力してください。";
  const final = await callGeminiOnce("gemini-3.6-flash", stage2Contents, stage2System, thinkingBudget);
  return { draft, final };
}

/* ============================================================
   8. メッセージ送信フロー
   ============================================================ */
async function sendMessage() {
  if (state.isGenerating) return;
  const input = document.getElementById("chat-input");
  const text = input.value.trim();
  if (!text && state.attachedFiles.length === 0) return;

  if (!state.settings.apiKey) {
    toast("先に設定画面でGemini APIキーを入力してください");
    openSettingsModal("panel-api");
    return;
  }

  let conv = getCurrentConv();
  if (!conv) conv = newConversation();

  const userMsg = {
    id: uid(),
    role: "user",
    text,
    files: state.attachedFiles.map(f => ({ name: f.name, mimeType: f.mimeType, size: f.size, dataUrl: f.dataUrl, base64: f.base64, isImage: f.isImage })),
    timestamp: Date.now()
  };
  conv.messages.push(userMsg);
  if (conv.messages.filter(m => m.role === "user").length === 1) {
    conv.title = autoTitleFromMessage(text || (userMsg.files[0] ? userMsg.files[0].name : "新しいチャット"));
  }
  touchConversation(conv);

  input.value = "";
  autoResizeTextarea(input);
  state.attachedFiles = [];
  renderFilePreviewStrip();
  renderSidebar();
  renderMessages(conv);
  updateChatTitle(conv);

  const level = state.thinkingLevel;
  const levelInfo = THINKING_LEVELS[level];
  const useTwoStage = levelInfo.twoStage; // Ⅳ・Ⅴは常に3.6 Flash・2段階
  const modelUsed = useTwoStage ? "gemini-3.6-flash" : state.selectedModel;

  state.isGenerating = true;
  updateSendButtonState();
  const thinkingMsgId = renderThinkingIndicator(useTwoStage);

  try {
    const sys = buildSystemInstruction();
    const contents = convertHistoryToGeminiContents(conv.messages);

    let finalText, draftText = null;
    if (useTwoStage) {
      const result = await callGeminiTwoStage(contents, sys, levelInfo.budget);
      finalText = result.final;
      draftText = result.draft;
    } else {
      finalText = await callGeminiOnce(modelUsed, contents, sys, levelInfo.budget);
    }

    removeThinkingIndicator(thinkingMsgId);

    const assistantMsg = {
      id: uid(),
      role: "assistant",
      text: finalText,
      thinkingTrace: draftText,
      model: modelUsed,
      thinkingLevel: level,
      timestamp: Date.now()
    };
    conv.messages.push(assistantMsg);
    touchConversation(conv);
    renderSidebar();
    appendMessageToDOM(assistantMsg);

    if (state.settings.personalIntelligence.autoLearn) {
      maybeExtractMemory(text, finalText);
    }
  } catch (err) {
    removeThinkingIndicator(thinkingMsgId);
    console.error(err);
    let msg = "エラーが発生しました。";
    if (String(err.message).includes("NO_API_KEY")) msg = "APIキーが設定されていません。設定画面から入力してください。";
    else if (String(err.message).includes("API_ERROR_400")) msg = "リクエストが不正です（APIキーやファイル形式を確認してください）。";
    else if (String(err.message).includes("API_ERROR_403")) msg = "APIキーが無効か、権限がありません。";
    else if (String(err.message).includes("API_ERROR_429")) msg = "APIのレート制限に達しました。しばらく待って再試行してください。";
    toast(msg);
    const errMsg = { id: uid(), role: "assistant", text: `⚠️ ${msg}`, isError: true, timestamp: Date.now() };
    conv.messages.push(errMsg);
    touchConversation(conv);
    appendMessageToDOM(errMsg);
  } finally {
    state.isGenerating = false;
    updateSendButtonState();
  }
}

// ごく簡易なパーソナルインテリジェンス自動学習（キーワード検知でメモ欄に追記提案）
function maybeExtractMemory(userText, aiText) {
  // 明示的な自己紹介的な発言のみ軽く拾う。過剰学習を避けるため保守的に。
  const patterns = [/私は(.{2,20}?)(です|だ)/, /(僕|私)の(名前|職業)は(.{2,20})/];
  for (const p of patterns) {
    const m = userText.match(p);
    if (m) {
      const note = m[0];
      const notes = state.settings.personalIntelligence.memoryNotes || "";
      if (!notes.includes(note)) {
        state.settings.personalIntelligence.memoryNotes = (notes ? notes + "\n" : "") + "・" + note;
        persistSettings();
      }
      break;
    }
  }
}

/* ============================================================
   9. レンダリング：サイドバー
   ============================================================ */
function renderSidebar(filterText = "") {
  const pinnedList = document.getElementById("pinned-list");
  const convList = document.getElementById("conv-list");
  pinnedList.innerHTML = "";
  convList.innerHTML = "";

  const filtered = state.conversations.filter(c => {
    if (!filterText) return true;
    const t = filterText.toLowerCase();
    return c.title.toLowerCase().includes(t) || c.messages.some(m => (m.text || "").toLowerCase().includes(t));
  });

  const pinned = filtered.filter(c => c.pinned);
  const rest = filtered.filter(c => !c.pinned);

  document.querySelector(".sidebar-section:has(#pinned-list)")?.classList.toggle("hidden", pinned.length === 0);

  pinned.forEach(c => pinnedList.appendChild(buildConvItem(c, true)));
  rest.forEach(c => convList.appendChild(buildConvItem(c, false)));

  if (filtered.length === 0) {
    convList.innerHTML = `<div style="padding:16px 8px;color:var(--text-tertiary);font-size:12.5px;">会話が見つかりません</div>`;
  }
}

function buildConvItem(conv, isPinned) {
  const div = document.createElement("div");
  div.className = "conv-item" + (conv.id === state.currentConvId ? " active" : "");
  div.dataset.convId = conv.id;
  div.innerHTML = `${isPinned ? '<span class="pin-icon">📌</span>' : ""}<span>${escapeHtml(conv.title)}</span>`;
  div.addEventListener("click", () => openConversation(conv.id));
  return div;
}

function openConversation(convId) {
  state.currentConvId = convId;
  const conv = getCurrentConv();
  renderSidebar(document.getElementById("history-search").value);
  renderMessages(conv);
  updateChatTitle(conv);
  if (window.innerWidth <= 860) closeMobileSidebar();
}

function updateChatTitle(conv) {
  document.getElementById("current-chat-title").textContent = conv ? conv.title : "新しいチャット";
}

/* ============================================================
   10. レンダリング：メッセージエリア
   ============================================================ */
function renderEmptyChat() {
  const messagesEl = document.getElementById("messages");
  messagesEl.innerHTML = `
    <div class="empty-state" id="empty-state">
      <div class="empty-logo">E</div>
      <h1>今日は何を話しますか？</h1>
      <p>会話・コード・資料作成、なんでもどうぞ。</p>
    </div>`;
  updateChatTitle(null);
  renderSidebar(document.getElementById("history-search")?.value || "");
}

function renderMessages(conv) {
  const messagesEl = document.getElementById("messages");
  messagesEl.innerHTML = "";
  if (!conv || conv.messages.length === 0) { renderEmptyChat(); return; }
  conv.messages.forEach(m => appendMessageToDOM(m, false));
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function renderMarkdown(text) {
  const rawHtml = marked.parse(text, { breaks: true });
  return DOMPurify.sanitize(rawHtml, { ADD_ATTR: ["target"] });
}

function enhanceCodeBlocks(container) {
  container.querySelectorAll("pre code").forEach(block => {
    hljs.highlightElement(block);
    const pre = block.parentElement;
    if (pre.parentElement.classList.contains("code-block")) return; // 既に処理済み
    const lang = (block.className.match(/language-(\w+)/) || [, "text"])[1];

    const wrapper = document.createElement("div");
    wrapper.className = "code-block";
    const header = document.createElement("div");
    header.className = "code-block-header";
    header.innerHTML = `<span>${escapeHtml(lang)}</span>`;
    const copyBtn = document.createElement("button");
    copyBtn.innerHTML = "📋 コピー";
    copyBtn.addEventListener("click", () => {
      navigator.clipboard.writeText(block.textContent).then(() => {
        copyBtn.innerHTML = "✅ コピー済み";
        setTimeout(() => copyBtn.innerHTML = "📋 コピー", 1500);
      });
    });
    header.appendChild(copyBtn);

    pre.parentElement.insertBefore(wrapper, pre);
    wrapper.appendChild(header);
    wrapper.appendChild(pre);
  });
}

function appendMessageToDOM(msg, scroll = true) {
  const messagesEl = document.getElementById("messages");
  const emptyState = document.getElementById("empty-state");
  if (emptyState) emptyState.remove();

  const row = document.createElement("div");
  row.className = `msg-row ${msg.role}`;
  row.dataset.msgId = msg.id;

  const avatar = document.createElement("div");
  avatar.className = "msg-avatar";
  avatar.textContent = msg.role === "user" ? (state.user?.name?.[0] || "U") : "E";

  const content = document.createElement("div");
  content.className = "msg-content";

  const bubble = document.createElement("div");
  bubble.className = "msg-bubble";

  // 添付ファイルチップ
  if (msg.files && msg.files.length) {
    msg.files.forEach(f => {
      const chip = document.createElement("div");
      chip.className = "msg-file-chip";
      if (f.isImage && f.dataUrl) {
        chip.innerHTML = `<img src="${f.dataUrl}" alt=""><span>${escapeHtml(f.name)}</span>`;
      } else {
        chip.innerHTML = `<span>📄</span><span>${escapeHtml(f.name)}</span>`;
      }
      bubble.appendChild(chip);
    });
  }

  // 思考過程トレース（下書き）表示
  if (msg.thinkingTrace) {
    const trace = document.createElement("div");
    trace.className = "thinking-trace";
    trace.textContent = "💭 " + msg.thinkingTrace.slice(0, 400) + (msg.thinkingTrace.length > 400 ? "…" : "");
    bubble.appendChild(trace);
  }

  const textDiv = document.createElement("div");
  if (msg.role === "assistant") {
    textDiv.innerHTML = renderMarkdown(msg.text || "");
  } else {
    textDiv.textContent = msg.text || "";
    textDiv.style.whiteSpace = "pre-wrap";
  }
  bubble.appendChild(textDiv);
  content.appendChild(bubble);

  // アクションボタン（アシスタントのみ：コピー・再生成／ユーザーのみ：編集）
  const actions = document.createElement("div");
  actions.className = "msg-actions";
  if (msg.role === "assistant" && !msg.isError) {
    actions.innerHTML = `
      <button class="act-copy" title="コピー">📋</button>
      <button class="act-regenerate" title="再生成">🔄</button>`;
    actions.querySelector(".act-copy").addEventListener("click", () => {
      navigator.clipboard.writeText(msg.text);
      toast("コピーしました");
    });
    actions.querySelector(".act-regenerate").addEventListener("click", () => regenerateMessage(msg.id));
  } else if (msg.role === "user") {
    actions.innerHTML = `<button class="act-edit" title="編集して再送信">✏️</button>`;
    actions.querySelector(".act-edit").addEventListener("click", () => editAndResend(msg.id));
  }
  content.appendChild(actions);

  row.appendChild(avatar);
  row.appendChild(content);
  messagesEl.appendChild(row);

  enhanceCodeBlocks(bubble);
  detectAndRenderOutputFiles(bubble, msg);

  if (scroll) messagesEl.scrollTop = messagesEl.scrollHeight;
}

function renderThinkingIndicator(isTwoStage) {
  const messagesEl = document.getElementById("messages");
  const id = "thinking-" + uid();
  const row = document.createElement("div");
  row.className = "msg-row assistant";
  row.id = id;
  row.innerHTML = `
    <div class="msg-avatar">E</div>
    <div class="msg-content">
      <div class="thinking-indicator">
        <span class="spinner"></span>
        <span>${isTwoStage ? "2段階で深く考えています…" : "考えています…"}</span>
      </div>
    </div>`;
  messagesEl.appendChild(row);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return id;
}
function removeThinkingIndicator(id) {
  document.getElementById(id)?.remove();
}

function regenerateMessage(msgId) {
  const conv = getCurrentConv();
  if (!conv) return;
  const idx = conv.messages.findIndex(m => m.id === msgId);
  if (idx === -1) return;
  conv.messages.splice(idx, 1);
  touchConversation(conv);
  renderMessages(conv);
  sendMessageInternalRetry(conv);
}
async function sendMessageInternalRetry(conv) {
  // 最後のユーザーメッセージ以降を消し、再送信と同等のロジックを再利用
  const level = state.thinkingLevel;
  const levelInfo = THINKING_LEVELS[level];
  const useTwoStage = levelInfo.twoStage;
  const modelUsed = useTwoStage ? "gemini-3.6-flash" : state.selectedModel;

  state.isGenerating = true;
  updateSendButtonState();
  const thinkingMsgId = renderThinkingIndicator(useTwoStage);
  try {
    const sys = buildSystemInstruction();
    const contents = convertHistoryToGeminiContents(conv.messages);
    let finalText, draftText = null;
    if (useTwoStage) {
      const result = await callGeminiTwoStage(contents, sys, levelInfo.budget);
      finalText = result.final; draftText = result.draft;
    } else {
      finalText = await callGeminiOnce(modelUsed, contents, sys, levelInfo.budget);
    }
    removeThinkingIndicator(thinkingMsgId);
    const assistantMsg = { id: uid(), role: "assistant", text: finalText, thinkingTrace: draftText, model: modelUsed, thinkingLevel: level, timestamp: Date.now() };
    conv.messages.push(assistantMsg);
    touchConversation(conv);
    appendMessageToDOM(assistantMsg);
  } catch (err) {
    removeThinkingIndicator(thinkingMsgId);
    toast("再生成に失敗しました");
    console.error(err);
  } finally {
    state.isGenerating = false;
    updateSendButtonState();
  }
}

function editAndResend(msgId) {
  const conv = getCurrentConv();
  if (!conv) return;
  const idx = conv.messages.findIndex(m => m.id === msgId);
  if (idx === -1) return;
  const msg = conv.messages[idx];
  const newText = prompt("メッセージを編集：", msg.text);
  if (newText === null || newText.trim() === "") return;
  conv.messages = conv.messages.slice(0, idx);
  const editedMsg = { ...msg, text: newText.trim(), id: uid(), timestamp: Date.now() };
  conv.messages.push(editedMsg);
  touchConversation(conv);
  renderMessages(conv);
  renderSidebar();
  sendMessageInternalRetry(conv);
}

function updateSendButtonState() {
  const btn = document.getElementById("send-btn");
  btn.disabled = state.isGenerating;
}

/* ============================================================
   11. 出力ファイル検知（HTML / PDF / ZIP をコードブロックから生成）
   ============================================================ */
function detectAndRenderOutputFiles(bubbleEl, msg) {
  if (msg.role !== "assistant") return;
  const codeBlocks = bubbleEl.querySelectorAll(".code-block");
  codeBlocks.forEach(block => {
    const langSpan = block.querySelector(".code-block-header span");
    const lang = langSpan ? langSpan.textContent.toLowerCase() : "";
    const codeEl = block.querySelector("code");
    if (!codeEl) return;
    const code = codeEl.textContent;

    if (lang === "html" && code.length > 60) {
      addOutputFileCard(block, `output-${msg.id.slice(0, 6)}.html`, "🌐", "HTMLファイル", () => {
        downloadBlob(new Blob([code], { type: "text/html" }), `elite-ai-${msg.id.slice(0, 6)}.html`);
      });
    }
  });

  // ユーザーが明示的にPDF/ZIP出力を求めていた場合の簡易対応
  const wantsPdf = /pdf(化|で出力|にして)/i.test(msg.text || "");
  const wantsZip = /zip(化|で出力|にまとめ)/i.test(msg.text || "");
  if (wantsPdf) {
    addStandaloneOutputCard(bubbleEl, `document-${msg.id.slice(0,6)}.pdf`, "📕", "テキストをPDF化", () => exportMessageAsPdf(msg));
  }
}

function addOutputFileCard(afterEl, filename, icon, meta, onDownload) {
  const card = document.createElement("div");
  card.className = "output-file-card";
  card.innerHTML = `
    <div class="output-file-icon">${icon}</div>
    <div class="output-file-info">
      <div class="output-file-name">${escapeHtml(filename)}</div>
      <div class="output-file-meta">${escapeHtml(meta)}</div>
    </div>
    <div class="output-file-download">⬇️</div>`;
  card.style.cursor = "pointer";
  card.addEventListener("click", onDownload);
  afterEl.insertAdjacentElement("afterend", card);
}
function addStandaloneOutputCard(parentEl, filename, icon, meta, onDownload) {
  const card = document.createElement("div");
  card.className = "output-file-card";
  card.innerHTML = `
    <div class="output-file-icon">${icon}</div>
    <div class="output-file-info">
      <div class="output-file-name">${escapeHtml(filename)}</div>
      <div class="output-file-meta">${escapeHtml(meta)}</div>
    </div>
    <div class="output-file-download">⬇️</div>`;
  card.style.cursor = "pointer";
  card.addEventListener("click", onDownload);
  parentEl.appendChild(card);
}
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}
function exportMessageAsPdf(msg) {
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF();
  const lines = pdf.splitTextToSize(msg.text || "", 180);
  pdf.text(lines, 15, 20);
  pdf.save(`elite-ai-${msg.id.slice(0, 6)}.pdf`);
}

/* ============================================================
   12. 会話全体のダウンロード（Markdown / PDF / JSON）
   ============================================================ */
function downloadConversation(format) {
  const conv = getCurrentConv();
  if (!conv) { toast("会話が選択されていません"); return; }

  if (format === "markdown") {
    let md = `# ${conv.title}\n\n`;
    conv.messages.forEach(m => {
      md += `### ${m.role === "user" ? "🧑 You" : "🤖 ELITE AI"}\n\n${m.text || ""}\n\n---\n\n`;
    });
    downloadBlob(new Blob([md], { type: "text/markdown" }), `${conv.title}.md`);
  } else if (format === "json") {
    downloadBlob(new Blob([JSON.stringify(conv, null, 2)], { type: "application/json" }), `${conv.title}.json`);
  } else if (format === "pdf") {
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF();
    let y = 20;
    pdf.setFontSize(16); pdf.text(conv.title, 15, y); y += 10;
    pdf.setFontSize(11);
    conv.messages.forEach(m => {
      const prefix = m.role === "user" ? "[You] " : "[ELITE AI] ";
      const lines = pdf.splitTextToSize(prefix + (m.text || ""), 180);
      lines.forEach(line => {
        if (y > 280) { pdf.addPage(); y = 20; }
        pdf.text(line, 15, y); y += 7;
      });
      y += 4;
    });
    pdf.save(`${conv.title}.pdf`);
  }
  closeModal("download-modal");
  toast("ダウンロードしました");
}

function exportAllHistory() {
  downloadBlob(new Blob([JSON.stringify(state.conversations, null, 2)], { type: "application/json" }), `elite-ai-history-${Date.now()}.json`);
  toast("全履歴をエクスポートしました");
}

/* ============================================================
   13. ファイル添付・プレビュー
   ============================================================ */
async function handleFilesSelected(fileList) {
  for (const file of Array.from(fileList)) {
    if (file.size > 15 * 1024 * 1024) { toast(`${file.name} は15MBを超えるため添付できません`); continue; }
    const dataUrl = await fileToBase64(file);
    const base64 = dataUrl.split(",")[1];
    const isImage = file.type.startsWith("image/");
    state.attachedFiles.push({ name: file.name, mimeType: file.type || "application/octet-stream", size: file.size, dataUrl, base64, isImage });
  }
  renderFilePreviewStrip();
}
function renderFilePreviewStrip() {
  const strip = document.getElementById("file-preview-strip");
  strip.innerHTML = "";
  if (state.attachedFiles.length === 0) { strip.classList.add("hidden"); return; }
  strip.classList.remove("hidden");
  state.attachedFiles.forEach((f, idx) => {
    const chip = document.createElement("div");
    chip.className = "file-preview-chip";
    chip.innerHTML = `
      ${f.isImage ? `<img src="${f.dataUrl}" alt="">` : `<div class="file-icon-box">📄</div>`}
      <div>
        <div style="font-weight:600;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(f.name)}</div>
        <div style="color:var(--text-tertiary);font-size:11px;">${formatBytes(f.size)}</div>
      </div>
      <button class="remove-file">✕</button>`;
    chip.querySelector(".remove-file").addEventListener("click", () => {
      state.attachedFiles.splice(idx, 1);
      renderFilePreviewStrip();
    });
    strip.appendChild(chip);
  });
}

/* ============================================================
   14. Textarea 自動リサイズ
   ============================================================ */
function autoResizeTextarea(el) {
  el.style.height = "auto";
  el.style.height = Math.min(el.scrollHeight, 200) + "px";
}

/* ============================================================
   15. モーダル制御
   ============================================================ */
function openModal(id) { document.getElementById(id).classList.remove("hidden"); }
function closeModal(id) { document.getElementById(id).classList.add("hidden"); }
function closeAllDropdowns() {
  document.querySelectorAll(".dropdown-menu").forEach(d => d.classList.add("hidden"));
}

function showAuthOverlay() { openModal("auth-overlay"); document.getElementById("app").classList.add("hidden"); }
function hideAuthOverlay() { closeModal("auth-overlay"); document.getElementById("app").classList.remove("hidden"); }

function openSettingsModal(panelId = "panel-api") {
  openModal("settings-modal");
  switchSettingsPanel(panelId);
  populateSettingsFields();
}
function switchSettingsPanel(panelId) {
  document.querySelectorAll(".settings-nav-item").forEach(b => b.classList.toggle("active", b.dataset.panel === panelId));
  document.querySelectorAll(".settings-panel").forEach(p => p.classList.toggle("active", p.id === panelId));
}
function populateSettingsFields() {
  document.getElementById("api-key-input").value = state.settings.apiKey || "";
  document.getElementById("font-family-select").value = state.settings.fontFamily;
  document.getElementById("font-size-range").value = state.settings.fontSize;
  document.getElementById("font-size-value").textContent = state.settings.fontSize + "px";
  document.querySelectorAll(".theme-option").forEach(b => b.classList.toggle("active", b.dataset.theme === state.settings.theme));

  const pi = state.settings.personalIntelligence;
  document.getElementById("pi-nickname").value = pi.nickname || "";
  document.getElementById("pi-style").value = pi.style || "";
  document.getElementById("pi-memory-notes").value = pi.memoryNotes || "";
  document.getElementById("pi-auto-learn").checked = !!pi.autoLearn;

  document.getElementById("cloud-sync-toggle").checked = !!state.settings.cloudSync;
  document.getElementById("cloud-sync-toggle").disabled = !firebaseEnabled || (state.user && state.user.isLocal);

  document.getElementById("account-name").textContent = state.user?.name || "ゲスト";
  document.getElementById("account-email").textContent = state.user?.email || "（ローカルのみで利用中）";
  document.getElementById("account-avatar").textContent = (state.user?.name || "?")[0];
}

/* ============================================================
   16. テーマ / フォント 適用
   ============================================================ */
function applyTheme(theme) {
  let effective = theme;
  if (theme === "system") {
    effective = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  document.documentElement.setAttribute("data-theme", effective);
}
function applyFont() {
  document.documentElement.style.setProperty("--font-ui", state.settings.fontFamily);
  document.documentElement.style.setProperty("--font-size-base", state.settings.fontSize + "px");
}
function applySidebarState() {
  const collapsed = !!state.settings.sidebarCollapsed;
  document.getElementById("sidebar").classList.toggle("collapsed", collapsed);
  document.getElementById("app").classList.toggle("sidebar-collapsed", collapsed);
}
function openMobileSidebar() {
  document.getElementById("sidebar").classList.add("mobile-open");
  document.getElementById("sidebar-backdrop").classList.add("visible");
}
function closeMobileSidebar() {
  document.getElementById("sidebar").classList.remove("mobile-open");
  document.getElementById("sidebar-backdrop").classList.remove("visible");
}
function toggleSidebarCollapsed() {
  state.settings.sidebarCollapsed = !state.settings.sidebarCollapsed;
  applySidebarState();
  persistSettings();
}
function applyAllSettings() {
  applyTheme(state.settings.theme);
  applyFont();
  applySidebarState();
}

/* ============================================================
   17. UI初期反映（サイドバー・ユーザー表示・モデル/思考度ピル）
   ============================================================ */
function renderUserBadge() {
  document.getElementById("user-avatar").textContent = (state.user?.name || "?")[0];
  document.getElementById("user-name").textContent = state.user?.name || "ゲスト";
}
function renderModelPill() {
  document.getElementById("model-select-label").textContent = MODELS[state.selectedModel].label;
}
function renderThinkingPill() {
  const dots = document.querySelectorAll("#thinking-dots .dot");
  dots.forEach((d, i) => d.classList.toggle("active", i < state.thinkingLevel));
}

function renderAll() {
  applyAllSettings();
  renderUserBadge();
  renderModelPill();
  renderThinkingPill();
  renderSidebar();
  if (state.currentConvId) renderMessages(getCurrentConv());
  else renderEmptyChat();
}

/* ============================================================
   18. セットアップガイド（README相当）
   ============================================================ */
const SETUP_GUIDE_HTML = `
<h3>1. Gemini APIキーを取得する</h3>
<ol>
  <li><a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener">Google AI Studio</a> にアクセスし、Googleアカウントでログイン</li>
  <li>「Create API key」をクリックしてキーを発行</li>
  <li>ELITE AIの「設定 → API」にキーを貼り付けて保存</li>
</ol>

<h3>2.（任意）Firebaseでアカウント同期を有効にする</h3>
<ol>
  <li><a href="https://console.firebase.google.com/" target="_blank" rel="noopener">Firebase Console</a> で新規プロジェクトを作成</li>
  <li>「Authentication」→「Sign-in method」で「メール/パスワード」と「Google」を有効化</li>
  <li>「Firestore Database」を作成（本番モードでOK。ルールは後述）</li>
  <li>プロジェクト設定 →「マイアプリ」→ ウェブアプリを追加し、設定オブジェクトをコピー</li>
  <li>このプロジェクトの <code>firebase-config.js</code> を開き、コピーした値を貼り付け</li>
</ol>

<h3>3. Firestoreセキュリティルール（推奨）</h3>
<pre><code>rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/conversations/{convId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}</code></pre>

<h3>4. GitHub Pagesで公開する</h3>
<ol>
  <li>このフォルダ（index.html / style.css / app.js / firebase-config.js）をGitHubリポジトリにpush</li>
  <li>リポジトリの Settings → Pages → Branch を <code>main</code> に設定</li>
  <li>数分後、<code>https://ユーザー名.github.io/リポジトリ名/</code> で公開されます</li>
</ol>

<h3>5. Firebaseを設定しない場合</h3>
<p>firebase-config.js を編集しなければ、ELITE AIは自動的に「ローカルのみモード」で動作します。全データはブラウザのlocalStorageに保存され、他の端末とは同期されません。</p>
`;

function injectSetupGuide() {
  document.getElementById("setup-guide-content").innerHTML = SETUP_GUIDE_HTML;
}

/* ============================================================
   19. 共有・ピン留め・名前変更・削除（会話メニュー）
   ============================================================ */
function shareConversation() {
  const conv = getCurrentConv();
  if (!conv) { toast("会話が選択されていません"); return; }
  // クラウド未接続でも壊れないダミー共有リンク（実運用ではFirestoreに公開ドキュメントを作成する想定）
  const shareId = conv.id;
  const link = `${location.origin}${location.pathname}#share=${shareId}`;
  document.getElementById("share-link-input").value = link;
  openModal("share-modal");
}
function togglePinConversation() {
  const conv = getCurrentConv();
  if (!conv) return;
  conv.pinned = !conv.pinned;
  touchConversation(conv);
  renderSidebar();
  toast(conv.pinned ? "ピン留めしました" : "ピン留めを解除しました");
}
function openRenameModal() {
  const conv = getCurrentConv();
  if (!conv) { toast("会話が選択されていません"); return; }
  document.getElementById("rename-input").value = conv.title;
  openModal("rename-modal");
}
function confirmRename() {
  const conv = getCurrentConv();
  if (!conv) return;
  const newTitle = document.getElementById("rename-input").value.trim();
  if (!newTitle) return;
  conv.title = newTitle;
  touchConversation(conv);
  renderSidebar();
  updateChatTitle(conv);
  closeModal("rename-modal");
  toast("名前を変更しました");
}
function requestDeleteConversation() {
  if (!state.currentConvId) { toast("会話が選択されていません"); return; }
  state.pendingDeleteConvId = state.currentConvId;
  openModal("confirm-delete-modal");
}
function confirmDeleteConversation() {
  if (state.pendingDeleteConvId) {
    deleteConversation(state.pendingDeleteConvId);
    state.pendingDeleteConvId = null;
    toast("会話を削除しました");
  }
  closeModal("confirm-delete-modal");
}

/* ============================================================
   20. イベントリスナー登録
   ============================================================ */
function wireUpEventListeners() {
  // ---- Auth ----
  document.querySelectorAll(".auth-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".auth-tab").forEach(t => t.classList.remove("active"));
      document.querySelectorAll(".auth-form").forEach(f => f.classList.remove("active"));
      tab.classList.add("active");
      document.getElementById(tab.dataset.tab + "-form").classList.add("active");
    });
  });
  document.getElementById("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await handleLogin(document.getElementById("login-email").value, document.getElementById("login-password").value);
    } catch (err) { toast("ログインに失敗しました：" + (err.message || "")); }
  });
  document.getElementById("signup-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await handleSignup(
        document.getElementById("signup-name").value,
        document.getElementById("signup-email").value,
        document.getElementById("signup-password").value
      );
    } catch (err) { toast("アカウント作成に失敗しました：" + (err.message || "")); }
  });
  document.getElementById("google-signin").addEventListener("click", async () => {
    try { await handleGoogleSignin(); } catch (err) { toast("Googleログインに失敗しました"); }
  });
  document.getElementById("skip-auth").addEventListener("click", () => {
    ensureGuestUser();
    loadConversationsLocal();
    hideAuthOverlay();
    renderAll();
  });
  document.getElementById("open-setup-guide").addEventListener("click", (e) => {
    e.preventDefault();
    injectSetupGuide();
    openModal("setup-guide-modal");
  });

  // ---- モーダル共通クローズ ----
  document.querySelectorAll(".close-modal").forEach(btn => {
    btn.addEventListener("click", () => closeModal(btn.dataset.close));
  });
  document.querySelectorAll(".overlay").forEach(ov => {
    ov.addEventListener("click", (e) => { if (e.target === ov && ov.id !== "auth-overlay") closeModal(ov.id); });
  });

  // ---- サイドバー ----
  document.getElementById("new-chat-btn").addEventListener("click", () => {
    state.currentConvId = null;
    renderEmptyChat();
    updateChatTitle(null);
    document.getElementById("chat-input").focus();
    if (window.innerWidth <= 860) closeMobileSidebar();
  });
  document.getElementById("sidebar-toggle").addEventListener("click", toggleSidebarCollapsed);
  document.getElementById("sidebar-expand-btn").addEventListener("click", toggleSidebarCollapsed);
  document.getElementById("mobile-sidebar-toggle").addEventListener("click", () => {
    const sidebar = document.getElementById("sidebar");
    if (sidebar.classList.contains("mobile-open")) closeMobileSidebar();
    else openMobileSidebar();
  });
  document.getElementById("sidebar-backdrop").addEventListener("click", closeMobileSidebar);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && document.getElementById("sidebar").classList.contains("mobile-open")) closeMobileSidebar();
  });
  document.getElementById("history-search").addEventListener("input", (e) => renderSidebar(e.target.value));
  document.getElementById("open-settings").addEventListener("click", () => openSettingsModal("panel-api"));

  // ---- 会話メニュー（三点リーダー） ----
  document.getElementById("chat-menu-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    document.getElementById("chat-menu-dropdown").classList.toggle("hidden");
  });
  document.getElementById("chat-menu-dropdown").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    closeAllDropdowns();
    const action = btn.dataset.action;
    if (action === "share") shareConversation();
    else if (action === "pin") togglePinConversation();
    else if (action === "download") openModal("download-modal");
    else if (action === "rename") openRenameModal();
    else if (action === "delete") requestDeleteConversation();
  });
  document.getElementById("copy-share-link").addEventListener("click", () => {
    const input = document.getElementById("share-link-input");
    navigator.clipboard.writeText(input.value);
    toast("リンクをコピーしました");
  });
  document.getElementById("confirm-rename").addEventListener("click", confirmRename);
  document.getElementById("cancel-delete").addEventListener("click", () => closeModal("confirm-delete-modal"));
  document.getElementById("confirm-delete-btn").addEventListener("click", confirmDeleteConversation);
  document.querySelectorAll(".download-option").forEach(btn => {
    btn.addEventListener("click", () => downloadConversation(btn.dataset.format));
  });

  // ---- グローバルクリックでドロップダウン閉じる ----
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".dropdown-menu") && !e.target.closest("#chat-menu-btn") && !e.target.closest("#model-select-btn") && !e.target.closest("#thinking-select-btn")) {
      closeAllDropdowns();
    }
  });

  // ---- モデル選択 ----
  document.getElementById("model-select-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    document.getElementById("model-dropdown").classList.toggle("hidden");
  });
  document.getElementById("model-dropdown").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-model]");
    if (!btn) return;
    state.selectedModel = btn.dataset.model;
    renderModelPill();
    closeAllDropdowns();
    // Flash-Liteでは深い思考(Ⅳ・Ⅴ)は使えない旨を案内
    if (!MODELS[state.selectedModel].supportsDeepThink && state.thinkingLevel > 3) {
      state.thinkingLevel = 3;
      renderThinkingPill();
      toast("3.5 Flash-Liteでは思考度はⅢまでです");
    }
  });

  // ---- 思考度選択 ----
  document.getElementById("thinking-select-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    document.getElementById("thinking-dropdown").classList.toggle("hidden");
  });
  document.getElementById("thinking-dropdown").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-level]");
    if (!btn) return;
    const level = parseInt(btn.dataset.level, 10);
    if (level >= 4 && !MODELS[state.selectedModel].supportsDeepThink) {
      // Ⅳ・Ⅴ選択時は自動的に3.6 Flashへ切り替え
      state.selectedModel = "gemini-3.6-flash";
      renderModelPill();
      toast("思考度Ⅳ・Ⅴは3.6 Flashに切り替えます");
    }
    state.thinkingLevel = level;
    renderThinkingPill();
    closeAllDropdowns();
  });

  // ---- ファイル添付 ----
  document.getElementById("attach-btn").addEventListener("click", () => document.getElementById("file-input").click());
  document.getElementById("file-input").addEventListener("change", (e) => {
    handleFilesSelected(e.target.files);
    e.target.value = "";
  });

  // ---- 入力欄・送信 ----
  const chatInput = document.getElementById("chat-input");
  chatInput.addEventListener("input", () => autoResizeTextarea(chatInput));
  chatInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });
  document.getElementById("send-btn").addEventListener("click", sendMessage);

  // ---- 設定：ナビゲーション ----
  document.querySelectorAll(".settings-nav-item").forEach(btn => {
    btn.addEventListener("click", () => switchSettingsPanel(btn.dataset.panel));
  });

  // ---- 設定：API ----
  document.getElementById("toggle-key-visibility").addEventListener("click", () => {
    const input = document.getElementById("api-key-input");
    input.type = input.type === "password" ? "text" : "password";
  });
  document.getElementById("save-api-key").addEventListener("click", () => {
    state.settings.apiKey = document.getElementById("api-key-input").value.trim();
    persistSettings();
    const status = document.getElementById("api-key-status");
    status.textContent = "✓ 保存しました";
    status.className = "status-badge ok";
    toast("APIキーを保存しました");
  });

  // ---- 設定：外観 ----
  document.querySelectorAll(".theme-option").forEach(btn => {
    btn.addEventListener("click", () => {
      state.settings.theme = btn.dataset.theme;
      document.querySelectorAll(".theme-option").forEach(b => b.classList.toggle("active", b === btn));
      applyTheme(state.settings.theme);
      persistSettings();
    });
  });
  document.getElementById("font-family-select").addEventListener("change", (e) => {
    state.settings.fontFamily = e.target.value;
    applyFont(); persistSettings();
  });
  document.getElementById("font-size-range").addEventListener("input", (e) => {
    state.settings.fontSize = parseInt(e.target.value, 10);
    document.getElementById("font-size-value").textContent = state.settings.fontSize + "px";
    applyFont(); persistSettings();
  });

  // ---- 設定：パーソナルインテリジェンス ----
  document.getElementById("save-intelligence").addEventListener("click", () => {
    state.settings.personalIntelligence = {
      nickname: document.getElementById("pi-nickname").value.trim(),
      style: document.getElementById("pi-style").value.trim(),
      memoryNotes: document.getElementById("pi-memory-notes").value.trim(),
      autoLearn: document.getElementById("pi-auto-learn").checked
    };
    persistSettings();
    toast("パーソナルインテリジェンス設定を保存しました");
  });

  // ---- 設定：履歴管理 ----
  document.getElementById("export-all-history").addEventListener("click", exportAllHistory);
  document.getElementById("clear-all-history").addEventListener("click", () => {
    if (!confirm("すべての会話履歴を削除します。この操作は取り消せません。よろしいですか？")) return;
    state.conversations = [];
    persistConversationsLocal();
    state.currentConvId = null;
    renderSidebar();
    renderEmptyChat();
    toast("すべての履歴を削除しました");
  });
  document.getElementById("cloud-sync-toggle").addEventListener("change", (e) => {
    state.settings.cloudSync = e.target.checked;
    persistSettings();
    if (state.settings.cloudSync) {
      subscribeCloudConversations();
      toast("クラウド同期を有効にしました");
    } else {
      if (state.unsubscribeConversations) { state.unsubscribeConversations(); state.unsubscribeConversations = null; }
      loadConversationsLocal();
      renderSidebar();
      toast("クラウド同期を無効にしました");
    }
  });

  // ---- 設定：アカウント ----
  document.getElementById("logout-btn").addEventListener("click", handleLogout);

  // システムテーマ変更の追従
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (state.settings.theme === "system") applyTheme("system");
  });
}

/* ============================================================
   21. アプリ起動
   ============================================================ */
async function bootApp() {
  loadSettings();
  applyAllSettings();
  wireUpEventListeners();

  const fbReady = await initFirebase();

  if (fbReady) {
    onAuthStateChanged(auth, (fbUser) => {
      if (fbUser) {
        setUserFromFirebase(fbUser);
        loadConversationsLocal(); // ローカルキャッシュをまず表示
        if (state.settings.cloudSync) subscribeCloudConversations();
        hideAuthOverlay();
        renderAll();
      } else {
        showAuthOverlay();
      }
    });
  } else {
    // ローカルモード：認証UIは「スキップして使う」導線のみ実質有効
    showAuthOverlay();
  }
}

bootApp();
