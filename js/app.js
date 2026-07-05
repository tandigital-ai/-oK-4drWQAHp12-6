// ============================================================
// app.js — Giao diện: gọi phân bổ CẢ THÁNG, cột Nguồn hóa đơn, sort, backup
// ============================================================
const appState = {
  vehicles: [], operationLogs: [], invoices: [], allocations: [], violations: [], projects: [], suppliers: [],
  currentDate: new Date().toISOString().split('T')[0],
  filters: { vehicles: { search: '', fuel: '', project: '', page: 1, sortKey: '', sortDir: 1 }, logs: { search: '', page: 1, sortKey: '', sortDir: 1 }, invoices: { search: '', fuel: '', project: '', page: 1, sortKey: '', sortDir: 1 }, allocations: { page: 1, sortKey: '', sortDir: 1, from: '', to: '', vehicle: '', fuel: '', supplier: '' } },
  pageSize: 10, confirmCallback: null
};

async function initializeApp() {
  try {
    showLoading(true, 'Đang khởi tạo...'); await initDB(); loadBusinessConfig(); syncConfigInputs(); //await seedSampleDataIfEmpty();
    const di = document.getElementById('global-date'); if (di) { di.value = appState.currentDate.slice(0, 7); di.addEventListener('change', onDateChange); }
    updateDateBadge(); await migrateOldVehicles(appState.currentDate.slice(0,7)); await loadAllData(); syncAllMonthInputs(); renderAll();
    if (localStorage.getItem('fams_autobackup') === '1') { const cb = document.getElementById('cfg-autobackup'); if (cb) cb.checked = true; setTimeout(() => backupData(true), 1500); }
    updateLastBackupInfo(); updateLockStatus(); showLoading(false); showToast('Hệ thống đã sẵn sàng!', 'success');
  } catch (err) { console.error(err); showLoading(false); showToast('Lỗi khởi tạo: ' + (err.message || err), 'error'); }
}
// Gán kỳ cho các xe cũ chưa có trường period (chạy 1 lần, đưa về tháng đang xem)
async function migrateOldVehicles(ym) {
  const all = await loadAllVehiclesRaw();
  let changed = 0;
  for (const v of all) { if (!v.period) { v.period = ym; await saveVehicle(v); changed++; } }
  if (changed > 0) showToast(`Đã gán ${changed} xe cũ vào kỳ ${ym}. Bạn có thể chỉnh lại nếu cần.`, 'info');
}
async function loadAllData() {
  const ym = appState.currentDate.slice(0, 7);
  const [y, m] = ym.split('-').map(Number);
  const dim = new Date(y, m, 0).getDate();
  const from = ym + '-01', to = ym + '-' + String(dim).padStart(2, '0');
  const [vehicles, projects, suppliers, logs, invoices, allocations] = await Promise.all([
    loadVehicles(ym), loadProjects(), loadSuppliers(),
    getAllByRange(SHEET_OPERATION_LOGS, from, to),
    getAllByRange(SHEET_INVOICES, from, to),
    getAllByRange(SHEET_ALLOCATIONS, from, to)
  ]);
  appState.vehicles = vehicles; appState.projects = projects; appState.suppliers = suppliers; appState.operationLogs = logs; appState.invoices = invoices; appState.allocations = allocations;
  loadLedgerFromStorage(ym);
}
async function onDateChange(e) {
  const v = e.target.value;
  appState.currentDate = (v && v.length === 7) ? (v + '-01') : v;
  showLoading(true, 'Đang tải dữ liệu tháng...');
  await loadAllData();
  appState.violations = await validateAllocations(appState.allocations);
  syncAllMonthInputs();   // đồng bộ TẤT CẢ ô tháng/ngày ở mọi tab
  updateDateBadge(); updateLockStatus();
  renderAll();
  showLoading(false);
}

// Đồng bộ mọi ô chọn tháng & khoảng ngày ở tất cả các tab theo "Tháng làm việc" đang chọn.
// Gọi mỗi khi đổi tháng làm việc, để không phải vào từng tab chọn lại.
function syncAllMonthInputs() {
  const ym = appState.currentDate.slice(0, 7);
  const [y, m] = ym.split('-').map(Number);
  const dim = new Date(y, m, 0).getDate();
  const first = ym + '-01';
  const last = ym + '-' + String(dim).padStart(2, '0');

  // Các ô kiểu <input type="month">
  const monthIds = ['inv-filter-month', 'alloc-month', 'plan-month', 'log-month', 'sum-month', 'import-month'];
  monthIds.forEach(id => { const el = document.getElementById(id); if (el) el.value = ym; });

  // Các ô "Từ ngày" (đầu tháng)
  const fromIds = ['alloc-from', 'log-from', 'sum-from'];
  fromIds.forEach(id => { const el = document.getElementById(id); if (el) el.value = first; });

  // Các ô "Đến ngày" (cuối tháng)
  const toIds = ['alloc-to', 'log-to', 'sum-to'];
  toIds.forEach(id => { const el = document.getElementById(id); if (el) el.value = last; });

  // Cập nhật lại bộ lọc phân bổ trong bộ nhớ để khớp tháng mới
  if (appState.filters && appState.filters.allocations) {
    appState.filters.allocations.from = first;
    appState.filters.allocations.to = last;
  }
}
function updateDateBadge() { const b = document.getElementById('current-date-badge'); if (b) { const d = appState.currentDate; b.textContent = d ? ('Tháng: ' + d.slice(5, 7) + '/' + d.slice(0, 4)) : 'Tháng: --/----'; } }
function syncConfigInputs() { setVal('cfg-yellow', THRESHOLD_YELLOW); setVal('cfg-red', THRESHOLD_RED); setVal('cfg-upper', ANOMALY_UPPER_LIMIT); setVal('cfg-lower', ANOMALY_LOWER_LIMIT); setVal('cfg-company', COMPANY_INFO.company); setVal('cfg-unit', COMPANY_INFO.unit); setVal('cfg-note', COMPANY_INFO.note); }

function toggleTheme() {
  document.body.classList.toggle('light');
  localStorage.setItem('fams_theme', document.body.classList.contains('light') ? 'light' : 'dark');
}
// Khôi phục chế độ giao diện đã chọn khi mở app
(function () { if (localStorage.getItem('fams_theme') === 'light') document.addEventListener('DOMContentLoaded', () => document.body.classList.add('light')); })();

function toggleSidebar() { document.body.classList.toggle('sidebar-open'); }
function closeSidebar() { document.body.classList.remove('sidebar-open'); }
// Gắn sự kiện chạm cho nút hamburger + overlay ngay khi trang tải xong (đảm bảo mobile bấm được)
document.addEventListener('DOMContentLoaded', function () {
  const hb = document.getElementById('hamburger-btn');
  if (hb) {
    // dùng pointerup để nhận cả chuột lẫn chạm, chặn nổi bọt tránh bị đóng ngay
    hb.addEventListener('click', function (e) { e.stopPropagation(); });
  }
  const ov = document.getElementById('sidebar-overlay');
  if (ov) ov.addEventListener('click', closeSidebar);
});

function switchTab(t) {
  closeSidebar(); // đóng ngăn kéo sau khi chọn menu trên điện thoại
  document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
  const tab = document.getElementById('tab-' + t); if (tab) tab.classList.remove('hidden');
  document.querySelectorAll('.nav-btn').forEach(b => { b.classList.remove('text-amber-400', 'bg-slate-800/60', 'shadow-sm'); b.classList.add('text-slate-400'); });
  const nav = document.getElementById('nav-' + t); if (nav) { nav.classList.add('text-amber-400', 'bg-slate-800/60', 'shadow-sm'); nav.classList.remove('text-slate-400'); }
  const titles = { dashboard: 'Bảng tổng quan', vehicles: 'Phương tiện & Định mức', 'operation-plans': 'Kế hoạch Vận hành', 'operation-logs': 'Nhật ký Vận hành', invoices: 'Hóa đơn Mua vào', allocation: 'Phân bổ & Đối soát', reports: 'In Phiếu & Báo cáo', settings: 'Cấu hình Hệ thống' };
  const ti = document.getElementById('view-title'); if (ti && titles[t]) ti.textContent = titles[t];
  if (t === 'reports') { renderReportVehicleSelect(); generateAIDiary(); }
  if (t === 'operation-plans') initPlanTab();
  if (t === 'allocation') { const el = document.getElementById('alloc-month'); if (el && !el.value) el.value = appState.currentDate.slice(0, 7); initAllocFilter(); renderAllocationsTable(); }
  if (t === 'summary') initSummaryTab();
}
function renderAll() { ensureToolbars(); ensureSortHeaders(); ensureAllocNoteHeader(); renderDashboard(); renderVehiclesTable(); renderOperationLogsTable(); renderInvoicesTable(); renderAllocationsTable(); renderStockLedger(); renderProjectsTable(); renderSuppliersTable(); }

// TOOLBAR
function ensureToolbars() { injectToolbar('tab-vehicles', 'vehicles-toolbar', buildVehiclesToolbar()); injectToolbar('tab-invoices', 'invoices-toolbar', buildInvoicesToolbar()); injectToolbar('tab-operation-logs', 'logs-toolbar', buildLogsToolbar()); }
function injectToolbar(tabId, tid, html) { if (document.getElementById(tid)) return; const tab = document.getElementById(tabId); if (!tab) return; const w = document.createElement('div'); w.id = tid; w.innerHTML = html; tab.insertBefore(w, tab.children[1]); }
function projectOptions() { return appState.projects.map(p => `<option value="${p.projectId}">${p.projectName}</option>`).join(''); }
function buildVehiclesToolbar() { return `<div class="bg-slate-950/40 border border-slate-800 rounded-xl p-3 flex flex-wrap gap-3 items-center"><input oninput="onFilter('vehicles','search',this.value)" placeholder="🔍 Tìm biển số / mã..." class="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white flex-1 min-w-[180px]"><select onchange="onFilter('vehicles','fuel',this.value)" class="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"><option value="">Tất cả nhiên liệu</option><option value="DO">Dầu</option><option value="A95">Xăng</option></select><select onchange="onFilter('vehicles','project',this.value)" class="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"><option value="">Tất cả công trình</option>__P__</select><button onclick="downloadTemplate('DINH_MUC_KE_HOACH')" class="bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-2 rounded-lg text-xs font-semibold"><i class="fa-solid fa-download mr-1"></i>Tải mẫu</button><button onclick="exportVehicles()" class="bg-slate-700 hover:bg-slate-600 text-white px-3 py-2 rounded-lg text-xs font-semibold"><i class="fa-solid fa-file-export mr-1"></i>Xuất Excel</button><button onclick="copyVehiclesPrevMonth()" class="bg-purple-600 hover:bg-purple-500 text-white px-3 py-2 rounded-lg text-xs font-semibold" title="Sao chép danh mục xe từ tháng liền trước sang tháng đang chọn"><i class="fa-solid fa-copy mr-1"></i>Sao chép từ tháng trước</button><button onclick="resetVehiclesData()" class="bg-rose-600 hover:bg-rose-500 text-white px-3 py-2 rounded-lg text-xs font-semibold" title="Chỉ xóa xe của tháng đang chọn"><i class="fa-solid fa-eraser mr-1"></i>Reset xe tháng này</button>
</div>`.replace('__P__', projectOptions()); }
function buildInvoicesToolbar() { return `<div class="bg-slate-950/40 border border-slate-800 rounded-xl p-3 flex flex-wrap gap-3 items-center"><input oninput="onFilter('invoices','search',this.value)" placeholder="🔍 Tìm mã HĐ / NCC..." class="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white flex-1 min-w-[180px]"><input type="month" id="inv-filter-month" value="${appState.currentDate.slice(0,7)}" onchange="onInvoiceMonthChange(this.value)" class="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white" title="Kỳ (tháng) hóa đơn"><select onchange="onFilter('invoices','fuel',this.value)" class="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"><option value="">Tất cả nhiên liệu</option><option value="DO">Dầu</option><option value="A95">Xăng</option></select><button onclick="downloadTemplate('BANG_KE_HOA_DON')" class="bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-2 rounded-lg text-xs font-semibold"><i class="fa-solid fa-download mr-1"></i>Tải mẫu</button><button onclick="exportInvoices()" class="bg-slate-700 hover:bg-slate-600 text-white px-3 py-2 rounded-lg text-xs font-semibold"><i class="fa-solid fa-file-export mr-1"></i>Xuất Excel</button><button onclick="resetInvoicesData(getVal('inv-filter-month'))" class="bg-rose-600 hover:bg-rose-500 text-white px-3 py-2 rounded-lg text-xs font-semibold"><i class="fa-solid fa-eraser mr-1"></i>Reset tháng này</button></div>`; }
function buildLogsToolbar() { return `<div class="bg-slate-950/40 border border-slate-800 rounded-xl p-3 flex flex-wrap gap-3 items-center"><input oninput="onFilter('logs','search',this.value)" placeholder="🔍 Tìm phương tiện..." class="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white flex-1 min-w-[180px]"><button onclick="downloadTemplate('VAN_HANH')" class="bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-2 rounded-lg text-xs font-semibold"><i class="fa-solid fa-download mr-1"></i>Tải mẫu</button><button onclick="resetLogsData()" class="bg-rose-600 hover:bg-rose-500 text-white px-3 py-2 rounded-lg text-xs font-semibold"><i class="fa-solid fa-eraser mr-1"></i>Reset bảng này</button></div>`; }
async function onInvoiceMonthChange(ym) {
  if (!ym) return;
  appState.currentDate = ym + '-01';
  const gd = document.getElementById('global-date'); if (gd) gd.value = appState.currentDate;
  updateDateBadge(); updateLockStatus();
  showLoading(true, 'Đang tải hóa đơn tháng...');
  await loadAllData(); renderAll(); showLoading(false);
}
function onFilter(table, field, value) { appState.filters[table][field] = value; appState.filters[table].page = 1; if (table === 'vehicles') renderVehiclesTable(); else if (table === 'invoices') renderInvoicesTable(); else if (table === 'logs') renderOperationLogsTable(); }
function gotoPage(table, page) { appState.filters[table].page = page; if (table === 'allocations') { renderAllocationsTable(); } else { renderAll(); } }

