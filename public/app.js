// app.js — สำนัก: ทำเนียบสมาชิก + เช็คชื่อรายวัน

const RANKS = ['เจ้าสำนัก', 'รองเจ้าสำนัก', 'ผู้อาวุโส', 'เอลิต', 'สมาชิก'];
const GATE_PASSWORD = 'admin123'; // ไม่ใช่ระบบล็อกอิน แค่ด่านกรอกรหัสผ่านฝั่ง client ตามที่ขอ

let allMembers = [];
let sessionUnlocked = false;
let editingId = null;
let deletingId = null;

// ---------------- tabs ----------------
document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => { t.classList.remove('active'); t.setAttribute('aria-selected', 'false'); });
    document.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'));
    tab.classList.add('active');
    tab.setAttribute('aria-selected', 'true');
    document.getElementById(`panel-${tab.dataset.tab}`).classList.add('active');
  });
});

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ---------------- members / overview ----------------
async function loadMembers() {
  try {
    const res = await fetch('/api/members');
    if (!res.ok) throw new Error('โหลดข้อมูลไม่สำเร็จ');
    allMembers = await res.json();
  } catch (err) {
    allMembers = [];
    console.error(err);
  }
  renderOverview();
  renderTable();
  document.getElementById('checkinTotal').textContent = allMembers.length;
  if (sessionUnlocked) loadCheckins();
}

function renderOverview() {
  const empty = document.getElementById('overviewEmpty');
  const stat = document.getElementById('overviewStat');
  const tableCard = document.getElementById('overviewTableCard');

  if (allMembers.length === 0) {
    stat.innerHTML = '';
    empty.hidden = false;
    tableCard.hidden = true;
    return;
  }
  empty.hidden = true;
  tableCard.hidden = false;
  stat.innerHTML = `<span class="stat-pill">ทั้งหมด <b>${allMembers.length}</b> คน</span>`;

  loadOverviewReport();
}

// แสดงตารางเช็คชื่อสัปดาห์นี้ในหน้าภาพรวม (รูปแบบเดียวกับหน้า "รายงาน")
async function loadOverviewReport() {
  const titleEl = document.getElementById('overviewTableTitle');
  const headEl = document.getElementById('overviewHead');
  const bodyEl = document.getElementById('overviewBody');

  function renderRosterOnly() {
    titleEl.textContent = 'ทำเนียบสมาชิก';
    headEl.innerHTML = '<th>รายชื่อสมาชิก</th><th>ตำแหน่ง</th>';
    bodyEl.innerHTML = allMembers.map((m) => `
      <tr>
        <td>${escapeHtml(m.name)}</td>
        <td>${escapeHtml(m.rank)}</td>
      </tr>
    `).join('');
  }

  const today = new Date();
  const monday = mondayOf(today);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const start = toISODate(monday);
  const end = toISODate(sunday);

  try {
    const res = await fetch(`/api/report?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'โหลดข้อมูลไม่สำเร็จ');

    const week = data.weeks[0];
    if (!week) {
      renderRosterOnly();
      return;
    }

    titleEl.textContent = `เช็คชื่อสัปดาห์นี้ (${week.weekStart} ถึง ${week.weekEnd})`;
    headEl.innerHTML = `
      <th>รายชื่อสมาชิก</th>
      <th>ตำแหน่ง</th>
      ${week.days.map((d) => `<th class="center">วัน${escapeHtml(d.dayName)}</th>`).join('')}
      <th class="center">รวม</th>
    `;
    bodyEl.innerHTML = week.rows.map((r) => {
      const dayCells = week.days.map((d) => {
        const v = r.byDate[d.date];
        return `<td class="center ${v === 1 ? 'cell-yes' : 'cell-no'}">${v}</td>`;
      }).join('');
      return `
        <tr>
          <td>${escapeHtml(r.name)}</td>
          <td>${escapeHtml(r.rank)}</td>
          ${dayCells}
          <td class="center cell-total">${r.total}</td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.error(err);
    renderRosterOnly();
  }
}

// ---------------- gate (หน้า 2 และ 3 ใช้รหัสร่วมกัน) ----------------
function initRankSelects() {
  ['addRank', 'editRank'].forEach((id) => {
    const sel = document.getElementById(id);
    sel.innerHTML = RANKS.map((r) => `<option value="${r}">${r}</option>`).join('');
  });
}
initRankSelects();

document.querySelectorAll('.gate').forEach((gateEl) => {
  const input = gateEl.querySelector('.gatePassword');
  const err = gateEl.querySelector('.gateError');
  const submitBtn = gateEl.querySelector('.gateSubmit');

  function tryUnlock() {
    if (input.value === GATE_PASSWORD) {
      unlockAll();
    } else {
      err.hidden = false;
      input.value = '';
      input.focus();
    }
  }

  submitBtn.addEventListener('click', tryUnlock);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') tryUnlock();
  });
});

