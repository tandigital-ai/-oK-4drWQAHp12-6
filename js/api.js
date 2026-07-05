// ============================================================
// api.js — FAMS XNTN Thủ Thiêm
// THUẬT TOÁN: Sổ cái tồn kho luân chuyển theo ngày (Cách A)
// Gom nhóm theo: Tháng + (Nhiên liệu + Công trình + Nhà cung cấp)
// ============================================================

const SHEET_VEHICLES = 'Vehicles';
const SHEET_OPERATION_LOGS = 'OperationLogs';
const SHEET_INVOICES = 'Invoices';
const SHEET_ALLOCATIONS = 'Allocations';
const SHEET_PROJECTS = 'Projects';
const SHEET_SUPPLIERS = 'Suppliers';
const SHEET_CONSTRAINT_VIOLATIONS = 'ConstraintViolations';
const SHEET_OPERATION_PLANS = 'OperationPlans';

let THRESHOLD_YELLOW = 0.9, THRESHOLD_RED = 1.0, ANOMALY_UPPER_LIMIT = 1.2, ANOMALY_LOWER_LIMIT = 0.8;
let COMPANY_INFO = {
  company: 'CÔNG TY TNHH MỘT THÀNH VIÊN THOÁT NƯỚC ĐÔ THỊ TP.HCM',
  unit: 'XNTN Thủ Thiêm',
  note: '(Phiếu có giá trị trong vòng 15 ngày kể từ ngày cấp)'
};

const DB_NAME = 'FuelAllocationDB';
const DB_VERSION = 2;
let db;

function initDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      db = event.target.result;
      if (!db.objectStoreNames.contains(SHEET_VEHICLES)) {
        const s = db.createObjectStore(SHEET_VEHICLES, { keyPath: 'vehicleId' });
        s.createIndex('projectId', 'projectId', { unique: false });
        s.createIndex('fuelType', 'fuelType', { unique: false });
      }
      if (!db.objectStoreNames.contains(SHEET_OPERATION_LOGS)) {
        const s = db.createObjectStore(SHEET_OPERATION_LOGS, { keyPath: 'logId' });
        s.createIndex('vehicleId', 'vehicleId', { unique: false });
        s.createIndex('date', 'date', { unique: false });
      }
      if (!db.objectStoreNames.contains(SHEET_INVOICES)) {
        const s = db.createObjectStore(SHEET_INVOICES, { keyPath: 'invoiceId' });
        s.createIndex('date', 'date', { unique: false });
        s.createIndex('fuelType', 'fuelType', { unique: false });
        s.createIndex('projectId', 'projectId', { unique: false });
      }
      if (!db.objectStoreNames.contains(SHEET_ALLOCATIONS)) {
        const s = db.createObjectStore(SHEET_ALLOCATIONS, { keyPath: 'allocationId' });
        s.createIndex('vehicleId', 'vehicleId', { unique: false });
        s.createIndex('date', 'date', { unique: false });
        s.createIndex('fuelType', 'fuelType', { unique: false });
        s.createIndex('projectId', 'projectId', { unique: false });
        s.createIndex('invoiceId', 'invoiceId', { unique: false });
      }
      if (!db.objectStoreNames.contains(SHEET_PROJECTS)) db.createObjectStore(SHEET_PROJECTS, { keyPath: 'projectId' });
      if (!db.objectStoreNames.contains(SHEET_SUPPLIERS)) db.createObjectStore(SHEET_SUPPLIERS, { keyPath: 'supplierId' });
      if (!db.objectStoreNames.contains(SHEET_OPERATION_PLANS)) {
        const s = db.createObjectStore(SHEET_OPERATION_PLANS, { keyPath: 'planId' });
        s.createIndex('vehicleId', 'vehicleId', { unique: false });
        s.createIndex('date', 'date', { unique: false });
      }
      if (!db.objectStoreNames.contains(SHEET_CONSTRAINT_VIOLATIONS)) {
        const s = db.createObjectStore(SHEET_CONSTRAINT_VIOLATIONS, { keyPath: 'violationId' });
        s.createIndex('date', 'date', { unique: false });
      }
    };
    request.onsuccess = (e) => { db = e.target.result; resolve(db); };
    request.onerror = (e) => reject('Lỗi khởi tạo IndexedDB: ' + e.target.error);
  });
}

function generateId() { return 'id-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9); }
function getStore(s, m = 'readonly') { return db.transaction(s, m).objectStore(s); }
function getAllFromStore(s) { return new Promise((r, j) => { const q = getStore(s).getAll(); q.onsuccess = () => r(q.result || []); q.onerror = () => j(q.error); }); }
function getAllByDate(s, d) { return new Promise((r, j) => { const q = getStore(s).index('date').getAll(d); q.onsuccess = () => r(q.result || []); q.onerror = () => j(q.error); }); }
function getAllByRange(s, from, to) { return new Promise((r, j) => { const q = getStore(s).index('date').getAll(IDBKeyRange.bound(from, to)); q.onsuccess = () => r(q.result || []); q.onerror = () => j(q.error); }); }
function deleteFromStore(s, k) { return new Promise((r, j) => { const q = getStore(s, 'readwrite').delete(k); q.onsuccess = () => r(true); q.onerror = () => j(q.error); }); }
function clearStore(s) { return new Promise((r, j) => { const q = getStore(s, 'readwrite').clear(); q.onsuccess = () => r(true); q.onerror = () => j(q.error); }); }
function putRecord(s, rec) { return new Promise((r, j) => { const q = getStore(s, 'readwrite').put(rec); q.onsuccess = () => r(rec); q.onerror = () => j(q.error); }); }

async function loadVehicles(period) { if (!db) await initDB(); const all = await getAllFromStore(SHEET_VEHICLES); if (!period) return all; return all.filter(v => (v.period || '') === period); }
async function loadAllVehiclesRaw() { if (!db) await initDB(); return getAllFromStore(SHEET_VEHICLES); }
async function loadProjects() { if (!db) await initDB(); return getAllFromStore(SHEET_PROJECTS); }
async function loadSuppliers() { if (!db) await initDB(); return getAllFromStore(SHEET_SUPPLIERS); }
async function loadOperationLogs(d) { if (!db) await initDB(); return getAllByDate(SHEET_OPERATION_LOGS, d); }
async function loadInvoices(d) { if (!db) await initDB(); return getAllByDate(SHEET_INVOICES, d); }
async function loadAllocations(d) { if (!db) await initDB(); return getAllByDate(SHEET_ALLOCATIONS, d); }
async function loadPlansByRange(from, to) { if (!db) await initDB(); return getAllByRange(SHEET_OPERATION_PLANS, from, to); }
// Chạy kế hoạch tự động: từ hóa đơn thực tế suy ra số ca dự kiến từng xe/ngày.
// Ghi vào SHEET_OPERATION_PLANS. Trả về { count, notes }.
// Chạy kế hoạch tự động (CÁCH A - Dồn ca FIFO):
// 1) Số ca mục tiêu mỗi xe = KeHoachThang / DinhMucCa, kẹp trong [caMin, caMax].
// 2) Kiểm tra tổng dầu nhóm (nhiên liệu+công trình) đủ cho kế hoạch không.
// 3) Dồn ca vào các ngày sớm nhất có đủ dầu theo FIFO (tồn + hóa đơn phát sinh).
//    Dư -> tồn sang ngày sau. Thiếu -> chờ hóa đơn ngày sau (tạm ứng tự nhiên).
async function generateAutoPlan(targetDate) {
  if (!db) await initDB();
  const d = new Date(targetDate);
  const firstDay = localDateStr(d.getFullYear(), d.getMonth(), 1);
  const daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  const lastDay = localDateStr(d.getFullYear(), d.getMonth(), daysInMonth);

  const vehicles = await loadVehicles(firstDay.slice(0, 7));
  const invoices = await getAllByRange(SHEET_INVOICES, firstDay, lastDay);

  const allDates = [];
  for (let i = 1; i <= daysInMonth; i++) allDates.push(localDateStr(d.getFullYear(), d.getMonth(), i));

  // Gom hóa đơn theo nhóm nhiên liệu + công trình, chia theo ngày (để rót FIFO)
  function gk(fuel, proj) { return `${fuel}__${proj}`; }
  const invByFC = {}; // key -> { 'YYYY-MM-DD': tongLit }
  invoices.forEach(inv => {
    const k = gk(inv.fuelType, inv.projectId);
    if (!invByFC[k]) invByFC[k] = {};
    invByFC[k][inv.date] = round2((invByFC[k][inv.date] || 0) + inv.quantity);
  });

  const plansToSave = [];
  const notes = [];
  const planTotalByVehicle = {}; // vehicleId -> tổng ca đã lên kế hoạch

  // Tập hợp tất cả nhóm xuất hiện (từ xe hoặc từ hóa đơn)
  const allGroups = new Set();
  vehicles.forEach(v => allGroups.add(gk(v.fuelType, v.projectId)));
  Object.keys(invByFC).forEach(k => allGroups.add(k));

  for (const k of allGroups) {
    const [fuel, proj] = k.split('__');
    const byDay = invByFC[k] || {};
    const tongHoaDon = round2(Object.values(byDay).reduce((s, x) => s + x, 0));
    const groupVehicles = vehicles
      .filter(v => v.fuelType === fuel && v.projectId === proj)
      .sort((a, b) => (a.priority || 999) - (b.priority || 999));

    // Không có xe trong nhóm nhưng có dầu -> báo lỗi
    if (groupVehicles.length === 0) {
      if (tongHoaDon > 0.01) notes.push({ level: 'ERROR', fuel, proj, message: `Nhóm ${fuel}/${getProjName(proj, [])}: có ${tongHoaDon} L hóa đơn nhưng KHÔNG có xe nào cùng nhiên liệu+công trình. Không lập được kế hoạch.` });
      continue;
    }

    // BƯỚC 1: Tính số ca mục tiêu mỗi xe từ kế hoạch tháng, kẹp trong [min, max]
    const targets = {}; // vehicleId -> số ca mục tiêu (số nguyên)
    let tongLitKeHoach = 0;
    groupVehicles.forEach(v => {
      let ca = (v.normPerShift > 0) ? (v.monthlyPlan || 0) / v.normPerShift : 0;
      ca = Math.round(ca); // làm tròn về số ca nguyên
      if (v.minShiftsPerMonth && ca < v.minShiftsPerMonth) ca = v.minShiftsPerMonth;
      if (v.maxShiftsPerMonth && ca > v.maxShiftsPerMonth) ca = v.maxShiftsPerMonth;
      if (ca < 0) ca = 0;
      targets[v.vehicleId] = ca;
      tongLitKeHoach = round2(tongLitKeHoach + ca * v.normPerShift);
    });

    // BƯỚC 2: Đối chiếu tổng dầu nhóm vs tổng lít kế hoạch (theo số ca mục tiêu)
    const chenh = round2(tongHoaDon - tongLitKeHoach);
    if (tongHoaDon <= 0.01) {
      notes.push({ level: 'ERROR', fuel, proj, message: `Nhóm ${fuel}/${getProjName(proj, [])}: cần ${tongLitKeHoach} L theo kế hoạch nhưng CHƯA có hóa đơn nào. Cần nhập hóa đơn nhiên liệu.` });
      // Không có dầu thì không dồn được ca -> bỏ qua nhóm
      continue;
    } else if (chenh > 0.01) {
      notes.push({ level: 'WARNING', fuel, proj, message: `Nhóm ${fuel}/${getProjName(proj, [])}: hóa đơn ${tongHoaDon} L > kế hoạch ${tongLitKeHoach} L → THỪA ${chenh} L. Xe sẽ chạy đủ ca mục tiêu, dầu dư để tồn.` });
    } else if (chenh < -0.01) {
      notes.push({ level: 'ERROR', fuel, proj, message: `Nhóm ${fuel}/${getProjName(proj, [])}: hóa đơn ${tongHoaDon} L < kế hoạch ${tongLitKeHoach} L → THIẾU ${round2(-chenh)} L. Chỉ dồn ca tới khi hết dầu.` });
    } else {
      notes.push({ level: 'INFO', fuel, proj, message: `Nhóm ${fuel}/${getProjName(proj, [])}: hóa đơn khớp kế hoạch (${tongHoaDon} L).` });
    }

    // BƯỚC 3: DỒN CA THEO FIFO (Cách A) - chạy từ ngày đầu tháng
    const remaining = {}; // ca còn phải xếp cho mỗi xe
    groupVehicles.forEach(v => remaining[v.vehicleId] = targets[v.vehicleId]);
    let tonKho = 0; // dầu tồn chuyển từ ngày trước sang

    for (const day of allDates) {
      // Cộng dầu hóa đơn phát sinh hôm nay vào kho
      tonKho = round2(tonKho + (byDay[day] || 0));
      if (tonKho <= 0.001) continue;

      // Duyệt xe theo STT ưu tiên. Giới hạn TỐI ĐA 3 ca/xe/ngày (1 ca = 8 giờ).
      // Ưu tiên rải 1-2 ca/ngày cho nhiều xe trước, chỉ lên ca 3 khi vẫn còn dầu & còn ca mục tiêu.
      // Cách làm: chạy 3 "lượt". Mỗi lượt cho mỗi xe thêm tối đa 1 ca (lên tới trần lượt đó).
      const MAX_CA_NGAY = 3; // trần tuyệt đối số ca/xe/ngày
      const caTrongNgay = {}; // vehicleId -> số ca đã xếp hôm nay
      for (let luot = 1; luot <= MAX_CA_NGAY; luot++) {
        for (const v of groupVehicles) {
          if (remaining[v.vehicleId] <= 0) continue;                 // hết ca mục tiêu
          if ((caTrongNgay[v.vehicleId] || 0) >= luot) continue;     // đã đạt mức của lượt này
          if ((caTrongNgay[v.vehicleId] || 0) >= MAX_CA_NGAY) continue; // chạm trần 3 ca/ngày
          if (tonKho + 0.001 < v.normPerShift) continue;             // không đủ dầu cho 1 ca
          // Xếp thêm 1 ca cho xe này
          tonKho = round2(tonKho - v.normPerShift);
          remaining[v.vehicleId] -= 1;
          caTrongNgay[v.vehicleId] = (caTrongNgay[v.vehicleId] || 0) + 1;
          planTotalByVehicle[v.vehicleId] = round2((planTotalByVehicle[v.vehicleId] || 0) + 1);
        }
      }
      // Ghi kế hoạch của ngày này (gộp số ca của mỗi xe trong ngày)
      for (const vid in caTrongNgay) {
        if (caTrongNgay[vid] > 0) plansToSave.push({ planId: generateId(), vehicleId: vid, date: day, plannedShifts: caTrongNgay[vid] });
      }
      // dầu dư (< 1 ca của mọi xe) sẽ tự động là tonKho chuyển sang ngày sau
    }

    // Cảnh báo nếu còn ca mục tiêu chưa xếp được vì hết dầu
    groupVehicles.forEach(v => {
      if (remaining[v.vehicleId] > 0) {
        notes.push({ level: 'WARNING', fuel, proj, message: `Xe ${v.licensePlate}: còn THIẾU ${remaining[v.vehicleId]} ca chưa xếp được do hết dầu trong tháng (mục tiêu ${targets[v.vehicleId]} ca).` });
      }
    });
  }

  // Kiểm tra ca min/max từng xe (sau khi đã xếp thực tế)
  vehicles.forEach(v => {
    const tongCa = planTotalByVehicle[v.vehicleId] || 0;
    if (v.maxShiftsPerMonth && tongCa > v.maxShiftsPerMonth + 0.001) notes.push({ level: 'WARNING', fuel: v.fuelType, proj: v.projectId, message: `Xe ${v.licensePlate}: kế hoạch ${tongCa} ca VƯỢT ca tối đa ${v.maxShiftsPerMonth}.` });
    else if (v.minShiftsPerMonth && tongCa > 0 && tongCa < v.minShiftsPerMonth - 0.001) notes.push({ level: 'INFO', fuel: v.fuelType, proj: v.projectId, message: `Xe ${v.licensePlate}: kế hoạch ${tongCa} ca THẤP hơn ca tối thiểu ${v.minShiftsPerMonth} (do thiếu dầu).` });
  });

  // Ghi vào DB: xóa kế hoạch cũ của tháng rồi lưu mới
  await clearPlansByRange(firstDay, lastDay);
  for (const p of plansToSave) await putRecord(SHEET_OPERATION_PLANS, p);

  return { count: plansToSave.length, notes };
}

// Trợ giúp lấy tên công trình trong api (không phụ thuộc app.js)
function getProjName(id, projects) { return id || 'N/A'; }
async function savePlan(p) { if (!db) await initDB(); if (!p.planId) p.planId = generateId(); return putRecord(SHEET_OPERATION_PLANS, p); }
async function clearPlanMonth(yyyymm) {
  if (!db) await initDB();
  const [y, m] = yyyymm.split('-').map(Number);
  const dim = new Date(y, m, 0).getDate();
  const from = yyyymm + '-01', to = yyyymm + '-' + String(dim).padStart(2, '0');
  return clearPlansByRange(from, to);
}
async function clearPlansByRange(from, to) {
  if (!db) await initDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(SHEET_OPERATION_PLANS, 'readwrite');
    const r = tx.objectStore(SHEET_OPERATION_PLANS).index('date').openCursor(IDBKeyRange.bound(from, to));
    r.onsuccess = (e) => { const c = e.target.result; if (c) { c.delete(); c.continue(); } };
    tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
  });
}

