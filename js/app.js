// app.js — OmniTranscript AI (Bản debug toàn diện by Claude)
// Khớp 100% với index.html hiện tại. Tự chứa mọi logic (không cần api.js).

// ==========================================
// TRẠNG THÁI TOÀN CỤC
// ==========================================
let sessionPassword = "";
let isVaultUnlocked = false;
let currentProject = null;
let projectsList = [];
let apiKeysList = [];
let exportRolesList = [];
let dynamicModels = {}; // { GoogleGemini: [...], Groq: [...] }

let activeRecordingStream = null;
let mediaRecorderInstance = null;
let recordedChunksData = [];
let recordingStartTime = 0;
let recordingTimerInterval = null;
let selectedAudioBlob = null;
let selectedAudioDuration = 0;

// Danh sách URL blob cần dọn dẹp để tránh rò rỉ bộ nhớ
let objectUrlsToRevoke = [];

// Cấu hình provider mặc định (model động sẽ ghi đè nếu bấm Cập nhật)
const DEFAULT_MODELS = {
  GoogleGemini: ["gemini-2.0-flash", "gemini-2.5-flash", "gemini-1.5-flash"],
  Groq: ["whisper-large-v3-turbo", "whisper-large-v3"],
  Deepgram: ["nova-2"]
};

// ==========================================
// KHỞI TẠO
// ==========================================
document.addEventListener("DOMContentLoaded", async () => {
  try {
    await initIndexedDB();
    await loadInitialData();
    setupEventListeners();
    showToast("Hệ thống OmniTranscript AI đã sẵn sàng!", "success");
  } catch (error) {
    console.error("Lỗi khởi tạo:", error);
    showToast("Lỗi khởi động hệ thống. Vui lòng tải lại trang.", "error");
  }
});

async function loadInitialData() {
  projectsList = await getAllRecords(STORE_PROJECTS);
  renderProjectList();

  exportRolesList = await getAllRecords(STORE_EXPORT_ROLES);
  renderExportRoles();
  updateExportRoleSelects();

  // Nạp model đã lưu (nếu có)
  try {
    const savedModels = await getRecord(STORE_APP_SETTINGS, "dynamicModels");
    dynamicModels = (savedModels && savedModels.settingValue) ? savedModels.settingValue : { ...DEFAULT_MODELS };
  } catch (e) {
    dynamicModels = { ...DEFAULT_MODELS };
  }

  updateVaultUI();
}

// ==========================================
// GẮN SỰ KIỆN (khớp đúng ID trong index.html)
// ==========================================
function setupEventListeners() {
  bind("btn-new-project", "click", () => openModal("new-project-modal"));
  bind("btn-close-new-project", "click", () => closeModal("new-project-modal"));
  bind("btn-cancel-create", "click", () => closeModal("new-project-modal"));
  bind("btn-open-vault", "click", () => { openModal("vault-modal"); updateVaultUI(); });
  bind("btn-close-vault", "click", () => closeModal("vault-modal"));
  bind("btn-open-settings", "click", () => { openModal("settings-modal"); renderExportRolesTable(); });
  bind("btn-close-settings", "click", () => closeModal("settings-modal"));

  // Nguồn âm thanh: tab upload / record
  bind("tab-btn-upload", "click", () => switchSourceTab("upload"));
  bind("tab-btn-record", "click", () => switchSourceTab("record"));
  bind("input-audio-file", "change", handleAudioFileSelect);
  bind("btn-record-audio", "click", startRecording);
  bind("btn-stop-record", "click", stopRecording);
  bind("btn-submit-create-project", "click", createNewProject);

  // Vault
  bind("btn-submit-vault-password", "click", unlockVault);
  bind("btn-lock-vault", "click", lockVault);
  bind("btn-save-api-key", "click", addNewApiKey);
  bind("btn-toggle-vault-password-visibility", "click", () => togglePassword("vault-password-input"));

  // Xử lý dự án
  bind("btn-start-processing", "click", processCurrentProject);
  bind("btn-resume-processing", "click", processCurrentProject);
  bind("btn-save-project-changes", "click", saveProjectChanges);

  // Tabs công cụ bên phải
  bind("tab-btn-transcript", "click", () => switchToolTab("transcript"));
  bind("tab-btn-summary", "click", () => switchToolTab("summary"));
  bind("tab-btn-export", "click", () => switchToolTab("export"));

  // Công cụ AI
  bind("btn-generate-summary", "click", generateSummaryWithAI);
  bind("btn-translate-transcript", "click", translateCurrentTranscript);
  bind("btn-ai-polish", "click", polishTranscript);
  bind("btn-stitch-transcript", "click", restitchTranscript);
  bind("btn-apply-diarization", "click", saveDiarizationMap);
  bind("btn-toggle-diarization-map", "click", () => {
    document.getElementById("diarization-mapping-panel")?.classList.toggle("hidden");
  });

  // Export
  bind("btn-download-md", "click", exportMarkdown);
  bind("btn-copy-md", "click", copyMarkdown);
  bind("btn-download-srt", "click", exportSRT);
  bind("btn-download-vtt", "click", exportVTT);
  bind("btn-download-json", "click", exportJSON);
  bind("select-export-role", "change", refreshMarkdownPreview);
  bind("btn-refresh-roles", "click", () => { updateExportRoleSelects(); refreshMarkdownPreview(); });

  // Settings
  bind("btn-save-export-role", "click", saveExportRole);
  bind("select-app-theme", "change", (e) => setTheme(e.target.value));

  // Nút cập nhật model (tạo động bên trong vault - xem addModelUpdateButton)
  addModelUpdateButton();

  // Chunk duration slider
  const slider = document.getElementById("input-chunk-duration");
  if (slider) {
    slider.addEventListener("input", () => {
      const el = document.getElementById("val-chunk-duration");
      if (el) el.textContent = slider.value + "s";
    });
  }
}

function bind(id, event, handler) {
  const el = document.getElementById(id);
  if (el) el.addEventListener(event, handler);
}

// ==========================================
// MODAL & UI HELPERS
// ==========================================
function openModal(id) { document.getElementById(id)?.classList.remove("hidden"); }
function closeModal(id) { document.getElementById(id)?.classList.add("hidden"); }

function togglePassword(id) {
  const el = document.getElementById(id);
  if (el) el.type = el.type === "password" ? "text" : "password";
}

function switchSourceTab(tab) {
  const up = document.getElementById("source-upload-container");
  const rec = document.getElementById("source-record-container");
  const btnUp = document.getElementById("tab-btn-upload");
  const btnRec = document.getElementById("tab-btn-record");
  if (tab === "upload") {
    up?.classList.remove("hidden"); rec?.classList.add("hidden");
    btnUp?.classList.add("bg-white", "text-slate-800", "shadow-sm");
    btnRec?.classList.remove("bg-white", "text-slate-800", "shadow-sm");
  } else {
    rec?.classList.remove("hidden"); up?.classList.add("hidden");
    btnRec?.classList.add("bg-white", "text-slate-800", "shadow-sm");
    btnUp?.classList.remove("bg-white", "text-slate-800", "shadow-sm");
  }
}

function switchToolTab(tab) {
  const tabs = ["transcript", "summary", "export"];
  tabs.forEach(t => {
    const content = document.getElementById("tab-content-" + t);
    const btn = document.getElementById("tab-btn-" + t);
    if (t === tab) {
      content?.classList.remove("hidden");
      btn?.classList.add("border-indigo-600", "text-indigo-600");
      btn?.classList.remove("border-transparent", "text-slate-500");
    } else {
      content?.classList.add("hidden");
      btn?.classList.remove("border-indigo-600", "text-indigo-600");
      btn?.classList.add("border-transparent", "text-slate-500");
    }
  });
  if (tab === "export") refreshMarkdownPreview();
}

function setTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
}

// ==========================================
// MÃ HÓA (WebCrypto AES-GCM) — gộp từ api.js
// ==========================================
async function deriveKey(password, salt) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw", enc.encode(password), { name: "PBKDF2" }, false, ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
    keyMaterial, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]
  );
}

async function encryptData(plainText, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  const enc = new TextEncoder();
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(plainText));
  return JSON.stringify({
    ciphertext: b64(new Uint8Array(encrypted)),
    iv: b64(iv),
    salt: b64(salt)
  });
}