function unlockAll() {
  sessionUnlocked = true;
  document.querySelectorAll('.gate').forEach((g) => { g.hidden = true; });
  document.getElementById('checkinContent').hidden = false;
  document.getElementById('manageContent').hidden = false;
  document.getElementById('reportContent').hidden = false;

  const checkinDate = document.getElementById('checkinDate');
  if (!checkinDate.value) checkinDate.valueAsDate = new Date();
  loadCheckins();

  initReportDefaults();
}

// ---------------- หน้า 2: เช็คชื่อ ----------------
document.getElementById('checkinDate').addEventListener('change', loadCheckins);

async function loadCheckins() {
  const date = document.getElementById('checkinDate').value;
  if (!date) return;
  try {
    const res = await fetch(`/api/checkins?date=${encodeURIComponent(date)}`);
    if (!res.ok) throw new Error('โหลดข้อมูลไม่สำเร็จ');
    const rows = await res.json();
    renderCheckedList(rows);
  } catch (err) {
    console.error(err);
  }
}

function renderCheckedList(rows) {
  const list = document.getElementById('checkedList');
  const empty = document.getElementById('checkedEmpty');
  document.getElementById('checkinCount').textContent = rows.length;
  document.getElementById('checkinTotal').textContent = allMembers.length;

  if (rows.length === 0) {
    list.innerHTML = '';
    empty.hidden = false;
    return;
  }
  empty.hidden = true;
  list.innerHTML = rows.map((r) => `
    <span class="checked-chip" data-id="${r.id}">
      ${escapeHtml(r.name)} <span class="rank-tag">${escapeHtml(r.rank)}</span>
      <button title="ยกเลิกเช็คชื่อ">✕</button>
    </span>
  `).join('');

  list.querySelectorAll('.checked-chip').forEach((chip) => {
    chip.querySelector('button').addEventListener('click', async () => {
      try {
        const res = await fetch(`/api/checkins/${chip.dataset.id}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('ยกเลิกไม่สำเร็จ');
        await loadCheckins();
      } catch (err) {
        alert(err.message);
      }
    });
  });
}

document.getElementById('checkinSubmit').addEventListener('click', async () => {
  const date = document.getElementById('checkinDate').value;
  const namesRaw = document.getElementById('checkinNames').value;
  const names = namesRaw.split('\n').map((n) => n.trim()).filter(Boolean);
  const status = document.getElementById('checkinStatus');

  if (!date || names.length === 0) {
    status.textContent = 'กรุณาเลือกวันที่และกรอกรายชื่ออย่างน้อย 1 คน';
    return;
  }

  status.textContent = 'กำลังเช็คชื่อ...';
  try {
    const res = await fetch('/api/checkins', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date, names }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'เช็คชื่อไม่สำเร็จ');
    let msg = `เช็คแล้ว ${data.matched} คน`;
    if (data.notFound && data.notFound.length > 0) {
      msg += ` (ไม่พบในทำเนียบ ${data.notFound.length} คน: ${data.notFound.join(', ')})`;
    }
    status.textContent = msg;
    document.getElementById('checkinNames').value = '';
    await loadCheckins();
  } catch (err) {
    status.textContent = err.message;
  }
});

// ---------------- หน้า 3: จัดการสมาชิก — เพิ่มแบบกลุ่ม ----------------
document.getElementById('addSubmit').addEventListener('click', async () => {
  const rank = document.getElementById('addRank').value;
  const namesRaw = document.getElementById('addNames').value;
  const names = namesRaw.split('\n').map((n) => n.trim()).filter(Boolean);
  const status = document.getElementById('addStatus');

  if (names.length === 0) {
    status.textContent = 'กรุณากรอกรายชื่ออย่างน้อย 1 คน';
    return;
  }

  status.textContent = 'กำลังบันทึก...';
  try {
    const res = await fetch('/api/members', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rank, names }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'บันทึกไม่สำเร็จ');
    status.textContent = `บันทึกแล้ว ${data.inserted} คน`;
    document.getElementById('addNames').value = '';
    await loadMembers();
  } catch (err) {
    status.textContent = err.message;
  }
});

// ---------------- ตารางสมาชิกทั้งหมด ----------------
function renderTable() {
  const tbody = document.getElementById('dataTableBody');
  if (allMembers.length === 0) {
    tbody.innerHTML = `<tr><td colspan="3" style="color:var(--text-faint);">ยังไม่มีสมาชิกในระบบ</td></tr>`;
    return;
  }
  tbody.innerHTML = allMembers.map((m) => `
    <tr data-id="${m.id}">
      <td>${escapeHtml(m.rank)}</td>
      <td>${escapeHtml(m.name)}</td>
      <td>
        <div class="row-actions">
          <button class="edit">แก้ไข</button>
          <button class="del">ลบ</button>
        </div>
      </td>
    </tr>
  `).join('');

  tbody.querySelectorAll('tr').forEach((tr) => {
    const id = Number(tr.dataset.id);
    tr.querySelector('.edit').addEventListener('click', () => openEdit(id));
    tr.querySelector('.del').addEventListener('click', () => openDelete(id));
  });
}

document.getElementById('refreshBtn').addEventListener('click', loadMembers);

// ---------------- edit modal ----------------
function openEdit(id) {
  const rec = allMembers.find((m) => m.id === id);
  if (!rec) return;
  editingId = id;
  document.getElementById('editRank').value = rec.rank;
  document.getElementById('editName').value = rec.name;
  document.getElementById('editModal').hidden = false;
}

document.getElementById('editCancel').addEventListener('click', () => {
  document.getElementById('editModal').hidden = true;
  editingId = null;
});

document.getElementById('editSave').addEventListener('click', async () => {
  if (editingId == null) return;
  const rank = document.getElementById('editRank').value;
  const name = document.getElementById('editName').value.trim();
  if (!name) return;

  try {
    const res = await fetch(`/api/members/${editingId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, rank }),
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'แก้ไขไม่สำเร็จ');
    }
    document.getElementById('editModal').hidden = true;
    editingId = null;
    await loadMembers();
  } catch (err) {
    alert(err.message);
  }
});

// ---------------- delete modal ----------------
function openDelete(id) {
  const rec = allMembers.find((m) => m.id === id);
  if (!rec) return;
  deletingId = id;
  document.getElementById('deleteName').textContent = `${rec.name} (${rec.rank})`;
  document.getElementById('deleteModal').hidden = false;
}

document.getElementById('deleteCancel').addEventListener('click', () => {
  document.getElementById('deleteModal').hidden = true;
  deletingId = null;
});

document.getElementById('deleteConfirm').addEventListener('click', async () => {
  if (deletingId == null) return;
  try {
    const res = await fetch(`/api/members/${deletingId}`, { method: 'DELETE' });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'ลบไม่สำเร็จ');
    }
    document.getElementById('deleteModal').hidden = true;
    deletingId = null;
    await loadMembers();
  } catch (err) {
    alert(err.message);
  }
});