async function saveVehicle(v) { if (!db) await initDB(); if (!v.vehicleId) v.vehicleId = generateId(); return putRecord(SHEET_VEHICLES, v); }
async function saveOperationLog(l) { if (!db) await initDB(); if (!l.logId) l.logId = generateId(); return putRecord(SHEET_OPERATION_LOGS, l); }
async function saveInvoice(i) { if (!db) await initDB(); if (!i.invoiceId) i.invoiceId = generateId(); return putRecord(SHEET_INVOICES, i); }
async function saveProject(p) { if (!db) await initDB(); if (!p.projectId) p.projectId = generateId(); return putRecord(SHEET_PROJECTS, p); }
async function saveSupplier(s) { if (!db) await initDB(); if (!s.supplierId) s.supplierId = generateId(); return putRecord(SHEET_SUPPLIERS, s); }
async function deleteVehicle(id) { if (!db) await initDB(); return deleteFromStore(SHEET_VEHICLES, id); }
// Sao chép toàn bộ phương tiện từ kỳ nguồn sang kỳ đích (mỗi xe là bản ghi độc lập)
async function copyVehiclesFromPeriod(fromPeriod, toPeriod) {
  if (!db) await initDB();
  const all = await getAllFromStore(SHEET_VEHICLES);
  const source = all.filter(v => (v.period || '') === fromPeriod);
  let count = 0;
  for (const v of source) {
    const copy = { ...v, vehicleId: generateId(), period: toPeriod };
    await putRecord(SHEET_VEHICLES, copy);
    count++;
  }
  return count;
}
// Xóa toàn bộ phương tiện của 1 kỳ
async function clearVehiclesByPeriod(period) {
  if (!db) await initDB();
  const all = await getAllFromStore(SHEET_VEHICLES);
  for (const v of all) { if ((v.period || '') === period) await deleteFromStore(SHEET_VEHICLES, v.vehicleId); }
  return true;
}
async function deleteOperationLog(id) { if (!db) await initDB(); return deleteFromStore(SHEET_OPERATION_LOGS, id); }
async function deleteInvoice(id) { if (!db) await initDB(); return deleteFromStore(SHEET_INVOICES, id); }
async function deleteProject(id) { if (!db) await initDB(); return deleteFromStore(SHEET_PROJECTS, id); }
async function deleteSupplier(id) { if (!db) await initDB(); return deleteFromStore(SHEET_SUPPLIERS, id); }

// ---------- IMPORT / TEMPLATE / EXPORT ----------
// Xóa dữ liệu của 1 KỲ (tháng) theo đúng loại import, trước khi nạp mới
async function clearDataForImport(dataType, yyyymm) {
  if (!db) await initDB();
  const [y, m] = yyyymm.split('-').map(Number);
  const dim = new Date(y, m, 0).getDate();
  const from = yyyymm + '-01', to = yyyymm + '-' + String(dim).padStart(2, '0');
  function clearRange(store) {
    return new Promise((res, rej) => {
      const tx = db.transaction(store, 'readwrite');
      const r = tx.objectStore(store).index('date').openCursor(IDBKeyRange.bound(from, to));
      r.onsuccess = (e) => { const c = e.target.result; if (c) { c.delete(); c.continue(); } };
      tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
    });
  }
  if (dataType === 'DINH_MUC_KE_HOACH') {
    // Danh mục phương tiện theo KỲ: chỉ xóa xe của tháng đang import, lưu kỳ để gắn vào từng xe
    window.__FAMS_IMPORT_PERIOD = yyyymm;
    await clearVehiclesByPeriod(yyyymm);
  } else if (dataType === 'KE_HOACH_NGANG') {
    await clearRange(SHEET_OPERATION_PLANS);
  } else if (dataType === 'VAN_HANH' || dataType === 'VAN_HANH_NGANG') {
    await clearRange(SHEET_OPERATION_LOGS);
  } else if (dataType === 'BANG_KE_HOA_DON') {
    await clearRange(SHEET_INVOICES);
  }
  return true;
}

