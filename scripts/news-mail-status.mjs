import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

// Read-only operational summary; never print subscriber addresses or signed links.
const filename = path.resolve(process.env.DATABASE_PATH || "data/naruto-fortress.db");
if (!fs.existsSync(filename)) {
  console.error("未找到现有数据库，请通过 DATABASE_PATH 指向生产数据库。不会创建空库。");
  process.exit(1);
}
const db = new Database(filename, { readonly: true, fileMustExist: true });
try {
  db.pragma("query_only = ON");
  db.pragma("busy_timeout = 5000");
  if (!db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'news_mail_outbox'").get()) {
    console.log("邮件订阅尚未初始化。请配置两端发送接口并重启网站。");
  } else {
    const subscribers = db.prepare("SELECT status, COUNT(*) AS count FROM news_mail_subscribers GROUP BY status").all();
    const deliveries = db.prepare("SELECT kind, status, COUNT(*) AS count FROM news_mail_outbox GROUP BY kind, status").all();
    const latest = db.prepare("SELECT MAX(sent_at) AS lastSentAt FROM news_mail_outbox WHERE status = 'sent'").get();
    const pending = db.prepare("SELECT MIN(next_attempt_at) AS nextAttemptAt FROM news_mail_outbox WHERE status = 'queued'").get();
    const state = db.prepare("SELECT initialized_at AS initializedAt FROM news_mail_state WHERE id = 1").get();
    const date = (value) => value ? new Date(value).toISOString() : null;
    console.log(JSON.stringify({
      subscribers, deliveries,
      initializedAt: date(state?.initializedAt),
      lastSentAt: date(latest?.lastSentAt),
      nextAttemptAt: date(pending?.nextAttemptAt),
      note: "sent 表示邮箱接口已接受；unknown 需核对已发送记录后处理，不自动重发。所有时间为 UTC。"
    }, null, 2));
  }
} finally {
  db.close();
}