// ---------------- หน้า 4: รายงาน ----------------

function toISODate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function mondayOf(date) {
  const d = new Date(date);
  const day = d.getDay(); // 0=อาทิตย์..6=เสาร์
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

function initReportDefaults() {
  const startInput = document.getElementById('reportStart');
  const endInput = document.getElementById('reportEnd');
  if (startInput.value && endInput.value) return; // ไม่ทับค่าที่ผู้ใช้ตั้งไว้แล้ว
  const today = new Date();
  const monday = mondayOf(today);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  startInput.value = toISODate(monday);
  endInput.value = toISODate(sunday);
}

document.querySelectorAll('.quick-range').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const startInput = document.getElementById('reportStart');
    const endInput = document.getElementById('reportEnd');
    const today = new Date();
    const range = btn.dataset.range;

    if (range === 'thisWeek') {
      const monday = mondayOf(today);
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      startInput.value = toISODate(monday);
      endInput.value = toISODate(sunday);
    } else if (range === 'lastWeek') {
      const monday = mondayOf(today);
      monday.setDate(monday.getDate() - 7);
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      startInput.value = toISODate(monday);
      endInput.value = toISODate(sunday);
    } else if (range === 'thisMonth') {
      const first = new Date(today.getFullYear(), today.getMonth(), 1);
      const last = new Date(today.getFullYear(), today.getMonth() + 1, 0);
      startInput.value = toISODate(first);
      endInput.value = toISODate(last);
    } else if (range === 'all') {
      // ดึงตั้งแต่สมาชิกคนแรกถูกเพิ่ม (ประมาณ 1 ปีย้อนหลังถ้าไม่มีข้อมูล) ถึงวันนี้
      const oneYearAgo = new Date(today);
      oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
      startInput.value = toISODate(oneYearAgo);
      endInput.value = toISODate(today);
    }
    await loadReport();
  });
});