async function importExcelData(file, dataType) {
  if (!db) await initDB();
  if (typeof XLSX === 'undefined') throw new Error('Chưa nạp thư viện XLSX trong index.html.');
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const wb = XLSX.read(data, { type: 'array' });
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
        let count = 0;
        for (const item of rows) {
          if (dataType === 'DINH_MUC_KE_HOACH') {
            await saveVehicle({ vehicleId: String(item.vehicleId || item['Mã'] || generateId()), period: (window.__FAMS_IMPORT_PERIOD || ''), licensePlate: String(item.licensePlate || item['Biển số'] || ''), fuelType: normalizeFuel(item.fuelType || item['Nhiên liệu'] || 'DO'), normPerShift: Number(item.normPerShift || item['Định mức ca'] || 0), minShiftsPerMonth: Number(item.minShiftsPerMonth || item['Ca min'] || 0), maxShiftsPerMonth: Number(item.maxShiftsPerMonth || item['Ca max'] || 0), monthlyPlan: Number(item.monthlyPlan || item['Kế hoạch tháng'] || 0), projectId: String(item.projectId || item['Mã công trình'] || ''), priority: Number(item.priority || item['STT'] || item['STT ưu tiên'] || 999) });
            count++;
          } else if (dataType === 'KE_HOACH_NGANG') {
            const vehP = String(item.vehicleId || item['Phương tiện'] || item['Mã'] || '').trim();
            if (!vehP || vehP.toUpperCase() === 'THỨ' || vehP.toUpperCase() === 'THU') continue; // bỏ qua hàng nhãn thứ
            const skipCols = ['vehicleId', 'Phương tiện', 'Mã', 'Biển số', 'Bien so', 'licensePlate', 'Tổng ca', 'Tong ca'];
            for (const colKeyP in item) {
              if (skipCols.includes(colKeyP)) continue;
              const rawValP = item[colKeyP];
              if (rawValP === '' || rawValP === null || rawValP === undefined || String(rawValP).toLowerCase() === 'nan') continue;
              const shiftsP = Number(rawValP); if (isNaN(shiftsP) || shiftsP <= 0) continue;
              const dateNormP = normalizeDate(colKeyP); if (!dateNormP) continue;
              await savePlan({ planId: generateId(), vehicleId: vehP, date: dateNormP, plannedShifts: shiftsP });
              count++;
            }
          } else if (dataType === 'VAN_HANH_NGANG') {
            const veh = String(item.vehicleId || item['Phương tiện'] || item['Mã'] || '').trim();
            if (!veh || veh.toUpperCase() === 'THỨ' || veh.toUpperCase() === 'THU') continue; // bỏ qua hàng nhãn thứ
            const skipCols = ['vehicleId', 'Phương tiện', 'Mã', 'Biển số', 'Bien so', 'licensePlate', 'Tổng ca', 'Tong ca'];
            for (const colKey in item) {
              if (skipCols.includes(colKey)) continue;
              const rawVal = item[colKey];
              if (rawVal === '' || rawVal === null || rawVal === undefined || String(rawVal).toLowerCase() === 'nan') continue;
              const shifts = Number(rawVal); if (isNaN(shifts) || shifts <= 0) continue;
              const dateNorm = normalizeDate(colKey); if (!dateNorm) continue;
              await saveOperationLog({ logId: generateId(), vehicleId: veh, date: dateNorm, fromShift: 1, toShift: shifts, actualShifts: shifts });
              count++;
            }
          } else if (dataType === 'VAN_HANH') {
            const rawF = item.fromShift, rawT = item.toShift;
            // Bỏ qua dòng không có ca (nan / rỗng)
            if (rawF === '' || rawF === null || rawF === undefined || String(rawF).toLowerCase() === 'nan') continue;
            const f = Number(rawF), t = Number(rawT || rawF);
            if (isNaN(f) || f <= 0) continue;
            await saveOperationLog({ logId: generateId(), vehicleId: String(item.vehicleId || item['Mã'] || ''), date: normalizeDate(item.date || item['Ngày']), fromShift: f, toShift: t, actualShifts: t - f + 1 });
            count++;
          } else if (dataType === 'BANG_KE_HOA_DON') {
            const q = Number(item.quantity || item['Số lượng'] || 0), u = Number(item.unitPrice || item['Đơn giá'] || 0);
            const fuel = normalizeFuel(item.fuelType || item['Nhiên liệu'] || 'DO');
            if (fuel === 'NHOT') continue; // bỏ qua nhớt, không phân bổ theo ca
            await saveInvoice({ invoiceId: String(item.invoiceId || item['Mã HĐ'] || generateId()), date: normalizeDate(item.date || item['Ngày']), supplier: String(item.supplier || item['Nhà cung cấp'] || ''), fuelType: fuel, quantity: q, unitPrice: u, totalAmount: q * u, projectId: String(item.projectId || item['Mã công trình'] || ''), location: String(item.location || item['Địa điểm nhận'] || '') });
            count++;
          }
        }
        resolve(count);
      } catch (err) { reject('Lỗi xử lý file Excel: ' + err.message); }
    };
    reader.onerror = () => reject('Lỗi đọc file');
    reader.readAsArrayBuffer(file);
  });
}
function downloadTemplate(dataType) {
  if (typeof XLSX === 'undefined') { alert('Chưa nạp thư viện XLSX'); return; }
  let rows = [], fileName = ''; const today = new Date().toISOString().split('T')[0];
  if (dataType === 'DINH_MUC_KE_HOACH') { fileName = 'Mau_DinhMuc_KeHoach.xlsx'; rows = [{ priority: 1, vehicleId: 'XE001', licensePlate: '51E-010.34', fuelType: 'DO', normPerShift: 40.5, minShiftsPerMonth: 20, maxShiftsPerMonth: 26, monthlyPlan: 1300, projectId: 'CT001' }]; }
  else if (dataType === 'VAN_HANH') { fileName = 'Mau_NhatKy_VanHanh.xlsx'; rows = [{ vehicleId: 'XE001', date: today, fromShift: 1, toShift: 2 }]; }
  else if (dataType === 'KE_HOACH_NGANG' || dataType === 'VAN_HANH_NGANG') {
    fileName = (dataType === 'KE_HOACH_NGANG') ? 'Mau_KeHoach_VanHanh.xlsx' : 'Mau_ChamCong_VanHanh.xlsx';
    buildHorizontalTemplate(dataType, fileName);
    return;
  }
  else if (dataType === 'BANG_KE_HOA_DON') { fileName = 'Mau_BangKe_HoaDon.xlsx'; rows = [{ invoiceId: 'HD001', date: today, supplier: 'NCC001', fuelType: 'DO', quantity: 140, unitPrice: 20000, projectId: 'CT001', location: 'CHXD' }]; }
  const ws = XLSX.utils.json_to_sheet(rows), wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Data');
  // Thêm sheet hướng dẫn sử dụng cho từng loại mẫu
  const guide = getTemplateGuide(dataType);
  const wsGuide = XLSX.utils.aoa_to_sheet(guide);
  wsGuide['!cols'] = [{ wch: 22 }, { wch: 70 }];
  XLSX.utils.book_append_sheet(wb, wsGuide, 'HUONG_DAN');
  XLSX.writeFile(wb, fileName);
}
function getTemplateGuide(dataType) {
  const common = [
    ['MẪU IMPORT DỮ LIỆU - FAMS XNTN THỦ THIÊM', ''],
    ['', ''],
    ['Cách dùng chung:', 'Nhập dữ liệu vào sheet "Data" theo đúng tên cột. KHÔNG đổi tên cột. Lưu file rồi vào ứng dụng, bấm "Nhập Excel", chọn đúng loại và tải file lên.'],
    ['', ''],
    ['Loại mẫu này:', ''],
  ];
  let detail = [];
  if (dataType === 'DINH_MUC_KE_HOACH') {
    detail = [
      ['Công dụng:', 'Khai báo danh mục phương tiện kèm định mức nhiên liệu và kế hoạch tháng. Đây là dữ liệu GỐC, phải nhập trước mọi thứ.'],
      ['', ''],
      ['priority', 'STT ưu tiên (số nhỏ được rót dầu trước). VD: 1, 2, 3...'],
      ['vehicleId', 'Mã phương tiện (duy nhất). VD: XE001'],
      ['licensePlate', 'Biển số xe. VD: 51E-010.34'],
      ['fuelType', 'Loại nhiên liệu: DO (dầu) hoặc A95 (xăng)'],
      ['normPerShift', 'Định mức tiêu hao mỗi ca (Lít). VD: 40.5'],
      ['minShiftsPerMonth', 'Số ca tối thiểu/tháng'],
      ['maxShiftsPerMonth', 'Số ca tối đa/tháng'],
      ['monthlyPlan', 'Kế hoạch nhiên liệu tháng (Lít) - trần không được vượt'],
      ['projectId', 'Mã công trình liên kết. VD: CT001'],
    ];
  } else if (dataType === 'VAN_HANH') {
    detail = [
      ['Công dụng:', 'Ghi nhật ký vận hành theo từng dòng (mỗi dòng 1 xe/1 ngày, ghi từ ca đến ca).'],
      ['', ''],
      ['vehicleId', 'Mã phương tiện. VD: XE001'],
      ['date', 'Ngày vận hành, định dạng YYYY-MM-DD. VD: 2026-07-01'],
      ['fromShift', 'Ca bắt đầu (1, 2 hoặc 3)'],
      ['toShift', 'Ca kết thúc (1, 2 hoặc 3). Số ca = toShift - fromShift + 1'],
    ];
  } else if (dataType === 'KE_HOACH_NGANG') {
    detail = [
      ['Công dụng:', 'Nhập KẾ HOẠCH vận hành dạng bảng ngang. Đây là căn cứ chạy phân bổ nếu ngày đó chưa có Nhật ký thực tế.'],
      ['', ''],
      ['Cột vehicleId (cột A)', 'Mã xe. VD: XE001. Đây là cột dùng để nhận diện xe khi import.'],
      ['Cột Biển số (cột B)', 'Chỉ để bạn ĐỐI CHIẾU cho dễ nhìn. Khi import hệ thống KHÔNG dùng cột này (dùng theo Mã xe).'],
      ['Hàng "THỨ" (dòng 2)', 'Chỉ để xem thứ trong tuần (CN, T2..T7). Khi import hệ thống TỰ ĐỘNG bỏ qua hàng này.'],
      ['Các cột ngày', 'Tiêu đề mỗi cột là 1 ngày (YYYY-MM-DD). Ô ghi số ca dự kiến (VD 2 = 2 ca, 1.5 = 1,5 ca). Để TRỐNG nếu nghỉ.'],
      ['Cột Tổng ca', 'Chỉ để tham khảo, hệ thống không đọc cột này.'],
      ['LƯU Ý', 'Trước khi import phải chọn KỲ (tháng) đúng. Import sẽ xóa kế hoạch cũ của tháng đó rồi nạp mới.'],
    ];
  } else if (dataType === 'VAN_HANH_NGANG') {
    detail = [
      ['Công dụng:', 'Nhập nhật ký vận hành THỰC TẾ dạng bảng chấm công ngang. Đây là số liệu ƯU TIÊN khi chạy phân bổ cả 3 phương án.'],
      ['', ''],
      ['Cột vehicleId (cột A)', 'Mã xe. VD: XE001. Đây là cột dùng để nhận diện xe khi import.'],
      ['Cột Biển số (cột B)', 'Chỉ để bạn ĐỐI CHIẾU cho dễ nhìn. Khi import hệ thống KHÔNG dùng cột này (dùng theo Mã xe).'],
      ['Hàng "THỨ" (dòng 2)', 'Chỉ để xem thứ trong tuần (CN, T2..T7). Khi import hệ thống TỰ ĐỘNG bỏ qua hàng này.'],
      ['Các cột ngày', 'Tiêu đề mỗi cột là 1 ngày (YYYY-MM-DD). Ô ghi số ca đã chạy thực tế. Để TRỐNG nếu nghỉ.'],
      ['Cột Tổng ca', 'Chỉ để tham khảo, hệ thống không đọc cột này.'],
      ['LƯU Ý', 'Trước khi import phải chọn KỲ (tháng) đúng. Import sẽ xóa nhật ký cũ của tháng đó rồi nạp mới.'],
    ];
  }
 else if (dataType === 'BANG_KE_HOA_DON') {
    detail = [
      ['Công dụng:', 'Nhập bảng kê hóa đơn mua nhiên liệu. Đây là nguồn dầu THỰC TẾ để chia về cho các xe.'],
      ['', ''],
      ['invoiceId', 'Mã hóa đơn. VD: HD001'],
      ['date', 'Ngày hóa đơn (YYYY-MM-DD)'],
      ['supplier', 'Mã nhà cung cấp. VD: NCC001'],
      ['fuelType', 'Loại nhiên liệu: DO hoặc A95'],
      ['quantity', 'Số lượng mua (Lít)'],
      ['unitPrice', 'Đơn giá (VND/Lít)'],
      ['projectId', 'Mã công trình. VD: CT001'],
      ['location', 'Địa điểm nhận nhiên liệu'],
    ];
  }
  return common.concat(detail);
}
// Tạo mẫu ngang đẹp: cột A = Mã xe, cột B = Biển số, các cột sau = ngày.
// Dòng 1: tiêu đề (Mã | Biển số | các ngày YYYY-MM-DD | Tổng ca)
// Dòng 2: hàng "THỨ" (nhãn ở cột A) - chỉ để xem, khi import sẽ bỏ qua
// Từ dòng 3: dữ liệu từng xe
function buildHorizontalTemplate(dataType, fileName) {
  if (typeof XLSX === 'undefined') { alert('Chưa nạp thư viện XLSX'); return; }
  const d = new Date(); const y = d.getFullYear(), m = d.getMonth();
  const dim = new Date(y, m + 1, 0).getDate();
  const dates = [];
  for (let i = 1; i <= dim; i++) dates.push(`${y}-${String(m + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`);
  const wd = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];

  const header = ['vehicleId', 'Biển số', ...dates, 'Tổng ca'];
  const rowThu = ['THỨ', '', ...dates.map(ds => wd[new Date(ds).getDay()]), ''];

  // Hai xe mẫu (lấy từ danh mục nếu có, để có sẵn biển số đúng)
  const sample = [
    { id: 'XE001', plate: '51E-010.34', mod: 3, val: 1 },
    { id: 'XE002', plate: '50N-771.94', mod: 4, val: 2 },
  ];
  const body = sample.map(s => {
    let tong = 0;
    const cells = dates.map((ds, idx) => { const v = ((idx + 1) % s.mod === 0) ? '' : s.val; if (v) tong += v; return v; });
    return [s.id, s.plate, ...cells, tong];
  });

  const aoa = [header, rowThu, ...body];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  // Cố định độ rộng cột cho dễ nhìn
  ws['!cols'] = [{ wch: 10 }, { wch: 14 }, ...dates.map(() => ({ wch: 5 })), { wch: 8 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Data');
  const guide = getTemplateGuide(dataType);
  const wsGuide = XLSX.utils.aoa_to_sheet(guide);
  wsGuide['!cols'] = [{ wch: 22 }, { wch: 70 }];
  XLSX.utils.book_append_sheet(wb, wsGuide, 'HUONG_DAN');
  XLSX.writeFile(wb, fileName);
}

function exportToExcel(rows, sheetName, fileName) {
  if (typeof XLSX === 'undefined') { alert('Chưa nạp thư viện XLSX'); return; }
  const ws = XLSX.utils.json_to_sheet(rows), wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName); XLSX.writeFile(wb, fileName);
}
function normalizeDate(raw) {
  if (!raw) return '';
  if (typeof raw === 'string') { const m = raw.match(/^(\d{4}-\d{2}-\d{2})/); if (m) return m[1]; }
  if (typeof raw === 'number') { const d = new Date(Math.round((raw - 25569) * 86400 * 1000)); return d.toISOString().split('T')[0]; }
  const d = new Date(raw); if (isNaN(d)) return String(raw); return d.toISOString().split('T')[0];
}
// Chuẩn hóa tên nhiên liệu: "Dầu"->DO, "Xăng"->A95, "Nhớt"->NHOT
function normalizeFuel(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (s === 'dầu' || s === 'dau' || s === 'do' || s === 'diesel') return 'DO';
  if (s === 'xăng' || s === 'xang' || s === 'a95' || s === 'a92' || s === 'e5') return (s === 'a92' ? 'A92' : s === 'e5' ? 'E5' : 'A95');
  if (s === 'nhớt' || s === 'nhot') return 'NHOT';
  return String(raw || '').trim().toUpperCase();
}
// Xóa toàn bộ dữ liệu vận hành + hóa đơn + phân bổ của 1 tháng (YYYY-MM)
async function clearMonthData(yyyymm) {
  if (!db) await initDB();
  const from = yyyymm + '-01', to = yyyymm + '-31';
  for (const store of [SHEET_OPERATION_LOGS, SHEET_INVOICES, SHEET_ALLOCATIONS]) {
    await new Promise((res, rej) => {
      const tx = db.transaction(store, 'readwrite');
      const r = tx.objectStore(store).index('date').openCursor(IDBKeyRange.bound(from, to));
      r.onsuccess = (e) => { const c = e.target.result; if (c) { c.delete(); c.continue(); } };
      tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
    });
  }
  return true;
}
// Khóa kỳ (tháng): lưu danh sách tháng bị khóa
// Lưu/nạp Sổ NXT và ghi chú theo tháng vào localStorage (để không mất khi tải lại)
function saveLedgerToStorage(yyyymm) {
  try {
    localStorage.setItem('fams_ledger_' + yyyymm, JSON.stringify(window.__FAMS_STOCK_LEDGER || []));
    localStorage.setItem('fams_notes_' + yyyymm, JSON.stringify(window.__FAMS_MONTHLY_NOTES || []));
  } catch (e) { console.warn('Không lưu được sổ kho:', e); }
}
function loadLedgerFromStorage(yyyymm) {
  try {
    const l = localStorage.getItem('fams_ledger_' + yyyymm);
    const n = localStorage.getItem('fams_notes_' + yyyymm);
    window.__FAMS_STOCK_LEDGER = l ? JSON.parse(l) : [];
    window.__FAMS_MONTHLY_NOTES = n ? JSON.parse(n) : [];
  } catch (e) { window.__FAMS_STOCK_LEDGER = []; window.__FAMS_MONTHLY_NOTES = []; }
}
function getLockedPeriods() { return JSON.parse(localStorage.getItem('fams_locked') || '[]'); }
function isPeriodLocked(dateStr) { return getLockedPeriods().includes(dateStr.slice(0, 7)); }
function lockPeriod(yyyymm) { const l = getLockedPeriods(); if (!l.includes(yyyymm)) l.push(yyyymm); localStorage.setItem('fams_locked', JSON.stringify(l)); }
function unlockPeriod(yyyymm) { let l = getLockedPeriods().filter(x => x !== yyyymm); localStorage.setItem('fams_locked', JSON.stringify(l)); }
// Dựng bảng số ca HIỆU LỰC dùng chung cho cả 3 PA.
// Quy tắc: ưu tiên Nhật ký thực tế; xe/ngày nào không có nhật ký thì lấy Kế hoạch.
// Trả về: { 'vehicleId|YYYY-MM-DD': soCa }
async function buildEffectiveShiftMap(firstDay, lastDay) {
  // QUY TẮC NGHIỆP VỤ: Phân bổ & Đối soát (PA1-PA4) CHỈ căn cứ Nhật ký vận hành (chấm công thực tế).
  // Kế hoạch vận hành KHÔNG được dùng để chạy phân bổ (chỉ dùng để dự trù ở tab Kế hoạch).
  const logs = await getAllByRange(SHEET_OPERATION_LOGS, firstDay, lastDay);
  const map = {};
  logs.forEach(l => { const s = l.actualShifts || 0; if (s > 0) map[l.vehicleId + '|' + l.date] = s; });
  return map;
}
// Dựng bản đồ địa điểm nhận theo nhóm (fuel__proj__sup) và theo từng hóa đơn.
// Trả về { byGroup: {key: location}, byInvoice: {invoiceId: location} }
function buildLocationMaps(invoices) {
  const byInvoice = {};
  const groupCount = {}; // key -> {location: soLanXuatHien}
  invoices.forEach(inv => {
    const loc = (inv.location || '').trim();
    byInvoice[inv.invoiceId] = loc;
    const key = `${inv.fuelType}__${inv.projectId}__${inv.supplier}`;
    if (!groupCount[key]) groupCount[key] = {};
    if (loc) groupCount[key][loc] = (groupCount[key][loc] || 0) + 1;
  });
  // Với mỗi nhóm, chọn địa điểm xuất hiện nhiều nhất
  const byGroup = {};
  for (const key in groupCount) {
    let best = '', max = -1;
    for (const loc in groupCount[key]) { if (groupCount[key][loc] > max) { max = groupCount[key][loc]; best = loc; } }
    byGroup[key] = best;
  }
  return { byGroup, byInvoice };
}

