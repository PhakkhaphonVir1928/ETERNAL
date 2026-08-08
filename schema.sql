-- schema.sql — สำนัก: ทำเนียบสมาชิก + เช็คชื่อรายวัน
-- ปกติไม่ต้องรันเอง เพราะ server.js จะสร้างตารางให้อัตโนมัติตอนสตาร์ท (ensureSchema)
-- ไฟล์นี้ไว้ดูโครงสร้าง หรือรันเองในกรณีต้องการสร้างตารางล่วงหน้า

CREATE TABLE IF NOT EXISTS members (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  `rank` VARCHAR(50) NOT NULL,
  status VARCHAR(50) DEFAULT NULL, -- ตอนนี้ใช้แค่ 'เข้ามาใหม่' หรือ NULL (ไม่ตั้ง = ไม่แสดงอะไรในหน้าภาพรวม)
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ถ้ามีตาราง members อยู่ก่อนแล้วแบบไม่มีคอลัมน์ status ให้รันเพิ่มเอง:
-- ALTER TABLE members ADD COLUMN status VARCHAR(50) DEFAULT NULL;

CREATE TABLE IF NOT EXISTS checkins (
  id INT AUTO_INCREMENT PRIMARY KEY,
  member_id INT NOT NULL,
  checkin_date DATE NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_member_date (member_id, checkin_date),
  FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