document.getElementById('reportPreview').addEventListener('click', loadReport);

async function loadReport() {
  const start = document.getElementById('reportStart').value;
  const end = document.getElementById('reportEnd').value;
  const status = document.getElementById('reportStatus');
  const weeksBox = document.getElementById('reportWeeks');
  const emptyBox = document.getElementById('reportEmpty');
  const summaryCard = document.getElementById('reportSummaryCard');

  if (!start || !end) {
    status.textContent = 'กรุณาเลือกช่วงวันที่';
    return;
  }
  if (start > end) {
    status.textContent = 'วันที่เริ่มต้องไม่เกินวันที่สิ้นสุด';
    return;
  }

  status.textContent = 'กำลังโหลดรายงาน...';
  weeksBox.innerHTML = '';
  summaryCard.hidden = true;
  emptyBox.hidden = true;

  try {
    const res = await fetch(`/api/report?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'โหลดรายงานไม่สำเร็จ');

    status.textContent = '';

    if (data.weeks.length === 0) {
      emptyBox.hidden = false;
      return;
    }

    weeksBox.innerHTML = data.weeks.map(renderWeekBlock).join('');
    renderSummaryTable(data.summary);
    summaryCard.hidden = false;
  } catch (err) {
    status.textContent = err.message;
  }
}

function renderWeekBlock(week) {
  const dayHeaders = week.days.map((d) => `<th class="center">วัน${escapeHtml(d.dayName)}</th>`).join('');
  const rows = week.rows.map((r) => {
    const dayCells = week.days.map((d) => {
      const v = r.byDate[d.date];
      return `<td class="center ${v === 1 ? 'cell-yes' : 'cell-no'}">${v}</td>`;
    }).join('');
    return `
      <tr>
        <td>${escapeHtml(r.name)}</td>
        <td>${escapeHtml(r.rank)}</td>
        ${dayCells}
        <td class="center cell-total">${r.total}</td>
      </tr>
    `;
  }).join('');

  return `
    <div class="report-week-block">
      <h3 class="report-week-title">สัปดาห์ ${escapeHtml(week.weekStart)} ถึง ${escapeHtml(week.weekEnd)}</h3>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>รายชื่อสมาชิก</th>
              <th>ตำแหน่ง</th>
              ${dayHeaders}
              <th class="center">รวม</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>
  `;
}

function renderSummaryTable(summary) {
  const head = document.getElementById('reportSummaryHead');
  const body = document.getElementById('reportSummaryBody');

  head.innerHTML = `
    <th>รายชื่อสมาชิก</th>
    <th>ตำแหน่ง</th>
    ${summary.weekLabels.map((label) => `<th class="center">${escapeHtml(label)}</th>`).join('')}
    <th class="center">รวมทั้งหมด</th>
  `;

  body.innerHTML = summary.rows.map((r) => `
    <tr>
      <td>${escapeHtml(r.name)}</td>
      <td>${escapeHtml(r.rank)}</td>
      ${r.perWeek.map((v) => `<td class="center">${v}</td>`).join('')}
      <td class="center cell-total">${r.grandTotal}</td>
    </tr>
  `).join('');
}

document.getElementById('reportDownload').addEventListener('click', () => {
  const start = document.getElementById('reportStart').value;
  const end = document.getElementById('reportEnd').value;
  const status = document.getElementById('reportStatus');
  if (!start || !end) {
    status.textContent = 'กรุณาเลือกช่วงวันที่ก่อนดาวน์โหลด';
    return;
  }
  if (start > end) {
    status.textContent = 'วันที่เริ่มต้องไม่เกินวันที่สิ้นสุด';
    return;
  }
  window.location.href = `/api/report/export?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`;
});

// ---------------- init ----------------
loadMembers();