// SORT
function ensureSortHeaders() {
  setupSort('vehicles-table-body', 'vehicles', ['priority', 'vehicleId', 'licensePlate', 'fuelType', 'normPerShift', null, 'monthlyPlan', 'projectId', null]);
  setupSort('operation-logs-table-body', 'logs', ['vehicleId', 'date', 'fromShift', 'toShift', 'actualShifts', null]);
  setupSort('invoices-table-body', 'invoices', ['invoiceId', 'date', 'supplier', 'fuelType', 'quantity', 'unitPrice', 'totalAmount', 'location', 'projectId', null]);
}
function setupSort(tbodyId, table, keys) {
  const tbody = document.getElementById(tbodyId); if (!tbody) return;
  const thead = tbody.closest('table').querySelector('thead tr'); if (!thead || thead.dataset.sortReady) return;
  thead.dataset.sortReady = '1';
  thead.querySelectorAll('th').forEach((th, i) => { const key = keys[i]; if (!key) return; th.style.cursor = 'pointer'; th.addEventListener('click', () => toggleSort(table, key)); th.innerHTML += ' <span class="text-slate-600">⇅</span>'; });
}
function toggleSort(table, key) { const f = appState.filters[table]; if (f.sortKey === key) f.sortDir = -f.sortDir; else { f.sortKey = key; f.sortDir = 1; } if (table === 'vehicles') renderVehiclesTable(); else if (table === 'invoices') renderInvoicesTable(); else if (table === 'logs') renderOperationLogsTable(); }
function applySort(rows, table) { const f = appState.filters[table]; if (!f.sortKey) return rows; const k = f.sortKey, dir = f.sortDir; return [...rows].sort((a, b) => { let x = a[k], y = b[k]; if (typeof x === 'number' && typeof y === 'number') return (x - y) * dir; x = String(x ?? '').toLowerCase(); y = String(y ?? '').toLowerCase(); return x < y ? -dir : x > y ? dir : 0; }); }

// Phân trang gọn (chuyên nghiệp): chỉ hiện vài trang quanh trang hiện tại + nút đầu/cuối/lùi/tới.
// Tự ẩn các trang ở xa bằng dấu "…". Hoạt động tốt trên cả điện thoại (ít nút, không tràn).
function paginate(rows, table) {
  const f = appState.filters[table];
  const totalPages = Math.max(1, Math.ceil(rows.length / appState.pageSize));
  if (f.page > totalPages) f.page = totalPages;
  if (f.page < 1) f.page = 1;
  const start = (f.page - 1) * appState.pageSize;
  const items = rows.slice(start, start + appState.pageSize);
  let pager = '';
  if (totalPages > 1) {
    const cur = f.page;
    const btn = (p, label, active, disabled) =>
      `<button ${disabled ? 'disabled' : ''} onclick="gotoPage('${table}',${p})" class="px-2.5 py-1 rounded text-xs ${active ? 'bg-amber-500 text-slate-950 font-bold' : disabled ? 'bg-slate-800/40 text-slate-600 cursor-not-allowed' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}">${label}</button>`;
    // Tính dải trang hiển thị: trang hiện tại ± 1
    const pagesToShow = new Set([1, totalPages, cur, cur - 1, cur + 1]);
    const list = [...pagesToShow].filter(p => p >= 1 && p <= totalPages).sort((a, b) => a - b);
    let mid = '';
    let prev = 0;
    list.forEach(p => {
      if (prev && p - prev > 1) mid += `<span class="px-1 text-slate-600">…</span>`; // trang bị ẩn
      mid += btn(p, p, p === cur, false);
      prev = p;
    });
    pager = `<div class="flex flex-wrap justify-end items-center gap-1 p-3 bg-slate-900/50">
      <span class="text-xs text-slate-500 mr-2">Trang ${cur}/${totalPages} · ${rows.length} dòng</span>
      ${btn(1, '«', false, cur === 1)}
      ${btn(cur - 1, '‹', false, cur === 1)}
      ${mid}
      ${btn(cur + 1, '›', false, cur === totalPages)}
      ${btn(totalPages, '»', false, cur === totalPages)}
    </div>`;
  }
  return { items, pager };
}

// DASHBOARD
function renderDashboard() {
  setText('stat-vehicles-count', appState.vehicles.length);
  setText('stat-shifts-count', appState.operationLogs.reduce((s, l) => s + (l.actualShifts || 0), 0));
  setText('stat-do-qty', appState.invoices.filter(i => i.fuelType === 'DO').reduce((s, i) => s + i.quantity, 0).toLocaleString('vi-VN') + ' Lít');
  setText('stat-violations-count', appState.violations.length);
  const cont = document.getElementById('monthly-plan-progress-container');
  if (cont) cont.innerHTML = appState.vehicles.length === 0 ? '<p class="text-slate-500 text-sm">Chưa có dữ liệu phương tiện.</p>' : appState.vehicles.map(v => { const al = appState.allocations.filter(a => a.vehicleId === v.vehicleId).reduce((s, a) => s + a.allocatedQuantity, 0); const pct = v.monthlyPlan ? Math.min(100, Math.round(al / v.monthlyPlan * 100)) : 0; const c = pct >= 100 ? 'bg-rose-500' : pct >= 90 ? 'bg-amber-500' : 'bg-emerald-500'; return `<div><div class="flex justify-between text-xs text-slate-400 mb-1"><span>${v.licensePlate} (${v.fuelType})</span><span>${al.toLocaleString('vi-VN')} / ${v.monthlyPlan.toLocaleString('vi-VN')} L</span></div><div class="w-full bg-slate-800 rounded-full h-2.5"><div class="${c} h-2.5 rounded-full" style="width:${pct}%"></div></div></div>`; }).join('');
  const vl = document.getElementById('dashboard-violations-list'), vb = document.getElementById('violation-badge');
  if (vb) vb.textContent = appState.violations.length + ' lỗi';
  if (vl) vl.innerHTML = appState.violations.length === 0 ? '<p class="text-slate-500 text-sm">Chưa phát hiện vi phạm.</p>' : appState.violations.map(v => { const e = v.severity === 'ERROR'; return `<div class="p-3 rounded-lg border ${e ? 'border-rose-500/30 bg-rose-500/10' : 'border-amber-500/30 bg-amber-500/10'}"><p class="text-xs font-semibold ${e ? 'text-rose-400' : 'text-amber-400'}">${v.violationType} · ${v.severity}</p><p class="text-sm text-slate-300 mt-1">${v.message}</p></div>`; }).join('');
  renderSmartInsights();
}
function renderSmartInsights() {
  const box = document.getElementById('dashboard-ai-insights'); if (!box) return;
  const ins = generateSmartInsights(appState.allocations, appState.invoices, appState.violations);
  let html = `<div class="p-4 bg-slate-900/80 border border-slate-800 rounded-lg text-sm text-slate-300"><p class="font-semibold text-amber-400 mb-1"><i class="fa-solid fa-wand-magic-sparkles mr-2"></i>Tự động hóa thông minh</p>Bấm <strong>"Chạy Phân bổ"</strong> để hệ thống phân bổ ngược cả tháng (điều chuyển dư/thiếu giữa các ngày).</div>`;
  if (ins.length) html += ins.map(i => { const c = i.type === 'error' ? 'text-rose-400' : i.type === 'warning' ? 'text-amber-400' : i.type === 'info' ? 'text-blue-400' : 'text-emerald-400'; const ic = i.type === 'error' ? 'fa-circle-xmark' : i.type === 'warning' ? 'fa-triangle-exclamation' : i.type === 'info' ? 'fa-lightbulb' : 'fa-circle-check'; return `<div class="p-4 bg-slate-900/80 border border-slate-800 rounded-lg text-sm text-slate-300"><p class="font-semibold ${c} mb-1"><i class="fa-solid ${ic} mr-2"></i>Trợ lý</p>${i.text}</div>`; }).join('');
  box.innerHTML = html;
}

// PHƯƠNG TIỆN
function filteredVehicles() { const f = appState.filters.vehicles; let r = appState.vehicles.filter(v => (!f.search || (v.licensePlate + v.vehicleId).toLowerCase().includes(f.search.toLowerCase())) && (!f.fuel || v.fuelType === f.fuel) && (!f.project || v.projectId === f.project)); if (!f.sortKey) { r = [...r].sort((a, b) => (a.priority || 999) - (b.priority || 999)); return r; } return applySort(r, 'vehicles'); }
function renderVehiclesTable() {
  const tbody = document.getElementById('vehicles-table-body'); if (!tbody) return; const rows = filteredVehicles();
  if (rows.length === 0) { tbody.innerHTML = emptyRow(9, 'Không có phương tiện phù hợp'); removePager('vehicles'); return; }
  const { items, pager } = paginate(rows, 'vehicles');
  tbody.innerHTML = items.map(v => `<tr class="hover:bg-slate-800/30"><td class="px-6 py-4 text-center font-bold text-amber-400">${v.priority || 999}</td><td class="px-6 py-4">${v.vehicleId}</td><td class="px-6 py-4 font-medium text-slate-100">${v.licensePlate}</td>
<td class="px-6 py-4">${v.fuelType}</td><td class="px-6 py-4 text-right">${v.normPerShift}</td><td class="px-6 py-4 text-center">${v.minShiftsPerMonth} - ${v.maxShiftsPerMonth}</td><td class="px-6 py-4 text-right">${(v.monthlyPlan||0).toLocaleString('vi-VN')}</td><td class="px-6 py-4">${getProjectName(v.projectId)}</td><td class="px-6 py-4 text-center whitespace-nowrap"><button onclick="openVehicleModal('${v.vehicleId}')" class="text-amber-400 mx-1"><i class="fa-solid fa-pen"></i></button><button onclick="duplicateVehicle('${v.vehicleId}')" class="text-blue-400 mx-1"><i class="fa-solid fa-copy"></i></button><button onclick="confirmDeleteVehicle('${v.vehicleId}')" class="text-rose-400 mx-1"><i class="fa-solid fa-trash"></i></button></td></tr>`).join('');
  setPager('vehicles', pager);
}
// NHẬT KÝ
function filteredLogs() { const f = appState.filters.logs; let r = appState.operationLogs.filter(l => { const v = appState.vehicles.find(x => x.vehicleId === l.vehicleId); const n = (v ? v.licensePlate : l.vehicleId).toLowerCase(); return !f.search || n.includes(f.search.toLowerCase()); }); return applySort(r, 'logs'); }
function renderOperationLogsTable() {
  const tbody = document.getElementById('operation-logs-table-body'); if (!tbody) return; const rows = filteredLogs();
  if (rows.length === 0) { tbody.innerHTML = emptyRow(6, 'Chưa có nhật ký cho ngày này'); removePager('logs'); return; }
  const { items, pager } = paginate(rows, 'logs');
  tbody.innerHTML = items.map(l => { const v = appState.vehicles.find(x => x.vehicleId === l.vehicleId); return `<tr class="hover:bg-slate-800/30"><td class="px-6 py-4 font-medium text-slate-100">${v ? v.licensePlate : l.vehicleId}</td><td class="px-6 py-4">${l.date}</td><td class="px-6 py-4 text-center">${l.fromShift}</td><td class="px-6 py-4 text-center">${l.toShift}</td><td class="px-6 py-4 text-right font-bold text-amber-400">${l.actualShifts}</td><td class="px-6 py-4 text-center whitespace-nowrap"><button onclick="openLogModal('${l.logId}')" class="text-amber-400 mx-1"><i class="fa-solid fa-pen"></i></button><button onclick="confirmDeleteLog('${l.logId}')" class="text-rose-400 mx-1"><i class="fa-solid fa-trash"></i></button></td></tr>`; }).join('');
  setPager('logs', pager);
}
// HÓA ĐƠN
function filteredInvoices() { const f = appState.filters.invoices; let r = appState.invoices.filter(i => (!f.search || (i.invoiceId + getSupplierName(i.supplier)).toLowerCase().includes(f.search.toLowerCase())) && (!f.fuel || i.fuelType === f.fuel)); return applySort(r, 'invoices'); }
function renderInvoicesTable() {
  const tbody = document.getElementById('invoices-table-body'); if (!tbody) return; const rows = filteredInvoices();
  if (rows.length === 0) { tbody.innerHTML = emptyRow(10, 'Không có hóa đơn phù hợp'); removePager('invoices'); return; }
  const { items, pager } = paginate(rows, 'invoices');
  tbody.innerHTML = items.map(i => `<tr class="hover:bg-slate-800/30"><td class="px-6 py-4">${i.invoiceId}</td><td class="px-6 py-4">${i.date}</td><td class="px-6 py-4">${getSupplierName(i.supplier)}</td><td class="px-6 py-4">${i.fuelType}</td><td class="px-6 py-4 text-right">${i.quantity.toLocaleString('vi-VN')}</td><td class="px-6 py-4 text-right">${i.unitPrice.toLocaleString('vi-VN')}</td><td class="px-6 py-4 text-right">${i.totalAmount.toLocaleString('vi-VN')}</td><td class="px-6 py-4">${i.location || ''}</td><td class="px-6 py-4">${getProjectName(i.projectId)}</td><td class="px-6 py-4 text-center whitespace-nowrap"><button onclick="openInvoiceModal('${i.invoiceId}')" class="text-amber-400 mx-1"><i class="fa-solid fa-pen"></i></button><button onclick="duplicateInvoice('${i.invoiceId}')" class="text-blue-400 mx-1"><i class="fa-solid fa-copy"></i></button><button onclick="confirmDeleteInvoice('${i.invoiceId}')" class="text-rose-400 mx-1"><i class="fa-solid fa-trash"></i></button></td></tr>`).join('');
  const sumQty = rows.reduce((s, i) => s + (i.quantity || 0), 0);
  const sumAmt = rows.reduce((s, i) => s + (i.totalAmount || 0), 0);
  tbody.innerHTML += `<tr class="bg-slate-900 font-bold"><td class="px-6 py-4 text-amber-400" colspan="4">TỔNG CỘNG (${rows.length} hóa đơn)</td><td class="px-6 py-4 text-right text-emerald-400">${sumQty.toLocaleString('vi-VN')}</td><td class="px-6 py-4"></td><td class="px-6 py-4 text-right text-emerald-400">${sumAmt.toLocaleString('vi-VN')}</td><td class="px-6 py-4" colspan="3"></td></tr>`;
  setPager('invoices', pager);
}

