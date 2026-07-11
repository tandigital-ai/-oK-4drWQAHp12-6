// config.js — OmniTranscript AI - Ứng dụng Biên tập Nội dung Đa phương tiện Địa phương Đầu tiên
// Bản quyền tác giả: TDA

// Khai báo các hằng số toàn cục theo đúng Contract
const DB_NAME = "OmniTranscriptDB";
const DB_VERSION = 1;
const STORE_PROJECTS = "Projects";
const STORE_CHUNKS = "Chunks";
const STORE_API_KEYS = "ApiKeys";
const STORE_APP_SETTINGS = "AppSettings";
const STORE_EXPORT_ROLES = "ExportRoles";
const APP_AUTHOR = "TDA";
const CHUNK_MIN_DURATION_SEC = 30;
const CHUNK_MAX_DURATION_SEC = 120;
const CHUNK_OVERLAP_SEC = 2;
const ENCRYPTION_ALGORITHM = "AES-GCM";
const ENCRYPTION_KEY_LENGTH = 256;
const PROVIDER_DEEPGRAM = "Deepgram";
const PROVIDER_GOOGLE_GEMINI = "GoogleGemini";
const PROVIDER_WEB_SPEECH = "WebSpeech";
const EVENT_PROJECT_UPDATED = "projectUpdated";
const EVENT_CHUNK_PROCESSED = "chunkProcessed";
const EVENT_API_KEY_VAULT_LOCKED = "vaultLocked";
const EVENT_API_KEY_VAULT_UNLOCKED = "vaultUnlocked";

// Biến lưu trữ kết nối database duy nhất
let dbInstance = null;

/**
 * Khởi tạo và mở kết nối đến IndexedDB, tạo các object stores nếu cần.
 * @returns {Promise<IDBDatabase>}
 */
function initIndexedDB() {
  return new Promise((resolve, reject) => {
    if (dbInstance) {
      resolve(dbInstance);
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = (event) => {
      console.error("Lỗi khởi tạo IndexedDB:", event.target.error);
      reject(event.target.error);
    };

    request.onsuccess = (event) => {
      dbInstance = event.target.result;
      resolve(dbInstance);
    };

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      // Tạo store Projects
      if (!db.objectStoreNames.contains(STORE_PROJECTS)) {
        db.createObjectStore(STORE_PROJECTS, { keyPath: "projectId" });
      }

      // Tạo store Chunks và index để truy vấn nhanh theo projectId
      if (!db.objectStoreNames.contains(STORE_CHUNKS)) {
        const chunkStore = db.createObjectStore(STORE_CHUNKS, { keyPath: "chunkId" });
        chunkStore.createIndex("projectId", "projectId", { unique: false });
      }

      // Tạo store ApiKeys
      if (!db.objectStoreNames.contains(STORE_API_KEYS)) {
        db.createObjectStore(STORE_API_KEYS, { keyPath: "keyId" });
      }

      // Tạo store AppSettings
      if (!db.objectStoreNames.contains(STORE_APP_SETTINGS)) {
        db.createObjectStore(STORE_APP_SETTINGS, { keyPath: "settingKey" });
      }

      // Tạo store ExportRoles
      if (!db.objectStoreNames.contains(STORE_EXPORT_ROLES)) {
        db.createObjectStore(STORE_EXPORT_ROLES, { keyPath: "roleId" });
      }

      // Khởi tạo các dữ liệu cấu hình mặc định ban đầu
      const transaction = event.currentTarget.transaction;
      const exportRolesStore = transaction.objectStore(STORE_EXPORT_ROLES);
      const appSettingsStore = transaction.objectStore(STORE_APP_SETTINGS);

      // Thêm các vai trò xuất Markdown mẫu chuyên nghiệp
      const defaultRoles = [
        {
          roleId: "role-meeting-minutes",
          roleName: "Biên bản cuộc họp",
          markdownTemplate: "# BIÊN BẢN CUỘC HỌP\n\n**Thời gian biên soạn:** {{date}}\n**Tác giả:** " + APP_AUTHOR + "\n\n## 1. Tóm tắt nội dung chính\n{{summary}}\n\n## 2. Chi tiết cuộc thảo luận\n{{transcript}}\n\n## 3. Kết luận & Hành động tiếp theo\n- [ ] Việc cần làm 1 (Phân công cụ thể)\n- [ ] Việc cần làm 2",
          createdAt: Date.now(),
          updatedAt: Date.now()
        },
        {
          roleId: "role-press-report",
          roleName: "Phóng sự báo chí",
          markdownTemplate: "# PHÓNG SỰ BÁO CHÍ\n\n*Biên tập bởi: " + APP_AUTHOR + " (OmniTranscript AI)*\n\n## Tổng quan sự việc\n{{summary}}\n\n## Chi tiết sự kiện & Trích dẫn trực tiếp\n{{transcript}}\n\n---\n*Bản tin được tạo tự động bằng hệ thống AI tiên tiến.*",
          createdAt: Date.now(),
          updatedAt: Date.now()
        },
        {
          roleId: "role-qa-interview",
          roleName: "Phỏng vấn Q&A",
          markdownTemplate: "# BIÊN BẢN PHỎNG VẤN (Q&A)\n\n**Người biên tập:** " + APP_AUTHOR + "\n\n## Đánh giá tổng quát cuộc phỏng vấn\n{{summary}}\n\n## Nội dung chi tiết đối thoại\n{{transcript}}",
          createdAt: Date.now(),
          updatedAt: Date.now()
        },
        {
          roleId: "role-podcast-notes",
          roleName: "Show Notes (Podcast)",
          markdownTemplate: "# SHOW NOTES - PODCAST EPISODE\n\n## Tóm tắt tập phát sóng\n{{summary}}\n\n## Nội dung chi tiết & Mốc thời gian nổi bật\n{{transcript}}\n\n---\n*Cảm ơn quý thính giả đã theo dõi chương trình!*",
          createdAt: Date.now(),
          updatedAt: Date.now()
        }
      ];

      defaultRoles.forEach((role) => {
        exportRolesStore.put(role);
      });

      // Thêm các cài đặt ứng dụng mặc định
      const defaultSettings = [
        { settingKey: "theme", settingValue: "light" },
        { settingKey: "defaultExportRole", settingValue: "role-meeting-minutes" }
      ];

      defaultSettings.forEach((setting) => {
        appSettingsStore.put(setting);
      });
    };
  });
}

