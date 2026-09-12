import { createHash, randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { z } from "zod";
import type { NewsEdition, NewsState } from "@/lib/news/types";
import { parseSubscriptionToken, privateHash, type MailConfig } from "@/lib/news-mail/config";
import { createMailTables, consumeMailLimits, MailRequestError, type Subscriber, type MailJob } from "@/lib/news-mail/store";
import { makeMailImages } from "@/lib/news-mail/images";
import { confirmationMail, editionMail } from "@/lib/news-mail/templates";
import { sendMail, type InlineAttachment, type MailPayload, type SendResult } from "@/lib/news-mail/provider";

const DAY = 86_400_000;
export const editionFingerprint = (edition: NewsEdition | null) => edition ? createHash("sha256").update(edition.pages.map(page => page.key).join(",")).digest("hex") : null;
type Source = { read(): Promise<NewsState>; image(key: string): Promise<Buffer | null> };
type Sender = (key: string, payload: MailPayload) => Promise<SendResult>;
type EditionRow = { edition_json: string; images_json: string | null };
export class NewsMailService {
  private processing: Promise<void> | null = null;
  constructor(private db: Database.Database, private config: MailConfig, private news: Source, private now = Date.now, private sender: Sender = (key, payload) => sendMail(config.apiUrl, config.apiToken, key, payload)) { createMailTables(db); }

  async initialize() { this.observe((await this.news.read()).edition); }
  private observe(edition: NewsEdition | null) {
    const fingerprint = editionFingerprint(edition);
    const now = this.now();
    this.db.transaction(() => {
      const state = this.db.prepare("SELECT fingerprint FROM news_mail_state WHERE id=1").get() as {fingerprint: string | null} | undefined;
      if (!state) {
        this.db.prepare("INSERT INTO news_mail_state(id,fingerprint,initialized_at) VALUES(1,?,?)").run(fingerprint, now);
        if (edition) this.db.prepare("INSERT OR IGNORE INTO news_mail_editions(id,edition_json,detected_at) VALUES(?,?,?)").run(fingerprint, JSON.stringify(edition), now);
        return;
      }
      // A missing cache is not a new edition and must not erase the durable last observation.
      if (!edition || fingerprint === state.fingerprint) return;
      this.db.prepare("UPDATE news_mail_state SET fingerprint=? WHERE id=1").run(fingerprint);
      const fresh = this.db.prepare("INSERT OR IGNORE INTO news_mail_editions(id,edition_json,detected_at) VALUES(?,?,?)").run(fingerprint, JSON.stringify(edition), now).changes;
      if (!state.fingerprint || !fresh) return;
      const subscribers = this.db.prepare("SELECT * FROM news_mail_subscribers WHERE status='active' AND confirmed_at<=? AND (start_fingerprint IS NULL OR start_fingerprint!=?)").all(now, fingerprint) as Subscriber[];
      for (const subscriber of subscribers) this.queue(subscriber, "edition", fingerprint);
    }).immediate();
  }

  private queue(subscriber: Subscriber, kind: "confirm" | "edition", editionId: string | null = null) {
    const dedupe = `${kind}:${subscriber.id}:${subscriber.generation}:${editionId || ""}`;
    const id = createHash("sha256").update(dedupe).digest("hex");
    this.db.prepare("INSERT OR IGNORE INTO news_mail_outbox(id,subscriber_id,generation,kind,edition_id,dedupe_key,next_attempt_at,created_at) VALUES(?,?,?,?,?,?,?,?)")
      .run(id, subscriber.id, subscriber.generation, kind, editionId, dedupe, this.now(), this.now());
  }

  subscribe(input: unknown, clientAddress: string) {
    const parsed = z.string().trim().max(254).email().safeParse(input);
    if (!parsed.success) throw new MailRequestError(400, "请输入有效的邮箱地址。");
    const email = parsed.data.toLowerCase();
    const now = this.now();
    const emailKey = privateHash(this.config.subscriptionSecret, `email:${email}`);
    const sourceKey = privateHash(this.config.subscriptionSecret, `source:${clientAddress}`);
    this.db.transaction(() => {
      consumeMailLimits(this.db, [
        { key: `email-minute:${emailKey}`, duration: 60_000, maximum: 1 },
        { key: `email-day:${emailKey}`, duration: DAY, maximum: 5 },
        { key: `source-hour:${sourceKey}`, duration: 3_600_000, maximum: 20 },
        { key: "global-hour", duration: 3_600_000, maximum: 200 }
      ], now);
      let subscriber = this.db.prepare("SELECT * FROM news_mail_subscribers WHERE email=?").get(email) as Subscriber | undefined;
      if (subscriber?.status === "active") return;
      const generation = randomUUID();
      if (subscriber) {
        this.db.prepare("UPDATE news_mail_outbox SET status='cancelled',lease_until=NULL WHERE subscriber_id=? AND status IN ('queued','sending')").run(subscriber.id);
        this.db.prepare("UPDATE news_mail_subscribers SET status='pending',generation=?,confirm_expires_at=?,confirmed_at=NULL,start_fingerprint=NULL,updated_at=? WHERE id=?").run(generation, now + DAY, now, subscriber.id);
      } else {
        this.db.prepare("INSERT INTO news_mail_subscribers(id,email,status,generation,confirm_expires_at,created_at,updated_at) VALUES(?,?,'pending',?,?,?,?)").run(randomUUID(), email, generation, now + DAY, now, now);
      }
      subscriber = this.db.prepare("SELECT * FROM news_mail_subscribers WHERE email=?").get(email) as Subscriber;
      this.queue(subscriber, "confirm");
    }).immediate();
  }

  async confirm(raw: unknown) {
    const token = parseSubscriptionToken(this.config, raw, "confirm");
    if (!token) throw new MailRequestError(400, "确认链接无效或已失效，请重新申请订阅。");
    const fingerprint = editionFingerprint((await this.news.read()).edition);
    this.db.transaction(() => {
      const subscriber = this.db.prepare("SELECT * FROM news_mail_subscribers WHERE id=? AND generation=?").get(token.id, token.generation) as Subscriber | undefined;
      if (!subscriber || subscriber.status === "unsubscribed") throw new MailRequestError(400, "确认链接无效或已失效，请重新申请订阅。");
      if (subscriber.status === "active") return;
      if (subscriber.confirm_expires_at <= this.now()) throw new MailRequestError(400, "确认链接已过期，请重新申请订阅。");
      this.db.prepare("UPDATE news_mail_subscribers SET status='active',confirmed_at=?,start_fingerprint=?,updated_at=? WHERE id=?").run(this.now(), fingerprint, this.now(), subscriber.id);
      this.db.prepare("UPDATE news_mail_outbox SET status='cancelled',lease_until=NULL WHERE subscriber_id=? AND kind='confirm' AND status IN ('queued','sending')").run(subscriber.id);
    }).immediate();
  }

  unsubscribe(raw: unknown) {
    const token = parseSubscriptionToken(this.config, raw, "unsubscribe");
    if (!token) throw new MailRequestError(400, "退订链接无效，请使用最近一封提醒邮件中的链接。");
    this.db.transaction(() => {
      const subscriber = this.db.prepare("SELECT * FROM news_mail_subscribers WHERE id=? AND generation=?").get(token.id, token.generation) as Subscriber | undefined;
      if (!subscriber) throw new MailRequestError(400, "退订链接无效，请使用最近一封提醒邮件中的链接。");
      this.db.prepare("UPDATE news_mail_subscribers SET status='unsubscribed',updated_at=? WHERE id=?").run(this.now(), subscriber.id);
      this.db.prepare("UPDATE news_mail_outbox SET status='cancelled',lease_until=NULL WHERE subscriber_id=? AND status IN ('queued','sending')").run(subscriber.id);
    }).immediate();
  }

  private claim(): MailJob | null {
    return this.db.transaction(() => {
      this.db.prepare("UPDATE news_mail_outbox SET status='queued',lease_until=NULL WHERE status='sending' AND lease_until<=?").run(this.now());
      const job = this.db.prepare("SELECT * FROM news_mail_outbox WHERE status='queued' AND next_attempt_at<=? ORDER BY created_at,id LIMIT 1").get(this.now()) as MailJob | undefined;
      if (!job) return null;
      try { consumeMailLimits(this.db, [{ key: "dispatch-minute", duration: 60_000, maximum: 10 }], this.now()); }
      catch (error) { if (error instanceof MailRequestError) return null; throw error; }
      this.db.prepare("UPDATE news_mail_outbox SET status='sending',lease_until=?,attempts=attempts+1 WHERE id=? AND status='queued'").run(this.now() + 300_000, job.id);
      return { ...job, status: "sending", attempts: job.attempts + 1 };
    }).immediate();
  }

  private async payload(job: MailJob, subscriber: Subscriber): Promise<MailPayload> {
    let images: {attachments: InlineAttachment[]; preview: boolean} | null = null;
    let edition: NewsEdition | null = null;
    if (job.kind === "edition") {
      const row = this.db.prepare("SELECT edition_json,images_json FROM news_mail_editions WHERE id=?").get(job.edition_id) as EditionRow;
      edition = JSON.parse(row.edition_json);
      if (row.images_json) images = JSON.parse(row.images_json);
      else {
        images = await makeMailImages(edition!, key => this.news.image(key));
        this.db.prepare("UPDATE news_mail_editions SET images_json=? WHERE id=? AND images_json IS NULL").run(JSON.stringify(images), job.edition_id);
        // Concurrent workers always use the first committed image set for identical API retries.
        images = JSON.parse((this.db.prepare("SELECT images_json FROM news_mail_editions WHERE id=?").get(job.edition_id) as { images_json: string }).images_json);
      }
    }
    const prepared = this.db.prepare("SELECT payload_json FROM news_mail_outbox WHERE id=?").get(job.id) as { payload_json: string | null };
    if (prepared.payload_json) return { ...JSON.parse(prepared.payload_json), ...(images ? { attachments: images.attachments } : {}) };
    const payload = job.kind === "confirm" ? confirmationMail(this.config, subscriber) : editionMail(this.config, subscriber, edition!, images!.attachments, images!.preview);
    const { attachments: _images, ...content } = payload;
    this.db.prepare("UPDATE news_mail_outbox SET payload_json=? WHERE id=? AND payload_json IS NULL").run(JSON.stringify(content), job.id);
    const saved = JSON.parse((this.db.prepare("SELECT payload_json FROM news_mail_outbox WHERE id=?").get(job.id) as { payload_json: string }).payload_json);
    return { ...saved, ...(images ? { attachments: images.attachments } : {}) };
  }

  private async process() {
    await this.initialize();
    for (let count = 0; count < 5; count++) {
      const job = this.claim();
      if (!job) break;
      try {
        const subscriber = this.db.prepare("SELECT * FROM news_mail_subscribers WHERE id=?").get(job.subscriber_id) as Subscriber;
        if (subscriber.generation !== job.generation || (job.kind === "confirm" ? subscriber.status !== "pending" || subscriber.confirm_expires_at <= this.now() : subscriber.status !== "active")) {
          this.db.prepare("UPDATE news_mail_outbox SET status='cancelled',lease_until=NULL WHERE id=?").run(job.id); continue;
        }
        const payload = await this.payload(job, subscriber);
        // Preparing images may take time; honor an unsubscribe that happened in the meantime.
        const current = this.db.prepare("SELECT status FROM news_mail_outbox WHERE id=?").get(job.id) as {status: string};
        if (current.status !== "sending") continue;
        const result = await this.sender(job.id, payload);
        if (result.status === "sent") this.db.prepare("UPDATE news_mail_outbox SET status='sent',provider_id=?,sent_at=?,lease_until=NULL,last_error=NULL WHERE id=? AND status='sending'").run(result.id, this.now(), job.id);
        else if (result.status === "unknown" || (job.attempts >= 64 || this.now() - job.created_at >= 3 * DAY)) this.db.prepare("UPDATE news_mail_outbox SET status='unknown',last_error=?,lease_until=NULL WHERE id=? AND status='sending'").run(result.status === "unknown" ? result.reason : "retry-limit-reached", job.id);
        else {
          const delay = Math.max(result.delayMs, Math.min(3_600_000, 30_000 * 2 ** Math.min(job.attempts - 1, 7)));
          this.db.prepare("UPDATE news_mail_outbox SET status='queued',next_attempt_at=?,last_error=?,lease_until=NULL WHERE id=? AND status='sending'").run(this.now() + delay, result.reason, job.id);
        }
      } catch {
        this.db.prepare("UPDATE news_mail_outbox SET status=?,next_attempt_at=?,last_error='local-preparation-failed',lease_until=NULL WHERE id=? AND status='sending'").run((job.attempts >= 64 || this.now() - job.created_at >= 3 * DAY) ? "unknown" : "queued", this.now() + 300_000, job.id);
        console.warn("[news-mail] local message preparation unavailable; queue preserved.");
      }
    }
  }
  tick() { return this.processing ||= this.process().finally(() => { this.processing = null; }); }
}
