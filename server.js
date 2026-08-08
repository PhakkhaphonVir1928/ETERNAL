// server.js — สำนัก: ทำเนียบสมาชิก + เช็คชื่อรายวัน
// Express API + static frontend, connects to Aiven MariaDB via mysql2

const express = require('express');
const mysql = require('mysql2/promise');
const path = require('path');
const ExcelJS = require('exceljs');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;

// ---- ลำดับตำแหน่งที่ระบบรองรับ (เรียงจากสูงไปต่ำ) ----
const RANKS = ['เจ้าสำนัก', 'รองเจ้าสำนัก', 'ผู้อาวุโส', 'เอลิต', 'สมาชิก'];
function rankIndex(r) {
  const i = RANKS.indexOf(r);
  return i === -1 ? RANKS.length : i;
}

// ---- เชื่อมต่อฐานข้อมูล Aiven MariaDB ----
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 5,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  dateStrings: ['DATE'], // ให้คอลัมน์ DATE กลับมาเป็น string YYYY-MM-DD ตรงๆ ไม่ต้องแปลง timezone
});

// สร้างตารางอัตโนมัติถ้ายังไม่มี
async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS members (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      \`rank\` VARCHAR(50) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS checkins (
      id INT AUTO_INCREMENT PRIMARY KEY,
      member_id INT NOT NULL,
      checkin_date DATE NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_member_date (member_id, checkin_date),
      FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
}
ensureSchema().catch((err) => {
  console.error('ไม่สามารถสร้างตารางฐานข้อมูลได้:', err.message);
});

function sortMembers(rows) {
  return rows.sort((a, b) => rankIndex(a.rank) - rankIndex(b.rank) || a.name.localeCompare(b.name, 'th'));
}

// ======================= MEMBERS (ทำเนียบสมาชิก) =======================

// GET /api/members — รายชื่อสมาชิกทั้งหมด
app.get('/api/members', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT id, name, `rank` FROM members');
    res.json(sortMembers(rows));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'อ่านข้อมูลไม่สำเร็จ', detail: err.message });
  }
});

// POST /api/members — เพิ่มสมาชิกแบบกลุ่ม
// body: { rank: "สมาชิก", names: ["ชื่อ1","ชื่อ2", ...] }
app.post('/api/members', async (req, res) => {
  try {
    const { rank, names } = req.body;
    if (!rank || !Array.isArray(names) || names.length === 0) {
      return res.status(400).json({ error: 'ข้อมูลไม่ครบ ต้องมี rank และ names (array)' });
    }
    if (!RANKS.includes(rank)) {
      return res.status(400).json({ error: 'ตำแหน่งไม่ถูกต้อง' });
    }
    const cleanNames = names.map((n) => String(n).trim()).filter(Boolean);
    if (cleanNames.length === 0) {
      return res.status(400).json({ error: 'ไม่มีรายชื่อที่ใช้ได้' });
    }
    const values = cleanNames.map((name) => [name, rank]);
    await pool.query('INSERT INTO members (name, `rank`) VALUES ?', [values]);
    res.status(201).json({ inserted: cleanNames.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'บันทึกข้อมูลไม่สำเร็จ', detail: err.message });
  }
});

// PUT /api/members/:id — แก้ไขสมาชิก
app.put('/api/members/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, rank } = req.body;
    if (!name || !rank) {
      return res.status(400).json({ error: 'ข้อมูลไม่ครบ ต้องมี name, rank' });
    }
    if (!RANKS.includes(rank)) {
      return res.status(400).json({ error: 'ตำแหน่งไม่ถูกต้อง' });
    }
    const [result] = await pool.query(
      'UPDATE members SET name = ?, `rank` = ? WHERE id = ?',
      [name, rank, id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'ไม่พบสมาชิกที่ต้องการแก้ไข' });
    }
    res.json({ updated: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'แก้ไขข้อมูลไม่สำเร็จ', detail: err.message });
  }
});

// DELETE /api/members/:id — ลบสมาชิก (ลบประวัติเช็คชื่อของคนนี้ไปด้วยอัตโนมัติ)
app.delete('/api/members/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [result] = await pool.query('DELETE FROM members WHERE id = ?', [id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'ไม่พบสมาชิกที่ต้องการลบ' });
    }
    res.json({ deleted: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'ลบข้อมูลไม่สำเร็จ', detail: err.message });
  }
});

// ======================= CHECKINS (เช็คชื่อรายวัน) =======================

// GET /api/checkins?date=YYYY-MM-DD — รายชื่อที่เช็คแล้วของวันนั้น
app.get('/api/checkins', async (req, res) => {
  try {
    const { date } = req.query;
    if (!date) return res.status(400).json({ error: 'ต้องระบุ date' });
    const [rows] = await pool.query(
      `SELECT c.id, c.member_id, m.name, m.\`rank\`
       FROM checkins c JOIN members m ON m.id = c.member_id
       WHERE c.checkin_date = ?`,
      [date]
    );
    res.json(sortMembers(rows));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'อ่านข้อมูลไม่สำเร็จ', detail: err.message });
  }
});