function calculateTheoreticalNorm(vehicle, log) { if (!log || log.actualShifts <= 0) return 0; return vehicle.normPerShift * log.actualShifts; }
function round2(n) { return Math.round(n * 100) / 100; }
function ddmm(dateStr) { const p = dateStr.split('-'); return p[2] + '/' + p[1]; }
// Tạo chuỗi ngày YYYY-MM-DD an toàn (không lệch múi giờ)
function localDateStr(y, mIndex, day) { return `${y}-${String(mIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`; }


// ============================================================
// THUẬT TOÁN: SỔ KHO ĐA NHÀ CUNG CẤP (FIFO) - NHẬP-XUẤT-TỒN
// Nhóm: Nhiên liệu + Công trình. Trong nhóm: nhiều KHO (NCC).
// Mỗi ngày: rót cho xe theo STT ưu tiên & định mức.
// Rút dầu FIFO: hóa đơn cũ nhất (mọi kho) xuất trước, vét hết mới sang kho/hóa đơn kế.
// Thiếu -> xe nợ -> tạm ứng hóa đơn ngày sau. Dư -> tồn chuyển ngày sau.
// ============================================================
async function calculateMonthlyAllocations(targetDate) {
  if (!db) await initDB();
  const d = new Date(targetDate);
  const firstDay = new Date(d.getFullYear(), d.getMonth(), 1).toISOString().split('T')[0];
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().split('T')[0];

  const vehicles = await loadVehicles(firstDay.slice(0, 7));
  const vMap = {}; vehicles.forEach(v => vMap[v.vehicleId] = v);
  const suppliers = await loadSuppliers();
  const sMap = {}; suppliers.forEach(s => sMap[s.supplierId] = s.supplierName);

  const invoices = await getAllByRange(SHEET_INVOICES, firstDay, lastDay);
  const shiftMapEff = await buildEffectiveShiftMap(firstDay, lastDay);
  const locMaps = buildLocationMaps(invoices);
  const logs = Object.keys(shiftMapEff).map(key => { const [vehicleId, date] = key.split('|'); return { vehicleId, date, plannedShifts: shiftMapEff[key], actualShifts: shiftMapEff[key] }; });

  const daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  const allDates = [];
  for (let i = 1; i <= daysInMonth; i++) allDates.push(localDateStr(d.getFullYear(), d.getMonth(), i));

  function groupKey(fuel, proj) { return `${fuel}__${proj}`; }

  // Nhu cầu từng ngày theo nhóm (Nhiên liệu+Công trình)
  const demandByGroup = {};
  logs.forEach(log => {
    const v = vMap[log.vehicleId]; if (!v) return;
    const shifts = log.plannedShifts || log.actualShifts || 0; if (shifts <= 0) return;
    const need = round2(v.normPerShift * shifts); if (need <= 0) return;
    const key = groupKey(v.fuelType, v.projectId);
    if (!demandByGroup[key]) demandByGroup[key] = {};
    if (!demandByGroup[key][log.date]) demandByGroup[key][log.date] = [];
    log.plannedShifts = shifts;
    demandByGroup[key][log.date].push({ vehicle: v, need, log });
  });

  // Hóa đơn từng nhóm, giữ NCC + ngày (để rút FIFO, mỗi hóa đơn 1 kho)
  const supplyByGroup = {};
  invoices.forEach(inv => {
    const key = groupKey(inv.fuelType, inv.projectId);
    if (!supplyByGroup[key]) supplyByGroup[key] = {};
    if (!supplyByGroup[key][inv.date]) supplyByGroup[key][inv.date] = [];
    supplyByGroup[key][inv.date].push({ invoiceId: inv.invoiceId, supplierId: inv.supplier, remaining: inv.quantity, date: inv.date });
  });

  const allAllocations = [];
  const monthlyNotes = [];
  const stockLedger = [];
  const allGroups = new Set([...Object.keys(demandByGroup), ...Object.keys(supplyByGroup)]);

  for (const key of allGroups) {
    const [fuel, proj] = key.split('__');
    const dayDemand = demandByGroup[key] || {};
    const daySupply = supplyByGroup[key] || {};

    let stockQueue = []; // tất cả hóa đơn còn dầu của nhóm này (mọi kho), rút theo FIFO ngày
    let backlog = [];    // xe còn nợ chưa rót đủ

    for (const day of allDates) {
      const tonDau = round2(stockQueue.reduce((s, x) => s + x.remaining, 0));

      // Nhập hóa đơn trong ngày (mỗi hóa đơn giữ nguyên kho/NCC)
      const todayInv = daySupply[day] || [];
      let nhapTrongNgay = 0;
      todayInv.forEach(inv => { stockQueue.push({ ...inv }); nhapTrongNgay = round2(nhapTrongNgay + inv.remaining); });

      // Nhu cầu phục vụ: nợ cũ trước, rồi nhu cầu mới (sắp theo STT ưu tiên)
      const todayItems = (dayDemand[day] || []).map(it => ({ vehicle: it.vehicle, remainingNeed: it.need, log: it.log, date: day }));
      todayItems.sort((a, b) => (a.vehicle.priority || 999) - (b.vehicle.priority || 999));
      const serveList = [...backlog, ...todayItems];

      let xuatTrongNgay = 0;

      for (const item of serveList) {
        if (item.remainingNeed <= 0.001) continue;

        // Ràng buộc kế hoạch tháng: xe đã nhận bao nhiêu trong tháng (tính từ allAllocations)
        const daNhan = round2(allAllocations.filter(a => a.vehicleId === item.vehicle.vehicleId).reduce((s, a) => s + a.allocatedQuantity, 0));
        const tranThang = item.vehicle.monthlyPlan || Infinity;
        let conDuocNhan = round2(tranThang - daNhan);
        if (conDuocNhan <= 0.001) continue; // chạm trần kế hoạch tháng -> bỏ qua, dồn xe kế
        let need = round2(Math.min(item.remainingNeed, conDuocNhan));

        // Rút FIFO: hóa đơn ngày cũ nhất trước (đã có sẵn trong kho tại thời điểm này)
        const sortedQueue = [...stockQueue].filter(q => q.remaining > 0.001 && q.date <= day).sort((a, b) => a.date < b.date ? -1 : (a.date > b.date ? 1 : 0));
        for (const q of sortedQueue) {
          if (need <= 0.001) break;
          const take = round2(Math.min(q.remaining, need));
          q.remaining = round2(q.remaining - take);
          need = round2(need - take);
          let note = (q.date === day ? `HĐ ${q.invoiceId} (cùng ngày)` : `Tồn HĐ ${q.invoiceId} ngày ${ddmm(q.date)}`) + ` — Kho NCC: ${sMap[q.supplierId] || q.supplierId}`;
          let extraNote = (item.date !== day) ? ` [Tạm ứng cho nhu cầu ngày ${ddmm(item.date)}, cấp thực ngày ${ddmm(day)}]` : '';
          allAllocations.push({ allocationId: generateId(), vehicleId: item.vehicle.vehicleId, date: item.date, fuelType: fuel, theoreticalNorm: (item.log ? round2(item.vehicle.normPerShift * (item.log.plannedShifts || 0)) : 0)
, allocatedQuantity: take, projectId: proj, supplierId: q.supplierId, location: (locMaps.byInvoice[q.invoiceId] || locMaps.byGroup[`${fuel}__${proj}__${q.supplierId}`] || ''), sourceNote: note + extraNote });
          xuatTrongNgay = round2(xuatTrongNgay + take);
          item.remainingNeed = round2(item.remainingNeed - take);
        }
        stockQueue = stockQueue.filter(q => q.remaining > 0.001);
      }

      backlog = serveList.filter(it => it.remainingNeed > 0.001).map(it => ({ vehicle: it.vehicle, remainingNeed: it.remainingNeed, log: it.log, date: it.date }));
      const tonCuoi = round2(stockQueue.reduce((s, x) => s + x.remaining, 0));
      const noHomNay = round2(backlog.reduce((s, x) => s + x.remainingNeed, 0));
      if (nhapTrongNgay > 0 || xuatTrongNgay > 0 || tonDau > 0 || noHomNay > 0)
        stockLedger.push({ date: day, fuel, proj, tonDau, nhap: nhapTrongNgay, xuat: xuatTrongNgay, tonCuoi, conNo: noHomNay });
    }

    if (backlog.length > 0) { const tongNo = round2(backlog.reduce((s, x) => s + x.remainingNeed, 0)); monthlyNotes.push({ level: 'ERROR', fuel, proj, message: `Nhóm ${fuel}/${proj}: hết tháng vẫn THIẾU ${tongNo} L. Cần bổ sung hóa đơn.` }); }
    const tonCuoiThang = round2(stockQueue.reduce((s, x) => s + x.remaining, 0));
    if (tonCuoiThang > 0.01) monthlyNotes.push({ level: 'INFO', fuel, proj, message: `Nhóm ${fuel}/${proj}: TỒN KHO cuối tháng ${tonCuoiThang} L (chuyển sang tháng sau).` });
  }

  await clearAllocationsByRange(firstDay, lastDay);
  if (allAllocations.length > 0) {
    await new Promise((res, rej) => { const tx = db.transaction(SHEET_ALLOCATIONS, 'readwrite'); const st = tx.objectStore(SHEET_ALLOCATIONS); allAllocations.forEach(a => st.put(a)); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
  }
  window.__FAMS_MONTHLY_NOTES = monthlyNotes;
  window.__FAMS_STOCK_LEDGER = stockLedger;
  return allAllocations;
}

async function updateAllocationQty(allocationId, newQty) {
  if (!db) await initDB();
  return new Promise((res, rej) => {
    const st = getStore(SHEET_ALLOCATIONS, 'readwrite');
    const g = st.get(allocationId);
    g.onsuccess = () => { const rec = g.result; if (!rec) { rej('Không tìm thấy'); return; } rec.allocatedQuantity = round2(Number(newQty) || 0); rec.manualEdited = true; st.put(rec); res(rec); };
    g.onerror = () => rej(g.error);
  });
}

// ============================================================
// PHƯƠNG ÁN 1: VÉT CẠN THEO KHO (rót hết 100% hóa đơn từng NCC)
// Nhóm: Nhiên liệu + Công trình + NCC. Mỗi nhóm rót hết dầu cả tháng.
// Chia theo trọng số = định mức/ca × số ca kế hoạch của xe.
// Suy ngược số ca thực = dầu ÷ (định mức/ca). Không tồn cuối tháng.
// ============================================================
async function calculateMonthlyAllocationsDrain(targetDate) {
  if (!db) await initDB();
  const d = new Date(targetDate);
  const firstDay = localDateStr(d.getFullYear(), d.getMonth(), 1);
  const lastDay = localDateStr(d.getFullYear(), d.getMonth(), new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate());

  const vehicles = await loadVehicles(firstDay.slice(0, 7));
  const vMap = {}; vehicles.forEach(v => vMap[v.vehicleId] = v);
  const suppliers = await loadSuppliers();
  const sMap = {}; suppliers.forEach(s => sMap[s.supplierId] = s.supplierName);

  const invoices = await getAllByRange(SHEET_INVOICES, firstDay, lastDay);
  const shiftMapEff = await buildEffectiveShiftMap(firstDay, lastDay);
  const locMaps = buildLocationMaps(invoices);

  // Gom hóa đơn theo nhóm Nhiên liệu + Công trình + NCC
  function gk(fuel, proj, sup) { return `${fuel}__${proj}__${sup}`; }
  const invByGroup = {};
  invoices.forEach(inv => { const k = gk(inv.fuelType, inv.projectId, inv.supplier); if (!invByGroup[k]) invByGroup[k] = []; invByGroup[k].push(inv); });

  // Gom nhu cầu trọng số theo nhóm Nhiên liệu + Công trình, dùng SỐ CA HIỆU LỰC (Nhật ký ưu tiên, thiếu thì Kế hoạch)
  const planByFC = {}; // key fuel__proj -> [{vehicle, date, shifts, weight}]
  for (const key in shiftMapEff) {
    const [vid, date] = key.split('|');
    const v = vMap[vid]; if (!v) continue;
    const shifts = shiftMapEff[key]; if (shifts <= 0) continue;
    const k = `${v.fuelType}__${v.projectId}`;
    if (!planByFC[k]) planByFC[k] = [];
    planByFC[k].push({ vehicle: v, date, shifts, weight: v.normPerShift * shifts });
  }

  const allAllocations = [];
  const monthlyNotes = [];
  const stockLedger = [];

  for (const gkey in invByGroup) {
    const [fuel, proj, sup] = gkey.split('__');
    const totalFuel = round2(invByGroup[gkey].reduce((s, x) => s + x.quantity, 0));
    const fcKey = `${fuel}__${proj}`;
    const demand = planByFC[fcKey] || [];
    const totalWeight = demand.reduce((s, x) => s + x.weight, 0);

    if (totalWeight <= 0) { monthlyNotes.push({ level: 'ERROR', fuel, proj, message: `Kho ${sMap[sup] || sup} (${fuel}/${proj}): có ${totalFuel} L hóa đơn nhưng KHÔNG có xe nào chạy (kế hoạch trống). Dầu không rót được.` }); continue; }

    // Chia dầu theo trọng số
    let allocated = 0; const rows = [];
    demand.forEach(item => {
      const qty = round2(totalFuel * (item.weight / totalWeight));
      allocated = round2(allocated + qty);
      rows.push({ item, qty });
    });
    // Bù sai số làm tròn vào dòng trọng số lớn nhất
    const diff = round2(totalFuel - allocated);
    if (diff !== 0 && rows.length > 0) { let mi = 0; rows.forEach((r, i) => { if (r.item.weight > rows[mi].item.weight) mi = i; }); rows[mi].qty = round2(rows[mi].qty + diff); }

    rows.forEach(r => {
      const v = r.item.vehicle;
      const soCaThuc = v.normPerShift > 0 ? round2(r.qty / v.normPerShift) : 0;
      allAllocations.push({ allocationId: generateId(), vehicleId: v.vehicleId, date: r.item.date, fuelType: fuel, theoreticalNorm: round2(v.normPerShift * r.item.shifts), allocatedQuantity: r.qty, projectId: proj, supplierId: sup, location: locMaps.byGroup[gkey] || '', actualShiftsCalc: soCaThuc, sourceNote: `Vét cạn kho ${sMap[sup] || sup} — số ca suy ngược: ${soCaThuc}` });
    });
    monthlyNotes.push({ level: 'INFO', fuel, proj, message: `Kho ${sMap[sup] || sup} (${fuel}/${proj}): đã rót hết ${totalFuel} L cho ${rows.length} lượt xe.` });
    stockLedger.push({ date: lastDay, fuel, proj, tonDau: 0, nhap: totalFuel, xuat: totalFuel, tonCuoi: 0, conNo: 0, supplier: sMap[sup] || sup });
  }

  await clearAllocationsByRange(firstDay, lastDay);
  if (allAllocations.length > 0) {
    await new Promise((res, rej) => { const tx = db.transaction(SHEET_ALLOCATIONS, 'readwrite'); const st = tx.objectStore(SHEET_ALLOCATIONS); allAllocations.forEach(a => st.put(a)); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
  }
  window.__FAMS_MONTHLY_NOTES = monthlyNotes;
  window.__FAMS_STOCK_LEDGER = stockLedger;
  return allAllocations;
}

// ============================================================
// PHƯƠNG ÁN 3 (v5 - CHIA HẠN NGẠCH NCC THEO CA TRỌN VẸN, 2 LƯỢT, THEO THỜI GIAN)
// Nguyên tắc chốt:
//   1) TRỤC = NGÀY VẬN HÀNH. Mọi dòng phân bổ mang ngày xe chạy.
//   2) TRẦN CỨNG mỗi ca ≤ định mức × số ca. k = min(1, tổng dầu/tổng nhu cầu), kẹp sàn 0.8.
//   3) LƯỢT 1 - CHIA HẠN NGẠCH: sắp mọi ca theo THỜI GIAN (ngày sớm trước, STT ưu tiên).
//      Sắp NCC theo hóa đơn ngày sớm nhất. Cuốn chiếu: gán trọn từng ca cho NCC hiện hành cho tới
//      khi dầu NCC đó không đủ 1 ca trọn -> phần lẻ dồn vào ca cuối của NCC đó (kẹp ≤ định mức),
//      rồi chuyển sang NCC kế tiếp. => mỗi NCC cấp SẠCH, mỗi ca chỉ 1 NCC.
//   4) LƯỢT 2 - RÓT FIFO trong đúng NCC đã gán: cùng ngày -> tồn trước -> TẠM ỨNG ngày sau (ghi chú).
//      Cột Xuất ghi ngày VH (Cách A) -> tồn có thể tạm âm, cuối kỳ >= 0.
//   5) Thiếu k<0.8 -> cảnh báo. Dư k=1 -> phần dư để tồn (không nhồi vượt).
// ============================================================
async function calculateMonthlyAllocationsRolling(targetDate, shortageMode) {
  if (!db) await initDB();
  shortageMode = shortageMode || 'STT';
  const FLOOR = 0.8, CEIL = 1.0;

  const d = new Date(targetDate);
  const firstDay = localDateStr(d.getFullYear(), d.getMonth(), 1);
  const daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  const lastDay = localDateStr(d.getFullYear(), d.getMonth(), daysInMonth);

  const vehicles = await loadVehicles(firstDay.slice(0, 7));
  const suppliers = await loadSuppliers();
  const sMap = {}; suppliers.forEach(s => sMap[s.supplierId] = s.supplierName);

  const invoices = await getAllByRange(SHEET_INVOICES, firstDay, lastDay);
  const shiftMap = await buildEffectiveShiftMap(firstDay, lastDay);
  const locMaps = buildLocationMaps(invoices);

  const allDates = [];
  for (let i = 1; i <= daysInMonth; i++) allDates.push(localDateStr(d.getFullYear(), d.getMonth(), i));

  const allAllocations = [];
  const monthlyNotes = [];
  const stockLedger = [];

  const fuelTypes = [...new Set(vehicles.map(v => v.fuelType).concat(invoices.map(i => i.fuelType)))];

  for (const fuel of fuelTypes) {
    // Lô hóa đơn của loại nhiên liệu này (giữ theo NCC + ngày để FIFO)
    const invF = invoices.filter(i => i.fuelType === fuel)
      .map(i => ({ invoiceId: i.invoiceId, supplierId: i.supplier, projectId: i.projectId, date: i.date, remaining: round2(i.quantity), quantity: round2(i.quantity) }))
      .sort((a, b) => a.date < b.date ? -1 : (a.date > b.date ? 1 : 0));
    const tongDau = round2(invF.reduce((s, x) => s + x.quantity, 0));

    const groupVehicles = vehicles.filter(v => v.fuelType === fuel);

    // Nhu cầu từng ca theo nhật ký
    let demandList = [];
    for (const v of groupVehicles) {
      for (const day of allDates) {
        const shifts = shiftMap[v.vehicleId + '|' + day] || 0;
        if (shifts > 0) demandList.push({ vehicle: v, date: day, shifts, need: round2(v.normPerShift * shifts), assignedSup: null, target: 0, remain: 0 });
      }
    }
    const tongNhuCau = round2(demandList.reduce((s, x) => s + x.need, 0));
    if (tongNhuCau <= 0.001) {
      if (tongDau > 0.01) monthlyNotes.push({ level: 'ERROR', fuel, proj: getProjOfInvoices(invF), message: `PA3 (${fuel}): có ${tongDau} L hóa đơn nhưng KHÔNG có xe nào chạy loại này.` });
      continue;
    }

    // Hệ số phủ + kẹp biên
    let k = tongDau / tongNhuCau;
    let kClamped = k, kNote = 'trong dung sai';
    if (k >= CEIL) { kClamped = CEIL; kNote = 'đủ/dư dầu → cấp 100%, phần dư để tồn'; }
    else if (k < FLOOR) { kClamped = FLOOR; kNote = 'thiếu nặng → kẹp sàn 80%, phần thiếu cảnh báo'; }
    const kPct = Math.round(kClamped * 100);
    demandList.forEach(it => { it.target = round2(it.need * kClamped); it.remain = it.target; });

    // Sắp ca theo THỜI GIAN: ngày sớm trước, cùng ngày theo STT ưu tiên
    demandList.sort((a, b) => a.date < b.date ? -1 : (a.date > b.date ? 1 : ((a.vehicle.priority || 999) - (b.vehicle.priority || 999))));

      // ===== HƯỚNG A (v7): GÁN NCC NGAY KHI CẤP, THEO NGÀY VẬN HÀNH, LŨY KẾ TỪNG NCC ≥ 0 =====
    // NGUYÊN TẮC:
    //  - Ngày cấp = NGÀY VẬN HÀNH (cố định, không dời).
    //  - Với MỖI NCC: tại mọi ngày N, tổng phân bổ lũy kế ≤ tổng hóa đơn lũy kế (không âm).
    //    (Cho phép "dầu vật lý về trước, hóa đơn giấy về sau" trong phạm vi đã thực nhập tới ngày N.)
    //  - Gán ca cho NCC ngay tại thời điểm cấp, ưu tiên NCC có hóa đơn VỀ SỚM & còn hạn ngạch lũy kế.
    //  - Trần cứng mỗi ca = need × k (≤ định mức). Vét phần lẻ ở cuối (1B/1C) để tồn = 0.
    {
      // Thứ tự NCC ưu tiên: NCC có hóa đơn về sớm nhất trước
      const supFirstDate = {};
      invF.forEach(q => { if (!supFirstDate[q.supplierId] || q.date < supFirstDate[q.supplierId]) supFirstDate[q.supplierId] = q.date; });
      const supOrder = Object.keys(supFirstDate).sort((a, b) => supFirstDate[a] < supFirstDate[b] ? -1 : (supFirstDate[a] > supFirstDate[b] ? 1 : 0));

      // Lũy kế nhập/xuất theo từng NCC (tăng dần theo ngày) - dùng làm VAN CHẶN không âm
      const nhapLK = {}; const xuatLK = {};
      supOrder.forEach(s => { nhapLK[s] = 0; xuatLK[s] = 0; });

      let backlog = []; // ca chưa cấp đủ (do dầu chưa về): {vehicle, workDate, remain, ref}

      for (const day of allDates) {
        // 1) Cộng hóa đơn nhập trong ngày vào lũy kế nhập
        invF.filter(q => q.date === day).forEach(q => { nhapLK[q.supplierId] = round2((nhapLK[q.supplierId] || 0) + q.quantity); });

        // 2) Nhu cầu phục vụ hôm nay = NỢ CŨ (ngày sớm hơn) trước, rồi ca mới hôm nay (STT ưu tiên)
        const todayNew = demandList.filter(it => it.date === day && it.remain > 0.001)
          .map(it => ({ vehicle: it.vehicle, workDate: day, remain: it.remain, ref: it }))
          .sort((a, b) => (a.vehicle.priority || 999) - (b.vehicle.priority || 999));
        const serveList = [...backlog, ...todayNew];
        backlog = [];

        let xuatNgay = 0;

        for (const item of serveList) {
          let need = item.remain;
          if (need <= 0.001) continue;

          // Thử lần lượt các NCC theo thứ tự về sớm; mỗi ca CHỈ dùng dầu 1 NCC (Phương án X).
          // Chọn NCC đầu tiên còn HẠN NGẠCH LŨY KẾ (quota>0). Cấp tối đa trong quota & trong nhu cầu.
          let capChoItem = 0; let supDung = null;
          for (const supId of supOrder) {
            const quota = round2((nhapLK[supId] || 0) - (xuatLK[supId] || 0));
            if (quota <= 0.001) continue;                 // NCC này chưa có dầu (lũy kế) -> thử NCC khác
            supDung = supId;
            const capDuoc = round2(Math.min(need, quota)); // trong hạn ngạch lũy kế NCC

            // Rút FIFO các lô còn dầu của NCC (lô ngày sớm nhất trước)
            let con = capDuoc;
            // HƯỚNG 1: cho phép cấp dầu TRƯỚC ngày hóa đơn (hàng đã về, hóa đơn giấy về sau).
            // Rút FIFO mọi lô còn dầu của NCC (không giới hạn theo ngày). Lũy kế có thể âm giữa kỳ.
            const lots = invF.filter(q => q.remaining > 0.001 && q.supplierId === supId).sort((a, b) => a.date < b.date ? -1 : 1);
            for (const q of lots) {
              if (con <= 0.001) break;
              const take = round2(Math.min(q.remaining, con));
              if (take <= 0.001) continue;
              q.remaining = round2(q.remaining - take);
              con = round2(con - take);
              const treGiay = (q.date > item.workDate); // hóa đơn giấy về sau ngày vận hành (dầu đã về trước)
              let note = (q.date === item.workDate) ? `HĐ ${q.invoiceId} cùng ngày`
                : (treGiay ? `HĐ ${q.invoiceId} (giấy về ${ddmm(q.date)}, dầu đã về trước ngày VH)` : `Tồn HĐ ${q.invoiceId} ngày ${ddmm(q.date)}`);
              addAlloc(allAllocations, item.vehicle, item.workDate, take, fuel, supId, q.invoiceId, q.projectId, sMap, locMaps, kPct, note);
            }
            const daCap = round2(capDuoc - con);
            xuatLK[supId] = round2((xuatLK[supId] || 0) + daCap);
            xuatNgay = round2(xuatNgay + daCap);
            capChoItem = daCap;
            break; // Phương án X: 1 ca chỉ 1 NCC, cấp xong (hoặc cấp tối đa quota) thì dừng
          }

          if (item.ref) item.ref.remain = round2(item.ref.remain - capChoItem);
          const conThieu = round2(need - capChoItem);
          if (conThieu > 0.001) backlog.push({ vehicle: item.vehicle, workDate: item.workDate, remain: conThieu, ref: item.ref });
        }

        // Sổ NXT theo ngày (tồn luôn ≥ 0 vì van lũy kế chặn)
        const nhapNgay = round2(invF.filter(q => q.date === day).reduce((s, q) => s + q.quantity, 0));
        const tonCuoi = round2(supOrder.reduce((s, sp) => s + ((nhapLK[sp] || 0) - (xuatLK[sp] || 0)), 0));
        const tonDauNgay = round2(tonCuoi + xuatNgay - nhapNgay);
        const noNgay = round2(backlog.reduce((s, b) => s + b.remain, 0));
        if (nhapNgay > 0 || xuatNgay > 0 || tonDauNgay > 0 || noNgay > 0)
          stockLedger.push({ date: day, fuel, proj: getProjOfInvoices(invF), supplier: '(chung 2 NCC)', tonDau: tonDauNgay < 0 ? 0 : tonDauNgay, nhap: nhapNgay, xuat: xuatNgay, tonCuoi: tonCuoi < 0 ? 0 : tonCuoi, conNo: noNgay });
      }

      // Sau khi hết tháng: còn dư dầu NCC nào thì VÉT NỐT vào các ca của NCC đó (nâng tới định mức,
      // nếu vẫn dư thì tới 110%). Đảm bảo tồn cuối = 0. Ưu tiên lấp ca đang thiếu nhiều nhất.
      const duSup = {};
      supOrder.forEach(sp => { duSup[sp] = round2((nhapLK[sp] || 0) - (xuatLK[sp] || 0)); });
      // Gom: mỗi allocation biết của NCC nào; ta nâng thêm lượng cấp cho các ca đã cấp của NCC đó.
      for (const supId of supOrder) {
        let du = round2(duSup[supId]);
        if (du <= 0.001) continue;
        // Các dòng đã cấp của NCC này, gom theo (xe+ngày) để nâng thêm; ưu tiên dòng thiếu nhiều nhất
        const rows = allAllocations.filter(a => a.supplierId === supId && a.fuelType === fuel);
        // Nâng tới 100% định mức trước
        for (const pass of [1.0, 1.10]) {
          rows.sort((a, b) => {
            const v = vehicles.find(x => x.vehicleId === a.vehicleId) || {};
            const w = vehicles.find(x => x.vehicleId === b.vehicleId) || {};
            const capA = (v.normPerShift * (a.actualShiftsCalc || 0) * pass) - a.allocatedQuantity;
            const capB = (w.normPerShift * (b.actualShiftsCalc || 0) * pass) - b.allocatedQuantity;
            return capB - capA;
          });
          for (const a of rows) {
            if (du <= 0.001) break;
            const v = vehicles.find(x => x.vehicleId === a.vehicleId) || {};
            const soCa = a.actualShiftsCalc || 0;
            const tranPass = round2(v.normPerShift * soCa * pass);
            const cho = round2(tranPass - a.allocatedQuantity);
            const them = round2(Math.min(du, cho));
            if (them <= 0.001) continue;
            a.allocatedQuantity = round2(a.allocatedQuantity + them);
            a.actualShiftsCalc = v.normPerShift > 0 ? round2(a.allocatedQuantity / v.normPerShift) : 0;
            a.sourceNote += ` [vét dầu dư +${them} L]`;
            du = round2(du - them);
          }
          if (du <= 0.001) break;
        }
        if (du > 0.01) monthlyNotes.push({ level: 'WARNING', fuel, proj: getProjOfInvoices(invF), message: `PA3 (${fuel}) - NCC ${sMap[supId] || supId}: còn dư ${du} L sau khi nới trần 110%. Để tồn (mua thừa).` });
      }

      // HƯỚNG 1: lũy kế được phép âm giữa kỳ (hàng về trước hóa đơn), nhưng CUỐI KỲ mỗi NCC phải ≥ 0.
      supOrder.forEach(supId => {
        const cuoiKy = round2((nhapLK[supId] || 0) - (xuatLK[supId] || 0));
        if (cuoiKy < -0.01) monthlyNotes.push({ level: 'ERROR', fuel, proj: getProjOfInvoices(invF), message: `PA3 (${fuel}) - NCC ${sMap[supId] || supId}: CUỐI KỲ lũy kế ÂM ${round2(-cuoiKy)} L (cấp vượt tổng hóa đơn cả tháng). Cần kiểm tra lại số ca hoặc bổ sung hóa đơn.` });
      });
      const noCuoi = round2(backlog.reduce((s, b) => s + b.remain, 0));
      if (noCuoi > 0.01) monthlyNotes.push({ level: 'WARNING', fuel, proj: getProjOfInvoices(invF), message: `PA3 (${fuel}): còn ${noCuoi} L nhu cầu chưa cấp trong tháng. Lũy kế cuối kỳ được kiểm tra riêng theo từng NCC.` });
    }

    // Kết luận
    const tongCap = round2(allAllocations.filter(a => a.fuelType === fuel).reduce((s, a) => s + a.allocatedQuantity, 0));
    const conThieu = round2(demandList.reduce((s, it) => s + (it.remain > 0.001 ? it.remain : 0), 0));
    const tonKhoLai = round2(invF.reduce((s, q) => s + q.remaining, 0));
    let lvl = 'INFO';
    let msg = `PA3 (${fuel}): Tổng HĐ ${tongDau} L / Nhu cầu ĐM ${tongNhuCau} L → hệ số phủ ${Math.round(k*100)}% (áp ${kPct}%, ${kNote}). Đã cấp ${tongCap} L.`;
    if (kClamped === FLOOR && k < FLOOR) lvl = 'WARNING';
    if (conThieu > 0.01) { lvl = 'ERROR'; msg += ` CẢNH BÁO: còn THIẾU ${conThieu} L (một số ca chưa gán được NCC do hết dầu).`; }
    if (tonKhoLai > 0.01) msg += ` Tồn kho còn ${tonKhoLai} L (dư dầu, chuyển tháng sau).`;
    monthlyNotes.push({ level: lvl, fuel, proj: getProjOfInvoices(invF), message: msg });
  }
  // ===== LỚP DAO ĐỘNG CÓ KIỂM SOÁT (Hướng 1 - làm hồ sơ tự nhiên) =====
  // Cùng 1 xe + 1 NCC + 1 nhiên liệu: GIỮ NGUYÊN TỔNG, chỉ hoán đổi lượng giữa các ngày để
  // vài ngày sát 100% ĐM, vài ngày ~85% ĐM -> hồ sơ nhìn tự nhiên, không đều tăm tắp.
  // Ràng buộc: (1) tổng nhóm không đổi (bảo toàn hóa đơn); (2) không ngày nào vượt 100% ĐM/ca.
  // Mẫu cao/thấp gieo CỐ ĐỊNH từ mã xe + ngày -> chạy lại ra GIỐNG NHAU, giải trình được.
  {
    const FLOOR_DAO = 0.85; // sàn kéo xuống 85% định mức; trần 100%
    const seedRand = (str) => { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return ((h >>> 0) % 1000) / 1000; };

    // Gom theo xe + NCC + nhiên liệu
    const groups = {};
    allAllocations.forEach(a => { const key = a.vehicleId + '|' + a.supplierId + '|' + a.fuelType; (groups[key] = groups[key] || []).push(a); });

    for (const key in groups) {
      const rows = groups[key].filter(a => a.allocatedQuantity > 0.001).sort((a, b) => a.date < b.date ? -1 : 1);
      if (rows.length < 2) continue;
      const [vid] = key.split('|');
      const v = vehicles.find(x => x.vehicleId === vid); if (!v || v.normPerShift <= 0) continue;

      // Trần/sàn mỗi dòng theo số ca thực của dòng đó
      rows.forEach(a => { const soCa = a.actualShiftsCalc || 0; a._max = round2(v.normPerShift * soCa); a._min = round2(v.normPerShift * soCa * FLOOR_DAO); });
      const tong = round2(rows.reduce((s, a) => s + a.allocatedQuantity, 0));

      // Mục tiêu dao động ngẫu nhiên cố định trong [min, max]
      rows.forEach(a => { const r = seedRand(vid + a.date); a._new = round2(a._min + (a._max - a._min) * r); });

      // Chuẩn hóa để tổng == tong (bảo toàn), kẹp trong [min, max], bù chênh nhiều vòng
      for (let iter = 0; iter < 5; iter++) {
        const sumNow = round2(rows.reduce((s, a) => s + a._new, 0));
        let diff = round2(tong - sumNow);
        if (Math.abs(diff) <= 0.001) break;
        // rải chênh vào các dòng còn room theo hướng phù hợp
        const order = diff > 0 ? rows.filter(a => a._new < a._max - 0.001) : rows.filter(a => a._new > a._min + 0.001);
        if (order.length === 0) break;
        // chia đều phần chênh cho các dòng còn room
        for (const a of order) {
          if (Math.abs(diff) <= 0.001) break;
          const share = round2(diff / order.length);
          if (diff > 0) { const room = round2(a._max - a._new); const t = round2(Math.min(room, Math.max(share, 0.001))); a._new = round2(a._new + t); diff = round2(diff - t); }
          else { const room = round2(a._new - a._min); const t = round2(Math.min(room, Math.max(-share, 0.001))); a._new = round2(a._new - t); diff = round2(diff + t); }
        }
      }

      // ÉP KHỚP TỔNG TUYỆT ĐỐI: dồn toàn bộ sai số làm tròn vào dòng có room lớn nhất,
      // để tổng nhóm sau dao động == tổng gốc (không lệch dù chỉ 0.001 L).
      let sumNew = round2(rows.reduce((s, a) => s + a._new, 0));
      let saiSo = round2(tong - sumNew);
      if (Math.abs(saiSo) > 0.0001) {
        // chọn dòng còn room để nhận sai số (dương thì cần room lên trần, âm thì cần room xuống sàn)
        let target = null;
        for (const a of rows) {
          const room = saiSo > 0 ? round2(a._max - a._new) : round2(a._new - a._min);
          if (room >= Math.abs(saiSo) - 0.0001) { target = a; break; }
        }
        if (!target) target = rows[rows.length - 1]; // không dòng nào đủ room -> dồn vào dòng cuối
        target._new = round2(target._new + saiSo);
      }

      // Ghi lại
      rows.forEach(a => {
        a.allocatedQuantity = a._new;
        a.actualShiftsCalc = v.normPerShift > 0 ? round2(a._new / v.normPerShift) : 0;
        const soCa = a.actualShiftsCalc || 1;
        const pctDM = Math.round(a._new / (v.normPerShift * (soCa || 1)) * 100);
        if (!/dao động hồ sơ/.test(a.sourceNote)) a.sourceNote += ` [dao động hồ sơ ~${pctDM}% ĐM]`;
        delete a._max; delete a._min; delete a._new;
      });
    }
  }
  // ===== VÁ SAI SỐ LÀM TRÒN CUỐI CÙNG THEO TỪNG NCC + NHIÊN LIỆU =====
  // Đảm bảo TỔNG phân bổ mỗi (NCC + nhiên liệu) == TỔNG hóa đơn tương ứng, tuyệt đối không lệch.
  // Dồn phần sai số (thường < 0.01 L) vào dòng phân bổ có lượng cấp lớn nhất của nhóm đó.
  {
    const invTotalBySF = {}; // "sup|fuel" -> tổng hóa đơn
    invoices.forEach(i => { const key = i.supplier + '|' + i.fuelType; invTotalBySF[key] = round2((invTotalBySF[key] || 0) + i.quantity); });
    const allocBySF = {};    // "sup|fuel" -> [allocations]
    allAllocations.forEach(a => { const key = a.supplierId + '|' + a.fuelType; (allocBySF[key] = allocBySF[key] || []).push(a); });
    for (const key in allocBySF) {
      const rows = allocBySF[key];
      const tongAlloc = round2(rows.reduce((s, a) => s + a.allocatedQuantity, 0));
      const tongInv = invTotalBySF[key] || 0;
      const saiSo = round2(tongInv - tongAlloc);
      if (Math.abs(saiSo) > 0.0001 && Math.abs(saiSo) < 1) { // chỉ vá sai số nhỏ do làm tròn
        // dồn vào dòng lượng cấp lớn nhất (ít ảnh hưởng % định mức)
        let big = rows[0];
        rows.forEach(a => { if (a.allocatedQuantity > big.allocatedQuantity) big = a; });
        big.allocatedQuantity = round2(big.allocatedQuantity + saiSo);
        const v = vehicles.find(x => x.vehicleId === big.vehicleId);
        if (v && v.normPerShift > 0) big.actualShiftsCalc = round2(big.allocatedQuantity / v.normPerShift);
        big.sourceNote += ` [vá sai số làm tròn ${saiSo > 0 ? '+' : ''}${saiSo} L]`;
      }
    }
  }

  await clearAllocationsByRange(firstDay, lastDay);
  if (allAllocations.length > 0) {
    await new Promise((res, rej) => { const tx = db.transaction(SHEET_ALLOCATIONS, 'readwrite'); const st = tx.objectStore(SHEET_ALLOCATIONS); allAllocations.forEach(a => st.put(a)); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
  }
  window.__FAMS_MONTHLY_NOTES = monthlyNotes;
  window.__FAMS_STOCK_LEDGER = stockLedger;
  return allAllocations;
}

// ----- Hàm phụ trợ cho PA3 v5 -----
function getProjOfInvoices(invF) { const set = new Set(invF.map(x => x.projectId)); return set.size === 1 ? [...set][0] : '(nhiều CT)'; }
function addAlloc(out, v, workDate, take, fuel, sup, invoiceId, projectId, sMap, locMaps, kPct, noteSource) {
  if (take <= 0.001) return;
  const soCa = v.normPerShift > 0 ? round2(take / v.normPerShift) : 0;
  const theoretical = round2(v.normPerShift * soCa);
  out.push({
    allocationId: generateId(),
    vehicleId: v.vehicleId,
    date: workDate,
    fuelType: fuel,
    theoreticalNorm: theoretical,
    allocatedQuantity: take,
    projectId: projectId,
    supplierId: sup,
    location: (locMaps.byInvoice[invoiceId] || locMaps.byGroup[`${fuel}__${projectId}__${sup}`] || ''),
    actualShiftsCalc: soCa,
    sourceNote: `PA3 ngày VH ${ddmm(workDate)} — ${noteSource} (Kho ${sMap[sup] || sup}) — cấp ${take} L (${v.normPerShift > 0 ? Math.round(take / v.normPerShift * 100 / (soCa || 1)) : kPct}% ĐM/ca, ca: ${soCa})`
  });
}

// ============================================================
// PHƯƠNG ÁN 4: RẢI ĐỀU THEO HỆ SỐ (uniform scaling)
// Nhóm: Công trình + NCC + Nhiên liệu.
// Hệ số = Tổng dầu hóa đơn tháng ÷ Tổng nhu cầu lý thuyết tháng.
// Mỗi xe/ngày cấp = nhu cầu ngày đó × Hệ số. Rải đều cả tháng.
// Đảm bảo Nhập = Xuất tuyệt đối, tồn cuối tháng = 0.
// Nguồn số ca: ưu tiên Nhật ký thực tế, thiếu thì Kế hoạch.
// ============================================================
async function calculateMonthlyAllocationsScaled(targetDate) {
  if (!db) await initDB();
  const d = new Date(targetDate);
  const firstDay = localDateStr(d.getFullYear(), d.getMonth(), 1);
  const daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  const lastDay = localDateStr(d.getFullYear(), d.getMonth(), daysInMonth);

  const vehicles = await loadVehicles(firstDay.slice(0, 7));
  const vMap = {}; vehicles.forEach(v => vMap[v.vehicleId] = v);
  const suppliers = await loadSuppliers();
  const sMap = {}; suppliers.forEach(s => sMap[s.supplierId] = s.supplierName);

  const invoices = await getAllByRange(SHEET_INVOICES, firstDay, lastDay);
  const shiftMap = await buildEffectiveShiftMap(firstDay, lastDay);
  const locMaps = buildLocationMaps(invoices);

  const allDates = [];
  for (let i = 1; i <= daysInMonth; i++) allDates.push(localDateStr(d.getFullYear(), d.getMonth(), i));

  function gk(fuel, proj, sup) { return `${fuel}__${proj}__${sup}`; }
  const invByGroup = {};
  invoices.forEach(inv => {
    const k = gk(inv.fuelType, inv.projectId, inv.supplier);
    if (!invByGroup[k]) invByGroup[k] = {};
    if (!invByGroup[k][inv.date]) invByGroup[k][inv.date] = 0;
    invByGroup[k][inv.date] = round2(invByGroup[k][inv.date] + inv.quantity);
  });

  const allAllocations = [];
  const monthlyNotes = [];
  const stockLedger = [];

  for (const gkey in invByGroup) {
    const [fuel, proj, sup] = gkey.split('__');
    const daySupply = invByGroup[gkey];
    const groupVehicles = vehicles.filter(v => v.fuelType === fuel && v.projectId === proj);

    // Nhu cầu từng ngày (đã sắp STT)
    const demandByDay = {};
    let tongCauThang = 0;
    allDates.forEach(day => {
      const dem = groupVehicles
        .map(v => ({ vehicle: v, shifts: shiftMap[v.vehicleId + '|' + day] || 0 }))
        .filter(x => x.shifts > 0)
        .map(x => ({ vehicle: x.vehicle, shifts: x.shifts, need: round2(x.vehicle.normPerShift * x.shifts) }))
        .sort((a, b) => (a.vehicle.priority || 999) - (b.vehicle.priority || 999));
      demandByDay[day] = dem;
      tongCauThang = round2(tongCauThang + dem.reduce((s, x) => s + x.need, 0));
    });

    const tongDauThang = round2(Object.values(daySupply).reduce((s, x) => s + x, 0));

    if (tongCauThang <= 0.001) {
      if (tongDauThang > 0.01) monthlyNotes.push({ level: 'ERROR', fuel, proj, message: `PA4 - Kho ${sMap[sup] || sup} (${fuel}/${proj}): có ${tongDauThang} L hóa đơn nhưng KHÔNG có xe nào chạy cả tháng. Không rót được.` });
      continue;
    }

    // Hệ số phóng đại (dầu / nhu cầu). >1: mua dư, <1: mua thiếu.
    const heSo = tongDauThang / tongCauThang;
    const heSoPct = Math.round(heSo * 100);

    // Cấp cho từng ngày = nhu cầu ngày × hệ số. Bù sai số làm tròn dồn vào dòng cuối cùng.
    let daCap = 0;
    const allocRows = [];
    allDates.forEach(day => {
      demandByDay[day].forEach(item => {
        const cap = round2(item.need * heSo);
        daCap = round2(daCap + cap);
        allocRows.push({ day, item, cap });
      });
    });
    // Bù chênh lệch làm tròn để tổng cấp = tổng dầu hóa đơn
    const diff = round2(tongDauThang - daCap);
    if (diff !== 0 && allocRows.length > 0) {
      // dồn vào dòng có nhu cầu lớn nhất
      let mi = 0; allocRows.forEach((r, i) => { if (r.item.need > allocRows[mi].item.need) mi = i; });
      allocRows[mi].cap = round2(allocRows[mi].cap + diff);
    }

    // Ghi allocation
    allocRows.forEach(r => {
      const v = r.item.vehicle;
      const soCaThuc = v.normPerShift > 0 ? round2(r.cap / v.normPerShift) : 0;
      const note = `PA4 ngày ${ddmm(r.day)} — Kho ${sMap[sup] || sup} — hệ số ${heSoPct}% — cấp ${r.cap} L (ĐM ${r.item.need} L, ca suy ra: ${soCaThuc})`;
      allAllocations.push({ allocationId: generateId(), vehicleId: v.vehicleId, date: r.day, fuelType: fuel, theoreticalNorm: r.item.need, allocatedQuantity: r.cap, projectId: proj, supplierId: sup, location: (locMaps.byGroup[gkey] || ''), actualShiftsCalc: soCaThuc, sourceNote: note });
    });

    // Dựng sổ Nhập-Xuất-Tồn theo ngày
    let carry = 0;
    allDates.forEach(day => {
      const tonDau = round2(carry);
      const nhap = round2(daySupply[day] || 0);
      const xuat = round2(demandByDay[day].reduce((s, x) => s + round2(x.need * heSo), 0));
      // Điều chỉnh dòng cuối để khớp làm tròn (áp cho ngày cuối có nhu cầu)
      carry = round2(carry + nhap - xuat);
      const conNo = carry < 0 ? round2(-carry) : 0;
      const tonCuoi = carry > 0 ? round2(carry) : 0;
      if (nhap > 0 || xuat > 0 || tonDau !== 0 || demandByDay[day].length > 0)
        stockLedger.push({ date: day, fuel, proj, supplier: sMap[sup] || sup, tonDau, nhap, xuat, tonCuoi, conNo });
    });
    // Hiệu chỉnh khớp tuyệt đối: ép tổng xuất trong sổ = tổng nhập, dồn chênh lệch vào dòng sổ cuối cùng của nhóm
    const groupLedgerRows = stockLedger.filter(r => r.fuel === fuel && r.proj === proj && r.supplier === (sMap[sup] || sup));
    const sumNhap = round2(groupLedgerRows.reduce((s, r) => s + r.nhap, 0));
    const sumXuat = round2(groupLedgerRows.reduce((s, r) => s + r.xuat, 0));
    const chenh = round2(sumNhap - sumXuat);
    if (chenh !== 0 && groupLedgerRows.length > 0) {
      const lastRow = groupLedgerRows[groupLedgerRows.length - 1];
      lastRow.xuat = round2(lastRow.xuat + chenh);
      // tính lại tồn cuối dòng cuối
      lastRow.tonCuoi = round2(lastRow.tonDau + lastRow.nhap - lastRow.xuat);
      if (lastRow.tonCuoi < 0) { lastRow.conNo = round2(-lastRow.tonCuoi); lastRow.tonCuoi = 0; } else lastRow.conNo = 0;
    }

    const lvl = heSo > 1.001 ? 'INFO' : (heSo < 0.999 ? 'WARNING' : 'INFO');
    monthlyNotes.push({ level: lvl, fuel, proj, message: `PA4 - Kho ${sMap[sup] || sup} (${fuel}/${proj}): Tổng HĐ ${tongDauThang} L / Nhu cầu ${tongCauThang} L → hệ số ${heSoPct}%. Đã rải đều, Nhập = Xuất.` });
  }

  await clearAllocationsByRange(firstDay, lastDay);
  if (allAllocations.length > 0) {
    await new Promise((res, rej) => { const tx = db.transaction(SHEET_ALLOCATIONS, 'readwrite'); const st = tx.objectStore(SHEET_ALLOCATIONS); allAllocations.forEach(a => st.put(a)); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
  }
  window.__FAMS_MONTHLY_NOTES = monthlyNotes;
  window.__FAMS_STOCK_LEDGER = stockLedger;
  return allAllocations;
}

function clearAllocationsByRange(from, to) {
  return new Promise((res, rej) => {
    const tx = db.transaction(SHEET_ALLOCATIONS, 'readwrite');
    const st = tx.objectStore(SHEET_ALLOCATIONS);
    const r = st.index('date').openCursor(IDBKeyRange.bound(from, to));
    r.onsuccess = (e) => { const c = e.target.result; if (c) { c.delete(); c.continue(); } };
    tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
  });
}

// ---------- KIỂM TRA RÀNG BUỘC (trên phân bổ của 1 ngày) ----------
async function validateAllocations(allocations) {
  if (!db) await initDB();
  if (!allocations || allocations.length === 0) return [];
  const date = allocations[0].date;
  const [vehicles, operationLogs] = await Promise.all([loadVehicles(), loadOperationLogs(date)]);
  const vMap = {}; vehicles.forEach(v => vMap[v.vehicleId] = v);
  const violations = [];
  allocations.forEach(a => {
    const v = vMap[a.vehicleId]; if (!v) return;
    const log = operationLogs.find(l => l.vehicleId === a.vehicleId);
    if (a.theoreticalNorm > 0) {
      const ratio = a.allocatedQuantity / a.theoreticalNorm;
      if (ratio > ANOMALY_UPPER_LIMIT) violations.push(mkV(a, 'OVER_NORM', 'WARNING', `Cấp ${a.allocatedQuantity} L (${Math.round(ratio*100)}% ĐM) - vượt ngưỡng`));
      else if (ratio < ANOMALY_LOWER_LIMIT) violations.push(mkV(a, 'UNDER_NORM', 'WARNING', `Cấp ${a.allocatedQuantity} L (${Math.round(ratio*100)}% ĐM) - thấp hơn ngưỡng`));
    }
    if ((!log || log.actualShifts <= 0) && a.allocatedQuantity > 0) violations.push(mkV(a, 'NO_OPERATION', 'ERROR', `Xe ${v.licensePlate} không có ca vận hành nhưng được cấp`));
  });
  // Ràng buộc kế hoạch tháng
  const d = new Date(date);
  const firstDay = new Date(d.getFullYear(), d.getMonth(), 1).toISOString().split('T')[0];
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().split('T')[0];
  const monthAlloc = await getAllByRange(SHEET_ALLOCATIONS, firstDay, lastDay);
  const monthSum = {}; monthAlloc.forEach(a => { monthSum[a.vehicleId] = (monthSum[a.vehicleId] || 0) + a.allocatedQuantity; });
  for (const vid in monthSum) {
    const v = vMap[vid]; if (!v || !v.monthlyPlan) continue;
    const ratio = monthSum[vid] / v.monthlyPlan;
    if (ratio >= THRESHOLD_RED) violations.push({ violationId: generateId(), vehicleId: vid, date, violationType: 'MONTHLY_PLAN_EXCEEDED', severity: 'ERROR', message: `Xe ${v.licensePlate}: tổng tháng ${Math.round(monthSum[vid])} L vượt kế hoạch ${v.monthlyPlan} L (${Math.round(ratio*100)}%)` });
    else if (ratio >= THRESHOLD_YELLOW) violations.push({ violationId: generateId(), vehicleId: vid, date, violationType: 'MONTHLY_PLAN_WARNING', severity: 'WARNING', message: `Xe ${v.licensePlate}: tổng tháng đạt ${Math.round(ratio*100)}% kế hoạch (cảnh báo vàng)` });
  }
  return violations;
}
function mkV(a, t, s, m) { return { violationId: generateId(), allocationId: a.allocationId, vehicleId: a.vehicleId, date: a.date, violationType: t, severity: s, message: m }; }

// ---------- TRỢ LÝ THÔNG MINH ----------
function generateSmartDiary(a, v, log) {
  const hours = log ? log.actualShifts * 8 : 0;
  const perHour = hours ? (a.allocatedQuantity / hours) : 0;
  const normHour = v && hours ? (v.normPerShift / 8) : 0;
  const pct = normHour ? Math.round(perHour / normHour * 100) : 100;
  const fuel = a.fuelType === 'DO' ? 'dầu Diesel' : 'xăng ' + a.fuelType;
  const works = ['vận chuyển đất thải', 'san lấp mặt bằng', 'đào móng', 'vận chuyển vật liệu', 'thi công nền đường'];
  const work = works[Math.abs(hashCode(a.vehicleId + a.date)) % works.length];
  const dg = pct > 110 ? 'cao hơn định mức' : pct < 90 ? 'thấp hơn định mức' : 'đạt định mức';
  return `Ngày ${a.date.split('-').reverse().join('/')}, xe ${v ? v.licensePlate : a.vehicleId} vận hành ${log ? log.actualShifts : 0} ca (${hours} giờ), nhận ${a.allocatedQuantity.toLocaleString('vi-VN')} lít ${fuel}, thực hiện công tác ${work}. Tiêu hao TB: ${perHour.toFixed(2)} lít/giờ, ${dg} (${pct}%).`;
}
function hashCode(str) { let h = 0; for (let i = 0; i < str.length; i++) { h = ((h << 5) - h) + str.charCodeAt(i); h |= 0; } return h; }

function generateSmartInsights(allocations, invoices, violations) {
  const insights = [];
  const ta = allocations.reduce((s, a) => s + a.allocatedQuantity, 0);
  const ti = invoices.reduce((s, i) => s + i.quantity, 0);
  const diff = round2(ti - ta);
  if (ti > 0) insights.push({ type: diff === 0 ? 'success' : 'warning', text: diff === 0 ? `Cân đối tốt: phân bổ trong ngày (${ta.toLocaleString('vi-VN')} L).` : `Ghi chú: hóa đơn ngày này ${ti.toLocaleString('vi-VN')} L, phân bổ cho ngày này ${ta.toLocaleString('vi-VN')} L. Chênh lệch đã/sẽ điều chuyển sang ngày khác (xem cột Nguồn hóa đơn).` });
  const errors = violations.filter(v => v.severity === 'ERROR').length, warns = violations.filter(v => v.severity === 'WARNING').length;
  if (errors > 0) insights.push({ type: 'error', text: `Phát hiện ${errors} lỗi nghiêm trọng cần xử lý.` });
  if (warns > 0) insights.push({ type: 'warning', text: `Có ${warns} cảnh báo cần xem xét.` });

  // Gợi ý xử lý khi tháng thiếu nhiên liệu
  const mNotes = window.__FAMS_MONTHLY_NOTES || [];
  const shortages = mNotes.filter(n => n.level === 'ERROR' || n.message.includes('thiếu'));
  if (shortages.length > 0) {
    insights.push({ type: 'error', text: `⚠ Tháng này có ${shortages.length} ngày bị THIẾU nhiên liệu so với nhu cầu vận hành.` });
    insights.push({ type: 'info', text: `Trợ lý gợi ý: (1) Kiểm tra & bổ sung hóa đơn NCC còn thiếu trong tháng; (2) Rà soát lại số ca vận hành (có thể ghi nhầm nhiều ca); (3) Nếu đúng thực tế thiếu, xem xét điều chỉnh kế hoạch tháng hoặc mua bổ sung. Chi tiết ngày thiếu xem ở cột Nguồn hóa đơn.` });
  }
  if (errors === 0 && warns === 0 && shortages.length === 0 && allocations.length > 0) insights.push({ type: 'success', text: 'Tất cả phân bổ hợp lệ. Sẵn sàng xuất phiếu cấp & nhật ký.' });
  return insights;
}

// ---------- SAO LƯU / PHỤC HỒI ----------
async function exportAllData() {
  if (!db) await initDB();
  const [vehicles, projects, suppliers, operationLogs, invoices, allocations] = await Promise.all([
    getAllFromStore(SHEET_VEHICLES), getAllFromStore(SHEET_PROJECTS), getAllFromStore(SHEET_SUPPLIERS),
    getAllFromStore(SHEET_OPERATION_LOGS), getAllFromStore(SHEET_INVOICES), getAllFromStore(SHEET_ALLOCATIONS)
  ]);
  return { meta: { app: 'FAMS', version: 2, exportedAt: new Date().toISOString() }, company: COMPANY_INFO, config: { THRESHOLD_YELLOW, THRESHOLD_RED, ANOMALY_UPPER_LIMIT, ANOMALY_LOWER_LIMIT }, data: { vehicles, projects, suppliers, operationLogs, invoices, allocations } };
}
async function importAllData(backup) {
  if (!db) await initDB();
  if (!backup || !backup.data) throw new Error('File sao lưu không hợp lệ');
  await Promise.all([clearStore(SHEET_VEHICLES), clearStore(SHEET_PROJECTS), clearStore(SHEET_SUPPLIERS), clearStore(SHEET_OPERATION_LOGS), clearStore(SHEET_INVOICES), clearStore(SHEET_ALLOCATIONS)]);
  const d = backup.data;
  for (const v of (d.vehicles || [])) await putRecord(SHEET_VEHICLES, v);
  for (const p of (d.projects || [])) await putRecord(SHEET_PROJECTS, p);
  for (const s of (d.suppliers || [])) await putRecord(SHEET_SUPPLIERS, s);
  for (const l of (d.operationLogs || [])) await putRecord(SHEET_OPERATION_LOGS, l);
  for (const i of (d.invoices || [])) await putRecord(SHEET_INVOICES, i);
  for (const a of (d.allocations || [])) await putRecord(SHEET_ALLOCATIONS, a);
  if (backup.company) { COMPANY_INFO = backup.company; localStorage.setItem('fams_company', JSON.stringify(COMPANY_INFO)); }
  if (backup.config) applyBusinessConfig(backup.config.THRESHOLD_YELLOW, backup.config.THRESHOLD_RED, backup.config.ANOMALY_UPPER_LIMIT, backup.config.ANOMALY_LOWER_LIMIT);
  return true;
}

// ---------- DỮ LIỆU MẪU ----------
async function seedSampleDataIfEmpty() {
  if (!db) await initDB();
  if ((await loadVehicles()).length > 0) return;
  const base = new Date(); const y = base.getFullYear(), m = base.getMonth();
  const d1 = new Date(y, m, 1).toISOString().split('T')[0];
  const d2 = new Date(y, m, 2).toISOString().split('T')[0];
  const d3 = new Date(y, m, 3).toISOString().split('T')[0];
  const loc = 'TP.HCM';
  await saveProject({ projectId: 'CT001', projectName: 'Khu đô thị Thủ Thiêm', description: 'Hạ tầng giai đoạn 1' });
  await saveProject({ projectId: 'CT002', projectName: 'Cầu vượt An Phú', description: 'Thi công cầu' });
  await saveSupplier({ supplierId: 'NCC001', supplierName: 'CHXD 01', contactInfo: '0123456789' });
  await saveSupplier({ supplierId: 'NCC002', supplierName: 'PV Oil', contactInfo: '0987654321' });
  await saveVehicle({ vehicleId: 'XE001', licensePlate: '51E-010.34', fuelType: 'DO', normPerShift: 40.5, minShiftsPerMonth: 20, maxShiftsPerMonth: 26, monthlyPlan: 1300, projectId: 'CT001', priority: 1 });
  await saveVehicle({ vehicleId: 'XE002', licensePlate: '50N-771.94', fuelType: 'DO', normPerShift: 100, minShiftsPerMonth: 18, maxShiftsPerMonth: 24, monthlyPlan: 2400, projectId: 'CT001', priority: 2 });
  // Ngày 1 & 2 & 3 đều có xe chạy
  await saveOperationLog({ logId: generateId(), vehicleId: 'XE001', date: d1, fromShift: 1, toShift: 1, actualShifts: 1 });
  await saveOperationLog({ logId: generateId(), vehicleId: 'XE002', date: d1, fromShift: 1, toShift: 1, actualShifts: 1 });
  await saveOperationLog({ logId: generateId(), vehicleId: 'XE001', date: d2, fromShift: 1, toShift: 2, actualShifts: 2 });
  await saveOperationLog({ logId: generateId(), vehicleId: 'XE001', date: d3, fromShift: 1, toShift: 1, actualShifts: 1 });
  // Hóa đơn ngày 1 dư (để test chuyển sang ngày 2), ngày 3 chưa có HĐ (test mượn - nhưng hết tháng nên sẽ cảnh báo)
  await saveInvoice({ invoiceId: 'HD001', date: d1, supplier: 'NCC001', fuelType: 'DO', quantity: 300, unitPrice: 20000, totalAmount: 6000000, projectId: 'CT001', location: loc });
  await saveInvoice({ invoiceId: 'HD002', date: d2, supplier: 'NCC001', fuelType: 'DO', quantity: 50, unitPrice: 20000, totalAmount: 1000000, projectId: 'CT001', location: loc });
}

// ---------- CẤU HÌNH ----------
function applyBusinessConfig(y, r, u, l) {
  if (!isNaN(y)) THRESHOLD_YELLOW = y; if (!isNaN(r)) THRESHOLD_RED = r;
  if (!isNaN(u)) ANOMALY_UPPER_LIMIT = u; if (!isNaN(l)) ANOMALY_LOWER_LIMIT = l;
  localStorage.setItem('fams_config', JSON.stringify({ THRESHOLD_YELLOW, THRESHOLD_RED, ANOMALY_UPPER_LIMIT, ANOMALY_LOWER_LIMIT }));
}
function loadBusinessConfig() {
  const s = localStorage.getItem('fams_config');
  if (s) { const c = JSON.parse(s); THRESHOLD_YELLOW = c.THRESHOLD_YELLOW; THRESHOLD_RED = c.THRESHOLD_RED; ANOMALY_UPPER_LIMIT = c.ANOMALY_UPPER_LIMIT; ANOMALY_LOWER_LIMIT = c.ANOMALY_LOWER_LIMIT; }
  const cp = localStorage.getItem('fams_company'); if (cp) COMPANY_INFO = JSON.parse(cp);
}
function applyCompanyConfig(info) { COMPANY_INFO = { ...COMPANY_INFO, ...info }; localStorage.setItem('fams_company', JSON.stringify(COMPANY_INFO)); }
