import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { enqueueCurrentEdition } from "../scripts/news-mail-send-current.mjs";
import { signSubscriptionToken } from "@/lib/news-mail/config";
import { NewsMailService } from "@/lib/news-mail/service";

const config = {
  apiUrl: "https://mail.riordon.xyz/api/integrations/konoha/send",
  apiToken: "fixture-api-token-".repeat(3),
  subscriptionSecret: "fixture-subscription-secret-".repeat(3),
  publicUrl: "https://naruto.riordon.xyz"
};
let db;
let service;
let edition;
let now;
let sender;
let imageBytes;
const to = "ninja@example.com";
const source = {
  read: async () => ({ edition, status: edition ? "ready" : "unavailable" }),
  image: async () => imageBytes
};
const subscriber = (email = to) => db.prepare("SELECT * FROM news_mail_subscribers WHERE email=?").get(email);
const token = (purpose, email = to) => {
  const current = subscriber(email);
  return signSubscriptionToken(config, { id: current.id, generation: current.generation, purpose });
};
async function activate(email = to) {
  service.subscribe(email, "127.0.0.1");
  await service.confirm(token("confirm", email));
}
const editionJobs = () => db.prepare("SELECT * FROM news_mail_outbox WHERE kind='edition' ORDER BY created_at,id").all();
function snapshot() {
  return Object.fromEntries([
    "news_mail_state", "news_mail_editions", "news_mail_subscribers", "news_mail_outbox", "news_mail_limits"
  ].map(table => [table, db.prepare("SELECT * FROM " + table + " ORDER BY rowid").all()]));
}

beforeEach(async () => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  now = Date.parse("2026-09-12T15:00:00+08:00");
  edition = {
    version: "526220",
    title: "火影忍者手游木叶快报",
    sourceUrl: "https://act.supercore.qq.com/supercore/act/a572ef51becd748b4ab1c0b0199721be0/index.html",
    syncedAt: "2026-09-10T02:52:31.604Z",
    pages: [{ key: "a".repeat(64) + ".jpg", width: 200, height: 400 }]
  };
  imageBytes = await sharp({ create: { width: 200, height: 400, channels: 3, background: "#d08040" } }).jpeg().toBuffer();
  sender = vi.fn(async () => ({ status: "sent", id: "fixture-provider-id" }));
  service = new NewsMailService(db, config, source, () => now, sender);
});
afterEach(() => db.close());