// POST /api/checkins — เช็คชื่อแบบวางชื่อหลายคนพร้อมกัน
// body: { date: "2026-08-08", names: ["ชื่อ1","ชื่อ2", ...] }
app.post('/api/checkins', async (req, res) => {
  try {
    const { date, names } = req.body;
    if (!date || !Array.isArray(names) || names.length === 0) {
      return res.status(400).json({ error: 'ข้อมูลไม่ครบ ต้องมี date และ names (array)' });
    }
    const cleanNames = [...new Set(names.map((n) => String(n).trim()).filter(Boolean))];
    if (cleanNames.length === 0) {
      return res.status(400).json({ error: 'ไม่มีรายชื่อที่ใช้ได้' });
    }

    const [members] = await pool.query('SELECT id, name FROM members');
    const byName = new Map(members.map((m) => [m.name, m.id]));

    const matchedIds = [];
    const notFound = [];
    cleanNames.forEach((n) => {
      if (byName.has(n)) matchedIds.push(byName.get(n));
      else notFound.push(n);
    });

    if (matchedIds.length > 0) {
      const values = matchedIds.map((id) => [id, date]);
      await pool.query('INSERT IGNORE INTO checkins (member_id, checkin_date) VALUES ?', [values]);
    }

    res.status(201).json({ matched: matchedIds.length, notFound });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'บันทึกข้อมูลไม่สำเร็จ', detail: err.message });
  }
});

// DELETE /api/checkins/:id — ยกเลิกการเช็คชื่อคนใดคนหนึ่ง
app.delete('/api/checkins/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [result] = await pool.query('DELETE FROM checkins WHERE id = ?', [id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'ไม่พบข้อมูลที่ต้องการลบ' });
    }
    res.json({ deleted: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'ลบข้อมูลไม่สำเร็จ', detail: err.message });
  }
});

// ======================= รายงานเช็คชื่อรายสัปดาห์ (ดึงไฟล์ชื่อ+วันที่) =======================

const THAI_DAYS = ['จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์', 'อาทิตย์'];

function toISODate(d) {
  return d.toISOString().slice(0, 10);
}
function parseISO(dateStr) {
  return new Date(`${dateStr}T00:00:00Z`);
}
function addDays(d, n) {
  const nd = new Date(d);
  nd.setUTCDate(nd.getUTCDate() + n);
  return nd;
}
// จันทร์ของสัปดาห์ที่ dateStr อยู่ (สัปดาห์เริ่มวันจันทร์)
function startOfWeekMonday(dateStr) {
  const d = parseISO(dateStr);
  const day = d.getUTCDay(); // 0=อาทิตย์ .. 6=เสาร์
  const diffToMonday = day === 0 ? -6 : 1 - day;
  return addDays(d, diffToMonday);
}