/**
 * Thêm một bản ghi mới vào object store được chỉ định.
 * @param {string} storeName - Tên store cần thêm dữ liệu
 * @param {object} data - Dữ liệu cần thêm
 * @returns {Promise<any>} - Trả về khóa chính của bản ghi vừa thêm
 */
function addRecord(storeName, data) {
  return initIndexedDB().then((db) => {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, "readwrite");
      const store = transaction.objectStore(storeName);
      const request = store.add(data);

      request.onsuccess = () => resolve(request.result);
      request.onerror = (e) => reject(e.target.error);
    });
  });
}

/**
 * Lấy một bản ghi từ object store bằng khóa chính.
 * @param {string} storeName - Tên store cần lấy dữ liệu
 * @param {any} key - Khóa chính của bản ghi
 * @returns {Promise<object|undefined>} - Bản ghi tìm thấy hoặc undefined
 */
function getRecord(storeName, key) {
  return initIndexedDB().then((db) => {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, "readonly");
      const store = transaction.objectStore(storeName);
      const request = store.get(key);

      request.onsuccess = () => resolve(request.result);
      request.onerror = (e) => reject(e.target.error);
    });
  });
}

/**
 * Cập nhật một bản ghi hiện có trong object store.
 * Thực hiện gộp dữ liệu cũ và dữ liệu mới để tránh mất trường thông tin.
 * @param {string} storeName - Tên store cần cập nhật
 * @param {any} key - Khóa chính của bản ghi
 * @param {object} data - Dữ liệu mới cần cập nhật
 * @returns {Promise<any>} - Trả về khóa chính của bản ghi vừa cập nhật
 */
function updateRecord(storeName, key, data) {
  return initIndexedDB().then((db) => {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, "readwrite");
      const store = transaction.objectStore(storeName);
      const getRequest = store.get(key);

      getRequest.onsuccess = () => {
        const existingData = getRequest.result || {};
        const updatedData = { ...existingData, ...data };

        // Đảm bảo khóa chính khớp với key truyền vào
        const keyPath = store.keyPath;
        if (keyPath) {
          updatedData[keyPath] = key;
        }

        const putRequest = store.put(updatedData);
        putRequest.onsuccess = () => resolve(putRequest.result);
        putRequest.onerror = (e) => reject(e.target.error);
      };

      getRequest.onerror = (e) => reject(e.target.error);
    });
  });
}

/**
 * Xóa một bản ghi từ object store.
 * @param {string} storeName - Tên store cần xóa dữ liệu
 * @param {any} key - Khóa chính của bản ghi cần xóa
 * @returns {Promise<void>}
 */
function deleteRecord(storeName, key) {
  return initIndexedDB().then((db) => {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, "readwrite");
      const store = transaction.objectStore(storeName);
      const request = store.delete(key);

      request.onsuccess = () => resolve();
      request.onerror = (e) => reject(e.target.error);
    });
  });
}

/**
 * Lấy tất cả bản ghi từ một object store.
 * @param {string} storeName - Tên store cần lấy dữ liệu
 * @returns {Promise<Array>} - Mảng chứa toàn bộ dữ liệu của store
 */
function getAllRecords(storeName) {
  return initIndexedDB().then((db) => {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, "readonly");
      const store = transaction.objectStore(storeName);
      const request = store.getAll();

      request.onsuccess = () => resolve(request.result || []);
      request.onerror = (e) => reject(e.target.error);
    });
  });
}