describe("发送当前已收录快报的运维命令", () => {
  it("默认预览，不触发网络、不修改队列或新闻及订阅状态", async () => {
    await service.initialize();
    await activate();
    const before = snapshot();
    const result = enqueueCurrentEdition(db, { to, now });
    expect(result).toMatchObject({
      mode: "preview",
      added: 0,
      recipients: 1, existing: {},
      edition: { title: edition.title, version: edition.version, syncedAt: edition.syncedAt, pages: 1 }
    });
    expect(snapshot()).toEqual(before);
    expect(sender).not.toHaveBeenCalled();
  });

  it("只为指定的 active 邮箱入队，由正式 worker 发送同一期模板和 CID 图片", async () => {
    await service.initialize();
    await activate();
    await activate("other@example.com");
    const before = snapshot();
    const result = enqueueCurrentEdition(db, { to: " NINJA@Example.com ", send: true, now });
    expect(result).toMatchObject({ mode: "queued", recipients: 1, added: 1, existing: {} });
    expect(sender).not.toHaveBeenCalled();
    expect(editionJobs()).toHaveLength(1);
    expect(editionJobs()[0]).toMatchObject({ subscriber_id: subscriber().id, generation: subscriber().generation });
    const after = snapshot();
    for (const table of ["news_mail_state", "news_mail_editions", "news_mail_subscribers", "news_mail_limits"]) {
      expect(after[table]).toEqual(before[table]);
    }
    await service.tick();
    expect(sender).toHaveBeenCalledTimes(1);
    const [key, payload] = sender.mock.calls[0];
    expect(key).toBe(editionJobs()[0].id);
    expect(payload.to).toBe(to);
    expect(payload.subject).toBe("木叶快报已经更新");
    expect(payload.html).toContain('src="cid:konoha-1"');
    expect(payload.text).toContain("/news/subscription/unsubscribe?token=");
    expect(payload.attachments.length).toBeGreaterThan(0);
    expect((await sharp(Buffer.from(payload.attachments[0].content, "base64")).metadata()).format).toBe("jpeg");
    expect(editionJobs()[0].status).toBe("sent");
    await service.tick();
    expect(sender).toHaveBeenCalledTimes(1);
  });

  it.each(["pending", "unsubscribed", "missing"])("拒绝 %s 收件人，不激活订阅、不生成快报任务", async status => {
    await service.initialize();
    if (status === "pending") service.subscribe(to, "127.0.0.1");
    if (status === "unsubscribed") {
      await activate();
      service.unsubscribe(token("unsubscribe"));
    }
    const before = snapshot();
    expect(() => enqueueCurrentEdition(db, { to, send: true, now })).toThrow();
    expect(snapshot()).toEqual(before);
  });

  it.each(["queued", "sending", "sent", "unknown", "cancelled"])("重复命令保留已有 %s 任务及其重试状态", async status => {
    await service.initialize();
    await activate();
    enqueueCurrentEdition(db, { to, send: true, now });
    db.prepare("UPDATE news_mail_outbox SET status=?,attempts=3,next_attempt_at=?,last_error='fixture-original',payload_json=? WHERE kind='edition'")
      .run(status, now + 60_000, JSON.stringify({ text: "persisted original payload" }));
    const before = snapshot();
    const result = enqueueCurrentEdition(db, { to, send: true, now: now + 1_000 });
    expect(result).toMatchObject({ recipients: 1, added: 0, existing: { [status]: 1 } });
    expect(snapshot()).toEqual(before);
  });

  it("自动更新已经入队的同一期不会被手动命令再次发送", async () => {
    await service.initialize();
    await activate();
    now += 60_000;
    edition = { ...edition, version: "526221", pages: [{ ...edition.pages[0], key: "b".repeat(64) + ".jpg" }] };
    await service.initialize();
    expect(editionJobs()).toHaveLength(1);
    const original = editionJobs()[0];
    expect(enqueueCurrentEdition(db, { to, send: true, now })).toMatchObject({ recipients: 1, added: 0, existing: { queued: 1 } });
    expect(editionJobs()).toEqual([original]);
    await service.tick();
    expect(sender).toHaveBeenCalledTimes(1);
    expect(sender.mock.calls[0][0]).toBe(original.id);
  });

  it("入队后退订仍会取消邮件，不绕过 worker 的订阅检查", async () => {
    await service.initialize();
    await activate();
    enqueueCurrentEdition(db, { to, send: true, now });
    service.unsubscribe(token("unsubscribe"));
    await service.tick();
    expect(sender).not.toHaveBeenCalled();
    expect(editionJobs()[0].status).toBe("cancelled");
  });

  it("网络失败保留正式队列的同一 key 和图片正文，重试命令不提前重试", async () => {
    await service.initialize();
    await activate();
    enqueueCurrentEdition(db, { to, send: true, now });
    sender.mockResolvedValueOnce({ status: "retry", delayMs: 60_000, reason: "provider-network" });
    await service.tick();
    expect(editionJobs()[0]).toMatchObject({ status: "queued", attempts: 1, next_attempt_at: now + 60_000 });
    expect(enqueueCurrentEdition(db, { to, send: true, now })).toMatchObject({ recipients: 1, added: 0, existing: { queued: 1 } });
    await service.tick();
    expect(sender).toHaveBeenCalledTimes(1);
    now += 60_000;
    await service.tick();
    expect(sender).toHaveBeenCalledTimes(2);
    expect(sender.mock.calls[1]).toEqual(sender.mock.calls[0]);
    expect(editionJobs()[0].status).toBe("sent");
  });

  it("以 state 指向期次为准，不误用历史表中较晚插入的其他快报", async () => {
    await service.initialize();
    await activate();
    const decoy = { ...edition, version: "999999", pages: [{ ...edition.pages[0], key: "b".repeat(64) + ".jpg" }] };
    db.prepare("INSERT INTO news_mail_editions(id,edition_json,detected_at) VALUES(?,?,?)")
      .run("b".repeat(64), JSON.stringify(decoy), now + 60_000);
    const result = enqueueCurrentEdition(db, { to, send: true, now });
    expect(result.edition.version).toBe("526220");
    expect(editionJobs()[0].edition_id).toBe(db.prepare("SELECT fingerprint FROM news_mail_state WHERE id=1").get().fingerprint);
  });

  it.each(["uninitialized", "empty"])("没有已收录期次时拒绝发送（%s）", async state => {
    if (state === "empty") {
      edition = null;
      await service.initialize();
    }
    await activate();
    const before = snapshot();
    expect(() => enqueueCurrentEdition(db, { to, send: true, now })).toThrow();
    expect(snapshot()).toEqual(before);
  });
});