// รวมข้อมูลรายงานช่วง start..end (inclusive) แบ่งเป็นสัปดาห์ (จันทร์-อาทิตย์)
// แสดงเฉพาะวันที่มีคนเช็คชื่ออย่างน้อย 1 คน (ตัดคอลัมน์วันที่ไม่มีกิจกรรมทิ้งไป เหมือนตารางต้นฉบับ)
async function buildReport(start, end) {
  const [members] = await pool.query('SELECT id, name, `rank` FROM members');
  const sortedMembers = sortMembers(members);

  const [checkinRows] = await pool.query(
    'SELECT member_id, checkin_date FROM checkins WHERE checkin_date BETWEEN ? AND ?',
    [start, end]
  );
  const checkinMap = new Map(); // member_id -> Set(dateStr)
  checkinRows.forEach((r) => {
    if (!checkinMap.has(r.member_id)) checkinMap.set(r.member_id, new Set());
    checkinMap.get(r.member_id).add(r.checkin_date);
  });

  const weekStarts = [];
  let cursor = startOfWeekMonday(start);
  const endDate = parseISO(end);
  while (cursor <= endDate) {
    weekStarts.push(new Date(cursor));
    cursor = addDays(cursor, 7);
  }

  const weeks = weekStarts
    .map((weekStartDate) => {
      const weekEndDate = addDays(weekStartDate, 6);
      const days = [];
      for (let i = 0; i < 7; i += 1) {
        const iso = toISODate(addDays(weekStartDate, i));
        if (iso < start || iso > end) continue;
        days.push({ date: iso, dayName: THAI_DAYS[i] });
      }
      const activeDays = days.filter((d) =>
        [...checkinMap.values()].some((set) => set.has(d.date))
      );
      if (activeDays.length === 0) return null;

      const rows = sortedMembers.map((m) => {
        const set = checkinMap.get(m.id) || new Set();
        const byDate = {};
        let total = 0;
        activeDays.forEach((d) => {
          const val = set.has(d.date) ? 1 : 0;
          byDate[d.date] = val;
          total += val;
        });
        return { id: m.id, name: m.name, rank: m.rank, byDate, total };
      });

      return {
        weekStart: toISODate(weekStartDate),
        weekEnd: toISODate(weekEndDate),
        days: activeDays,
        rows,
      };
    })
    .filter(Boolean);

  const summaryRows = sortedMembers.map((m) => {
    const perWeek = weeks.map((w) => {
      const row = w.rows.find((r) => r.id === m.id);
      return row ? row.total : 0;
    });
    const grandTotal = perWeek.reduce((a, b) => a + b, 0);
    return { id: m.id, name: m.name, rank: m.rank, perWeek, grandTotal };
  });

  return {
    start,
    end,
    weeks,
    summary: {
      weekLabels: weeks.map((w) => `${w.weekStart} - ${w.weekEnd}`),
      rows: summaryRows,
    },
  };
}

// GET /api/report?start=YYYY-MM-DD&end=YYYY-MM-DD — ดูข้อมูลรายงาน (JSON) เพื่อพรีวิวบนเว็บ
app.get('/api/report', async (req, res) => {
  try {
    const { start, end } = req.query;
    if (!start || !end) return res.status(400).json({ error: 'ต้องระบุ start และ end' });
    if (start > end) return res.status(400).json({ error: 'วันที่เริ่มต้องไม่เกินวันที่สิ้นสุด' });
    const data = await buildReport(start, end);
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'สร้างรายงานไม่สำเร็จ', detail: err.message });
  }
});