// BẢNG PHÂN BỔ — thêm cột "Nguồn hóa đơn" (chèn header 1 lần)
function ensureAllocNoteHeader() {
  const tbody = document.getElementById('allocations-table-body'); if (!tbody) return;
  const thr = tbody.closest('table').querySelector('thead tr'); if (!thr || thr.dataset.noteReady) return;
  thr.dataset.noteReady = '1';
  // Nếu tiêu đề chưa có cột "Nguồn hóa đơn" thì mới chèn (tránh trùng khi đã khai trong HTML)
  const hasNote = Array.from(thr.querySelectorAll('th')).some(th => th.textContent.includes('Nguồn hóa đơn'));
  if (!hasNote) { const th = document.createElement('th'); th.className = 'px-6 py-4'; th.textContent = 'Nguồn hóa đơn / NCC'; thr.insertBefore(th, thr.lastElementChild); }
}

function renderStockLedger() {
  const tbody = document.getElementById('stock-ledger-body'); if (!tbody) return;
  const ledger = (window.__FAMS_STOCK_LEDGER || []).filter(r => r.date.slice(0, 7) === appState.currentDate.slice(0, 7));
  if (ledger.length === 0) { tbody.innerHTML = '<tr><td colspan="8" class="px-4 py-6 text-center text-slate-500">Chưa có dữ liệu. Bấm "Chạy Phân bổ" để tính sổ kho.</td></tr>'; return; }
  tbody.innerHTML = ledger.map(r => `<tr class="hover:bg-slate-800/30">
    <td class="px-4 py-2">${r.date.split('-').reverse().join('/')}</td>
    <td class="px-4 py-2">${r.fuel}</td>
    <td class="px-4 py-2">${getProjectName(r.proj)}</td>
    <td class="px-4 py-2 text-right">${r.tonDau.toLocaleString('vi-VN')}</td>
    <td class="px-4 py-2 text-right text-emerald-400">${r.nhap.toLocaleString('vi-VN')}</td>
    <td class="px-4 py-2 text-right text-amber-400">${r.xuat.toLocaleString('vi-VN')}</td>
    <td class="px-4 py-2 text-right font-bold text-blue-400">${r.tonCuoi.toLocaleString('vi-VN')}</td>
    <td class="px-4 py-2 text-right ${r.conNo > 0 ? 'text-rose-400 font-bold' : 'text-slate-600'}">${r.conNo > 0 ? r.conNo.toLocaleString('vi-VN') : '-'}</td>
  </tr>`).join('');
  const tN = ledger.reduce((s, r) => s + (r.nhap || 0), 0);
  const tX = ledger.reduce((s, r) => s + (r.xuat || 0), 0);
  const tNo = ledger.reduce((s, r) => s + (r.conNo || 0), 0);
  tbody.innerHTML += `<tr class="bg-slate-900 font-bold"><td class="px-4 py-2 text-amber-400" colspan="3">TỔNG CỘNG</td><td class="px-4 py-2"></td><td class="px-4 py-2 text-right text-emerald-400">${tN.toLocaleString('vi-VN')}</td><td class="px-4 py-2 text-right text-amber-400">${tX.toLocaleString('vi-VN')}</td><td class="px-4 py-2"></td><td class="px-4 py-2 text-right ${tNo > 0 ? 'text-rose-400' : 'text-slate-600'}">${tNo ? tNo.toLocaleString('vi-VN') : '-'}</td></tr>`;
}
function saveStockLedger() {
  const ym = appState.currentDate.slice(0, 7);
  if (!window.__FAMS_STOCK_LEDGER || window.__FAMS_STOCK_LEDGER.length === 0) { showToast('Chưa có sổ kho để lưu. Hãy chạy phân bổ trước.', 'error'); return; }
  saveLedgerToStorage(ym);
  showToast(`Đã lưu sổ Nhập-Xuất-Tồn kỳ ${ym}`, 'success');
}

function exportStockLedger() {
  const ledger = (window.__FAMS_STOCK_LEDGER || []).filter(r => r.date.slice(0, 7) === appState.currentDate.slice(0, 7));
  if (ledger.length === 0) { showToast('Chưa có dữ liệu sổ kho', 'error'); return; }
  const rows = ledger.map(r => ({ 'Ngày': r.date, 'Nhiên liệu': r.fuel, 'Công trình': getProjectName(r.proj), 'Tồn đầu (L)': r.tonDau, 'Nhập-Hóa đơn (L)': r.nhap, 'Xuất-Phân bổ (L)': r.xuat, 'Tồn cuối (L)': r.tonCuoi, 'Còn nợ (L)': r.conNo }));
  exportToExcel(rows, 'NhapXuatTon', 'SoKho_NXT_' + appState.currentDate.slice(0, 7) + '.xlsx');
  showToast('Đã xuất sổ Nhập-Xuất-Tồn', 'success');
}
// Khởi tạo bộ lọc phân bổ theo tháng làm việc + nạp danh sách xe/NCC
function initAllocFilter() {
  const ym = appState.currentDate.slice(0, 7);
  const [y, m] = ym.split('-').map(Number);
  const dim = new Date(y, m, 0).getDate();
  const f = appState.filters.allocations;
  // Đặt lại khoảng ngày theo THÁNG đang đứng (không phụ thuộc dữ liệu cũ)
  f.from = ym + '-01';
  f.to = ym + '-' + String(dim).padStart(2, '0');
  f.page = 1;
  const ef = document.getElementById('alloc-from'); if (ef) ef.value = f.from;
  const et = document.getElementById('alloc-to'); if (et) et.value = f.to;
  const sv = document.getElementById('alloc-f-vehicle'); if (sv) sv.innerHTML = '<option value="">Tất cả</option>' + appState.vehicles.map(v => `<option value="${v.vehicleId}" ${f.vehicle === v.vehicleId ? 'selected' : ''}>${v.licensePlate}</option>`).join('');
  const ss = document.getElementById('alloc-f-supplier'); if (ss) ss.innerHTML = '<option value="">Tất cả</option>' + appState.suppliers.map(s => `<option value="${s.supplierId}" ${f.supplier === s.supplierId ? 'selected' : ''}>${s.supplierName}</option>`).join('');
  const sf = document.getElementById('alloc-f-fuel'); if (sf) sf.value = f.fuel || '';
}
function applyAllocFilter() {
  const f = appState.filters.allocations;
  f.from = getVal('alloc-from') || f.from;
  f.to = getVal('alloc-to') || f.to;
  f.vehicle = getVal('alloc-f-vehicle');
  f.fuel = getVal('alloc-f-fuel');
  f.supplier = getVal('alloc-f-supplier');
  f.page = 1;
  renderAllocationsTable();
}
function clearAllocFilter() {
  const f = appState.filters.allocations;
  f.vehicle = ''; f.fuel = ''; f.supplier = ''; f.page = 1;
  initAllocFilter();
  renderAllocationsTable();
}
// Lọc danh sách allocations theo bộ lọc
function getFilteredAllocations() {
  const f = appState.filters.allocations;
  let rows = [...appState.allocations];
  if (f.from) rows = rows.filter(a => a.date >= f.from);
  if (f.to) rows = rows.filter(a => a.date <= f.to);
  if (f.vehicle) rows = rows.filter(a => a.vehicleId === f.vehicle);
  if (f.fuel) rows = rows.filter(a => a.fuelType === f.fuel);
  if (f.supplier) rows = rows.filter(a => a.supplierId === f.supplier);
  return rows;
}

function renderAllocationsTable() {
  const tbody = document.getElementById('allocations-table-body'); if (!tbody) return;
  const badge = document.getElementById('allocation-summary-badge');
  const all = getFilteredAllocations().sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    const va = appState.vehicles.find(x => x.vehicleId === a.vehicleId);
    const vb = appState.vehicles.find(x => x.vehicleId === b.vehicleId);
    return ((va ? va.priority : 999) || 999) - ((vb ? vb.priority : 999) || 999);
  });
  if (all.length === 0) { tbody.innerHTML = emptyRow(10, 'Chưa tính toán phân bổ. Bấm "Chạy Phân bổ".'); if (badge) badge.textContent = 'Chưa tính toán'; removePager('allocations'); return; }

  // Tổng cộng tính trên TOÀN BỘ dữ liệu (không chỉ trang hiện tại)
  const tNorm = all.reduce((s, x) => s + (x.theoreticalNorm || 0), 0);
  const tAlloc = all.reduce((s, x) => s + (x.allocatedQuantity || 0), 0);
  if (badge) badge.textContent = `${all.length} dòng · ${tAlloc.toLocaleString('vi-VN')} L`;

  const { items, pager } = paginate(all, 'allocations');
  tbody.innerHTML = items.map(al => {
    const v = appState.vehicles.find(x => x.vehicleId === al.vehicleId);
    const shifts = al.actualShiftsCalc != null ? al.actualShiftsCalc : (appState.operationLogs.find(l => l.vehicleId === al.vehicleId && l.date === al.date) || {}).actualShifts || 0;
    const vio = appState.violations.find(x => x.allocationId === al.allocationId);
    const warn = vio ? `<span class="text-xs px-2 py-0.5 rounded ${vio.severity === 'ERROR' ? 'bg-rose-500/20 text-rose-400' : 'bg-amber-500/20 text-amber-400'}" title="${vio.message}">${vio.violationType}</span>` : `<span class="text-xs px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400">Bình thường</span>`;
    const note = al.sourceNote ? `<span class="text-xs text-slate-400" title="${al.sourceNote}">${al.sourceNote}</span>` : '<span class="text-xs text-slate-600">—</span>';
    return `<tr class="hover:bg-slate-800/30"><td class="px-6 py-3 text-slate-300">${al.date.split('-').reverse().join('/')}</td><td class="px-6 py-3 font-medium text-slate-100">${v ? v.licensePlate : al.vehicleId}</td><td class="px-6 py-3">${getProjectName(al.projectId)}</td><td class="px-6 py-3">${al.fuelType}</td><td class="px-6 py-3 text-right">${v ? v.normPerShift : '—'}</td><td class="px-6 py-3 text-center">${round2(shifts)}</td><td class="px-6 py-3 text-right">${(al.theoreticalNorm||0).toLocaleString('vi-VN')}</td><td class="px-6 py-3 text-right"><input type="number" step="0.001" value="${al.allocatedQuantity}" data-alloc="${al.allocationId}" onchange="onAllocCellEdit(this)" class="alloc-cell w-24 bg-transparent text-right font-bold text-amber-400 border border-slate-700 rounded px-1 py-0.5 focus:bg-slate-800 focus:outline-none">${al.manualEdited ? ' <span class="text-xs text-blue-400" title="Đã chỉnh tay">✎</span>' : ''}</td>
<td class="px-6 py-3 max-w-xs">${note}</td><td class="px-6 py-3 text-center">${warn}</td></tr>`; }).join('');

  // Dòng tổng cộng (luôn hiện, tính trên toàn bộ)
  tbody.innerHTML += `<tr class="bg-slate-900 font-bold"><td class="px-6 py-3 text-amber-400" colspan="6">TỔNG CỘNG (${all.length} dòng)</td><td class="px-6 py-3 text-right text-slate-200">${tNorm.toLocaleString('vi-VN')}</td><td class="px-6 py-3 text-right text-emerald-400">${tAlloc.toLocaleString('vi-VN')}</td><td class="px-6 py-3" colspan="2"></td></tr>`;
  setPager('allocations', pager);
}
// Sửa tay 1 ô lượng cấp (chưa lưu DB, chỉ cập nhật bộ nhớ + tổng badge). Bấm nút LƯU để ghi.
function onAllocCellEdit(input) {
  const id = input.dataset.alloc;
  const num = Number(input.value);
  if (isNaN(num) || num < 0) { showToast('Số không hợp lệ', 'error'); return; }
  const rec = appState.allocations.find(a => a.allocationId === id);
  if (rec) {
    rec.allocatedQuantity = round2(num);
    rec.manualEdited = true;
    // Tự tính lại SỐ CA vận hành suy ngược từ lượng cấp mới
    const v = appState.vehicles.find(x => x.vehicleId === rec.vehicleId);
    if (v && v.normPerShift > 0) rec.actualShiftsCalc = round2(num / v.normPerShift);
    // Cập nhật GHI CHÚ nguồn: đánh dấu đã chỉnh tay + số ca mới
    const soCa = (rec.actualShiftsCalc != null) ? rec.actualShiftsCalc : 0;
    const nccTen = getSupplierName(rec.supplierId);
    rec.sourceNote = `Chỉnh tay ngày ${rec.date.split('-').reverse().join('/')} — Kho ${nccTen} — cấp ${round2(num)} L (ca suy ra: ${soCa})`;
    // Vẽ lại đúng dòng đang sửa để cột Số ca & Ghi chú đổi theo ngay
    const tr = input.closest('tr');
    if (tr) {
      const tds = tr.querySelectorAll('td');
      // Cột thứ 6 (index 5) = Số ca vận hành; cột áp chót = Nguồn hóa đơn/Ghi chú
      if (tds[5]) tds[5].textContent = round2(soCa);
      const noteTd = tds[tds.length - 2];
      if (noteTd) noteTd.innerHTML = `<span class="text-xs text-blue-400" title="${rec.sourceNote}">${rec.sourceNote}</span>`;
    }
  }
  // cập nhật badge tổng
  const badge = document.getElementById('allocation-summary-badge');
  const tAlloc = appState.allocations.reduce((s, x) => s + (x.allocatedQuantity || 0), 0);
  if (badge) badge.textContent = `${appState.allocations.length} dòng · ${tAlloc.toLocaleString('vi-VN')} L (chưa lưu)`;
}
// Lưu toàn bộ chỉnh sửa tay vào DB
async function saveAllocationsEdits() {
  if (!appState.allocations || appState.allocations.length === 0) { showToast('Chưa có phân bổ để lưu', 'error'); return; }
  if (isPeriodLocked(appState.currentDate)) { showToast('Kỳ này đang KHÓA, không thể lưu.', 'error'); return; }
  showLoading(true, 'Đang lưu kết quả phân bổ...');
  try {
    for (const a of appState.allocations) { await putRecord(SHEET_ALLOCATIONS, a); }
    appState.violations = await validateAllocations(appState.allocations);
    renderAll();
    showLoading(false); showToast('Đã lưu kết quả phân bổ theo kỳ này', 'success');
  } catch (e) { showLoading(false); showToast('Lỗi lưu: ' + (e.message || e), 'error'); }
}

