import type Database from "better-sqlite3";
export type Subscriber = { id: string; email: string; status: "pending" | "active" | "unsubscribed"; generation: string; confirm_expires_at: number; confirmed_at: number | null; start_fingerprint: string | null };
export type MailJob = { id: string; subscriber_id: string; generation: string; kind: "confirm" | "edition"; edition_id: string | null; attempts: number; status: string; lease_until: number | null; created_at: number };
export function createMailTables(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS news_mail_subscribers (
      id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      status TEXT NOT NULL CHECK(status IN ('pending','active','unsubscribed')),
      generation TEXT NOT NULL, confirm_expires_at INTEGER NOT NULL,
      confirmed_at INTEGER, start_fingerprint TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS news_mail_state (
      id INTEGER PRIMARY KEY CHECK(id=1), fingerprint TEXT, initialized_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS news_mail_editions (
      id TEXT PRIMARY KEY, edition_json TEXT NOT NULL, detected_at INTEGER NOT NULL, images_json TEXT
    );
    CREATE TABLE IF NOT EXISTS news_mail_outbox (
      id TEXT PRIMARY KEY, subscriber_id TEXT NOT NULL REFERENCES news_mail_subscribers(id),
      generation TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('confirm','edition')),
      edition_id TEXT REFERENCES news_mail_editions(id),
      dedupe_key TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','sending','sent','unknown','cancelled')),
      attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at INTEGER NOT NULL, lease_until INTEGER,
      provider_id TEXT, last_error TEXT, payload_json TEXT, created_at INTEGER NOT NULL, sent_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_news_mail_jobs_due ON news_mail_outbox(status,next_attempt_at);
    CREATE INDEX IF NOT EXISTS idx_news_mail_subscriber_jobs ON news_mail_outbox(subscriber_id,status);
    CREATE TABLE IF NOT EXISTS news_mail_limits (
      key TEXT PRIMARY KEY, window_start INTEGER NOT NULL, count INTEGER NOT NULL
    );
  `);
}
// Next compiles instrumentation and request routes into separate modules while they share
// the process-wide service instance. A global symbol survives that class-identity boundary.
const MAIL_REQUEST_ERROR = Symbol.for("konoha.news-mail.request-error");
export class MailRequestError extends Error {
  readonly [MAIL_REQUEST_ERROR] = true;
  constructor(public status: number, message: string, public retryAfter?: number) { super(message); }
}
export function isMailRequestError(error: unknown): error is MailRequestError {
  if (!error || typeof error !== "object") return false;
  const value = error as Partial<MailRequestError>;
  return value[MAIL_REQUEST_ERROR] === true && typeof value.message === "string" &&
    typeof value.status === "number" && Number.isInteger(value.status) && value.status >= 400 && value.status <= 599 &&
    (value.retryAfter === undefined || (Number.isSafeInteger(value.retryAfter) && value.retryAfter > 0));
}
export function consumeMailLimits(db: Database.Database, rules: Array<{ key: string; duration: number; maximum: number }>, now: number) {
  const states = rules.map(rule => ({ rule, row: db.prepare("SELECT window_start,count FROM news_mail_limits WHERE key=?").get(rule.key) as { window_start: number; count: number } | undefined }));
  for (const {rule,row} of states) if (row && row.window_start + rule.duration > now && row.count >= rule.maximum) {
    throw new MailRequestError(429, "请求较频繁，请稍后再试。", Math.max(1, Math.ceil((row.window_start + rule.duration - now) / 1000)));
  }
  for (const {rule,row} of states) {
    const active = row && row.window_start + rule.duration > now;
    db.prepare("INSERT INTO news_mail_limits(key,window_start,count) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET window_start=excluded.window_start,count=excluded.count")
      .run(rule.key, active ? row.window_start : now, active ? row.count + 1 : 1);
  }
  db.prepare("DELETE FROM news_mail_limits WHERE window_start < ?").run(now - 2 * 86_400_000);
}