// GET /api/report/export?start=YYYY-MM-DD&end=YYYY-MM-DD — ดาวน์โหลดเป็นไฟล์ Excel (.xlsx)
// ถ้าช่วงที่เลือกมีหลายสัปดาห์ จะรวมทุกสัปดาห์ไว้ในไฟล์เดียวกัน (ชีต "รายสัปดาห์") บวกชีตสรุปรวม ("สรุปรวม")
app.get('/api/report/export', async (req, res) => {
  try {
    const { start, end } = req.query;
    if (!start || !end) return res.status(400).json({ error: 'ต้องระบุ start และ end' });
    if (start > end) return res.status(400).json({ error: 'วันที่เริ่มต้องไม่เกินวันที่สิ้นสุด' });
    const data = await buildReport(start, end);

    const GREEN = 'FFD9EAD3';
    const RED = 'FFF4CCCC';
    const YELLOW = 'FFFFF2CC';
    const HEADER_RED = 'FFB3231A';

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'สำนัก';
    workbook.created = new Date();

    function styleHeaderCell(cell, isFirstCol) {
      cell.font = { bold: true, color: { argb: isFirstCol ? 'FFFFFFFF' : 'FF3A2A24' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: isFirstCol ? HEADER_RED : YELLOW } };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border = { bottom: { style: 'thin', color: { argb: 'FFCCCCCC' } } };
    }

    // ---- ชีต 1: รายละเอียดรายสัปดาห์ ----
    const detailSheet = workbook.addWorksheet('รายสัปดาห์');
    let r = 1;
    if (data.weeks.length === 0) {
      detailSheet.getCell(1, 1).value = 'ไม่มีข้อมูลการเช็คชื่อในช่วงวันที่ที่เลือก';
    }
    data.weeks.forEach((week) => {
      const labelCell = detailSheet.getCell(r, 1);
      labelCell.value = `สัปดาห์ ${week.weekStart} ถึง ${week.weekEnd}`;
      labelCell.font = { bold: true, size: 13, color: { argb: 'FFB3231A' } };
      r += 1;

      const headers = ['รายชื่อสมาชิก', 'ตำแหน่ง', ...week.days.map((d) => `วัน${d.dayName}`), 'รวม'];
      headers.forEach((h, i) => {
        const cell = detailSheet.getCell(r, i + 1);
        cell.value = h;
        styleHeaderCell(cell, i === 0);
      });
      r += 1;

      week.rows.forEach((row) => {
        detailSheet.getCell(r, 1).value = row.name;
        detailSheet.getCell(r, 2).value = row.rank;
        week.days.forEach((d, i) => {
          const cell = detailSheet.getCell(r, 3 + i);
          const v = row.byDate[d.date];
          cell.value = v;
          cell.alignment = { horizontal: 'center' };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: v === 1 ? GREEN : RED } };
        });
        const totalCell = detailSheet.getCell(r, 3 + week.days.length);
        totalCell.value = row.total;
        totalCell.font = { bold: true };
        totalCell.alignment = { horizontal: 'center' };
        totalCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GREEN } };
        r += 1;
      });
      r += 1; // เว้นบรรทัดคั่นสัปดาห์
    });
    detailSheet.getColumn(1).width = 22;
    detailSheet.getColumn(2).width = 16;
    for (let c = 3; c <= 12; c += 1) detailSheet.getColumn(c).width = 11;

    // ---- ชีต 2: สรุปรวมทุกสัปดาห์ ----
    const summarySheet = workbook.addWorksheet('สรุปรวม');
    const summaryHeaders = ['รายชื่อสมาชิก', 'ตำแหน่ง', ...data.summary.weekLabels, 'รวมทั้งหมด'];
    summaryHeaders.forEach((h, i) => {
      const cell = summarySheet.getCell(1, i + 1);
      cell.value = h;
      styleHeaderCell(cell, i === 0);
    });
    data.summary.rows.forEach((row, idx) => {
      const rr = idx + 2;
      summarySheet.getCell(rr, 1).value = row.name;
      summarySheet.getCell(rr, 2).value = row.rank;
      row.perWeek.forEach((v, i) => {
        const cell = summarySheet.getCell(rr, 3 + i);
        cell.value = v;
        cell.alignment = { horizontal: 'center' };
      });
      const totalCell = summarySheet.getCell(rr, 3 + row.perWeek.length);
      totalCell.value = row.grandTotal;
      totalCell.font = { bold: true };
      totalCell.alignment = { horizontal: 'center' };
      totalCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GREEN } };
    });
    summarySheet.getColumn(1).width = 22;
    summarySheet.getColumn(2).width = 16;
    for (let c = 3; c <= 3 + data.summary.weekLabels.length; c += 1) summarySheet.getColumn(c).width = 16;

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', `attachment; filename="rayngan-checkin_${start}_${end}.xlsx"`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'สร้างไฟล์ไม่สำเร็จ', detail: err.message });
  }
});

// health check
app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`เซิร์ฟเวอร์ทำงานที่พอร์ต ${PORT}`);
});