// CÔNG TRÌNH / NCC
function renderProjectsTable() { const tbody = document.getElementById('projects-table-body'); if (!tbody) return; tbody.innerHTML = appState.projects.length === 0 ? '<tr><td colspan="3" class="p-2 text-slate-500">Chưa có</td></tr>' : appState.projects.map(p => `<tr><td class="p-2">${p.projectId}</td><td class="p-2">${p.projectName}</td><td class="p-2 text-right whitespace-nowrap"><button onclick="openProjectModal('${p.projectId}')" class="text-amber-400 mx-1"><i class="fa-solid fa-pen"></i></button><button onclick="confirmDeleteProject('${p.projectId}')" class="text-rose-400 mx-1"><i class="fa-solid fa-trash"></i></button></td></tr>`).join(''); }
function renderSuppliersTable() { const tbody = document.getElementById('suppliers-table-body'); if (!tbody) return; tbody.innerHTML = appState.suppliers.length === 0 ? '<tr><td colspan="3" class="p-2 text-slate-500">Chưa có</td></tr>' : appState.suppliers.map(s => `<tr><td class="p-2">${s.supplierId}</td><td class="p-2">${s.supplierName}</td><td class="p-2 text-right whitespace-nowrap"><button onclick="openSupplierModal('${s.supplierId}')" class="text-amber-400 mx-1"><i class="fa-solid fa-pen"></i></button><button onclick="confirmDeleteSupplier('${s.supplierId}')" class="text-rose-400 mx-1"><i class="fa-solid fa-trash"></i></button></td></tr>`).join(''); }

// CHẠY PHÂN BỔ (CẢ THÁNG)
async function resetAllocation() {
  const am = document.getElementById('alloc-month');
  const ym = (am && am.value) ? am.value : appState.currentDate.slice(0, 7);
  showConfirm(`Xóa TOÀN BỘ dữ liệu tab Phân bổ & Đối soát của tháng ${ym}: bảng chi tiết phân bổ + Sổ Nhập-Xuất-Tồn + ghi chú? (Kế hoạch, hóa đơn, nhật ký KHÔNG bị xóa)`, async () => {
    const [y, m] = ym.split('-').map(Number);
    const dim = new Date(y, m, 0).getDate();
    const from = ym + '-01', to = ym + '-' + String(dim).padStart(2, '0');
    showLoading(true, 'Đang xóa dữ liệu phân bổ & đối soát...');

    // 1) Xóa toàn bộ bản ghi phân bổ trong IndexedDB của tháng này
    await clearAllocationsByRange(from, to);

    // 2) Xóa sổ Nhập-Xuất-Tồn + ghi chú trong BỘ NHỚ
    window.__FAMS_MONTHLY_NOTES = [];
    window.__FAMS_STOCK_LEDGER = [];

    // 3) Xóa sổ kho + ghi chú đã LƯU trong localStorage (nếu không xóa, loadAllData sẽ nạp lại sổ cũ)
    try {
      localStorage.removeItem('fams_ledger_' + ym);
      localStorage.removeItem('fams_notes_' + ym);
    } catch (e) { /* bỏ qua nếu localStorage lỗi */ }

    // 4) Nạp lại dữ liệu tháng & vẽ lại toàn bộ giao diện
    appState.currentDate = from;
    appState.allocations = [];
    appState.violations = [];
    await loadAllData();
    renderAll();

    // 5) Đảm bảo các bảng của tab hiển thị trạng thái rỗng
    renderAllocationsTable();
    renderStockLedger();
    const badge = document.getElementById('allocation-summary-badge');
    if (badge) badge.textContent = 'Chưa tính toán';

    showLoading(false);
    showToast(`Đã reset toàn bộ dữ liệu phân bổ & đối soát tháng ${ym}`, 'success');
  });
}

async function onAllocMonthChange() {
  const am = document.getElementById('alloc-month');
  if (!am || !am.value) return;
  appState.currentDate = am.value + '-01';
  const gd = document.getElementById('global-date'); if (gd) gd.value = appState.currentDate;
  updateDateBadge(); updateLockStatus();
  showLoading(true, 'Đang tải dữ liệu tháng...');
  await loadAllData();
  appState.violations = await validateAllocations(appState.allocations);
  initAllocFilter(); renderAll(); showLoading(false);
}

async function runAllocationEngine(mode) {
  try {
    const am = document.getElementById('alloc-month');
    if (am && am.value) { appState.currentDate = am.value + '-01'; }
    if (!appState.currentDate) { showToast('Vui lòng chọn tháng phân bổ', 'error'); return; }
    if (isPeriodLocked(appState.currentDate)) { showToast('Kỳ này đã bị khóa, không thể chạy phân bổ.', 'error'); return; }
    const method = (mode === 'DRAIN') ? 'PA1 - Vét cạn kho' : (mode === 'ROLLING') ? 'PA3 - Luân chuyển ngày' : (mode === 'SCALED') ? 'PA4 - Rải đều hệ số' : 'PA2 - Kho tồn';
    showLoading(true, `Đang chạy ${method}...`);
    if (mode === 'DRAIN') await calculateMonthlyAllocationsDrain(appState.currentDate);
    else if (mode === 'ROLLING') {
      const sel = document.querySelector('input[name="pa3-mode"]:checked');
      const shortageMode = sel ? sel.value : 'STT';
      await calculateMonthlyAllocationsRolling(appState.currentDate, shortageMode);
    }
    else if (mode === 'SCALED') await calculateMonthlyAllocationsScaled(appState.currentDate);
    else await calculateMonthlyAllocations(appState.currentDate);
    saveLedgerToStorage(appState.currentDate.slice(0, 7));
    await loadAllData();
    appState.violations = await validateAllocations(appState.allocations);
    switchTab('allocation');
    initAllocFilter();
    renderAllocationsTable();
    renderAll();
    showLoading(false);
    showToast(`Đã phân bổ cả tháng. Ngày này: ${appState.allocations.length} dòng, ${appState.violations.length} cảnh báo`, appState.violations.some(v => v.severity === 'ERROR') ? 'error' : 'success');
  } catch (err) { console.error(err); showLoading(false); showToast('Lỗi phân bổ: ' + (err.message || err), 'error'); }
}

// CRUD (giữ nguyên như bản trước)
function openVehicleModal(id) { fillProjectSelect('v-project'); const v = id ? appState.vehicles.find(x => x.vehicleId === id) : null; setVal('v-id', v ? v.vehicleId : ''); setVal('v-plate', v ? v.licensePlate : ''); setVal('v-fuel', v ? v.fuelType : 'DO'); setVal('v-norm', v ? v.normPerShift : ''); setVal('v-min-shifts', v ? v.minShiftsPerMonth : ''); setVal('v-max-shifts', v ? v.maxShiftsPerMonth : ''); setVal('v-plan', v ? v.monthlyPlan : ''); setVal('v-project', v ? v.projectId : ''); setVal('v-priority', v ? (v.priority || '') : ''); setText('vehicle-modal-title', v ? 'Sửa phương tiện' : 'Thêm phương tiện mới'); showModal('vehicle-modal'); }
function closeVehicleModal() { hideModal('vehicle-modal'); }
async function submitVehicleForm() { try { const vehicle = { vehicleId: getVal('v-id') || null, period: appState.currentDate.slice(0, 7), licensePlate: getVal('v-plate'), fuelType: getVal('v-fuel'), normPerShift: Number(getVal('v-norm')) || 0, minShiftsPerMonth: Number(getVal('v-min-shifts')) || 0, maxShiftsPerMonth: Number(getVal('v-max-shifts')) || 0, monthlyPlan: Number(getVal('v-plan')) || 0, projectId: getVal('v-project'), priority: Number(getVal('v-priority')) || 999 };
 if (!vehicle.licensePlate) { showToast('Vui lòng nhập biển số', 'error'); return; } await saveVehicle(vehicle); appState.vehicles = await loadVehicles(appState.currentDate.slice(0, 7));
 renderVehiclesTable(); renderDashboard(); closeVehicleModal(); showToast('Đã lưu phương tiện', 'success'); } catch (e) { showToast('Lỗi: ' + (e.message || e), 'error'); } }
async function duplicateVehicle(id) { const v = appState.vehicles.find(x => x.vehicleId === id); if (!v) return; await saveVehicle({ ...v, vehicleId: null, period: appState.currentDate.slice(0, 7), licensePlate: v.licensePlate + ' (sao chép)' }); appState.vehicles = await loadVehicles(appState.currentDate.slice(0, 7)); renderVehiclesTable(); showToast('Đã tạo bản sao', 'success'); }
function confirmDeleteVehicle(id) { const v = appState.vehicles.find(x => x.vehicleId === id); showConfirm(`Xóa phương tiện "${v ? v.licensePlate : id}"?`, async () => { await deleteVehicle(id); appState.vehicles = await loadVehicles(appState.currentDate.slice(0, 7));
 renderVehiclesTable(); renderDashboard(); showToast('Đã xóa', 'success'); }); }

function openLogModal(id) { fillVehicleSelect('l-vehicle'); const l = id ? appState.operationLogs.find(x => x.logId === id) : null; setVal('l-vehicle', l ? l.vehicleId : ''); setVal('l-date', l ? l.date : defaultDateInMonth());
 setVal('l-from', l ? l.fromShift : 1); setVal('l-to', l ? l.toShift : 1); document.getElementById('log-modal').dataset.editId = id || ''; setText('log-modal-title', l ? 'Sửa nhật ký' : 'Ghi nhận số ca'); showModal('log-modal'); }
function closeLogModal() { hideModal('log-modal'); }
async function submitLogForm() { try { const f = Number(getVal('l-from')) || 1, t = Number(getVal('l-to')) || 1; if (t < f) { showToast('Ca kết thúc phải >= ca bắt đầu', 'error'); return; } const editId = document.getElementById('log-modal').dataset.editId; const log = { logId: editId || generateId(), vehicleId: getVal('l-vehicle'), date: getVal('l-date'), fromShift: f, toShift: t, actualShifts: t - f + 1 }; if (!log.vehicleId) { showToast('Vui lòng chọn phương tiện', 'error'); return; } await saveOperationLog(log); if (log.date.slice(0, 7) === appState.currentDate.slice(0, 7)) await loadAllData(); renderOperationLogsTable();
 renderDashboard(); closeLogModal(); showToast('Đã lưu nhật ký', 'success'); } catch (e) { showToast('Lỗi: ' + (e.message || e), 'error'); } }
function confirmDeleteLog(id) { showConfirm('Xóa nhật ký này?', async () => { await deleteOperationLog(id); await loadAllData();
 renderOperationLogsTable(); renderDashboard(); showToast('Đã xóa', 'success'); }); }

function openInvoiceModal(id) { fillProjectSelect('inv-project'); fillSupplierSelect('inv-supplier'); const i = id ? appState.invoices.find(x => x.invoiceId === id) : null; setVal('inv-id', i ? i.invoiceId : ''); setVal('inv-date', i ? i.date : defaultDateInMonth());
 setVal('inv-supplier', i ? i.supplier : ''); setVal('inv-fuel', i ? i.fuelType : 'DO'); setVal('inv-quantity', i ? i.quantity : ''); setVal('inv-unit-price', i ? i.unitPrice : ''); setVal('inv-project', i ? i.projectId : ''); setVal('inv-location', i ? (i.location || '') : ''); setText('invoice-modal-title', i ? 'Sửa hóa đơn' : 'Thêm hóa đơn mới'); showModal('invoice-modal'); }
function closeInvoiceModal() { hideModal('invoice-modal'); }
async function submitInvoiceForm() { try { const q = Number(getVal('inv-quantity')) || 0, u = Number(getVal('inv-unit-price')) || 0; const invoice = { invoiceId: getVal('inv-id') || generateId(), date: getVal('inv-date'), supplier: getVal('inv-supplier'), fuelType: getVal('inv-fuel'), quantity: q, unitPrice: u, totalAmount: q * u, projectId: getVal('inv-project'), location: getVal('inv-location') }; if (q <= 0) { showToast('Số lượng phải lớn hơn 0', 'error'); return; } await saveInvoice(invoice); if (invoice.date.slice(0, 7) === appState.currentDate.slice(0, 7)) await loadAllData(); renderInvoicesTable();
 renderDashboard(); closeInvoiceModal(); showToast('Đã lưu hóa đơn', 'success'); } catch (e) { showToast('Lỗi: ' + (e.message || e), 'error'); } }
async function duplicateInvoice(id) { const i = appState.invoices.find(x => x.invoiceId === id); if (!i) return; await saveInvoice({ ...i, invoiceId: generateId() }); await loadAllData();
 renderInvoicesTable(); showToast('Đã tạo bản sao', 'success'); }
function confirmDeleteInvoice(id) { showConfirm('Xóa hóa đơn này?', async () => { await deleteInvoice(id); await loadAllData();
 renderInvoicesTable(); renderDashboard(); showToast('Đã xóa', 'success'); }); }

