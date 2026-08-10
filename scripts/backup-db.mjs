import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const source = path.resolve(process.env.DATABASE_PATH || path.join(root, "data", "naruto-fortress.db"));
if (!fs.existsSync(source)) {
  console.error("数据库尚未创建，请先启动一次网站。");
  process.exit(1);
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupDir = path.resolve(process.env.BACKUP_DIR || path.join(root, "data", "backups"));
if (backupDir === path.parse(backupDir).root || backupDir === path.resolve(root)) {
  throw new Error("BACKUP_DIR 必须指向专用备份目录，不能使用磁盘根目录或项目根目录。");
}
const destinationDir = path.join(backupDir, stamp);
fs.mkdirSync(destinationDir, { recursive: true });
const destination = path.join(destinationDir, "naruto-fortress.db");

const db = new Database(source, { readonly: true });
await db.backup(destination);
db.close();
const uploads = path.resolve(process.env.UPLOAD_DIR || path.join(root, "public", "uploads"));
if (fs.existsSync(uploads)) fs.cpSync(uploads, path.join(destinationDir, "uploads"), { recursive: true });
const retained = fs.readdirSync(backupDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/.test(entry.name))
  .map((entry) => entry.name)
  .sort()
  .reverse();
for (const expired of retained.slice(14)) fs.rmSync(path.join(backupDir, expired), { recursive: true, force: true });
console.log(`数据库与头像备份完成：${destinationDir}`);
