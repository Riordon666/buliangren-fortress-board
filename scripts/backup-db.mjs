import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const source = path.join(root, "data", "naruto-fortress.db");
if (!fs.existsSync(source)) {
  console.error("数据库尚未创建，请先启动一次网站。");
  process.exit(1);
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupDir = path.join(root, "data", "backups");
fs.mkdirSync(backupDir, { recursive: true });
const destination = path.join(backupDir, `naruto-fortress-${stamp}.db`);

const db = new Database(source, { readonly: true });
await db.backup(destination);
db.close();
console.log(`数据库备份完成：${destination}`);