describe("本期快报发送给执行时全部已确认订阅", () => {
  it("覆盖新加入的 active 邮箱，排除 pending、已退订及未记录确认时间的邮箱", async () => {
    await service.initialize();
    await activate();
    await activate("new-active@example.com");
    service.subscribe("pending@example.com", "127.0.0.1");
    await activate("unsubscribed@example.com");
    service.unsubscribe(token("unsubscribe", "unsubscribed@example.com"));
    await activate("incomplete@example.com");
    db.prepare("UPDATE news_mail_subscribers SET confirmed_at=NULL WHERE email=?").run("incomplete@example.com");
    const before = snapshot();

    const preview = enqueueCurrentEdition(db, { allActive: true, now });
    expect(preview).toMatchObject({ mode: "preview", recipients: 2, added: 0, existing: {} });
    expect(snapshot()).toEqual(before);
    const queued = enqueueCurrentEdition(db, { allActive: true, send: true, now });
    expect(queued).toMatchObject({ mode: "queued", recipients: 2, added: 2, existing: {} });
    expect(editionJobs()).toHaveLength(2);
    expect(snapshot().news_mail_subscribers).toEqual(before.news_mail_subscribers);
    expect(snapshot().news_mail_state).toEqual(before.news_mail_state);

    await service.tick();
    const updates = sender.mock.calls.filter(([, payload]) => payload.subject === "木叶快报已经更新");
    expect(updates.map(([, payload]) => payload.to).sort()).toEqual([to, "new-active@example.com"].sort());
    for (const [, payload] of updates) {
      expect(payload.html).toContain('src="cid:konoha-1"');
      expect(payload.attachments.length).toBeGreaterThan(0);
    }
    expect(enqueueCurrentEdition(db, { allActive: true, send: true, now })).toMatchObject({
      recipients: 2, added: 0, existing: { sent: 2 }
    });
  });

  it("群发与单个邮箱命令共用正式去重，新确认的人仅补入自己的本期邮件", async () => {
    await service.initialize();
    await activate();
    enqueueCurrentEdition(db, { to, send: true, now });
    await service.tick();
    expect(sender).toHaveBeenCalledTimes(1);
    await activate("later@example.com");
    expect(enqueueCurrentEdition(db, { allActive: true, send: true, now })).toMatchObject({
      recipients: 2, added: 1, existing: { sent: 1 }
    });
    await service.tick();
    expect(sender).toHaveBeenCalledTimes(2);
    expect(sender.mock.calls.map(([, payload]) => payload.to)).toEqual([to, "later@example.com"]);
    expect(editionJobs()).toHaveLength(2);
  });

  it("必须明确选单个邮箱或全部 active，不能省略范围或同时传入", async () => {
    await service.initialize();
    await activate();
    const before = snapshot();
    for (const options of [{ send: true, now }, { to, allActive: true, send: true, now }]) {
      expect(() => enqueueCurrentEdition(db, options)).toThrow();
      expect(snapshot()).toEqual(before);
    }
  });
});