function openProjectModal(id) { const p = id ? appState.projects.find(x => x.projectId === id) : null; setVal('p-id', p ? p.projectId : ''); setVal('p-name', p ? p.projectName : ''); setVal('p-desc', p ? p.description : ''); setText('project-modal-title', p ? 'Sửa công trình' : 'Thêm công trình'); showModal('project-modal'); }
function closeProjectModal() { hideModal('project-modal'); }
async function submitProjectForm() { try { const project = { projectId: getVal('p-id') || generateId(), projectName: getVal('p-name'), description: getVal('p-desc') }; if (!project.projectName) { showToast('Vui lòng nhập tên công trình', 'error'); return; } await saveProject(project); appState.projects = await loadProjects(); renderProjectsTable(); closeProjectModal(); showToast('Đã lưu công trình', 'success'); } catch (e) { showToast('Lỗi: ' + (e.message || e), 'error'); } }
function confirmDeleteProject(id) { const used = appState.vehicles.some(v => v.projectId === id) || appState.invoices.some(i => i.projectId === id); if (used) { showToast('Không thể xóa: công trình đang được dùng', 'error'); return; } showConfirm('Xóa công trình này?', async () => { await deleteProject(id); appState.projects = await loadProjects(); renderProjectsTable(); showToast('Đã xóa', 'success'); }); }

function openSupplierModal(id) { const s = id ? appState.suppliers.find(x => x.supplierId === id) : null; setVal('s-id', s ? s.supplierId : ''); setVal('s-name', s ? s.supplierName : ''); setVal('s-contact', s ? s.contactInfo : ''); setText('supplier-modal-title', s ? 'Sửa nhà cung cấp' : 'Thêm nhà cung cấp'); showModal('supplier-modal'); }
function closeSupplierModal() { hideModal('supplier-modal'); }
async function submitSupplierForm() { try { const supplier = { supplierId: getVal('s-id') || generateId(), supplierName: getVal('s-name'), contactInfo: getVal('s-contact') }; if (!supplier.supplierName) { showToast('Vui lòng nhập tên NCC', 'error'); return; } await saveSupplier(supplier); appState.suppliers = await loadSuppliers(); renderSuppliersTable(); closeSupplierModal(); showToast('Đã lưu NCC', 'success'); } catch (e) { showToast('Lỗi: ' + (e.message || e), 'error'); } }
function confirmDeleteSupplier(id) { const used = appState.invoices.some(i => i.supplier === id); if (used) { showToast('Không thể xóa: NCC đang được dùng', 'error'); return; } showConfirm('Xóa NCC này?', async () => { await deleteSupplier(id); appState.suppliers = await loadSuppliers(); renderSuppliersTable(); showToast('Đã xóa', 'success'); }); }

function openImportModal() { setVal('import-month', appState.currentDate.slice(0, 7)); showModal('import-modal'); }
function closeImportModal() { hideModal('import-modal'); }
async function submitImportForm() {
  try {
    const fi = document.getElementById('import-file'), dt = getVal('import-type');
    const ym = getVal('import-month');
    if (!ym) { showToast('Vui lòng chọn KỲ (tháng) trước khi import', 'error'); return; }
    if (!fi.files || !fi.files[0]) { showToast('Vui lòng chọn file Excel', 'error'); return; }
    if (isPeriodLocked(ym + '-01')) { showToast(`Kỳ ${ym} đang bị KHÓA. Hãy mở khóa trước khi import.`, 'error'); return; }
    const labels = { DINH_MUC_KE_HOACH: 'Danh mục phương tiện (toàn bộ)', KE_HOACH_NGANG: `Kế hoạch vận hành tháng ${ym}`, VAN_HANH: `Nhật ký vận hành tháng ${ym}`, VAN_HANH_NGANG: `Chấm công vận hành tháng ${ym}`, BANG_KE_HOA_DON: `Hóa đơn tháng ${ym}` };
    showConfirm(`Import sẽ XÓA sạch dữ liệu "${labels[dt] || dt}" rồi nạp dữ liệu mới từ file. Tiếp tục?`, async () => {
      try {
        showLoading(true, 'Đang xóa dữ liệu cũ của kỳ...');
        await clearDataForImport(dt, ym);
        showLoading(true, 'Đang import dữ liệu mới...');
        const c = await importExcelData(fi.files[0], dt);
        appState.currentDate = ym + '-01';
        const gd = document.getElementById('global-date'); if (gd) gd.value = appState.currentDate;
        updateDateBadge(); updateLockStatus();
        await loadAllData(); renderAll(); showLoading(false); closeImportModal();
        showToast(`Đã xóa dữ liệu cũ và import thành công ${c} dòng cho kỳ ${ym}!`, 'success');
      } catch (e) { showLoading(false); showToast('Lỗi import: ' + (e.message || e), 'error'); }
    });
  } catch (e) { showLoading(false); showToast('Lỗi import: ' + (e.message || e), 'error'); }
}

function saveBusinessConfig() { applyBusinessConfig(parseFloat(getVal('cfg-yellow')), parseFloat(getVal('cfg-red')), parseFloat(getVal('cfg-upper')), parseFloat(getVal('cfg-lower'))); showToast('Đã lưu thông số', 'success'); }
function saveCompanyConfig() { applyCompanyConfig({ company: getVal('cfg-company'), unit: getVal('cfg-unit'), note: getVal('cfg-note') }); showToast('Đã lưu thông tin công ty', 'success'); }