async function decryptData(encryptedJson, password) {
  const { ciphertext, iv, salt } = JSON.parse(encryptedJson);
  const key = await deriveKey(password, unb64(salt));
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: unb64(iv) }, key, unb64(ciphertext)
  );
  return new TextDecoder().decode(decrypted);
}

function b64(arr) { return btoa(String.fromCharCode(...arr)); }
function unb64(str) { return new Uint8Array(atob(str).split("").map(c => c.charCodeAt(0))); }

// ==========================================
// VAULT
// ==========================================
async function unlockVault() {
  const input = document.getElementById("vault-password-input");
  const password = input.value;
  if (!password) { showToast("Vui lòng nhập mật khẩu Vault!", "warning"); return; }

  sessionPassword = password;
  input.value = "";

  try {
    const keys = await getAllRecords(STORE_API_KEYS);
    if (keys.length > 0) {
      await decryptData(keys[0].encryptedKeyData, sessionPassword); // thử giải mã để kiểm tra mật khẩu
    }
    isVaultUnlocked = true;
    apiKeysList = keys;
    // Ghi nhớ mật khẩu nếu người dùng tích chọn
    const remember = document.getElementById("remember-vault-check");
    if (remember && remember.checked) localStorage.setItem(REMEMBER_KEY, password);
    else localStorage.removeItem(REMEMBER_KEY);
    updateVaultUI();
    showToast("Mở khóa Vault thành công!", "success");
  } catch (e) {
    sessionPassword = "";
    isVaultUnlocked = false;
    updateVaultUI();
    showToast("Mật khẩu không đúng hoặc dữ liệu lỗi!", "error");
  }
}

function lockVault() {
  sessionPassword = "";
  isVaultUnlocked = false;
  apiKeysList = [];
  localStorage.removeItem(REMEMBER_KEY);
  updateVaultUI();
  showToast("Đã khóa Vault.", "info");
}

function updateVaultUI() {
  const badge = document.getElementById("vault-status-badge");
  const unlockedContent = document.getElementById("vault-unlocked-content");
  const lockedPlaceholder = document.getElementById("vault-locked-placeholder");

  if (isVaultUnlocked) {
    if (badge) badge.innerHTML = `<i class="fa-solid fa-lock-open mr-1"></i>Đã Mở Khóa`;
    if (badge) badge.className = "px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30";
    unlockedContent?.classList.remove("hidden");
    lockedPlaceholder?.classList.add("hidden");
    loadKeysList();
  } else {
    if (badge) badge.innerHTML = `<i class="fa-solid fa-lock mr-1"></i>Đã Khóa`;
    if (badge) badge.className = "px-2 py-0.5 rounded text-[10px] font-bold bg-rose-500/20 text-rose-400 border border-rose-500/30";
    unlockedContent?.classList.add("hidden");
    lockedPlaceholder?.classList.remove("hidden");
  }
}

async function loadKeysList() {
  if (!isVaultUnlocked) return;
  apiKeysList = await getAllRecords(STORE_API_KEYS);
  renderApiKeyList();
}

async function addNewApiKey() {
  if (!isVaultUnlocked) { showToast("Vui lòng mở khóa Vault trước!", "warning"); return; }
  const provider = document.getElementById("select-provider").value;
  const alias = document.getElementById("input-key-alias").value.trim();
  const rawKey = document.getElementById("input-api-key").value.trim();
  if (!alias || !rawKey) { showToast("Vui lòng nhập đủ Tên gợi nhớ và API Key!", "warning"); return; }

  try {
    const encrypted = await encryptData(rawKey, sessionPassword);
    await addRecord(STORE_API_KEYS, {
      keyId: generateUUID(), providerName: provider, encryptedKeyData: encrypted,
      aliasName: alias, isActive: true, createdAt: Date.now(), updatedAt: Date.now(),
      requestCount: 0, cooldownUntil: 0, lastUsed: 0
    });
    document.getElementById("input-key-alias").value = "";
    document.getElementById("input-api-key").value = "";
    showToast("Đã thêm & mã hóa API Key!", "success");
    await loadKeysList();
  } catch (e) {
    showToast("Lỗi mã hóa key: " + e.message, "error");
  }
}

async function decryptApiKey(keyObj) {
  return await decryptData(keyObj.encryptedKeyData, sessionPassword);
}

async function deleteApiKey(keyId) {
  if (!confirm("Xóa API Key này?")) return;
  await deleteRecord(STORE_API_KEYS, keyId);
  showToast("Đã xóa API Key.", "success");
  await loadKeysList();
}

async function toggleApiKeyActive(keyId) {
  const k = apiKeysList.find(x => x.keyId === keyId);
  if (k) {
    k.isActive = !k.isActive; k.updatedAt = Date.now();
    await updateRecord(STORE_API_KEYS, keyId, k);
    await loadKeysList();
  }
}

// Test key
async function testApiKey(keyId) {
  const k = apiKeysList.find(x => x.keyId === keyId);
  if (!k) return;
  showToast(`Đang kiểm tra key "${k.aliasName}"...`, "info");
  try {
    const rawKey = await decryptApiKey(k);
    const ok = await checkKeyValidity(k.providerName, rawKey);
    showToast(ok ? `Key "${k.aliasName}" hoạt động tốt! ✅` : `Key "${k.aliasName}" KHÔNG hợp lệ ❌`, ok ? "success" : "error");
  } catch (e) {
    showToast("Lỗi test key: " + e.message, "error");
  }
}

async function checkKeyValidity(provider, apiKey) {
  try {
    if (provider === "Deepgram") {
      const r = await fetch("https://api.deepgram.com/v1/projects", { headers: { "Authorization": `Token ${apiKey}` } });
      return r.ok;
    }
    if (provider === "GoogleGemini") {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
      return r.ok;
    }
    if (provider === "Groq") {
      const r = await fetch("https://api.groq.com/openai/v1/models", { headers: { "Authorization": `Bearer ${apiKey}` } });
      return r.ok;
    }
  } catch (e) { return false; }
  return false;
}

// ==========================================
// CẬP NHẬT MODEL ĐỘNG
// ==========================================
function addModelUpdateButton() {
  // Chèn nút "Cập nhật Model" ngay cạnh dropdown provider trong vault
  const providerSelect = document.getElementById("select-provider");
  if (!providerSelect || document.getElementById("btn-update-models")) return;
  const btn = document.createElement("button");
  btn.id = "btn-update-models";
  btn.type = "button";
  btn.className = "mt-1 text-[10px] text-indigo-600 hover:underline";
  btn.innerHTML = `<i class="fa-solid fa-arrows-rotate"></i> Cập nhật danh sách Model mới nhất`;
  btn.addEventListener("click", updateModelsForCurrentProvider);
  providerSelect.parentElement.appendChild(btn);
}

