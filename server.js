// server.js — สำนัก: ทำเนียบสมาชิก + เช็คชื่อรายวัน
// Express API + static frontend, connects to Aiven MariaDB via mysql2

const express = require('express');
const mysql = require('mysql2/promise');
const path = require('path');

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