describe("指定邮箱的独立带图验收任务", () => {
  it("正式邮件已经 sent 后仍可创建一次指定邮箱验收，原记录和其他订阅保持不变", async () => {
    await service.initialize();
    await activate();
    await activate("other@example.com");
    enqueueCurrentEdition(db, { to, send: true, now });
    await service.tick();
    const original = editionJobs()[0];
    expect(original.status).toBe("sent");
    const before = snapshot();

    const result = enqueueCurrentEdition(db, { to, testId: "mail33-check-20260912", send: true, now });
    expect(result).toMatchObject({ recipients: 1, added: 1, existing: {} });
    expect(editionJobs()).toHaveLength(2);
    expect(editionJobs().find(job => job.id === original.id)).toEqual(original);
    expect(snapshot().news_mail_state).toEqual(before.news_mail_state);
    expect(snapshot().news_mail_subscribers).toEqual(before.news_mail_subscribers);

    await service.tick();
    expect(sender).toHaveBeenCalledTimes(2);
    const [testKey, payload] = sender.mock.calls[1];
    expect(testKey).not.toBe(original.id);
    expect(payload.to).toBe(to);
    expect(payload.subject).toBe("木叶快报已经更新");
    expect(payload.html).toContain('src="cid:konoha-1"');
    expect(payload.attachments.length).toBeGreaterThan(0);
    expect(payload).toEqual(sender.mock.calls[0][1]);
    expect(editionJobs().find(job => job.id === original.id)).toEqual(original);
    expect(editionJobs().every(job => job.status === "sent")).toBe(true);
  });

  it("相同验收编号在 queued 和 sent 后重复执行均不再创建任务或重置正式记录", async () => {
    await service.initialize();
    await activate();
    enqueueCurrentEdition(db, { to, send: true, now });
    await service.tick();
    const options = { to, testId: "mail33-repeat-check", send: true, now };
    expect(enqueueCurrentEdition(db, options)).toMatchObject({ added: 1 });
    const queued = snapshot();
    expect(enqueueCurrentEdition(db, options)).toMatchObject({ added: 0, existing: { queued: 1 } });
    expect(snapshot()).toEqual(queued);
    await service.tick();
    expect(sender).toHaveBeenCalledTimes(2);
    const sent = snapshot();
    expect(enqueueCurrentEdition(db, options)).toMatchObject({ added: 0, existing: { sent: 1 } });
    expect(snapshot()).toEqual(sent);
    expect(enqueueCurrentEdition(db, { to, send: true, now })).toMatchObject({ added: 0, existing: { sent: 1 } });
    await service.tick();
    expect(sender).toHaveBeenCalledTimes(2);
  });

  it("验收编号只允许指定单个邮箱，不能启用全部订阅群发或省略邮箱", async () => {
    await service.initialize();
    await activate();
    const before = snapshot();
    for (const options of [
      { allActive: true, testId: "mail33-unsafe", send: true, now },
      { to, allActive: true, testId: "mail33-unsafe", send: true, now },
      { testId: "mail33-unsafe", send: true, now }
    ]) {
      expect(() => enqueueCurrentEdition(db, options)).toThrow();
      expect(snapshot()).toEqual(before);
    }
    expect(sender).not.toHaveBeenCalled();
  });

  it("无效验收编号在入队前拒绝，不允许空编号、分隔符、换行或超长值", async () => {
    await service.initialize();
    await activate();
    const before = snapshot();
    for (const testId of ["", "_invalid", "with space", "edition:collision", "../path", "line\nbreak", "中文", "x".repeat(65), 123, null]) {
      expect(() => enqueueCurrentEdition(db, { to, testId, send: true, now })).toThrow();
      expect(snapshot()).toEqual(before);
    }
    expect(sender).not.toHaveBeenCalled();
  });
});