async function updateModelsForCurrentProvider() {
  if (!isVaultUnlocked) { showToast("Mở khóa Vault trước để dùng key lấy model.", "warning"); return; }
  const provider = document.getElementById("select-provider").value;
  const keyObj = apiKeysList.find(k => k.providerName === provider && k.isActive);
  if (!keyObj) { showToast(`Chưa có key ${provider} để lấy model.`, "warning"); return; }

  showToast(`Đang lấy danh sách model ${provider}...`, "info");
  try {
    const rawKey = await decryptApiKey(keyObj);
    let models = [];
    if (provider === "GoogleGemini") {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${rawKey}`);
      const data = await r.json();
      models = (data.models || [])
        .filter(m => m.supportedGenerationMethods?.includes("generateContent"))
        .map(m => m.name.replace("models/", ""));
    } else if (provider === "Groq") {
      const r = await fetch("https://api.groq.com/openai/v1/models", { headers: { "Authorization": `Bearer ${rawKey}` } });
      const data = await r.json();
      models = (data.data || []).map(m => m.id).filter(id => id.includes("whisper") || id.includes("llama") || id.includes("gpt"));
    } else {
      models = DEFAULT_MODELS[provider] || [];
    }
    if (models.length) {
      dynamicModels[provider] = models;
      await updateRecord(STORE_APP_SETTINGS, "dynamicModels", { settingKey: "dynamicModels", settingValue: dynamicModels });
      showToast(`Đã cập nhật ${models.length} model cho ${provider}!`, "success");
    } else {
      showToast("Không lấy được model. Dùng danh sách mặc định.", "warning");
    }
  } catch (e) {
    showToast("Lỗi lấy model: " + e.message, "error");
  }
}

// Chọn model tối ưu (đầu tiên trong danh sách động, hoặc mặc định)
function getBestModel(provider) {
  const list = (dynamicModels[provider] && dynamicModels[provider].length) ? dynamicModels[provider] : DEFAULT_MODELS[provider];
  return list ? list[0] : "";
}

// ==========================================
// GHI ÂM & TẢI FILE
// ==========================================
async function handleAudioFileSelect(event) {
  const file = event.target.files[0];
  if (!file) return;
  selectedAudioBlob = file;
  selectedAudioDuration = await getAudioDuration(file);

  const info = document.getElementById("selected-file-info");
  info?.classList.remove("hidden");
  const nameEl = document.getElementById("selected-file-name");
  const sizeEl = document.getElementById("selected-file-size");
  if (nameEl) nameEl.textContent = file.name;
  if (sizeEl) sizeEl.textContent = (file.size / 1024 / 1024).toFixed(2) + " MB";

  const nameInput = document.getElementById("input-project-name");
  if (nameInput && !nameInput.value) nameInput.value = file.name.replace(/\.[^/.]+$/, "");
}

function getAudioDuration(file) {
  return new Promise((resolve) => {
    const audio = document.createElement("audio");
    const url = URL.createObjectURL(file);
    audio.src = url;
    audio.addEventListener("loadedmetadata", () => {
      const d = audio.duration;
      URL.revokeObjectURL(url);
      resolve(isFinite(d) && d > 0 ? d : 0);
    });
    audio.addEventListener("error", () => { URL.revokeObjectURL(url); resolve(0); });
  });
}

async function startRecording() {
  try {
    recordedChunksData = [];
    activeRecordingStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorderInstance = new MediaRecorder(activeRecordingStream);
    mediaRecorderInstance.ondataavailable = (e) => { if (e.data.size > 0) recordedChunksData.push(e.data); };
    mediaRecorderInstance.onstop = () => {
      selectedAudioBlob = new Blob(recordedChunksData, { type: "audio/webm" });
      selectedAudioDuration = (Date.now() - recordingStartTime) / 1000;
      const info = document.getElementById("selected-file-info");
      info?.classList.remove("hidden");
      const nameEl = document.getElementById("selected-file-name");
      if (nameEl) nameEl.textContent = "Ghi âm trực tiếp (" + formatTime(selectedAudioDuration) + ")";
      const nameInput = document.getElementById("input-project-name");
      if (nameInput && !nameInput.value) nameInput.value = "Ghi âm " + new Date().toLocaleDateString("vi-VN");
    };
    mediaRecorderInstance.start();
    recordingStartTime = Date.now();

    document.getElementById("recording-indicator")?.classList.add("recording-active");
    const status = document.getElementById("recording-status");
    if (status) status.textContent = "Đang ghi âm...";
    const recBtn = document.getElementById("btn-record-audio");
    const stopBtn = document.getElementById("btn-stop-record");
    if (recBtn) recBtn.disabled = true;
    if (stopBtn) { stopBtn.disabled = false; stopBtn.className = "bg-slate-700 hover:bg-slate-600 text-white text-xs font-semibold py-2 px-4 rounded-lg flex items-center gap-1.5 transition cursor-pointer"; }

    let s = 0;
    recordingTimerInterval = setInterval(() => {
      s++;
      const t = document.getElementById("recording-timer");
      if (t) t.textContent = formatTime(s);
    }, 1000);
  } catch (e) {
    console.error("Chi tiết lỗi micro:", e.name, e.message);
    let msg = "Không truy cập được micro. ";
    if (e.name === "NotAllowedError") msg += "Trình duyệt đã chặn quyền. Bấm biểu tượng 🔒 cạnh ô địa chỉ → cho phép Microphone → tải lại trang (F5).";
    else if (e.name === "NotFoundError") msg += "Máy không tìm thấy micro nào. Kiểm tra micro đã cắm/bật chưa.";
    else if (e.name === "NotReadableError") msg += "Micro đang bị ứng dụng khác dùng (Zoom, Teams...). Hãy đóng chúng lại.";
    else if (location.protocol === "file:") msg += "Bạn đang mở bằng file:// — hãy chạy qua Live Server (http://localhost).";
    else msg += "Lỗi: " + e.name;
    showToast(msg, "error");
  }
}

function stopRecording() {
  if (mediaRecorderInstance && mediaRecorderInstance.state !== "inactive") mediaRecorderInstance.stop();
  if (activeRecordingStream) activeRecordingStream.getTracks().forEach(t => t.stop());
  clearInterval(recordingTimerInterval);
  document.getElementById("recording-indicator")?.classList.remove("recording-active");
  const status = document.getElementById("recording-status");
  if (status) status.textContent = "Đã lưu bản ghi";
  const recBtn = document.getElementById("btn-record-audio");
  const stopBtn = document.getElementById("btn-stop-record");
  if (recBtn) recBtn.disabled = false;
  if (stopBtn) stopBtn.disabled = true;
  showToast("Đã dừng & lưu bản ghi.", "success");
}

// ==========================================
// TẠO DỰ ÁN
// ==========================================
async function createNewProject() {
  const name = document.getElementById("input-project-name").value.trim();
  const sourceLang = document.getElementById("select-source-language").value;
  const targetLang = document.getElementById("select-target-language").value;
  if (!name) { showToast("Vui lòng nhập tên dự án!", "warning"); return; }
  if (!selectedAudioBlob) { showToast("Vui lòng tải file hoặc ghi âm trước!", "warning"); return; }

  const btn = document.getElementById("btn-submit-create-project");
  if (btn) { btn.disabled = true; btn.textContent = "Đang khởi tạo..."; }

  try {
    const projectId = generateUUID();
    const chunkDur = parseInt(document.getElementById("input-chunk-duration")?.value || CHUNK_MAX_DURATION_SEC, 10);

    const newProject = {
      projectId, projectName: name, audioBlob: selectedAudioBlob,
      durationSeconds: selectedAudioDuration, status: "pending",
      sourceLanguage: sourceLang, targetLanguage: targetLang,
      createdAt: Date.now(), updatedAt: Date.now(),
      finalTranscript: "", summaryContent: "", diarizationMap: {}, chunkOrder: []
    };

    showToast("Đang cắt nhỏ âm thanh...", "info");
    const chunks = await sliceAudioIntoChunks(projectId, selectedAudioBlob, selectedAudioDuration, chunkDur);
    newProject.chunkOrder = chunks.map(c => c.chunkId);
    newProject.status = "chunked";

    await addRecord(STORE_PROJECTS, newProject);
    for (const c of chunks) await addRecord(STORE_CHUNKS, c);

    document.getElementById("input-audio-file").value = "";
    document.getElementById("input-project-name").value = "";
    document.getElementById("selected-file-info")?.classList.add("hidden");
    selectedAudioBlob = null; selectedAudioDuration = 0;

    closeModal("new-project-modal");
    await loadInitialData();
    showToast("Tạo dự án thành công!", "success");
    openProject(projectId);
  } catch (e) {
    console.error(e);
    showToast("Lỗi tạo dự án: " + e.message, "error");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Tạo dự án"; }
  }
}

// CẮT AUDIO: decode 1 LẦN duy nhất rồi cắt (chống crash file dài)
async function sliceAudioIntoChunks(projectId, audioBlob, totalDuration, chunkDur) {
  const chunks = [];
  const overlap = CHUNK_OVERLAP_SEC;
  const chunkDuration = chunkDur || CHUNK_MAX_DURATION_SEC;

  let audioBuffer = null;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const arrayBuf = await audioBlob.arrayBuffer();
    audioBuffer = await ctx.decodeAudioData(arrayBuf);
    if (!totalDuration || totalDuration <= 0) totalDuration = audioBuffer.duration;
    ctx.close();
  } catch (e) {
    console.warn("Không decode được audio, sẽ gửi cả file làm 1 chunk:", e);
  }

  if (!totalDuration || totalDuration <= 0) totalDuration = 60;

  let startTime = 0;
  while (startTime < totalDuration) {
    let endTime = Math.min(startTime + chunkDuration, totalDuration);
    if (endTime - startTime < CHUNK_MIN_DURATION_SEC && chunks.length > 0) {
      chunks[chunks.length - 1].endTimeSeconds = endTime;
      break;
    }
    let chunkBlob;
    if (audioBuffer) {
      chunkBlob = sliceBufferToWav(audioBuffer, startTime, endTime);
    } else {
      chunkBlob = audioBlob; // dự phòng: cả file
    }
    chunks.push({
      chunkId: generateUUID(), projectId,
      startTimeSeconds: startTime, endTimeSeconds: endTime,
      audioChunkBlob: chunkBlob, status: "pending", transcript: "",
      speakerLabel: "Speaker 1", providerUsed: "", retryCount: 0,
      errorMessage: "", rawApiResponse: null
    });
    if (!audioBuffer) break; // không decode được thì chỉ 1 chunk
    startTime = endTime - overlap;
    if (startTime < 0) startTime = 0;
    if (endTime >= totalDuration) break;
  }
  return chunks;
}

// Cắt trực tiếp từ AudioBuffer đã decode (nhanh, không tốn RAM lặp lại)
function sliceBufferToWav(audioBuffer, startTime, endTime) {
  const sr = audioBuffer.sampleRate;
  const startSample = Math.floor(startTime * sr);
  const endSample = Math.min(Math.floor(endTime * sr), audioBuffer.length);
  const frameCount = endSample - startSample;
  const numChan = audioBuffer.numberOfChannels;

  const out = { sampleRate: sr, numberOfChannels: numChan, length: frameCount, channels: [] };
  for (let ch = 0; ch < numChan; ch++) {
    out.channels.push(audioBuffer.getChannelData(ch).subarray(startSample, endSample));
  }
  return encodeWav(out);
}

function encodeWav(buf) {
  const numChan = buf.numberOfChannels;
  const length = buf.length * numChan * 2 + 44;
  const ab = new ArrayBuffer(length);
  const view = new DataView(ab);
  let pos = 0;
  const setU16 = (d) => { view.setUint16(pos, d, true); pos += 2; };
  const setU32 = (d) => { view.setUint32(pos, d, true); pos += 4; };

  setU32(0x46464952); setU32(length - 8); setU32(0x45564157);
  setU32(0x20746d66); setU32(16); setU16(1); setU16(numChan);
  setU32(buf.sampleRate); setU32(buf.sampleRate * 2 * numChan);
  setU16(numChan * 2); setU16(16);
  setU32(0x61746164); setU32(length - pos - 4);

  let offset = 0;
  while (pos < length) {
    for (let i = 0; i < numChan; i++) {
      let s = Math.max(-1, Math.min(1, buf.channels[i][offset] || 0));
      s = s < 0 ? s * 0x8000 : s * 0x7FFF;
      view.setInt16(pos, s, true); pos += 2;
    }
    offset++;
  }
  return new Blob([ab], { type: "audio/wav" });
}

// ==========================================
// GHÉP NỐI TRANSCRIPT (loại bỏ overlap trùng)
// ==========================================
function stitchTranscripts(a, b) {
  if (!a) return b || "";
  if (!b) return a || "";
  const wa = a.trim().split(/\s+/);
  const wb = b.trim().split(/\s+/);
  let maxOverlap = 0;
  const maxCheck = Math.min(wa.length, wb.length, 15);
  const clean = (s) => s.toLowerCase().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, "");
  for (let i = 1; i <= maxCheck; i++) {
    if (clean(wa.slice(-i).join(" ")) === clean(wb.slice(0, i).join(" "))) maxOverlap = i;
  }
  return maxOverlap > 0 ? a.trim() + " " + wb.slice(maxOverlap).join(" ") : a.trim() + " " + b.trim();
}

// ==========================================
// XỬ LÝ AI + XOAY VÒNG KEY THEO QUOTA (tính năng cốt lõi)
// ==========================================
async function processCurrentProject() {
  if (!currentProject) return;
  if (!isVaultUnlocked) { showToast("Mở khóa Vault trước khi xử lý!", "warning"); openModal("vault-modal"); return; }

  // Chỉ dùng key STT (Groq / Deepgram / Gemini) đang bật và không cooldown
  const now = Date.now();
  const sttKeys = apiKeysList.filter(k => k.isActive && (k.cooldownUntil || 0) < now &&
    ["Groq", "Deepgram", "GoogleGemini"].includes(k.providerName));
  if (sttKeys.length === 0) { showToast("Không có API Key STT khả dụng!", "warning"); openModal("vault-modal"); return; }

  const btn = document.getElementById("btn-start-processing");
  if (btn) { btn.disabled = true; btn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Đang xử lý...`; }
  // Bật chế độ chạy ngầm bền bỉ
  isProcessing = true;
  requestWakeLock();
  startSilentKeepAlive();

  try {
    currentProject.status = "processing";
    await updateRecord(STORE_PROJECTS, currentProject.projectId, currentProject);

    const allChunks = await getAllRecords(STORE_CHUNKS);
    const chunks = allChunks.filter(c => c.projectId === currentProject.projectId)
      .sort((a, b) => a.startTimeSeconds - b.startTimeSeconds);

    let done = 0;
    let keyIndex = 0; // con trỏ xoay vòng key

    for (const chunk of chunks) {
      if (chunk.status === "completed") { done++; updateProgress(done, chunks.length); continue; }
      chunk.status = "processing";
      await updateRecord(STORE_CHUNKS, chunk.chunkId, chunk);
      renderChunkList(chunks);

      let success = false, lastErr = "";
      // Thử tối đa số lượng key đang có (xoay vòng)
      for (let attempt = 0; attempt < sttKeys.length; attempt++) {
        const keyObj = sttKeys[(keyIndex + attempt) % sttKeys.length];
        if ((keyObj.cooldownUntil || 0) > Date.now()) continue; // key đang nghỉ

        try {
          const rawKey = await decryptApiKey(keyObj);
          showToast(`Đoạn ${formatTime(chunk.startTimeSeconds)} → ${keyObj.aliasName} (${keyObj.providerName})`, "info");
          const res = await transcribeChunk(chunk.audioChunkBlob, keyObj.providerName, rawKey, currentProject.sourceLanguage);

          if (res.transcript !== undefined) {
            chunk.status = "completed";
            chunk.transcript = res.transcript;
            chunk.speakerLabel = res.speaker || "Speaker 1";
            chunk.providerUsed = keyObj.providerName;
            chunk.rawApiResponse = null; // không lưu raw để tiết kiệm dung lượng
            await updateRecord(STORE_CHUNKS, chunk.chunkId, chunk);

            keyObj.requestCount = (keyObj.requestCount || 0) + 1;
            keyObj.lastUsed = Date.now();
            await updateRecord(STORE_API_KEYS, keyObj.keyId, keyObj);
            keyIndex = (keyIndex + attempt); // lần sau bắt đầu từ key này (cân bằng tải)
            success = true;
            break;
          }
        } catch (err) {
          lastErr = err.message;
          console.error(`Key ${keyObj.aliasName} lỗi:`, err);
          // Nếu là lỗi quota (429) → cho key nghỉ 60 giây rồi nhảy key kế tiếp
          if (/429|quota|rate/i.test(err.message)) {
            keyObj.cooldownUntil = Date.now() + 60000;
            await updateRecord(STORE_API_KEYS, keyObj.keyId, keyObj);
            showToast(`Key "${keyObj.aliasName}" hết quota tạm thời → xoay sang key khác.`, "warning");
          }
        }
      }

      if (!success) {
        chunk.status = "error";
        chunk.errorMessage = lastErr || "Tất cả key đều thất bại.";
        await updateRecord(STORE_CHUNKS, chunk.chunkId, chunk);
        renderChunkList(chunks);
        throw new Error(`Dừng tại đoạn ${formatTime(chunk.startTimeSeconds)}: ${chunk.errorMessage}. Bấm "Tiếp tục" để thử lại.`);
      }

      done++;
      updateProgress(done, chunks.length);
      renderChunkList(chunks);
    }

    // Ghép nối
    let full = "";
    for (const c of chunks) full = stitchTranscripts(full, c.transcript);
    currentProject.finalTranscript = full.trim();
    currentProject.status = "completed";
    await updateRecord(STORE_PROJECTS, currentProject.projectId, currentProject);

    const editor = document.getElementById("final-transcript-editor");
    if (editor) editor.value = full.trim();
    showToast("Hoàn tất phiên âm toàn dự án!", "success");
    notifyDone("✅ Phiên âm hoàn tất!", `Dự án "${currentProject.projectName}" đã xử lý xong.`);
  } catch (e) {
    showToast(e.message, "error");
    notifyDone("⚠️ Xử lý bị dừng", e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = `<i class="fa-solid fa-play"></i> Bắt đầu xử lý AI`; }
    // Tắt chế độ chạy ngầm
    isProcessing = false;
    releaseWakeLock();
    stopSilentKeepAlive();
    renderProjectDetail(currentProject.projectId);
    await loadInitialData();
  }
}

async function transcribeChunk(blob, provider, apiKey, lang) {
  if (provider === "Groq") return transcribeGroq(blob, apiKey, lang);
  if (provider === "Deepgram") return transcribeDeepgram(blob, apiKey, lang);
  if (provider === "GoogleGemini") return transcribeGemini(blob, apiKey, lang);
  throw new Error("Provider không hỗ trợ: " + provider);
}

// GROQ (Whisper) — endpoint OpenAI-compatible, multipart/form-data
async function transcribeGroq(blob, apiKey, lang) {
  const form = new FormData();
  form.append("file", blob, "audio.wav");
  form.append("model", getBestModel("Groq") || "whisper-large-v3-turbo");
  form.append("response_format", "json");
  if (lang) form.append("language", lang.split("-")[0]);
  const r = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST", headers: { "Authorization": `Bearer ${apiKey}` }, body: form
  });
  if (!r.ok) throw new Error(`Groq ${r.status}: ${await r.text()}`);
  const data = await r.json();
  return { transcript: (data.text || "").trim() };
}

