/* ==========================================================================
   Job Application Tracker — Application Logic
   ========================================================================== */

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------
const STORAGE_KEY = 'job-applications';

function loadRecords() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.error('Failed to load records:', e);
    return [];
  }
}

function saveRecords(records) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  } catch (e) {
    console.error('Failed to save records:', e);
    showToast('保存失败，请检查浏览器存储空间', 'error');
  }
}

function generateId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback
  return 'id_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 9);
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let records = [];
let sortStack = []; // multi-column sort: [{field, direction}, ...]
let pendingDeleteId = null;

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const INTERVIEW_ROUND_MAP = {
  1: '一面', 2: '二面', 3: '三面', 4: '四面',
  5: '五面', 6: '六面', 7: '七面', 8: '八面', 9: '九面'
};

function formatDate(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '-';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatDateShort(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '-';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function getCategoryBadge(cat) {
  const map = { '实习': 'badge-intern', '秋招': 'badge-autumn', '春招': 'badge-spring', '日常': 'badge-daily' };
  return map[cat] || '';
}

function getStatusBadge(status) {
  const map = { '已投递': 'badge-submitted', '已笔试待面试': 'badge-exam', '面试中': 'badge-interview', '已收到offer': 'badge-offer' };
  return map[status] || '';
}

function getSourceBadge(source) {
  const map = { 'BOSS': 'badge-source-boss', '智联': 'badge-source-zhilian', '官网': 'badge-source-official' };
  return map[source] || 'badge-source-other';
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function cell(val) {
  return val ? escapeHtml(val) : '<span style="color:#ccc">-</span>';
}

// ---------------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------------
let toastTimer;

function showToast(msg, type) {
  const el = $('#toast');
  if (toastTimer) clearTimeout(toastTimer);
  el.textContent = msg;
  el.className = 'toast ' + (type || '') + ' show';
  toastTimer = setTimeout(() => { el.className = 'toast'; }, 2500);
}

// ---------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------
function getFilters() {
  return {
    search: $('#searchInput').value.trim().toLowerCase(),
    category: $('#filterCategory').value,
    status: $('#filterStatus').value,
    source: $('#filterSource').value,
    location: $('#filterLocation').value,
  };
}

function applyFilters(list) {
  const f = getFilters();
  return list.filter(r => {
    if (f.search && !r.company.toLowerCase().includes(f.search)) return false;
    if (f.category && r.category !== f.category) return false;
    if (f.status && r.status !== f.status) return false;
    if (f.source && r.source !== f.source) return false;
    if (f.location && r.location !== f.location) return false;
    return true;
  });
}

// ---------------------------------------------------------------------------
// Sorting — multi-column sort stack
// ---------------------------------------------------------------------------
function applySort(list) {
  if (sortStack.length === 0) return [...list];
  return [...list].sort((a, b) => {
    for (const { field, direction } of sortStack) {
      const dir = direction === 'asc' ? 1 : -1;
      let va = a[field];
      let vb = b[field];

      // Salary sort: numbers first (sorted by direction), 面议 in middle, empty last
      if (field === 'salary') {
        const aIsNum = va != null && va !== '' && va !== '面议' && !isNaN(parseFloat(va));
        const bIsNum = vb != null && vb !== '' && vb !== '面议' && !isNaN(parseFloat(vb));
        const aIsNeg = va === '面议';
        const bIsNeg = vb === '面议';
        const aEmpty = va == null || va === '';
        const bEmpty = vb == null || vb === '';

        if (aIsNum && bIsNum) {
          const diff = parseFloat(va) - parseFloat(vb);
          if (diff !== 0) return diff * dir;
          continue;
        }
        // Fixed order (direction only affects numbers): numbers → 面议 → empty
        if (aIsNum && !bIsNum) return -1;
        if (!aIsNum && bIsNum) return 1;
        if (aIsNeg && bEmpty) return -1;
        if (aEmpty && bIsNeg) return 1;
        continue;
      }

      // String sort — push empties to end
      const aEmpty = va == null || va === '';
      const bEmpty = vb == null || vb === '';
      if (aEmpty && bEmpty) continue;
      if (aEmpty) return 1;  // a to end
      if (bEmpty) return -1; // b to end

      va = String(va);
      vb = String(vb);
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
    }
    return 0;
  });
}

// Header click: cycle asc → desc → remove.
// Clicking a new column adds it to the sort stack (multi-column sort by click order).
function handleSortClick(field) {
  const idx = sortStack.findIndex(s => s.field === field);
  if (idx === -1) {
    sortStack.push({ field, direction: 'asc' });
  } else if (sortStack[idx].direction === 'asc') {
    sortStack[idx].direction = 'desc';
  } else {
    sortStack.splice(idx, 1);
  }
  renderAll();
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function renderStats() {
  const total = records.length;
  const cats = { '实习': 0, '秋招': 0, '春招': 0, '日常': 0 };
  const stats = { '已投递': 0, '已笔试待面试': 0, '面试中': 0, '已收到offer': 0 };
  records.forEach(r => {
    if (cats[r.category] !== undefined) cats[r.category]++;
    if (stats[r.status] !== undefined) stats[r.status]++;
  });
  $('#statTotal').textContent = total;
  $('#statIntern').textContent = cats['实习'];
  $('#statAutumn').textContent = cats['秋招'];
  $('#statSpring').textContent = cats['春招'];
  $('#statDaily').textContent = cats['日常'];
  $('#statSubmitted').textContent = stats['已投递'];
  $('#statInterview').textContent = stats['面试中'] + stats['已笔试待面试'];
  $('#statOffer').textContent = stats['已收到offer'];
}

function renderTable() {
  const filtered = applyFilters(records);
  const sorted = applySort(filtered);
  const tbody = $('#tableBody');

  if (sorted.length === 0) {
    const hasFilters = Object.values(getFilters()).some(v => v);
    tbody.innerHTML = `<tr class="empty-row"><td colspan="16">${hasFilters ? '没有匹配的记录' : '暂无记录，点击「新增记录」开始'}</td></tr>`;
  } else {
    tbody.innerHTML = sorted.map(r => `
      <tr>
        <td><strong>${escapeHtml(r.company)}</strong></td>
        <td><span class="badge ${getCategoryBadge(r.category)}">${escapeHtml(r.category)}</span></td>
        <td><span class="badge ${getStatusBadge(r.status)}">${escapeHtml(r.status)}${r.status === '面试中' && r.interviewRound ? ' ' + INTERVIEW_ROUND_MAP[r.interviewRound] : ''}</span></td>
        <td>${r.source ? `<span class="badge ${getSourceBadge(r.source)}">${escapeHtml(r.source)}</span>` : '<span style="color:#ccc">-</span>'}</td>
        <td>${r.status === '面试中' && r.interviewRound ? INTERVIEW_ROUND_MAP[r.interviewRound] : '<span style="color:#ccc">-</span>'}</td>
        <td>${cell(r.location)}</td>
        <td>${r.salary ? (r.salary === '面议' ? '面议' : escapeHtml(r.salary) + 'k') : '<span style="color:#ccc">-</span>'}</td>
        <td>${cell(r.internshipDuration)}</td>
        <td>${cell(r.dailyHours)}</td>
        <td>${cell(r.lunchBreak)}</td>
        <td>${cell(r.restDays)}</td>
        <td>${cell(r.overtime)}</td>
        <td>${cell(r.socialInsurance)}</td>
        <td><span title="${formatDate(r.createdAt)}">${formatDateShort(r.createdAt)}</span></td>
        <td><span title="${formatDate(r.updatedAt)}">${formatDateShort(r.updatedAt)}</span></td>
        <td>
          <div class="action-btns">
            <button class="btn btn-xs btn-edit" data-edit="${r.id}">编辑</button>
            <button class="btn btn-xs btn-delete" data-delete="${r.id}">删除</button>
          </div>
        </td>
      </tr>
    `).join('');
  }

  // Update result info
  const total = records.length;
  const showing = sorted.length;
  $('#resultInfo').textContent = total === showing
    ? `共 ${total} 条记录`
    : `显示 ${showing} / ${total} 条记录`;

  // Update sort header indicators from sortStack
  $$('.data-table th').forEach(th => {
    const si = th.querySelector('.sort-icon');
    th.classList.remove('sorted-asc', 'sorted-desc');
    if (si) si.innerHTML = '';
  });
  sortStack.forEach((s, i) => {
    const th = document.querySelector(`.data-table th[data-field="${s.field}"]`);
    if (th) {
      th.classList.add(s.direction === 'asc' ? 'sorted-asc' : 'sorted-desc');
    }
  });

  // Re-bind action buttons for rows
  bindRowActions();
}

function renderCards() {
  const filtered = applyFilters(records);
  const sorted = applySort(filtered);
  const container = $('#cardList');

  if (sorted.length === 0) {
    const hasFilters = Object.values(getFilters()).some(v => v);
    container.innerHTML = `<div class="card" style="text-align:center;color:var(--text-muted);padding:32px">${hasFilters ? '没有匹配的记录' : '暂无记录，点击「新增记录」开始'}</div>`;
    return;
  }

  container.innerHTML = sorted.map(r => `
    <div class="card">
      <div class="card-header">
        <span class="card-company">${escapeHtml(r.company)}</span>
        <span class="badge ${getStatusBadge(r.status)}">${escapeHtml(r.status)}${r.status === '面试中' && r.interviewRound ? ' ' + INTERVIEW_ROUND_MAP[r.interviewRound] : ''}</span>
      </div>
      <div class="card-fields">
        <div class="card-field"><span class="card-label">分类：</span><span class="card-value"><span class="badge ${getCategoryBadge(r.category)}">${escapeHtml(r.category)}</span></span></div>
        ${r.source ? `<div class="card-field"><span class="card-label">投递源：</span><span class="card-value"><span class="badge ${getSourceBadge(r.source)}">${escapeHtml(r.source)}</span></span></div>` : '<div></div>'}
        ${r.location ? `<div class="card-field"><span class="card-label">地点：</span><span class="card-value">${escapeHtml(r.location)}</span></div>` : '<div></div>'}
        ${r.salary ? `<div class="card-field"><span class="card-label">薪资：</span><span class="card-value">${r.salary === '面议' ? '面议' : escapeHtml(r.salary) + 'k'}</span></div>` : '<div></div>'}
        ${r.internshipDuration ? `<div class="card-field"><span class="card-label">实习时长：</span><span class="card-value">${escapeHtml(r.internshipDuration)}</span></div>` : '<div></div>'}
        ${r.dailyHours ? `<div class="card-field"><span class="card-label">每天工时：</span><span class="card-value">${escapeHtml(r.dailyHours)}</span></div>` : '<div></div>'}
        ${r.lunchBreak ? `<div class="card-field"><span class="card-label">午休：</span><span class="card-value">${escapeHtml(r.lunchBreak)}</span></div>` : '<div></div>'}
        ${r.restDays ? `<div class="card-field"><span class="card-label">月休：</span><span class="card-value">${escapeHtml(r.restDays)}</span></div>` : '<div></div>'}
        ${r.overtime ? `<div class="card-field"><span class="card-label">加班：</span><span class="card-value">${escapeHtml(r.overtime)}</span></div>` : '<div></div>'}
        ${r.socialInsurance ? `<div class="card-field"><span class="card-label">社保：</span><span class="card-value">${escapeHtml(r.socialInsurance)}</span></div>` : '<div></div>'}
        <div class="card-field"><span class="card-label">登记：</span><span class="card-value">${formatDateShort(r.createdAt)}</span></div>
        <div class="card-field"><span class="card-label">修改：</span><span class="card-value">${formatDateShort(r.updatedAt)}</span></div>
      </div>
      <div class="card-actions">
        <button class="btn btn-xs btn-edit" data-edit="${r.id}">编辑</button>
        <button class="btn btn-xs btn-delete" data-delete="${r.id}">删除</button>
      </div>
    </div>
  `).join('');

  bindRowActions();
}

function renderLocationFilter() {
  const locations = [...new Set(records.map(r => r.location).filter(Boolean))].sort();
  const sel = $('#filterLocation');
  sel.innerHTML = '<option value="">全部地点</option>' +
    locations.map(l => `<option value="${escapeHtml(l)}">${escapeHtml(l)}</option>`).join('');
  // Restore previous selection if still valid
  const prev = sel.dataset.prev;
  if (prev && locations.includes(prev)) sel.value = prev;
  else sel.dataset.prev = '';
}

function renderSortBar() {
  const fields = [
    { key: 'company', label: '公司' },
    { key: 'category', label: '分类' },
    { key: 'status', label: '状态' },
    { key: 'source', label: '投递源' },
    { key: 'salary', label: '薪资' },
    { key: 'location', label: '地点' },
    { key: 'internshipDuration', label: '实习' },
    { key: 'restDays', label: '月休' },
    { key: 'createdAt', label: '登记' },
    { key: 'updatedAt', label: '修改' },
  ];

  const container = $('#sortBar');
  container.innerHTML = '<span class="sort-bar-label">排序：</span>' +
    fields.map(f => {
      const s = sortStack.find(s => s.field === f.key);
      let cls = 'sort-pill';
      let label = f.label;
      if (s) {
        cls += s.direction === 'asc' ? ' active-asc' : ' active-desc';
        label += s.direction === 'asc' ? ' ↑' : ' ↓';
      }
      return `<button class="${cls}" data-sort="${f.key}">${label}</button>`;
    }).join('');

  // Bind click events
  container.querySelectorAll('.sort-pill').forEach(btn => {
    btn.addEventListener('click', () => handleSortClick(btn.dataset.sort));
  });
}

function renderAll() {
  renderStats();
  renderTable();
  renderCards();
  renderSortBar();
  renderLocationFilter();
}

// ---------------------------------------------------------------------------
// Row action binding (event delegation doesn't work well with dynamic innerHTML,
// so we bind after each render)
// ---------------------------------------------------------------------------
function bindRowActions() {
  $$('[data-edit]').forEach(btn => {
    btn.addEventListener('click', () => openEditModal(btn.dataset.edit));
  });
  $$('[data-delete]').forEach(btn => {
    btn.addEventListener('click', () => openDeleteConfirm(btn.dataset.delete));
  });
}

// ---------------------------------------------------------------------------
// CRUD — Add / Edit
// ---------------------------------------------------------------------------
function openAddModal() {
  $('#modalTitle').textContent = '新增记录';
  $('#recordForm').reset();
  $('#recordId').value = '';
  $('#interviewRoundGroup').style.display = 'none';
  hideAllCustomInputs();
  $('#formModal').classList.add('active');
  $('#company').focus();
}

function openEditModal(id) {
  const r = records.find(r => r.id === id);
  if (!r) return;

  $('#modalTitle').textContent = '编辑记录';
  $('#recordId').value = r.id;
  $('#company').value = r.company || '';
  $('#category').value = r.category || '';
  $('#status').value = r.status || '';
  $('#location').value = r.location || '';
  $('#salary').value = r.salary || '';

  // Reset custom fields
  hideAllCustomInputs();

  // Handle fields with custom option
  setSelectOrCustom('source', r.source);
  setSelectOrCustom('internshipDuration', r.internshipDuration);
  setSelectOrCustom('dailyHours', r.dailyHours);
  setSelectOrCustom('lunchBreak', r.lunchBreak);
  setSelectOrCustom('restDays', r.restDays);

  $('#overtime').value = r.overtime || '';
  $('#socialInsurance').value = r.socialInsurance || '';

  // Interview round
  if (r.status === '面试中') {
    $('#interviewRoundGroup').style.display = '';
    $('#interviewRound').value = r.interviewRound || 1;
  } else {
    $('#interviewRoundGroup').style.display = 'none';
  }

  $('#formModal').classList.add('active');
  $('#company').focus();
}

function setSelectOrCustom(fieldId, value) {
  const sel = $('#' + fieldId);
  const customInput = $('#' + fieldId + 'Custom');
  if (!value) {
    sel.value = '';
    return;
  }
  // Check if value matches a preset option
  const options = [...sel.options].map(o => o.value);
  if (options.includes(value)) {
    sel.value = value;
  } else {
    sel.value = '其他';
    if (customInput) {
      customInput.style.display = '';
      customInput.value = value;
    }
  }
}

function hideAllCustomInputs() {
  ['sourceCustom', 'internshipDurationCustom', 'dailyHoursCustom', 'lunchBreakCustom', 'restDaysCustom'].forEach(id => {
    const el = $(`#${id}`);
    if (el) { el.style.display = 'none'; el.value = ''; }
  });
}

function getCustomValue(selectId) {
  const sel = $(`#${selectId}`);
  if (sel.value === '其他') {
    const custom = $(`#${selectId}Custom`);
    return custom ? custom.value.trim() : '';
  }
  return sel.value;
}

function closeFormModal() {
  $('#formModal').classList.remove('active');
}

function saveRecord(e) {
  e.preventDefault();

  const company = $('#company').value.trim();
  const category = $('#category').value;
  const status = $('#status').value;

  if (!company || !category || !status) {
    showToast('请填写公司名称、投递分类和投递状态', 'error');
    return;
  }

  const id = $('#recordId').value;

  // Check duplicate company name (case-insensitive)
  const duplicate = records.find(r => r.company.toLowerCase() === company.toLowerCase() && r.id !== id);
  if (duplicate) {
    showToast(`公司「${company}」已存在，不能重复添加`, 'error');
    return;
  }
  const now = new Date().toISOString();

  const data = {
    id: id || generateId(),
    company,
    category,
    status,
    interviewRound: status === '面试中' ? parseInt($('#interviewRound').value) || 1 : null,
    source: getCustomValue('source'),
    location: $('#location').value,
    salary: $('#salary').value.trim(),
    internshipDuration: getCustomValue('internshipDuration'),
    dailyHours: getCustomValue('dailyHours'),
    lunchBreak: getCustomValue('lunchBreak'),
    restDays: getCustomValue('restDays'),
    overtime: $('#overtime').value.trim(),
    socialInsurance: $('#socialInsurance').value.trim(),
    updatedAt: now,
  };

  if (id) {
    // Editing — preserve createdAt
    const existing = records.find(r => r.id === id);
    if (existing) {
      data.createdAt = existing.createdAt;
    } else {
      data.createdAt = now;
    }
  } else {
    data.createdAt = now;
  }

  if (id) {
    const idx = records.findIndex(r => r.id === id);
    if (idx !== -1) records[idx] = data;
    showToast('记录已更新', 'success');
  } else {
    records.push(data);
    showToast('记录已添加', 'success');
  }

  saveRecords(records);
  closeFormModal();
  renderAll();
}

// ---------------------------------------------------------------------------
// CRUD — Delete
// ---------------------------------------------------------------------------
function openDeleteConfirm(id) {
  const r = records.find(r => r.id === id);
  if (!r) return;
  pendingDeleteId = id;
  $('#confirmCompany').textContent = r.company;
  $('#confirmModal').classList.add('active');
}

function closeConfirmModal() {
  $('#confirmModal').classList.remove('active');
  pendingDeleteId = null;
}

function confirmDelete() {
  if (!pendingDeleteId) return;
  records = records.filter(r => r.id !== pendingDeleteId);
  saveRecords(records);
  closeConfirmModal();
  renderAll();
  showToast('记录已删除', 'success');
}

// ---------------------------------------------------------------------------
// Export — CSV (Excel)
// ---------------------------------------------------------------------------
function exportCSV() {
  const filtered = applyFilters(records);
  const sorted = applySort(filtered);

  if (sorted.length === 0) {
    showToast('没有数据可导出', 'error');
    return;
  }

  const headers = [
    '公司名称', '投递分类', '投递状态', '投递源', '面试阶段', '工作地点',
    '大概薪资', '实习时长', '每天工作时长', '午休时长', '月休情况',
    '加班情况', '社保情况', '登记日期', '修改日期'
  ];

  const rows = sorted.map(r => [
    r.company,
    r.category,
    r.status + (r.status === '面试中' && r.interviewRound ? ' ' + INTERVIEW_ROUND_MAP[r.interviewRound] : ''),
    r.source || '',
    r.status === '面试中' && r.interviewRound ? INTERVIEW_ROUND_MAP[r.interviewRound] : '',
    r.location || '',
    r.salary ? (r.salary === '面议' ? '面议' : r.salary + 'k') : '',
    r.internshipDuration || '',
    r.dailyHours || '',
    r.lunchBreak || '',
    r.restDays || '',
    r.overtime || '',
    r.socialInsurance || '',
    formatDateShort(r.createdAt),
    formatDateShort(r.updatedAt)
  ]);

  const escCsv = (val) => {
    const s = String(val);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  };

  const csv = '﻿' + headers.map(escCsv).join(',') + '\n' +
    rows.map(row => row.map(escCsv).join(',')).join('\n');

  downloadBlob(csv, '求职投递记录.csv', 'text/csv;charset=utf-8');
  showToast('CSV 文件已导出', 'success');
}

// ---------------------------------------------------------------------------
// Export — PDF (via browser print)
// ---------------------------------------------------------------------------
function exportPDF() {
  // Set print date attribute for the print CSS
  const now = new Date();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  document.body.setAttribute('data-print-date', dateStr);
  window.print();
}

// ---------------------------------------------------------------------------
// Export — Backup JSON
// ---------------------------------------------------------------------------
function exportBackup() {
  if (records.length === 0) {
    showToast('没有数据可备份', 'error');
    return;
  }
  const now = new Date();
  const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  const json = JSON.stringify(records, null, 2);
  downloadBlob(json, `求职投递备份_${dateStr}.json`, 'application/json');
  showToast('备份文件已导出', 'success');
}

// ---------------------------------------------------------------------------
// Import — Restore JSON
// ---------------------------------------------------------------------------
function importBackup() {
  const fileInput = $('#restoreFileInput');
  fileInput.value = '';
  fileInput.click();
}

function handleRestoreFile(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(ev) {
    try {
      const data = JSON.parse(ev.target.result);
      if (!Array.isArray(data)) throw new Error('格式错误');
      // Basic validation
      for (const item of data) {
        if (!item.company || !item.category || !item.status) {
          throw new Error('数据格式不完整，缺少必填字段');
        }
      }
      const count = data.length;
      const confirmed = confirm(`即将导入 ${count} 条记录。\n\n选择"确定"将覆盖当前全部 ${records.length} 条记录，此操作不可撤销。\n\n确定要继续吗？`);
      if (!confirmed) return;

      records = data;
      saveRecords(records);
      renderAll();
      showToast(`成功导入 ${count} 条记录`, 'success');
    } catch (err) {
      showToast('导入失败：文件格式不正确', 'error');
      console.error('Import error:', err);
    }
  };
  reader.readAsText(file);
  e.target.value = '';
}

// ---------------------------------------------------------------------------
// Reset to defaults
// ---------------------------------------------------------------------------
function resetDefaults() {
  // Reset search
  $('#searchInput').value = '';
  // Reset filter selects
  $('#filterCategory').value = '';
  $('#filterStatus').value = '';
  $('#filterSource').value = '';
  $('#filterLocation').value = '';
  $('#filterLocation').dataset.prev = '';
  // Reset sort to default
  sortStack = [];
  renderAll();
  showToast('已恢复默认设置', 'success');
}

// ---------------------------------------------------------------------------
// Utility: Download blob
// ---------------------------------------------------------------------------
function downloadBlob(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Event binding — main controls
// ---------------------------------------------------------------------------
function bindEvents() {
  // Search input — debounced
  let searchTimer;
  $('#searchInput').addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(renderAll, 200);
  });

  // Filter selects
  ['filterCategory', 'filterStatus', 'filterSource', 'filterLocation'].forEach(id => {
    $('#' + id).addEventListener('change', () => {
      // Remember location filter selection
      if (id === 'filterLocation') {
        $('#' + id).dataset.prev = $('#' + id).value;
      }
      renderAll();
    });
  });

  // Table header sort clicks — cycle asc → desc → remove; clicking new column adds to stack
  $('#dataTable').addEventListener('click', (e) => {
    const th = e.target.closest('th.sortable');
    if (!th) return;
    handleSortClick(th.dataset.field);
  });

  // Toolbar buttons
  $('#btnAdd').addEventListener('click', openAddModal);
  $('#btnExportCSV').addEventListener('click', exportCSV);
  $('#btnExportPDF').addEventListener('click', exportPDF);
  $('#btnBackup').addEventListener('click', exportBackup);
  $('#btnRestore').addEventListener('click', importBackup);
  $('#btnReset').addEventListener('click', resetDefaults);
  $('#restoreFileInput').addEventListener('change', handleRestoreFile);

  // Modal close buttons
  $('#btnModalClose').addEventListener('click', closeFormModal);
  $('#btnCancel').addEventListener('click', closeFormModal);
  $('#formModal').addEventListener('click', (e) => {
    if (e.target === $('#formModal')) closeFormModal();
  });

  // Confirm modal
  $('#btnConfirmClose').addEventListener('click', closeConfirmModal);
  $('#btnConfirmCancel').addEventListener('click', closeConfirmModal);
  $('#btnConfirmDelete').addEventListener('click', confirmDelete);
  $('#confirmModal').addEventListener('click', (e) => {
    if (e.target === $('#confirmModal')) closeConfirmModal();
  });

  // Form submit
  $('#recordForm').addEventListener('submit', saveRecord);

  // Status change → show/hide interview round
  $('#status').addEventListener('change', () => {
    $('#interviewRoundGroup').style.display = $('#status').value === '面试中' ? '' : 'none';
  });

  // Custom input toggles
  ['source', 'internshipDuration', 'dailyHours', 'lunchBreak', 'restDays'].forEach(field => {
    $('#' + field).addEventListener('change', () => {
      const customEl = $('#' + field + 'Custom');
      if (customEl) {
        customEl.style.display = $('#' + field).value === '其他' ? '' : 'none';
        if ($('#' + field).value !== '其他') customEl.value = '';
      }
    });
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    // Escape to close modals
    if (e.key === 'Escape') {
      if ($('#formModal').classList.contains('active')) closeFormModal();
      else if ($('#confirmModal').classList.contains('active')) closeConfirmModal();
    }
    // Ctrl+N to add new record
    if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
      e.preventDefault();
      openAddModal();
    }
  });
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
function init() {
  records = loadRecords();
  bindEvents();
  renderAll();
}

// Kick off when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
