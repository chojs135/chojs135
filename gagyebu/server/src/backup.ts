import fs from "node:fs";
import path from "node:path";
import { db, DATA_DIR } from "./db.js";

// 데이터가 집 PC 한 대에만 있으므로 하루 한 번 DB 사본을 남긴다(최근 30개 보관).
// BACKUP_DIR을 구글 드라이브/원드라이브 동기화 폴더로 지정하면 PC가 고장 나도 복구할 수 있다.
const BACKUP_DIR = process.env.BACKUP_DIR ?? path.join(DATA_DIR, "backups");
const KEEP = 30;

async function backupOnce() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const file = path.join(BACKUP_DIR, `gagyebu-${new Date().toISOString().slice(0, 10)}.db`);
  if (fs.existsSync(file)) return;
  await db.backup(file);
  const old = fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => /^gagyebu-\d{4}-\d{2}-\d{2}\.db$/.test(f))
    .sort()
    .slice(0, -KEEP);
  for (const f of old) fs.rmSync(path.join(BACKUP_DIR, f));
  console.log(`DB 백업: ${file}`);
}

export function startBackups() {
  const run = () => backupOnce().catch((e) => console.error("DB 백업 실패:", e));
  run();
  setInterval(run, 60 * 60 * 1000);
}