// SAO LƯU
async function backupData(silent) { try { const data = await exportAllData(); const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19); a.href = url; a.download = `FAMS_backup_${ts}.json`; a.click(); URL.revokeObjectURL(url); localStorage.setItem('fams_last_backup', new Date().toISOString()); updateLastBackupInfo(); if (!silent) showToast('Đã sao lưu thành công!', 'success'); } catch (e) { if (!silent) showToast('Lỗi sao lưu: ' + (e.message || e), 'error'); } }
function restoreData(input) { const file = input.files[0]; if (!file) return; const reader = new FileReader(); reader.onload = async (e) => { try { const backup = JSON.parse(e.target.result); showConfirm('Phục hồi sẽ GHI ĐÈ toàn bộ dữ liệu hiện tại. Tiếp tục?', async () => { showLoading(true, 'Đang phục hồi...'); await importAllData(backup); syncConfigInputs(); await loadAllData(); renderAll(); showLoading(false); showToast('Phục hồi thành công!', 'success'); }); } catch (err) { showToast('File không hợp lệ: ' + err.message, 'error'); } input.value = ''; }; reader.readAsText(file); }
function toggleAutoBackup(checked) { localStorage.setItem('fams_autobackup', checked ? '1' : '0'); showToast(checked ? 'Đã bật tự động sao lưu' : 'Đã tắt tự động sao lưu', 'info'); }
function clearCurrentMonth() {
  const ym = appState.currentDate.slice(0, 7);
  if (isPeriodLocked(appState.currentDate)) { showToast(`Kỳ ${ym} đã bị khóa. Hãy mở khóa trước khi xóa.`, 'error'); return; }
  showConfirm(`Xóa TOÀN BỘ nhật ký vận hành, hóa đơn và phân bổ của tháng ${ym}? Không thể hoàn tác (nên sao lưu trước).`, async () => {
    showLoading(true, 'Đang xóa dữ liệu tháng...');
    await clearMonthData(ym);
    await loadAllData(); appState.violations = []; renderAll();
    showLoading(false); showToast(`Đã xóa dữ liệu tháng ${ym}`, 'success');
  });
}
function toggleLockPeriod() {
  const ym = appState.currentDate.slice(0, 7);
  if (isPeriodLocked(appState.currentDate)) { unlockPeriod(ym); showToast(`Đã MỞ khóa kỳ ${ym}`, 'info'); }
  else { lockPeriod(ym); showToast(`Đã KHÓA kỳ ${ym}`, 'success'); }
  updateLockStatus();
}
function updateLockStatus() {
  const el = document.getElementById('lock-status'); if (!el) return;
  const ym = appState.currentDate.slice(0, 7);
  el.textContent = isPeriodLocked(appState.currentDate) ? `🔒 Kỳ ${ym} đang KHÓA (không cho phân bổ/xóa/sửa)` : `🔓 Kỳ ${ym} đang mở`;
  el.className = isPeriodLocked(appState.currentDate) ? 'text-xs text-rose-400' : 'text-xs text-emerald-400';
}
// ============================================================
// BÁO CÁO TỔNG HỢP (từ ngày - đến ngày, lọc xe/nhiên liệu)
// ============================================================
// ===== KẾ HOẠCH VẬN HÀNH (BẢNG NGANG CHỈNH SỬA TRỰC TIẾP) =====
function initPlanTab() { if (!getVal('plan-month')) setVal('plan-month', appState.currentDate.slice(0, 7)); renderPlanMatrix(); }
async function renderPlanMatrix() {
  const box = document.getElementById('plan-matrix-container'); if (!box) return;
  const ym = getVal('plan-month') || appState.currentDate.slice(0, 7);
  const from = ym + '-01';
  const [y, m] = ym.split('-').map(Number);
  const dim = new Date(y, m, 0).getDate();
  const to = ym + '-' + String(dim).padStart(2, '0');
  const plans = await loadPlansByRange(from, to);
  const planMap = {}; plans.forEach(p => { if (!planMap[p.vehicleId]) planMap[p.vehicleId] = {}; planMap[p.vehicleId][p.date] = p.plannedShifts; });
  const dates = []; for (let i = 1; i <= dim; i++) dates.push(ym + '-' + String(i).padStart(2, '0'));
  const vehicles = [...appState.vehicles].sort((a, b) => (a.priority || 999) - (b.priority || 999));
  if (vehicles.length === 0) { box.innerHTML = '<p class="text-slate-500 text-sm">Chưa có phương tiện. Hãy thêm phương tiện trước.</p>'; return; }
  let html = `<p class="mb-2 text-slate-400 text-sm">Kế hoạch tháng ${ym} — gõ số ca vào ô (2 = 2 ca, 1.5 = 1,5 ca), để trống nếu nghỉ. Bấm "Lưu kế hoạch" sau khi sửa xong.</p>`;
  html += `<table class="min-w-full text-xs border-collapse"><thead><tr class="bg-slate-900">
    <th class="border border-slate-700 px-2 py-1 sticky left-0 bg-slate-900">Phương tiện</th>
    ${dates.map(d => `<th class="border border-slate-700 px-1 py-1">${d.slice(8)}</th>`).join('')}
    <th class="border border-slate-700 px-2 py-1 text-amber-400">Tổng ca</th></tr>
    <tr class="bg-slate-900/60">
    <th class="border border-slate-700 px-2 py-0.5 sticky left-0 bg-slate-900/60 text-[10px] text-slate-500 font-normal">Thứ</th>
    ${dates.map(d => { const t = thu(d); return `<th class="border border-slate-700 px-1 py-0.5 text-[10px] font-normal ${t === 'CN' ? 'text-rose-400' : 'text-slate-500'}">${t}</th>`; }).join('')}
    <th class="border border-slate-700 px-2 py-0.5"></th></tr></thead><tbody>`;
  vehicles.forEach(v => {
    let tong = 0;
    html += `<tr><td class="border border-slate-700 px-2 py-1 font-medium text-slate-100 sticky left-0 bg-slate-950 whitespace-nowrap">${v.licensePlate}</td>`;
    dates.forEach(d => { const val = (planMap[v.vehicleId] && planMap[v.vehicleId][d]) || ''; if (val) tong += Number(val); html += `<td class="border border-slate-700 p-0"><input type="number" step="0.5" min="0" value="${val}" data-veh="${v.vehicleId}" data-date="${d}" class="plan-cell w-12 bg-transparent text-center text-emerald-400 py-1 focus:bg-slate-800 focus:outline-none" oninput="updatePlanTotal(this)"></td>`; });
    html += `<td class="border border-slate-700 px-2 py-1 text-center font-bold text-amber-400 plan-total" data-veh="${v.vehicleId}">${tong}</td></tr>`;
  });
  html += '</tbody></table>';
  box.innerHTML = html;
}
function updatePlanTotal(input) {
  const veh = input.dataset.veh;
  let tong = 0;
  document.querySelectorAll(`.plan-cell[data-veh="${veh}"]`).forEach(c => { const n = Number(c.value); if (!isNaN(n)) tong += n; });
  const cell = document.querySelector(`.plan-total[data-veh="${veh}"]`);
  if (cell) {
    cell.textContent = round2(tong);
    const v = appState.vehicles.find(x => x.vehicleId === veh);
    if (v && v.maxShiftsPerMonth && tong > v.maxShiftsPerMonth) { cell.classList.add('text-rose-400'); cell.classList.remove('text-amber-400'); cell.title = `Vượt kế hoạch tháng (tối đa ${v.maxShiftsPerMonth} ca)`; }
    else if (v && v.minShiftsPerMonth && tong < v.minShiftsPerMonth) { cell.classList.add('text-blue-400'); cell.classList.remove('text-amber-400'); cell.title = `Thấp hơn kế hoạch tháng (tối thiểu ${v.minShiftsPerMonth} ca)`; }
    else { cell.classList.remove('text-rose-400', 'text-blue-400'); cell.classList.add('text-amber-400'); cell.title = ''; }
  }
}
async function resetVehiclesData() {
  const ym = appState.currentDate.slice(0, 7);
  showConfirm(`Xóa TOÀN BỘ danh mục phương tiện của THÁNG ${ym}? (Các tháng khác không bị ảnh hưởng)`, async () => {
    showLoading(true, 'Đang xóa phương tiện...');
    await clearVehiclesByPeriod(ym);
    await loadAllData(); renderAll(); showLoading(false);
    showToast(`Đã xóa toàn bộ phương tiện tháng ${ym}`, 'success');
  });
}
// Sao chép danh mục xe từ tháng trước sang tháng hiện tại
async function copyVehiclesPrevMonth() {
  const ym = appState.currentDate.slice(0, 7);
  const [y, m] = ym.split('-').map(Number);
  const prev = new Date(y, m - 2, 1);
  const prevYm = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`;
  const already = appState.vehicles.length;
  const doCopy = async () => {
    showLoading(true, 'Đang sao chép danh mục...');
    const c = await copyVehiclesFromPeriod(prevYm, ym);
    await loadAllData(); renderAll(); showLoading(false);
    if (c === 0) showToast(`Tháng ${prevYm} không có phương tiện nào để sao chép.`, 'error');
    else showToast(`Đã sao chép ${c} phương tiện từ tháng ${prevYm} sang ${ym}. Nhớ chỉnh lại kế hoạch lít nếu cần.`, 'success');
  };
  if (already > 0) showConfirm(`Tháng ${ym} đã có ${already} xe. Sao chép thêm từ tháng ${prevYm} sẽ CỘNG DỒN vào (có thể trùng). Tiếp tục?`, doCopy);
  else doCopy();
}
async function resetLogsData(ym) {
  ym = ym || (getVal('log-from') ? getVal('log-from').slice(0, 7) : appState.currentDate.slice(0, 7));
  if (isPeriodLocked(ym + '-01')) { showToast(`Kỳ ${ym} đang KHÓA. Hãy mở khóa trước khi reset.`, 'error'); return; }
  showConfirm(`Xóa TOÀN BỘ nhật ký vận hành của tháng ${ym}?`, async () => {
    showLoading(true, 'Đang xóa nhật ký...');
    await clearDataForImport('VAN_HANH', ym);
    await loadAllData(); renderAll();
    if (typeof renderLogMatrix === 'function' && document.getElementById('log-matrix-container')) renderLogMatrix();
    showLoading(false);
    showToast(`Đã xóa nhật ký tháng ${ym}`, 'success');
  });
}
async function resetInvoicesData(ym) {
  ym = ym || getVal('inv-filter-month') || appState.currentDate.slice(0, 7);
  if (isPeriodLocked(ym + '-01')) { showToast(`Kỳ ${ym} đang KHÓA. Hãy mở khóa trước khi reset.`, 'error'); return; }
  showConfirm(`Xóa TOÀN BỘ hóa đơn của tháng ${ym}?`, async () => {
    showLoading(true, 'Đang xóa hóa đơn...');
    await clearDataForImport('BANG_KE_HOA_DON', ym);
    appState.currentDate = ym + '-01';
    await loadAllData(); renderAll(); showLoading(false);
    showToast(`Đã xóa hóa đơn tháng ${ym}`, 'success');
  });
}

async function resetPlanMatrix() {
  const ym = getVal('plan-month') || appState.currentDate.slice(0, 7);
  if (isPeriodLocked(ym + '-01')) { showToast(`Kỳ ${ym} đang bị KHÓA. Hãy vào Cấu hình để MỞ khóa kỳ trước khi reset.`, 'error'); return; }
  showConfirm(`Xóa TOÀN BỘ kế hoạch vận hành của tháng ${ym}? (Nhật ký, hóa đơn, phân bổ KHÔNG bị xóa)`, async () => {
    showLoading(true, 'Đang xóa kế hoạch...');
    await clearPlanMonth(ym);
    await renderPlanMatrix();
    showLoading(false);
    showToast(`Đã reset kế hoạch tháng ${ym}`, 'success');
  });
}
async function runAutoPlan() {
  const ym = getVal('plan-month') || appState.currentDate.slice(0, 7);
  if (isPeriodLocked(ym + '-01')) { showToast(`Kỳ ${ym} đang KHÓA. Mở khóa trước khi chạy.`, 'error'); return; }
  showConfirm(`Chạy kế hoạch tự động cho tháng ${ym}? Thao tác sẽ GHI ĐÈ kế hoạch hiện có của tháng này (dựa trên hóa đơn thực tế).`, async () => {
    showLoading(true, 'Đang lập kế hoạch tự động...');
    try {
      const res = await generateAutoPlan(ym + '-01');
      await renderPlanMatrix();
      renderPlanNotes(res.notes);
      showLoading(false);
      showToast(`Đã lập kế hoạch tự động (${res.count} ô có số ca). Xem ghi chú thừa/thiếu bên dưới.`, res.notes.some(n => n.level === 'ERROR') ? 'error' : 'success');
    } catch (e) { showLoading(false); showToast('Lỗi: ' + (e.message || e), 'error'); }
  });
}
function renderPlanNotes(notes) {
  const box = document.getElementById('plan-notes-container'); if (!box) return;
  if (!notes || notes.length === 0) { box.classList.add('hidden'); box.innerHTML = ''; return; }
  box.classList.remove('hidden');
  const head = `<div class="flex justify-between items-center"><span class="font-bold text-slate-200"><i class="fa-solid fa-clipboard-check text-purple-400 mr-2"></i>Ghi chú kế hoạch (đối chiếu hóa đơn vs kế hoạch)</span><button onclick="exportPlanNotes()" class="bg-slate-700 hover:bg-slate-600 text-white px-3 py-1 rounded text-xs"><i class="fa-solid fa-file-excel mr-1"></i>Xuất ghi chú</button></div>`;
  const items = notes.map(n => {
    const c = n.level === 'ERROR' ? 'border-rose-500/40 bg-rose-500/10 text-rose-300' : n.level === 'WARNING' ? 'border-amber-500/40 bg-amber-500/10 text-amber-300' : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300';
    return `<div class="p-2 rounded border text-sm ${c}">${n.message}</div>`;
  }).join('');
  box.innerHTML = head + items;
  window.__FAMS_PLAN_NOTES = notes;
}
function exportPlanNotes() {
  const notes = window.__FAMS_PLAN_NOTES || [];
  if (notes.length === 0) { showToast('Chưa có ghi chú', 'error'); return; }
  const rows = notes.map(n => ({ 'Mức độ': n.level, 'Nhiên liệu': n.fuel, 'Công trình': getProjectName(n.proj), 'Ghi chú': n.message }));
  exportToExcel(rows, 'GhiChuKeHoach', 'GhiChu_KeHoach_' + (getVal('plan-month') || appState.currentDate.slice(0, 7)) + '.xlsx');
  showToast('Đã xuất ghi chú kế hoạch', 'success');
}

async function savePlanMatrix() {
  const ym = getVal('plan-month') || appState.currentDate.slice(0, 7);
  const [y, m] = ym.split('-').map(Number);
  const dim = new Date(y, m, 0).getDate();
  const from = ym + '-01', to = ym + '-' + String(dim).padStart(2, '0');
  showLoading(true, 'Đang lưu kế hoạch...');
  await clearPlansByRange(from, to);
  const cells = document.querySelectorAll('.plan-cell');
  let count = 0;
  for (const c of cells) {
    const n = Number(c.value);
    if (!isNaN(n) && n > 0) { await savePlan({ planId: generateId(), vehicleId: c.dataset.veh, date: c.dataset.date, plannedShifts: n }); count++; }
  }
  showLoading(false); showToast(`Đã lưu kế hoạch (${count} ô có số ca)`, 'success');
}
async function exportPlanMatrix() {
  const ym = getVal('plan-month') || appState.currentDate.slice(0, 7);
  const [y, m] = ym.split('-').map(Number);
  const dim = new Date(y, m, 0).getDate();
  const from = ym + '-01', to = ym + '-' + String(dim).padStart(2, '0');
  const plans = await loadPlansByRange(from, to);
  const planMap = {}; plans.forEach(p => { if (!planMap[p.vehicleId]) planMap[p.vehicleId] = {}; planMap[p.vehicleId][p.date] = p.plannedShifts; });
  const dates = []; for (let i = 1; i <= dim; i++) dates.push(ym + '-' + String(i).padStart(2, '0'));
  const vehicles = [...appState.vehicles].sort((a, b) => (a.priority || 999) - (b.priority || 999));
  const aoa = [['vehicleId', ...dates, 'Tổng ca']];
  vehicles.forEach(v => { let tong = 0; const row = [v.vehicleId]; dates.forEach(d => { const val = (planMap[v.vehicleId] && planMap[v.vehicleId][d]) || ''; if (val) tong += Number(val); row.push(val || ''); }); row.push(tong); aoa.push(row); });
  const ws = XLSX.utils.aoa_to_sheet(aoa), wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'KeHoach');
  XLSX.writeFile(wb, `KeHoach_VanHanh_${ym}.xlsx`);
  showToast('Đã xuất kế hoạch', 'success');
}

// ===== NHẬT KÝ VẬN HÀNH DẠNG CHẤM CÔNG NGANG =====
function pickLogMonth() {
  const el = document.getElementById('log-month'); if (!el || !el.value) return;
  const [y, m] = el.value.split('-').map(Number);
  const dim = new Date(y, m, 0).getDate();
  setVal('log-from', el.value + '-01');
  setVal('log-to', el.value + '-' + String(dim).padStart(2, '0'));
  renderLogMatrix();
}

function logQuickMonth() {
  const ym = appState.currentDate.slice(0, 7);
  const [y, m] = ym.split('-').map(Number);
  const dim = new Date(y, m, 0).getDate();
  setVal('log-from', ym + '-01');
  setVal('log-to', ym + '-' + String(dim).padStart(2, '0'));
  renderLogMatrix();
}
async function getLogMatrixData() {
  if (!db) await initDB();
  let from = getVal('log-from'), to = getVal('log-to');
  if (!from || !to) { const d = new Date(appState.currentDate); from = new Date(d.getFullYear(), d.getMonth(), 1).toISOString().split('T')[0]; to = new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().split('T')[0]; setVal('log-from', from); setVal('log-to', to); }
  const logs = await new Promise((res, rej) => { const r = getStore(SHEET_OPERATION_LOGS).index('date').getAll(IDBKeyRange.bound(from, to)); r.onsuccess = () => res(r.result || []); r.onerror = () => rej(r.error); });
  // Danh sách ngày liên tục
  const dates = []; let cur = new Date(from); const end = new Date(to);
  while (cur <= end) { dates.push(cur.toISOString().split('T')[0]); cur.setDate(cur.getDate() + 1); }
  // Ma trận xe × ngày (giá trị = số ca; nếu from<>to lấy actualShifts)
  const matrix = {}; const vehSet = new Set();
  logs.forEach(l => { vehSet.add(l.vehicleId); if (!matrix[l.vehicleId]) matrix[l.vehicleId] = {}; matrix[l.vehicleId][l.date] = l.actualShifts; });
  // Sắp xe theo STT ưu tiên
  const vehicleIds = [...vehSet].sort((a, b) => { const va = appState.vehicles.find(x => x.vehicleId === a); const vb = appState.vehicles.find(x => x.vehicleId === b); return ((va ? va.priority : 999) || 999) - ((vb ? vb.priority : 999) || 999); });
  return { dates, vehicleIds, matrix, from, to };
}
async function renderLogMatrix() {
  const box = document.getElementById('log-matrix-container'); if (!box) return;
  // Nếu chưa có nhật ký nhưng có xe -> vẫn hiển thị bảng trống cho phép nhập tay
  const data = await getLogMatrixData();
  let { dates, vehicleIds, matrix, from, to } = data;
  if (vehicleIds.length === 0) {
    vehicleIds = [...appState.vehicles].sort((a, b) => (a.priority || 999) - (b.priority || 999)).map(v => v.vehicleId);
    vehicleIds.forEach(vid => { if (!matrix[vid]) matrix[vid] = {}; });
  }
  if (vehicleIds.length === 0) { box.innerHTML = '<p class="text-slate-500 text-sm">Chưa có phương tiện. Hãy thêm phương tiện trước.</p>'; return; }
  let html = `<p class="mb-2 text-slate-400 text-sm">Chấm công từ ${from} đến ${to} — gõ số ca vào ô (2 = 2 ca), để trống nếu nghỉ. Bấm "Lưu chấm công" sau khi sửa.</p>`;
  html += `<table class="min-w-full text-xs border-collapse"><thead><tr class="bg-slate-900">
    <th class="border border-slate-700 px-2 py-1 sticky left-0 bg-slate-900">Phương tiện</th>
    ${dates.map(d => `<th class="border border-slate-700 px-1 py-1">${d.slice(8)}</th>`).join('')}
    <th class="border border-slate-700 px-2 py-1 text-amber-400">Tổng ca</th></tr>
    <tr class="bg-slate-900/60">
    <th class="border border-slate-700 px-2 py-0.5 sticky left-0 bg-slate-900/60 text-[10px] text-slate-500 font-normal">Thứ</th>
    ${dates.map(d => { const t = thu(d); return `<th class="border border-slate-700 px-1 py-0.5 text-[10px] font-normal ${t === 'CN' ? 'text-rose-400' : 'text-slate-500'}">${t}</th>`; }).join('')}
    <th class="border border-slate-700 px-2 py-0.5"></th></tr></thead><tbody>`;
  vehicleIds.forEach(vid => {
    const v = appState.vehicles.find(x => x.vehicleId === vid);
    let tong = 0;
    html += `<tr><td class="border border-slate-700 px-2 py-1 font-medium text-slate-100 sticky left-0 bg-slate-950 whitespace-nowrap">${v ? v.licensePlate : vid}</td>`;
    dates.forEach(d => { const val = matrix[vid][d] || ''; if (val) tong += Number(val); html += `<td class="border border-slate-700 p-0"><input type="number" step="0.5" min="0" value="${val}" data-veh="${vid}" data-date="${d}" class="log-cell w-12 bg-transparent text-center text-emerald-400 py-1 focus:bg-slate-800 focus:outline-none" oninput="updateLogTotal(this)"></td>`; });
    html += `<td class="border border-slate-700 px-2 py-1 text-center font-bold text-amber-400 log-total" data-veh="${vid}">${tong}</td></tr>`;
  });
  html += '</tbody></table>';
  box.innerHTML = html;
}
function updateLogTotal(input) {
  const veh = input.dataset.veh;
  let tong = 0;
  document.querySelectorAll(`.log-cell[data-veh="${veh}"]`).forEach(c => { const n = Number(c.value); if (!isNaN(n)) tong += n; });
  const cell = document.querySelector(`.log-total[data-veh="${veh}"]`);
  if (cell) cell.textContent = round2(tong);
}
async function saveLogMatrix() {
  const ym = getVal('log-from') ? getVal('log-from').slice(0, 7) : appState.currentDate.slice(0, 7);
  if (isPeriodLocked(ym + '-01')) { showToast(`Kỳ ${ym} đang KHÓA. Hãy mở khóa trước khi lưu.`, 'error'); return; }
  const cells = document.querySelectorAll('.log-cell');
  if (cells.length === 0) { showToast('Chưa có bảng để lưu. Bấm "Xem chấm công" trước.', 'error'); return; }
  showLoading(true, 'Đang lưu chấm công...');
  // Xóa nhật ký cũ trong khoảng đang hiển thị rồi lưu lại từ bảng
  const from = getVal('log-from'), to = getVal('log-to');
  await new Promise((res, rej) => {
    const tx = db.transaction(SHEET_OPERATION_LOGS, 'readwrite');
    const r = tx.objectStore(SHEET_OPERATION_LOGS).index('date').openCursor(IDBKeyRange.bound(from, to));
    r.onsuccess = (e) => { const c = e.target.result; if (c) { c.delete(); c.continue(); } };
    tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
  });
  let count = 0;
  for (const c of cells) {
    const n = Number(c.value);
    if (!isNaN(n) && n > 0) { await saveOperationLog({ logId: generateId(), vehicleId: c.dataset.veh, date: c.dataset.date, fromShift: 1, toShift: n, actualShifts: n }); count++; }
  }
  await loadAllData(); renderAll();
  showLoading(false); showToast(`Đã lưu chấm công (${count} ô có số ca)`, 'success');
}
async function exportLogMatrix() {
  const { dates, vehicleIds, matrix, from, to } = await getLogMatrixData();
  if (vehicleIds.length === 0) { showToast('Không có dữ liệu', 'error'); return; }
  const aoa = [];
  aoa.push(['Phương tiện', ...dates.map(d => d.slice(8) + '/' + d.slice(5, 7)), 'Tổng ca']);
  vehicleIds.forEach(vid => { const v = appState.vehicles.find(x => x.vehicleId === vid); let tong = 0; const row = [v ? v.licensePlate : vid]; dates.forEach(d => { const val = matrix[vid][d]; if (val) tong += val; row.push(val || ''); }); row.push(tong); aoa.push(row); });
  const ws = XLSX.utils.aoa_to_sheet(aoa), wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'ChamCong');
  XLSX.writeFile(wb, `ChamCong_VanHanh_${from}_${to}.xlsx`);
  showToast('Đã xuất bảng chấm công', 'success');
}

function initSummaryTab() {
  const sel = document.getElementById('sum-vehicle');
  if (sel) sel.innerHTML = '<option value="">Tất cả</option>' + appState.vehicles.map(v => `<option value="${v.vehicleId}">${v.licensePlate}</option>`).join('');
  const ssup = document.getElementById('sum-supplier');
  if (ssup) ssup.innerHTML = '<option value="">Tất cả</option>' + appState.suppliers.map(s => `<option value="${s.supplierId}">${s.supplierName}</option>`).join('');
  const ym = appState.currentDate.slice(0, 7);
  const [y, m] = ym.split('-').map(Number);
  const dim = new Date(y, m, 0).getDate();
  const first = ym + '-01';
  const last = ym + '-' + String(dim).padStart(2, '0');
  if (!getVal('sum-from')) setVal('sum-from', first);
  if (!getVal('sum-to')) setVal('sum-to', last);
}

function pickSummaryMonth() {
  const el = document.getElementById('sum-month'); if (!el || !el.value) return;
  const [y, m] = el.value.split('-').map(Number);
  const dim = new Date(y, m, 0).getDate();
  setVal('sum-from', el.value + '-01');
  setVal('sum-to', el.value + '-' + String(dim).padStart(2, '0'));
  runSummary();
}

function quickRange(type) {
  const ym = appState.currentDate.slice(0, 7);
  const [y, m] = ym.split('-').map(Number);
  const dim = new Date(y, m, 0).getDate();
  if (type === 'month') {
    setVal('sum-from', ym + '-01');
    setVal('sum-to', ym + '-' + String(dim).padStart(2, '0'));
  }
  runSummary();
}
// Lấy toàn bộ phân bổ trong khoảng ngày (đã lọc)
async function getSummaryData() {
  if (!db) await initDB();
  const from = getVal('sum-from'), to = getVal('sum-to');
  if (!from || !to) { showToast('Chọn từ ngày - đến ngày', 'error'); return null; }
  const fv = getVal('sum-vehicle'), ff = getVal('sum-fuel'), fs = getVal('sum-supplier');
  let rows = await new Promise((res, rej) => { const r = getStore(SHEET_ALLOCATIONS).index('date').getAll(IDBKeyRange.bound(from, to)); r.onsuccess = () => res(r.result || []); r.onerror = () => rej(r.error); });
  if (fv) rows = rows.filter(a => a.vehicleId === fv);
  if (ff) rows = rows.filter(a => a.fuelType === ff);
  if (fs) rows = rows.filter(a => a.supplierId === fs);
  return { rows, from, to };
}
async function runSummary() {
  const data = await getSummaryData(); if (!data) return;
  const box = document.getElementById('summary-preview');
  if (data.rows.length === 0) { box.innerHTML = '<p class="text-slate-500">Không có dữ liệu phân bổ trong khoảng này. Hãy chạy Phân bổ trước.</p>'; return; }
  // Xem trước dạng NGANG (ma trận xe theo hàng, ngày theo cột)
  const { vehicleIds, dates, matrix, totalByVehicle } = buildMatrix(data.rows);
  let html = `<table class="min-w-full text-xs border-collapse"><thead><tr class="bg-slate-900">
    <th class="border border-slate-700 px-2 py-1 sticky left-0 bg-slate-900">Phương tiện</th>
    ${dates.map(d => `<th class="border border-slate-700 px-2 py-1">${d.slice(8)}</th>`).join('')}
    <th class="border border-slate-700 px-2 py-1 text-amber-400">Tổng</th></tr>
    <tr class="bg-slate-900/60">
    <th class="border border-slate-700 px-2 py-0.5 sticky left-0 bg-slate-900/60 text-[10px] text-slate-500 font-normal">Thứ</th>
    ${dates.map(d => { const t = thu(d); return `<th class="border border-slate-700 px-2 py-0.5 text-[10px] font-normal ${t === 'CN' ? 'text-rose-400' : 'text-slate-500'}">${t}</th>`; }).join('')}
    <th class="border border-slate-700 px-2 py-0.5"></th></tr></thead><tbody>`;
  vehicleIds.forEach(vid => {
    const v = appState.vehicles.find(x => x.vehicleId === vid);
    html += `<tr><td class="border border-slate-700 px-2 py-1 font-medium text-slate-100 sticky left-0 bg-slate-950">${v ? v.licensePlate : vid}</td>`;
    dates.forEach(d => { const val = matrix[vid][d] || 0; html += `<td class="border border-slate-700 px-2 py-1 text-right ${val ? '' : 'text-slate-700'}">${val ? val.toLocaleString('vi-VN') : '-'}</td>`; });
    html += `<td class="border border-slate-700 px-2 py-1 text-right font-bold text-amber-400">${totalByVehicle[vid].toLocaleString('vi-VN')}</td></tr>`;
  });
  const totalByDate = dates.map(d => round2(vehicleIds.reduce((s, vid) => s + (matrix[vid][d] || 0), 0)));
  const grand = round2(Object.values(totalByVehicle).reduce((s, x) => s + x, 0));
  html += `<tr class="bg-slate-900"><td class="border border-slate-700 px-2 py-1 font-bold text-amber-400 sticky left-0 bg-slate-900">TỔNG CỘNG</td>${totalByDate.map(t => `<td class="border border-slate-700 px-2 py-1 text-right font-bold text-slate-200">${t ? t.toLocaleString('vi-VN') : '-'}</td>`).join('')}<td class="border border-slate-700 px-2 py-1 text-right font-bold text-emerald-400">${grand.toLocaleString('vi-VN')}</td></tr>`;
  html += '</tbody></table>';
  box.innerHTML = `<p class="mb-2 text-slate-400">Xem trước (dạng ngang) — từ ${data.from} đến ${data.to}, ${data.rows.length} dòng phân bổ:</p>` + html;
}
// Dựng ma trận: xe × ngày (gộp nhiều phiếu cùng xe/ngày)
function buildMatrix(rows) {
  const dateSet = new Set(), vehSet = new Set(), matrix = {};
  rows.forEach(a => {
    dateSet.add(a.date); vehSet.add(a.vehicleId);
    if (!matrix[a.vehicleId]) matrix[a.vehicleId] = {};
    matrix[a.vehicleId][a.date] = round2((matrix[a.vehicleId][a.date] || 0) + a.allocatedQuantity);
  });
  const dates = [...dateSet].sort();
  const vehicleIds = [...vehSet].sort((a, b) => { const va = appState.vehicles.find(x => x.vehicleId === a); const vb = appState.vehicles.find(x => x.vehicleId === b); return (va ? va.licensePlate : a).localeCompare(vb ? vb.licensePlate : b); });
  const totalByVehicle = {};
  vehicleIds.forEach(vid => { totalByVehicle[vid] = round2(Object.values(matrix[vid]).reduce((s, x) => s + x, 0)); });
  return { vehicleIds, dates, matrix, totalByVehicle };
}
function thu(dateStr) { const wd = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7']; return wd[new Date(dateStr).getDay()]; }

// XUẤT CHI TIẾT (từng dòng phân bổ - để đối soát)
async function exportDetail() {
  const data = await getSummaryData(); if (!data) return;
  if (data.rows.length === 0) { showToast('Không có dữ liệu', 'error'); return; }
  const out = data.rows.sort((a, b) => a.date < b.date ? -1 : 1).map(a => {
    const v = appState.vehicles.find(x => x.vehicleId === a.vehicleId);
    return { 'Ngày': a.date, 'Thứ': thu(a.date), 'Biển số': v ? v.licensePlate : a.vehicleId, 'Nhiên liệu': a.fuelType, 'Công trình': getProjectName(a.projectId), 'NCC': getSupplierName(a.supplierId), 'ĐM lý thuyết (L)': a.theoreticalNorm, 'Phân bổ (L)': a.allocatedQuantity, 'Nguồn hóa đơn / Ghi chú': a.sourceNote || '' };
  });
  exportToExcel(out, 'ChiTiet', `ChiTiet_PhanBo_${data.from}_${data.to}.xlsx`);
  showToast('Đã xuất file chi tiết', 'success');
}

// XUẤT TỔNG HỢP DỌC (giống mẫu: hàng = ngày, cột = xe; có dòng tiêu đề nhiên liệu + cột Thứ)
async function exportVertical() {
  const data = await getSummaryData(); if (!data) return;
  if (data.rows.length === 0) { showToast('Không có dữ liệu', 'error'); return; }
  const { vehicleIds, dates, matrix, totalByVehicle } = buildMatrix(data.rows);
  const aoa = [];
  // Hàng 1: tiêu đề cột = biển số
  aoa.push(['Ngày cấp', 'Thứ', ...vehicleIds.map(vid => { const v = appState.vehicles.find(x => x.vehicleId === vid); return v ? v.licensePlate : vid; })]);
  // Hàng 2: loại nhiên liệu
  aoa.push(['', '', ...vehicleIds.map(vid => { const v = appState.vehicles.find(x => x.vehicleId === vid); return v ? (v.fuelType === 'DO' ? 'Dầu' : 'Xăng') : ''; })]);
  // Các hàng ngày
  dates.forEach(d => { aoa.push([d, thu(d), ...vehicleIds.map(vid => matrix[vid][d] || 0)]); });
  // Hàng tổng
  aoa.push(['TỔNG CỘNG', '', ...vehicleIds.map(vid => totalByVehicle[vid])]);
  const ws = XLSX.utils.aoa_to_sheet(aoa), wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'TongHopDoc');
  XLSX.writeFile(wb, `TongHop_Doc_${data.from}_${data.to}.xlsx`);
  showToast('Đã xuất tổng hợp DỌC', 'success');
}

// XUẤT TỔNG HỢP NGANG (hàng = xe, cột = ngày; kiểu bảng chấm công)
async function exportHorizontal() {
  const data = await getSummaryData(); if (!data) return;
  if (data.rows.length === 0) { showToast('Không có dữ liệu', 'error'); return; }
  const { vehicleIds, dates, matrix, totalByVehicle } = buildMatrix(data.rows);
  const aoa = [];
  aoa.push(['Phương tiện', 'Nhiên liệu', ...dates.map(d => d.slice(8) + '/' + d.slice(5, 7)), 'TỔNG']);
  vehicleIds.forEach(vid => {
    const v = appState.vehicles.find(x => x.vehicleId === vid);
    aoa.push([v ? v.licensePlate : vid, v ? (v.fuelType === 'DO' ? 'Dầu' : 'Xăng') : '', ...dates.map(d => matrix[vid][d] || 0), totalByVehicle[vid]]);
  });
  // dòng tổng theo ngày
  const totalByDate = dates.map(d => round2(vehicleIds.reduce((s, vid) => s + (matrix[vid][d] || 0), 0)));
  const grand = round2(Object.values(totalByVehicle).reduce((s, x) => s + x, 0));
  aoa.push(['TỔNG CỘNG', '', ...totalByDate, grand]);
  const ws = XLSX.utils.aoa_to_sheet(aoa), wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'TongHopNgang');
  XLSX.writeFile(wb, `TongHop_Ngang_${data.from}_${data.to}.xlsx`);
  showToast('Đã xuất tổng hợp NGANG', 'success');
}

function updateLastBackupInfo() { const el = document.getElementById('last-backup-info'); if (!el) return; const last = localStorage.getItem('fams_last_backup'); el.textContent = last ? 'Lần sao lưu gần nhất: ' + new Date(last).toLocaleString('vi-VN') : 'Chưa có lần sao lưu nào.'; }

// XUẤT EXCEL (kèm cột note phân bổ)
function exportVehicles() { if (appState.vehicles.length === 0) { showToast('Không có dữ liệu', 'error'); return; } exportToExcel(appState.vehicles, 'PhuongTien', 'DanhSach_PhuongTien.xlsx'); }
function exportInvoices() { if (appState.invoices.length === 0) { showToast('Không có dữ liệu', 'error'); return; } exportToExcel(appState.invoices, 'HoaDon', 'HoaDon_' + appState.currentDate.slice(0, 7) + '.xlsx'); }
function exportAllocations() {
  if (appState.allocations.length === 0) { showToast('Chưa có phân bổ để xuất', 'error'); return; }
  const rows = appState.allocations.map(a => { const v = appState.vehicles.find(x => x.vehicleId === a.vehicleId); return { 'Biển số': v ? v.licensePlate : a.vehicleId, 'Ngày': a.date, 'Nhiên liệu': a.fuelType, 'Công trình': getProjectName(a.projectId), 'NCC': getSupplierName(a.supplierId), 'ĐM lý thuyết': a.theoreticalNorm, 'Phân bổ (L)': a.allocatedQuantity, 'Nguồn hóa đơn / Ghi chú': a.sourceNote || '' }; });
  exportToExcel(rows, 'PhanBo', 'PhanBo_' + appState.currentDate.slice(0, 7) + '.xlsx');
}

// BÁO CÁO / IN PHIẾU
function renderReportVehicleSelect() { const sel = document.getElementById('report-vehicle-select'); if (!sel) return; sel.innerHTML = appState.vehicles.map(v => `<option value="${v.vehicleId}">${v.licensePlate}</option>`).join(''); }
function printSingleSlip() { const vid = getVal('report-vehicle-select'); const al = appState.allocations.filter(a => a.vehicleId === vid); if (al.length === 0) { showToast('Xe này chưa có phân bổ', 'error'); return; } buildPrintArea(al); window.print(); }
function printAllSlips() {
  if (appState.allocations.length === 0) { showToast('Chưa có phân bổ để in. Hãy chạy phân bổ trước.', 'error'); return; }
  buildPrintArea(appState.allocations);
  window.print();
}
function exportSlipsExcel() {
  if (appState.allocations.length === 0) { showToast('Chưa có phân bổ để xuất', 'error'); return; }
  const numMap = buildSlipNumbers(appState.allocations);
  const sorted = [...appState.allocations].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    const va = appState.vehicles.find(x => x.vehicleId === a.vehicleId);
    const vb = appState.vehicles.find(x => x.vehicleId === b.vehicleId);
    return ((va ? va.priority : 999) || 999) - ((vb ? vb.priority : 999) || 999);
  });
  const rows = sorted.map(a => {
    const v = appState.vehicles.find(x => x.vehicleId === a.vehicleId);
    return {
      'Số phiếu': numMap[a.allocationId] || '',
      'Ngày cấp': a.date,
      'Thứ': thu(a.date),
      'Biển số xe': v ? v.licensePlate : a.vehicleId,
      'Nhà cung cấp': getSupplierName(a.supplierId),
      'Địa điểm nhận': a.location || '',
      'Loại nhiên liệu': a.fuelType === 'DO' ? 'Dầu' : (a.fuelType === 'A95' ? 'Xăng' : a.fuelType),
      'Số lượng (L)': a.allocatedQuantity,
      'Nội dung (công trình)': getProjectName(a.projectId)
    };
  });
  const totalQty = rows.reduce((s, r) => s + (r['Số lượng (L)'] || 0), 0);
  rows.push({ 'Số phiếu': '', 'Ngày cấp': '', 'Thứ': '', 'Biển số xe': '', 'Nhà cung cấp': '', 'Địa điểm nhận': '', 'Loại nhiên liệu': 'TỔNG CỘNG', 'Số lượng (L)': round2(totalQty), 'Nội dung (công trình)': '' });
  exportToExcel(rows, 'PhieuCap', 'DanhSach_PhieuCap_' + appState.currentDate.slice(0, 7) + '.xlsx');
  showToast('Đã xuất danh sách phiếu cấp cả tháng', 'success');
}
// Lấy ký hiệu viết tắt NCC: chữ đầu của 2 từ cuối trong tên. VD "DNTN TM KIM LONG" -> "KL"
function supplierCode(supplierId) {
  const name = getSupplierName(supplierId) || String(supplierId || 'XX');
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[words.length - 2][0] + words[words.length - 1][0]).toUpperCase();
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return 'XX';
}
// Sinh số phiếu ổn định theo NCC + tháng + STT (liên tục trong từng NCC theo thứ tự ngày -> xe)
// Trả về map: allocationId -> "KL/06/0001"
function buildSlipNumbers(allocations) {
  // sắp toàn bộ theo ngày rồi theo STT ưu tiên của xe để STT phiếu ổn định
  const sorted = [...allocations].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    const va = appState.vehicles.find(x => x.vehicleId === a.vehicleId);
    const vb = appState.vehicles.find(x => x.vehicleId === b.vehicleId);
    const pa = (va ? va.priority : 999) || 999, pb = (vb ? vb.priority : 999) || 999;
    if (pa !== pb) return pa - pb;
    return (a.vehicleId || '').localeCompare(b.vehicleId || '');
  });
  const counters = {}; // theo NCC
  const map = {};
  sorted.forEach(a => {
    const code = supplierCode(a.supplierId);
    const mm = a.date.slice(5, 7);
    const keyCounter = code + '|' + mm;
    counters[keyCounter] = (counters[keyCounter] || 0) + 1;
    map[a.allocationId] = `${code}/${mm}/${String(counters[keyCounter]).padStart(4, '0')}`;
  });
  return map;
}
function buildSlipLien(a, soPhieu, lienText) {
  const v = appState.vehicles.find(x => x.vehicleId === a.vehicleId);
  const location = a.location && a.location.trim() ? a.location : 'CHXD';
  const projectName = getProjectName(a.projectId);
  const fuelLabel = a.fuelType === 'DO' ? 'Dầu' : (a.fuelType === 'A95' ? 'Xăng' : a.fuelType);
  const d = new Date(a.date);
  const dateLine = `Ngày ${String(d.getDate()).padStart(2,'0')} tháng ${String(d.getMonth()+1).padStart(2,'0')} năm ${d.getFullYear()}`;
  const ncc = getSupplierName(a.supplierId);
  return `<div style="width:48.5%;border:1px solid #000;padding:8px 10px;font-size:11px;box-sizing:border-box;display:inline-block;vertical-align:top;margin:0 0.4%">
    <div style="font-weight:bold;font-size:10px">${COMPANY_INFO.company}</div>
    <div style="font-size:10px">Đơn vị: ${COMPANY_INFO.unit}</div>
    <div style="text-align:center;margin:5px 0"><div style="font-weight:bold;font-size:13px">PHIẾU CẤP NHIÊN LIỆU</div><div style="font-style:italic;font-size:9px">(${lienText})</div></div>
    <div style="text-align:right;color:#c00;font-weight:bold">Số: ${soPhieu}</div>
    <div style="margin-top:4px">Địa điểm nhận: ${location}</div>
    <div style="margin-top:2px">Nhà cung cấp: ${ncc}</div>
    <div style="margin-top:2px">Biển số xe: <b>${v ? v.licensePlate : a.vehicleId}</b></div>
    <div style="margin-top:2px">Loại hàng: ${fuelLabel}</div>
    <div style="margin-top:2px">Số lượng cấp:</div>
    <table style="width:100%;margin:2px 0;border-collapse:collapse">
      <tr><td style="padding:1px 0 1px 20px">1. Xăng</td><td style="text-align:right">${a.fuelType==='A95'?a.allocatedQuantity.toLocaleString('vi-VN'):''}</td><td style="width:30px">(lít)</td></tr>
      <tr><td style="padding:1px 0 1px 20px">2. Dầu</td><td style="text-align:right">${a.fuelType==='DO'?a.allocatedQuantity.toLocaleString('vi-VN'):''}</td><td>(lít)</td></tr>
      <tr><td style="padding:1px 0 1px 20px">3. Nhớt</td><td style="text-align:right"></td><td>(lít)</td></tr>
    </table>
    <div>Nội dung: ${projectName}</div>
    <div style="font-style:italic;font-size:9px;margin-top:2px">${COMPANY_INFO.note}</div>
    <div style="text-align:right;font-style:italic;margin-top:4px">${dateLine}</div>
    <div style="display:flex;justify-content:space-between;margin-top:4px;font-weight:bold"><span style="text-align:center;flex:1">Người nhận</span><span style="text-align:center;flex:1">Người cấp</span></div>
    <div style="height:55px"></div>
  </div>`;
}
function buildPrintArea(allocations) {
  const area = document.getElementById('print-area'); if (!area) return;
  // sắp theo ngày rồi STT xe để in theo thứ tự cấp phát
  const sorted = [...allocations].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    const va = appState.vehicles.find(x => x.vehicleId === a.vehicleId);
    const vb = appState.vehicles.find(x => x.vehicleId === b.vehicleId);
    return ((va ? va.priority : 999) || 999) - ((vb ? vb.priority : 999) || 999);
  });
  const numMap = buildSlipNumbers(allocations);
  let html = '';
  sorted.forEach((a, idx) => {
    const soPhieu = numMap[a.allocationId] || '';
    html += `<div style="margin-bottom:10px;page-break-inside:avoid">${buildSlipLien(a, soPhieu, 'Liên 1: Lưu')}${buildSlipLien(a, soPhieu, 'Liên 2: Giao người thực hiện')}</div>`;
    if ((idx + 1) % 3 === 0) html += '<div class="page-break"></div>'; // 3 phiếu / trang A4
  });
  area.innerHTML = html;
}

async function editAllocation(id, current) {
  const val = prompt('Nhập lượng nhiên liệu cấp thực tế (Lít):', current);
  if (val === null) return;
  const num = Number(val); if (isNaN(num) || num < 0) { showToast('Số không hợp lệ', 'error'); return; }
  try { await updateAllocationQty(id, num); await loadAllData(); appState.violations = await validateAllocations(appState.allocations);
 renderAll(); showToast('Đã cập nhật lượng cấp', 'success'); }
  catch (e) { showToast('Lỗi: ' + (e.message || e), 'error'); }
}

function generateAIDiary() { const out = document.getElementById('ai-diary-output'); if (!out) return; if (appState.allocations.length === 0) { out.innerHTML = '<p class="text-slate-500 text-sm">Chưa có phân bổ. Hãy chạy phân bổ trước.</p>'; return; } out.innerHTML = appState.allocations.map(a => { const v = appState.vehicles.find(x => x.vehicleId === a.vehicleId); const log = appState.operationLogs.find(l => l.vehicleId === a.vehicleId); return `<div class="p-4 bg-slate-900/80 border border-slate-800 rounded-lg text-sm text-slate-300">${generateSmartDiary(a, v, log)}</div>`; }).join(''); }

// XÁC NHẬN + TIỆN ÍCH
function showConfirm(msg, cb) { appState.confirmCallback = cb; setText('confirm-message', msg); showModal('confirm-dialog'); }
function hideConfirmDialog() { hideModal('confirm-dialog'); appState.confirmCallback = null; }
async function confirmAction() { const cb = appState.confirmCallback; hideConfirmDialog(); if (cb) await cb(); }
function defaultDateInMonth() {
  const today = new Date().toISOString().split('T')[0];
  return today.slice(0, 7) === appState.currentDate.slice(0, 7) ? today : appState.currentDate;
}
function getProjectName(id) { const p = appState.projects.find(x => x.projectId === id); return p ? p.projectName : (id || 'N/A'); }
function getSupplierName(id) { const s = appState.suppliers.find(x => x.supplierId === id); return s ? s.supplierName : (id || 'N/A'); }
function fillProjectSelect(id) { const s = document.getElementById(id); if (!s) return; s.innerHTML = '<option value="">-- Chọn công trình --</option>' + appState.projects.map(p => `<option value="${p.projectId}">${p.projectName}</option>`).join(''); }
function fillSupplierSelect(id) { const s = document.getElementById(id); if (!s) return; s.innerHTML = '<option value="">-- Chọn nhà cung cấp --</option>' + appState.suppliers.map(x => `<option value="${x.supplierId}">${x.supplierName}</option>`).join(''); }
function fillVehicleSelect(id) { const s = document.getElementById(id); if (!s) return; s.innerHTML = '<option value="">-- Chọn phương tiện --</option>' + appState.vehicles.map(v => `<option value="${v.vehicleId}">${v.licensePlate}</option>`).join(''); }
function setPager(table, html) { removePager(table); if (!html) return; const map = { vehicles: 'vehicles-table-body', invoices: 'invoices-table-body', logs: 'operation-logs-table-body', allocations: 'allocations-table-body' }; const tbody = document.getElementById(map[table]); if (!tbody) return; const card = tbody.closest('.rounded-xl'); if (!card) return; const div = document.createElement('div'); div.id = 'pager-' + table; div.innerHTML = html; card.appendChild(div); }
function removePager(table) { const p = document.getElementById('pager-' + table); if (p) p.remove(); }
function emptyRow(c, m) { return `<tr><td colspan="${c}" class="px-6 py-8 text-center text-slate-500">${m}</td></tr>`; }
function setText(id, v) { const el = document.getElementById(id); if (el) el.textContent = v; }
function setVal(id, v) { const el = document.getElementById(id); if (el) el.value = v; }
function getVal(id) { const el = document.getElementById(id); return el ? el.value : ''; }
function showModal(id) { const el = document.getElementById(id); if (el) el.classList.remove('hidden'); }
function hideModal(id) { const el = document.getElementById(id); if (el) el.classList.add('hidden'); }
function showLoading(s, t) { const ov = document.getElementById('loading-overlay'); if (!ov) return; if (t) setText('loading-text', t); ov.classList.toggle('hidden', !s); }
function showToast(msg, type) { const c = document.getElementById('toast-container'); if (!c) { alert(msg); return; } const colors = { success: 'border-emerald-500 text-emerald-300', error: 'border-rose-500 text-rose-300', info: 'border-amber-500 text-amber-300' }; const d = document.createElement('div'); d.className = `bg-slate-900 border ${colors[type] || colors.info} rounded-lg px-4 py-3 text-sm shadow-lg`; d.textContent = msg; c.appendChild(d); setTimeout(() => d.remove(), 4000); }