async function transcribeDeepgram(blob, apiKey, lang) {
  const l = (lang || "vi").split("-")[0];
  const url = `https://api.deepgram.com/v1/listen?smart_format=true&punctuate=true&diarize=true&model=nova-2&language=${l}`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "Authorization": `Token ${apiKey}`, "Content-Type": blob.type || "audio/wav" },
    body: blob
  });
  if (!r.ok) throw new Error(`Deepgram ${r.status}: ${await r.text()}`);
  const data = await r.json();
  const alt = data.results?.channels?.[0]?.alternatives?.[0];
  return { transcript: (alt?.transcript || "").trim() };
}

async function transcribeGemini(blob, apiKey, lang) {
  const base64 = await blobToBase64(blob);
  const model = getBestModel("GoogleGemini") || "gemini-2.0-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const payload = {
    contents: [{ parts: [
      { inlineData: { mimeType: blob.type || "audio/wav", data: base64 } },
      { text: `Hãy phiên âm chính xác file audio này sang văn bản (ngôn ngữ: ${lang}). Chỉ trả về văn bản đã phiên âm, thêm dấu câu đầy đủ. KHÔNG giải thích, KHÔNG tóm tắt.` }
    ]}],
    generationConfig: { temperature: 0.1, maxOutputTokens: 8192 }
  };
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  if (!r.ok) throw new Error(`Gemini ${r.status}: ${await r.text()}`);
  const data = await r.json();
  return { transcript: (data.candidates?.[0]?.content?.parts?.[0]?.text || "").trim() };
}

