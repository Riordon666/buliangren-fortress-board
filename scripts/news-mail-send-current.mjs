import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

// Queue real edition jobs; the running website prepares its normal template and CID images.
// Keep this dedupe format identical to NewsMailService.queue so retries never create extra mail.
export function enqueueCurrentEdition(db, { to, allActive = false, testId, send = false, now = Date.now() }) {
  if (Boolean(to) === Boolean(allActive)) throw new Error("请选择 --all-active 或 --to 收件邮箱，不能同时指定。");
  if (testId !== undefined && (allActive || typeof testId !== "string" || !/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(testId))) {
    throw new Error("测试编号只能配合 --to 单邮箱使用，且需为 1～64 位英文字母、数字、点、下划线或短横线。");
  }
  if (!allActive && (typeof to !== "string" || !to.trim() || to.length > 254 || /[\r\n]/.test(to))) {
    throw new Error("请通过 --to 指定一个已确认订阅的收件邮箱。");
  }
  const transaction = db.transaction(() => {
    const subscribers = allActive
      ? db.prepare("SELECT id,generation FROM news_mail_subscribers WHERE status='active' AND confirmed_at IS NOT NULL").all()
      : db.prepare("SELECT id,generation FROM news_mail_subscribers WHERE email=? AND status='active' AND confirmed_at IS NOT NULL").all(to.trim().toLowerCase());
    if (!allActive && !subscribers.length) throw new Error("该邮箱尚未确认订阅或已退订，请先完成邮件确认。");
    const current = db.prepare("SELECT e.id,e.edition_json FROM news_mail_state s JOIN news_mail_editions e ON e.id=s.fingerprint WHERE s.id=1").get();
    if (!current) throw new Error("尚未记录已收录的快报，请确认网站已同步快报并保持运行约 30 秒后重试。");
    let edition;
    try { edition = JSON.parse(current.edition_json); } catch { /* Validate below without logging cached content. */ }
    if (!edition || typeof edition.title !== "string" || typeof edition.version !== "string" ||
        typeof edition.syncedAt !== "string" || !Number.isFinite(Date.parse(edition.syncedAt)) ||
        !Array.isArray(edition.pages) || !edition.pages.length ||
        edition.pages.some(page => !page || !/^[a-f0-9]{64}\.(jpg|png|webp)$/.test(page.key) || !(page.width > 0) || !(page.height > 0)) ||
        createHash("sha256").update(edition.pages.map(page => page.key).join(",")).digest("hex") !== current.id) {
      throw new Error("本期快报记录不完整，请先检查网站新闻缓存。");
    }
    const findJob = db.prepare("SELECT status FROM news_mail_outbox WHERE dedupe_key=?");
    const insertJob = send ? db.prepare("INSERT OR IGNORE INTO news_mail_outbox(id,subscriber_id,generation,kind,edition_id,dedupe_key,next_attempt_at,created_at) VALUES(?,?,?,'edition',?,?,?,?)") : null;
    let added = 0;
    const existing = {};
    for (const subscriber of subscribers) {
      const editionKey = `edition:${subscriber.id}:${subscriber.generation}:${current.id}`;
      // A deliberately requested, single-recipient test has its own stable key.
      // Never change or reset a real delivery to make an upgrade test send again.
      const dedupe = testId === undefined ? editionKey : `test:${testId}:${editionKey}`;
      const job = findJob.get(dedupe);
      if (job) {
        existing[job.status] = (existing[job.status] || 0) + 1;
        continue;
      }
      const id = createHash("sha256").update(dedupe).digest("hex");
      if (insertJob) added += insertJob.run(id, subscriber.id, subscriber.generation, current.id, dedupe, now, now).changes;
    }
    return {
      mode: send ? "queued" : "preview",
      edition: { title: edition.title, version: edition.version, syncedAt: edition.syncedAt, pages: edition.pages.length },
      recipients: subscribers.length, added, existing, ...(testId === undefined ? {} : { testId })
    };
  });
  // Select the current edition and recipients under the same lock as the inserts.
  return send ? transaction.immediate() : transaction();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let db;
  try {
    const { values } = parseArgs({ options: { to: { type: "string" }, "test-id": { type: "string" }, "all-active": { type: "boolean", default: false }, send: { type: "boolean", default: false } }, strict: true, allowPositionals: false });
    if (Boolean(values.to) === values["all-active"]) throw new Error("用法：node --env-file=.env.production scripts/news-mail-send-current.mjs --all-active --send（或用 --to 收件邮箱；省略 --send 仅预览）。");
    db = new Database(path.resolve(process.env.DATABASE_PATH?.trim() || "data/naruto-fortress.db"), { readonly: !values.send, fileMustExist: true });
    db.pragma("busy_timeout = 5000");
    if (values.send) db.pragma("foreign_keys = ON");
    const result = enqueueCurrentEdition(db, { to: values.to, allActive: values["all-active"], testId: values["test-id"], send: values.send });
    console.log(JSON.stringify(result, null, 2));
    if (!values.send) console.log("仅预览，没有加入发送队列；带 --send 可发送。");
    else if (result.added) console.log(`已加入 ${result.added} 封本期快报邮件。保持网站运行，通常约 30 秒开始处理，按现有发送速率逐封发送。`);
    else console.log("没有新增邮件：当前没有符合条件的订阅，或本期已存在发送记录。");
    if (Object.keys(result.existing).length) console.log("已存在的任务保持原状态，未重复添加；unknown 需核对邮箱已发送记录，不自动重发。");
  } catch (error) {
    const safe = error instanceof Error && /^[\u4e00-\u9fff]/.test(error.message) ? error.message : "命令未完成。请检查参数，并在网站运行目录加载 .env.production，确认数据库已初始化。";
    console.error(safe);
    process.exitCode = 1;
  } finally { db?.close(); }
}