// ==========================================
// LLM: TÓM TẮT / DỊCH / ĐÁNH BÓNG (dùng Gemini)
// ==========================================
async function getGeminiKeyForLLM() {
  const k = apiKeysList.find(x => x.isActive && x.providerName === "GoogleGemini" && (x.cooldownUntil || 0) < Date.now());
  if (!k) throw new Error("Cần một API Key Google Gemini đang bật để dùng tính năng này.");
  return await decryptApiKey(k);
}

async function callGeminiLLM(prompt, apiKey, systemInstruction = "") {
  const model = getBestModel("GoogleGemini") || "gemini-2.0-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const payload = { contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.3, maxOutputTokens: 8192 } };
  if (systemInstruction) payload.systemInstruction = { parts: [{ text: systemInstruction }] };
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  if (!r.ok) throw new Error(`Gemini LLM ${r.status}: ${await r.text()}`);
  const data = await r.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
}

async function generateSummaryWithAI() {
  if (!currentProject?.finalTranscript) { showToast("Chưa có transcript để tóm tắt!", "warning"); return; }
  const btn = document.getElementById("btn-generate-summary");
  if (btn) { btn.disabled = true; btn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Đang tóm tắt...`; }
  try {
    const key = await getGeminiKeyForLLM();
    const sys = `Bạn là trợ lý tóm tắt chuyên nghiệp. Tóm tắt bằng ${currentProject.targetLanguage || currentProject.sourceLanguage}.`;
    const prompt = `Tóm tắt nội dung sau theo cấu trúc: 1) Chủ đề chính; 2) Các điểm cốt lõi (gạch đầu dòng); 3) Hành động tiếp theo.\n\n---\n${currentProject.finalTranscript}\n---`;
    const summary = await callGeminiLLM(prompt, key, sys);
    currentProject.summaryContent = summary.trim();
    await updateRecord(STORE_PROJECTS, currentProject.projectId, currentProject);
    const view = document.getElementById("summary-content-view");
    if (view) view.innerHTML = escapeHtml(summary).replace(/\n/g, "<br>");
    showToast("Đã tạo tóm tắt!", "success");
  } catch (e) { showToast(e.message, "error"); }
  finally { if (btn) { btn.disabled = false; btn.innerHTML = `<i class="fa-solid fa-sparkles"></i> Tạo Tóm tắt AI`; } }
}

async function translateCurrentTranscript() {
  if (!currentProject?.finalTranscript) { showToast("Chưa có transcript để dịch!", "warning"); return; }
  const target = currentProject.targetLanguage;
  if (!target) { showToast("Dự án này không chọn ngôn ngữ dịch.", "warning"); return; }
  try {
    const key = await getGeminiKeyForLLM();
    showToast("Đang dịch...", "info");
    const sys = `Bạn là dịch giả chuyên nghiệp. Dịch sang: ${target}. Giữ nguyên nhãn người nói và mốc thời gian nếu có.`;
    const translated = await callGeminiLLM(`Dịch văn bản sau:\n---\n${currentProject.finalTranscript}\n---`, key, sys);
    const editor = document.getElementById("final-transcript-editor");
    if (editor) editor.value = translated;
    showToast("Đã dịch xong! (Nhớ bấm Lưu thay đổi nếu muốn giữ lại)", "success");
  } catch (e) { showToast(e.message, "error"); }
}

async function polishTranscript() {
  if (!currentProject?.finalTranscript) { showToast("Chưa có transcript để đánh bóng!", "warning"); return; }
  try {
    const key = await getGeminiKeyForLLM();
    showToast("Đang đánh bóng văn bản...", "info");
    const sys = `Bạn là biên tập viên. Sửa lỗi chính tả, dấu câu, bỏ từ đệm vô nghĩa, giữ nguyên ý và nhãn người nói. KHÔNG tóm tắt.`;
    const polished = await callGeminiLLM(`Biên tập văn bản sau:\n---\n${currentProject.finalTranscript}\n---`, key, sys);
    const editor = document.getElementById("final-transcript-editor");
    if (editor) editor.value = polished;
    showToast("Đã đánh bóng! (Bấm Lưu thay đổi để giữ lại)", "success");
  } catch (e) { showToast(e.message, "error"); }
}

async function restitchTranscript() {
  if (!currentProject) return;
  const allChunks = await getAllRecords(STORE_CHUNKS);
  const chunks = allChunks.filter(c => c.projectId === currentProject.projectId).sort((a, b) => a.startTimeSeconds - b.startTimeSeconds);
  let full = "";
  for (const c of chunks) full = stitchTranscripts(full, c.transcript);
  const editor = document.getElementById("final-transcript-editor");
  if (editor) editor.value = full.trim();
  showToast("Đã ghép nối lại.", "success");
}

async function saveProjectChanges() {
  if (!currentProject) return;
  const editor = document.getElementById("final-transcript-editor");
  if (editor) currentProject.finalTranscript = editor.value;
  currentProject.updatedAt = Date.now();
  await updateRecord(STORE_PROJECTS, currentProject.projectId, currentProject);
  showToast("Đã lưu thay đổi!", "success");
}

// ==========================================
// DỰ ÁN: MỞ / HIỂN THỊ / XÓA
// ==========================================
async function openProject(projectId) {
  const project = await getRecord(STORE_PROJECTS, projectId);
  if (!project) { showToast("Không tìm thấy dự án!", "error"); return; }
  currentProject = project;
  document.getElementById("welcome-screen")?.classList.add("hidden");
  document.getElementById("project-workspace")?.classList.remove("hidden");
  renderProjectDetail(projectId);
  switchToolTab("transcript");
}

async function renderProjectDetail(projectId) {
  if (!currentProject) return;
  const titleEl = document.getElementById("project-title");
  if (titleEl) titleEl.textContent = currentProject.projectName;
  const langEl = document.getElementById("project-languages-badge");
  if (langEl) langEl.innerHTML = `<i class="fa-solid fa-language mr-1"></i> ${currentProject.sourceLanguage} → ${currentProject.targetLanguage || "—"}`;
  const statusEl = document.getElementById("project-status");
  if (statusEl) statusEl.textContent = statusLabel(currentProject.status);

  // Audio player
  const player = document.getElementById("audio-source-player");
  if (player && currentProject.audioBlob) {
    const url = URL.createObjectURL(currentProject.audioBlob);
    objectUrlsToRevoke.push(url);
    player.src = url;
  }

  const editor = document.getElementById("final-transcript-editor");
  if (editor) editor.value = currentProject.finalTranscript || "";
  const summ = document.getElementById("summary-content-view");
  if (summ && currentProject.summaryContent) summ.innerHTML = escapeHtml(currentProject.summaryContent).replace(/\n/g, "<br>");

  const allChunks = await getAllRecords(STORE_CHUNKS);
  const chunks = allChunks.filter(c => c.projectId === projectId).sort((a, b) => a.startTimeSeconds - b.startTimeSeconds);
  renderChunkList(chunks);
  renderChunksGrid(chunks);
  renderDiarizationMap(chunks);
}

function renderChunkList(chunks) {
  const c = document.getElementById("chunks-list-container");
  if (!c) return;
  if (!chunks.length) { c.innerHTML = `<div class="text-center py-12 text-slate-400 text-sm">Chưa có phân đoạn.</div>`; return; }
  c.innerHTML = chunks.map((ch, i) => {
    let badge = { pending: "badge-pending", processing: "badge-processing", completed: "badge-completed", error: "badge-error" }[ch.status] || "badge-pending";
    const speaker = currentProject.diarizationMap?.[ch.speakerLabel] || ch.speakerLabel;
    return `<div class="chunk-item status-${ch.status}">
      <div class="flex items-center justify-between mb-1">
        <span class="text-xs font-semibold text-slate-500">#${i + 1} · ${formatTime(ch.startTimeSeconds)}–${formatTime(ch.endTimeSeconds)}</span>
        <span class="status-badge ${badge}">${statusLabel(ch.status)}${ch.providerUsed ? " · " + ch.providerUsed : ""}</span>
      </div>
      <div class="flex gap-2">
        <span class="text-xs font-bold text-amber-700 whitespace-nowrap">${escapeHtml(speaker)}</span>
        <p class="text-sm text-slate-700 flex-1">${ch.transcript ? escapeHtml(ch.transcript) : '<span class="italic text-slate-400">Chưa phiên âm</span>'}</p>
      </div>
    </div>`;
  }).join("");
}

function renderChunksGrid(chunks) {
  const grid = document.getElementById("chunks-grid");
  const prog = document.getElementById("chunks-progress-text");
  if (!grid) return;
  if (!chunks.length) { grid.innerHTML = `<span class="text-xs text-slate-400 italic">Chưa cắt nhỏ.</span>`; return; }
  const done = chunks.filter(c => c.status === "completed").length;
  if (prog) prog.textContent = `${done}/${chunks.length} Đã hoàn thành`;
  const color = { pending: "bg-slate-300", processing: "bg-blue-500 animate-pulse", completed: "bg-emerald-500", error: "bg-rose-500" };
  grid.innerHTML = chunks.map((c, i) => `<div title="Đoạn ${i + 1}: ${statusLabel(c.status)}" class="w-4 h-4 rounded ${color[c.status] || "bg-slate-300"}"></div>`).join("");
}

function renderDiarizationMap(chunks) {
  const c = document.getElementById("diarization-list");
  if (!c) return;
  const speakers = [...new Set(chunks.map(x => x.speakerLabel))];
  if (!speakers.length) { c.innerHTML = `<p class="text-xs text-amber-600 italic col-span-2">Chưa phát hiện người nói.</p>`; return; }
  c.innerHTML = speakers.map(sp => {
    const cur = currentProject.diarizationMap?.[sp] || sp;
    return `<div class="flex items-center gap-2">
      <span class="text-xs font-bold text-slate-600 w-20 truncate">${escapeHtml(sp)}:</span>
      <input type="text" data-speaker="${escapeHtml(sp)}" value="${escapeHtml(cur)}" class="diarization-input flex-1 border border-slate-200 rounded px-2 py-1 text-xs" placeholder="Tên thật...">
    </div>`;
  }).join("");
}

async function saveDiarizationMap() {
  if (!currentProject) return;
  const map = {};
  document.querySelectorAll(".diarization-input").forEach(inp => {
    const sp = inp.getAttribute("data-speaker");
    const name = inp.value.trim();
    if (name) map[sp] = name;
  });
  currentProject.diarizationMap = map;
  await updateRecord(STORE_PROJECTS, currentProject.projectId, currentProject);
  showToast("Đã cập nhật tên người nói!", "success");
  renderProjectDetail(currentProject.projectId);
}

async function deleteProject(projectId) {
  if (!confirm("Xóa dự án này và toàn bộ dữ liệu liên quan?")) return;
  await deleteRecord(STORE_PROJECTS, projectId);
  const allChunks = await getAllRecords(STORE_CHUNKS);
  for (const c of allChunks.filter(x => x.projectId === projectId)) await deleteRecord(STORE_CHUNKS, c.chunkId);
  if (currentProject?.projectId === projectId) {
    currentProject = null;
    document.getElementById("project-workspace")?.classList.add("hidden");
    document.getElementById("welcome-screen")?.classList.remove("hidden");
  }
  showToast("Đã xóa dự án.", "success");
  await loadInitialData();
}

// ==========================================
// EXPORT
// ==========================================
function buildMarkdown() {
  if (!currentProject) return "";
  const roleId = document.getElementById("select-export-role")?.value;
  const role = exportRolesList.find(r => r.roleId === roleId);
  let tpl = role ? role.markdownTemplate : "# {{PROJECT_NAME}}\n\n{{SUMMARY}}\n\n{{TRANSCRIPT}}";
  const map = {
    "{{PROJECT_NAME}}": currentProject.projectName,
    "{{createdAt}}": new Date(currentProject.createdAt).toLocaleString("vi-VN"),
    "{{date}}": new Date(currentProject.createdAt).toLocaleString("vi-VN"),
    "{{duration}}": formatTime(currentProject.durationSeconds),
    "{{SUMMARY}}": currentProject.summaryContent || "Chưa có tóm tắt.",
    "{{summary}}": currentProject.summaryContent || "Chưa có tóm tắt.",
    "{{TRANSCRIPT}}": document.getElementById("final-transcript-editor")?.value || currentProject.finalTranscript || "",
    "{{transcript}}": document.getElementById("final-transcript-editor")?.value || currentProject.finalTranscript || ""
  };
  for (const [k, v] of Object.entries(map)) tpl = tpl.split(k).join(v);
  return tpl;
}

function refreshMarkdownPreview() {
  const el = document.getElementById("markdown-preview");
  if (el) el.value = buildMarkdown();
}

function exportMarkdown() {
  if (!currentProject) return;
  downloadFile(buildMarkdown(), `${currentProject.projectName}.md`, "text/markdown");
  showToast("Đã tải file Markdown!", "success");
}

function copyMarkdown() {
  const text = document.getElementById("markdown-preview")?.value || buildMarkdown();
  navigator.clipboard.writeText(text).then(() => showToast("Đã copy Markdown!", "success"))
    .catch(() => showToast("Không copy được.", "error"));
}

async function exportSRT() {
  if (!currentProject) return;
  const chunks = await getProjectChunks();
  let srt = "";
  chunks.forEach((c, i) => {
    const sp = currentProject.diarizationMap?.[c.speakerLabel] || c.speakerLabel;
    srt += `${i + 1}\n${srtTime(c.startTimeSeconds)} --> ${srtTime(c.endTimeSeconds)}\n[${sp}]: ${c.transcript || "..."}\n\n`;
  });
  downloadFile(srt, `${currentProject.projectName}.srt`, "text/plain");
  showToast("Đã tải SRT!", "success");
}

async function exportVTT() {
  if (!currentProject) return;
  const chunks = await getProjectChunks();
  let vtt = "WEBVTT\n\n";
  chunks.forEach((c, i) => {
    const sp = currentProject.diarizationMap?.[c.speakerLabel] || c.speakerLabel;
    vtt += `${i + 1}\n${srtTime(c.startTimeSeconds).replace(",", ".")} --> ${srtTime(c.endTimeSeconds).replace(",", ".")}\n[${sp}]: ${c.transcript || "..."}\n\n`;
  });
  downloadFile(vtt, `${currentProject.projectName}.vtt`, "text/vtt");
  showToast("Đã tải VTT!", "success");
}

async function exportJSON() {
  if (!currentProject) return;
  const chunks = await getProjectChunks();
  const data = {
    project: { name: currentProject.projectName, duration: currentProject.durationSeconds, sourceLanguage: currentProject.sourceLanguage, targetLanguage: currentProject.targetLanguage },
    summary: currentProject.summaryContent,
    transcript: currentProject.finalTranscript,
    segments: chunks.map(c => ({ start: c.startTimeSeconds, end: c.endTimeSeconds, speaker: currentProject.diarizationMap?.[c.speakerLabel] || c.speakerLabel, text: c.transcript }))
  };
  downloadFile(JSON.stringify(data, null, 2), `${currentProject.projectName}.json`, "application/json");
  showToast("Đã tải JSON!", "success");
}

async function getProjectChunks() {
  const all = await getAllRecords(STORE_CHUNKS);
  return all.filter(c => c.projectId === currentProject.projectId).sort((a, b) => a.startTimeSeconds - b.startTimeSeconds);
}

function downloadFile(content, filename, type) {
  const blob = new Blob([content], { type: type + ";charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url); // dọn ngay
}

// ==========================================
// EXPORT ROLES (Settings)
// ==========================================
async function saveExportRole() {
  const name = document.getElementById("input-role-name").value.trim();
  const tpl = document.getElementById("textarea-role-template").value.trim();
  if (!name || !tpl) { showToast("Điền đủ Tên vai trò và Mẫu Markdown!", "warning"); return; }
  await addRecord(STORE_EXPORT_ROLES, { roleId: "role-" + generateUUID().slice(0, 8), roleName: name, markdownTemplate: tpl, createdAt: Date.now(), updatedAt: Date.now() });
  document.getElementById("input-role-name").value = "";
  document.getElementById("textarea-role-template").value = "";
  showToast("Đã lưu vai trò xuất bản!", "success");
  await loadInitialData();
  renderExportRolesTable();
}

async function deleteExportRole(roleId) {
  if (!confirm("Xóa vai trò này?")) return;
  await deleteRecord(STORE_EXPORT_ROLES, roleId);
  showToast("Đã xóa vai trò.", "success");
  await loadInitialData();
  renderExportRolesTable();
}

function renderExportRoles() { /* sidebar không cần, giữ trống */ }

function renderExportRolesTable() {
  const c = document.getElementById("export-roles-list");
  if (!c) return;
  if (!exportRolesList.length) { c.innerHTML = `<tr><td colspan="3" class="p-4 text-center text-slate-400">Chưa có vai trò.</td></tr>`; return; }
  c.innerHTML = exportRolesList.map(r => `<tr>
    <td class="p-3 font-semibold">${escapeHtml(r.roleName)}</td>
    <td class="p-3 text-slate-500">${escapeHtml(r.markdownTemplate.slice(0, 50))}...</td>
    <td class="p-3 text-right"><button onclick="deleteExportRole('${r.roleId}')" class="text-rose-600 hover:text-rose-800"><i class="fa-solid fa-trash"></i></button></td>
  </tr>`).join("");
}

function updateExportRoleSelects() {
  ["select-export-role", "select-default-export-role"].forEach(id => {
    const sel = document.getElementById(id);
    if (sel) sel.innerHTML = exportRolesList.map(r => `<option value="${r.roleId}">${escapeHtml(r.roleName)}</option>`).join("");
  });
}

// ==========================================
// RENDER DANH SÁCH DỰ ÁN (sidebar) + API KEYS
// ==========================================
function renderProjectList() {
  const c = document.getElementById("project-list");
  const count = document.getElementById("project-count");
  if (count) count.textContent = projectsList.length;
  if (!c) return;
  if (!projectsList.length) {
    c.innerHTML = `<div class="text-center py-8 text-slate-500 text-xs"><i class="fa-regular fa-folder-open text-2xl mb-2 block"></i>Chưa có dự án nào.</div>`;
    return;
  }
  projectsList.sort((a, b) => b.createdAt - a.createdAt);
  c.innerHTML = projectsList.map(p => `
    <div class="bg-slate-800 hover:bg-slate-700 rounded-lg p-3 cursor-pointer transition group" onclick="openProject('${p.projectId}')">
      <div class="flex items-center justify-between">
        <span class="text-sm font-medium text-white truncate">${escapeHtml(p.projectName)}</span>
        <button onclick="event.stopPropagation(); deleteProject('${p.projectId}')" class="text-slate-500 hover:text-rose-400 opacity-0 group-hover:opacity-100 transition"><i class="fa-solid fa-trash text-xs"></i></button>
      </div>
      <div class="flex items-center gap-2 mt-1 text-[10px] text-slate-400">
        <span>${formatTime(p.durationSeconds)}</span><span>·</span><span>${statusLabel(p.status)}</span>
      </div>
    </div>`).join("");
}

function renderApiKeyList() {
  const c = document.getElementById("api-keys-list");
  const count = document.getElementById("api-keys-count");
  if (count) count.textContent = apiKeysList.length;
  if (!c) return;
  if (!apiKeysList.length) { c.innerHTML = `<tr><td colspan="5" class="p-4 text-center text-slate-400 italic">Chưa có khóa API nào.</td></tr>`; return; }
  c.innerHTML = apiKeysList.map(k => `<tr>
    <td class="p-3"><span class="bg-indigo-100 text-indigo-800 text-[10px] px-2 py-0.5 rounded-full font-medium">${k.providerName}</span></td>
    <td class="p-3 font-semibold">${escapeHtml(k.aliasName)}</td>
    <td class="p-3 text-slate-400">•••••• <span class="text-[9px]">(mã hóa)</span> ${k.requestCount ? `· ${k.requestCount} lần dùng` : ""}</td>
    <td class="p-3"><label class="relative inline-flex items-center cursor-pointer">
      <input type="checkbox" class="sr-only peer" ${k.isActive ? "checked" : ""} onchange="toggleApiKeyActive('${k.keyId}')">
      <div class="w-9 h-5 bg-slate-200 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-600"></div>
    </label></td>
    <td class="p-3 text-right whitespace-nowrap">
      <button onclick="testApiKey('${k.keyId}')" class="text-emerald-600 hover:text-emerald-800 mr-2" title="Test key"><i class="fa-solid fa-vial"></i></button>
      <button onclick="deleteApiKey('${k.keyId}')" class="text-rose-600 hover:text-rose-800" title="Xóa"><i class="fa-solid fa-trash"></i></button>
    </td>
  </tr>`).join("");
}

// ==========================================
// TIỆN ÍCH
// ==========================================
function updateProgress(cur, total) {
  const prog = document.getElementById("chunks-progress-text");
  if (prog) prog.textContent = `${cur}/${total} Đã hoàn thành`;
}

function statusLabel(s) {
  return { pending: "Chờ xử lý", chunked: "Đã cắt đoạn", processing: "Đang xử lý", completed: "Hoàn thành", error: "Lỗi" }[s] || s;
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result.split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function formatTime(sec) {
  if (isNaN(sec) || sec == null) return "00:00";
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60);
  const p = (n) => n.toString().padStart(2, "0");
  return h > 0 ? `${p(h)}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`;
}

function srtTime(sec) {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60), ms = Math.floor((sec % 1) * 1000);
  const p = (n, l = 2) => n.toString().padStart(l, "0");
  return `${p(h)}:${p(m)}:${p(s)},${p(ms, 3)}`;
}

function escapeHtml(str) {
  if (str == null) return "";
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function generateUUID() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0, v = c === "x" ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// ==========================================
// TOAST THÔNG BÁO (bổ sung)
// ==========================================
function showToast(message, type = "info") {
  let container = document.getElementById("toast-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "toast-container";
    container.className = "fixed bottom-5 right-5 z-[100] flex flex-col gap-2 max-w-sm";
    document.body.appendChild(container);
  }

  const toast = document.createElement("div");
  let bgClass = "bg-slate-800 text-white";
  let icon = "fa-circle-info";
  if (type === "success") { bgClass = "bg-emerald-600 text-white"; icon = "fa-circle-check"; }
  else if (type === "error") { bgClass = "bg-rose-600 text-white"; icon = "fa-circle-xmark"; }
  else if (type === "warning") { bgClass = "bg-amber-500 text-slate-900"; icon = "fa-triangle-exclamation"; }

  toast.className = `${bgClass} p-3 rounded-xl shadow-lg flex items-center gap-3 transition-all duration-300 transform translate-y-5 opacity-0`;
  toast.innerHTML = `<i class="fa-solid ${icon} text-lg"></i><span class="text-sm font-semibold">${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => { toast.classList.remove("translate-y-5", "opacity-0"); }, 10);
  setTimeout(() => {
    toast.classList.add("translate-y-5", "opacity-0");
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// ==========================================
// RESPONSIVE: NÚT MENU DI ĐỘNG
// ==========================================
(function setupMobileMenu() {
  function ready() {
    const btn = document.getElementById("btn-mobile-menu");
    const sidebar = document.getElementById("main-sidebar");
    const overlay = document.getElementById("sidebar-overlay");
    if (!btn || !sidebar || !overlay) return;

    const open = () => { sidebar.classList.add("open"); overlay.classList.remove("hidden"); };
    const close = () => { sidebar.classList.remove("open"); overlay.classList.add("hidden"); };

    btn.addEventListener("click", () => {
      sidebar.classList.contains("open") ? close() : open();
    });
    overlay.addEventListener("click", close);

    // Bấm vào một dự án hoặc "Tạo dự án mới" thì tự đóng menu trên mobile
    sidebar.addEventListener("click", (e) => {
      if (window.innerWidth < 1024 && e.target.closest("[onclick], button")) {
        setTimeout(close, 150);
      }
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ready);
  else ready();
})();


// ==========================================
// GHI NHỚ MẬT KHẨU VAULT (tiện lợi cho dùng cá nhân)
// ==========================================
const REMEMBER_KEY = "omni_vault_remember";

// Tự mở khóa khi mở app nếu đã bật ghi nhớ
async function tryAutoUnlock() {
  const saved = localStorage.getItem(REMEMBER_KEY);
  if (!saved) return;
  try {
    sessionPassword = saved;
    const keys = await getAllRecords(STORE_API_KEYS);
    if (keys.length > 0) await decryptData(keys[0].encryptedKeyData, sessionPassword);
    isVaultUnlocked = true;
    apiKeysList = keys;
    updateVaultUI();
    showToast("Đã tự động mở khóa Vault (ghi nhớ mật khẩu).", "success");
  } catch (e) {
    sessionPassword = "";
    isVaultUnlocked = false;
    localStorage.removeItem(REMEMBER_KEY); // mật khẩu lưu bị sai -> xóa
    updateVaultUI();
  }
}

// Chèn ô "Ghi nhớ mật khẩu" vào modal Vault
function injectRememberCheckbox() {
  if (document.getElementById("remember-vault-wrap")) return;
  const btn = document.getElementById("btn-submit-vault-password");
  if (!btn) return;
  const wrap = document.createElement("label");
  wrap.id = "remember-vault-wrap";
  wrap.className = "flex items-center gap-2 mt-3 text-xs text-slate-600 cursor-pointer";
  wrap.innerHTML = `
    <input type="checkbox" id="remember-vault-check" class="w-4 h-4 accent-indigo-600">
    <span>Ghi nhớ mật khẩu & tự mở khóa trên máy này (chỉ dùng nếu là máy cá nhân)</span>`;
  // đặt ngay dưới khu vực nhập mật khẩu
  btn.closest(".bg-slate-50")?.appendChild(wrap);
  // đồng bộ trạng thái tick với thực tế
  document.getElementById("remember-vault-check").checked = !!localStorage.getItem(REMEMBER_KEY);
}

// Chạy khi tải xong
(function initRemember() {
  function ready() {
    injectRememberCheckbox();
    tryAutoUnlock();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ready);
  else ready();
})();


// ==========================================
// MODAL HƯỚNG DẪN
// ==========================================
(function setupGuide() {
  function ready() {
    bind("btn-open-guide", "click", () => openModal("guide-modal"));
    bind("btn-close-guide", "click", () => closeModal("guide-modal"));
    bind("btn-close-guide-2", "click", () => closeModal("guide-modal"));

    // Tự hiện hướng dẫn cho lần đầu dùng app
    if (!localStorage.getItem("omni_guide_seen")) {
      setTimeout(() => { openModal("guide-modal"); localStorage.setItem("omni_guide_seen", "1"); }, 800);
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ready);
  else ready();
})();


// ==========================================
// CHẠY NGẦM CHUYÊN NGHIỆP (Background resilience)
// ==========================================

let wakeLockRef = null;
let silentAudioEl = null;

// (1) Wake Lock: giữ máy không "ngủ" khi đang xử lý
async function requestWakeLock() {
  try {
    if ("wakeLock" in navigator) {
      wakeLockRef = await navigator.wakeLock.request("screen");
    }
  } catch (e) { /* thiết bị không hỗ trợ, bỏ qua */ }
}
function releaseWakeLock() {
  try { wakeLockRef?.release(); wakeLockRef = null; } catch (e) {}
}
// Nếu quay lại tab mà wake lock bị mất, xin lại
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && wakeLockRef === null && isProcessing) requestWakeLock();
});

// (2) Phát âm thanh im lặng để trình duyệt không "bóp" tab khi ẩn
function startSilentKeepAlive() {
  if (silentAudioEl) return;
  // file wav im lặng cực ngắn, lặp vô hạn
  const silent = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YQAAAAA=";
  silentAudioEl = new Audio(silent);
  silentAudioEl.loop = true;
  silentAudioEl.volume = 0.001;
  silentAudioEl.play().catch(() => {});
}
function stopSilentKeepAlive() {
  if (silentAudioEl) { silentAudioEl.pause(); silentAudioEl = null; }
}

// (3) Xin quyền thông báo desktop (gọi 1 lần khi mở app)
function initNotifications() {
  if ("Notification" in window && Notification.permission === "default") {
    // xin quyền khi người dùng tương tác lần đầu, tránh bị chặn
    document.body.addEventListener("click", function askOnce() {
      Notification.requestPermission();
      document.body.removeEventListener("click", askOnce);
    }, { once: true });
  }
}
function notifyDone(title, body) {
  try {
    if ("Notification" in window && Notification.permission === "granted") {
      const n = new Notification(title, { body, icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🎙️</text></svg>" });
      n.onclick = () => { window.focus(); n.close(); };
    }
  } catch (e) {}
}

// Cờ báo đang xử lý (để wake lock biết)
let isProcessing = false;

// Khởi động
(function initBackground() {
  function ready() { initNotifications(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ready);
  else ready();
})();
