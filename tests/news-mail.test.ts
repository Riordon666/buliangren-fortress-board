import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { getMailConfig, signSubscriptionToken, type MailConfig } from "@/lib/news-mail/config";
import { NewsMailService } from "@/lib/news-mail/service";
import { sendMail, type MailPayload, type SendResult } from "@/lib/news-mail/provider";
import { makeMailImages } from "@/lib/news-mail/images";
import type { NewsEdition, NewsState } from "@/lib/news/types";
import type { Subscriber } from "@/lib/news-mail/store";
const config: MailConfig = { apiUrl: "https://mail.riordon.xyz/api/integrations/konoha/send", apiToken: "api-secret-".repeat(5), subscriptionSecret: "subscription-secret-".repeat(4), publicUrl: "https://naruto.riordon.xyz" };
let db: Database.Database;
let service: NewsMailService;
let now: number;
let edition: NewsEdition | null;
let bytes: Buffer;
let sender: ReturnType<typeof vi.fn<(key: string, payload: MailPayload) => Promise<SendResult>>>;
const source = { read: async () => ({ edition, status: edition ? "ready" : "unavailable" }) as NewsState, image: async () => bytes };
const row = (email = "ninja@example.com") => db.prepare("SELECT * FROM news_mail_subscribers WHERE email=?").get(email) as Subscriber;
const token = (purpose: "confirm" | "unsubscribe", email?: string) => signSubscriptionToken(config, { id: row(email).id, generation: row(email).generation, purpose });
async function activate(email = "ninja@example.com") { service.subscribe(email, "127.0.0.1"); await service.confirm(token("confirm", email)); }
const jobs = () => db.prepare("SELECT * FROM news_mail_outbox ORDER BY created_at,id").all() as Array<{ status: string; attempts: number; last_error: string | null; id: string }>;
function change(letter = "b") { edition = { ...edition!, version: "526221", syncedAt: new Date(now).toISOString(), pages: [{ key: letter.repeat(64) + ".jpg", width: 200, height: 400 }] }; }
beforeEach(async () => {
  db = new Database(":memory:"); db.pragma("foreign_keys=ON");
  now = Date.parse("2026-09-15T15:00:00+08:00");
  edition = { version: "526220", title: "火影忍者手游木叶快报", sourceUrl: "https://act.supercore.qq.com/", syncedAt: new Date(now).toISOString(), pages: [{ key: "a".repeat(64) + ".jpg", width: 200, height: 400 }] };
  bytes = await sharp({ create: { width: 200, height: 400, channels: 3, background: "#d08040" } }).jpeg().toBuffer();
  sender = vi.fn(async () => ({ status: "sent", id: "provider-test-id" } as SendResult));
  service = new NewsMailService(db, config, source, () => now, sender);
});
afterEach(() => { db.close(); });

describe("邮件配置与订阅确认", () => {
  it("未配置或弱secret时关闭，不接受HTTP或带路径的公共网址", () => {
    expect(getMailConfig({})).toBeNull();
    const env = { NEWS_MAIL_API_URL: config.apiUrl, NEWS_MAIL_API_TOKEN: config.apiToken, NEWS_SUBSCRIPTION_SECRET: config.subscriptionSecret, NEWS_PUBLIC_URL: config.publicUrl };
    expect(getMailConfig(env)).toEqual(config);
    expect(getMailConfig({ ...env, NEWS_MAIL_API_TOKEN: "short" })).toBeNull();
    expect(getMailConfig({ ...env, NEWS_PUBLIC_URL: config.publicUrl + "/news" })).toBeNull();
    expect(getMailConfig({ ...env, NEWS_MAIL_API_URL: "http://mail.riordon.xyz/api" })).toBeNull();
  });
  it("邮件代理未设置时直连，设置后仅接受完整的SOCKS5远程DNS地址", () => {
    const env = { NEWS_MAIL_API_URL: config.apiUrl, NEWS_MAIL_API_TOKEN: config.apiToken, NEWS_SUBSCRIPTION_SECRET: config.subscriptionSecret, NEWS_PUBLIC_URL: config.publicUrl };
    expect(getMailConfig({ ...env, NEWS_MAIL_PROXY_URL: "" })).toEqual(config);
    const proxyUrl = "socks5h://local-user:encoded%23password@127.0.0.1:38157";
    expect(getMailConfig({ ...env, NEWS_MAIL_PROXY_URL: proxyUrl })).toEqual({ ...config, proxyUrl });
    for (const value of ["http://127.0.0.1:38157", "socks5://127.0.0.1:38157", "socks5h://127.0.0.1", "socks5h://127.0.0.1:0", "socks5h://127.0.0.1:38157/path", "socks5h://127.0.0.1:38157?token=bad"]) {
      expect(getMailConfig({ ...env, NEWS_MAIL_PROXY_URL: value })).toBeNull();
    }
  });
  it("只给输入的单一邮箱发确认邮件，未确认不发快报", async () => {
    service.subscribe(" Ninja@Example.com ", "127.0.0.1");
    expect(row().status).toBe("pending");
    await service.tick();
    expect(sender).toHaveBeenCalledTimes(1);
    const payload = sender.mock.calls[0][1];
    expect(payload.to).toBe("ninja@example.com");
    expect(payload.subject).toContain("确认订阅");
    expect(payload.text).toContain("/news/subscription/confirm?token=");
    now += 60_000; change(); await service.tick();
    expect(sender).toHaveBeenCalledTimes(1);
  });
  it("确认幂等、token不可跨用途使用，24小时后失效", async () => {
    service.subscribe("ninja@example.com", "127.0.0.1");
    await expect(service.confirm(token("unsubscribe"))).rejects.toMatchObject({ status: 400 });
    await expect(service.confirm(token("confirm") + "x")).rejects.toMatchObject({ status: 400 });
    now += 86_400_000;
    await expect(service.confirm(token("confirm"))).rejects.toMatchObject({ status: 400 });
    service.subscribe("ninja@example.com", "127.0.0.1");
    const valid = token("confirm");
    await service.confirm(valid); await service.confirm(valid);
    expect(row().status).toBe("active");
  });
  it("邮箱重发冷却持久化，重启不能绕过；旧确认链接失效", async () => {
    service.subscribe("ninja@example.com", "127.0.0.1");
    const old = token("confirm");
    service = new NewsMailService(db, config, source, () => now, sender);
    expect(() => service.subscribe("NINJA@example.com", "127.0.0.1")).toThrow("请求较频繁");
    now += 60_000; service.subscribe("ninja@example.com", "127.0.0.1");
    await expect(service.confirm(old)).rejects.toMatchObject({ status: 400 });
    expect(jobs().filter(job => job.status === "queued")).toHaveLength(1);
  });
  it("无效邮箱不落库、每来源限额不因不同邮箱而绕过", () => {
    expect(() => service.subscribe("a@example.com\nBcc:x@example.com", "127.0.0.1")).toThrow();
    expect(db.prepare("SELECT COUNT(*) AS count FROM news_mail_subscribers").get()).toEqual({ count: 0 });
    for (let i = 0; i < 20; i++) service.subscribe(`ninja${i}@example.com`, "127.0.0.1");
    expect(() => service.subscribe("last@example.com", "127.0.0.1")).toThrow("请求较频繁");
  });
});

describe("新一期识别与恢复", () => {
  it("首次启用以旧快报建立基准，不群发；版本变化但内容相同不通知", async () => {
    await activate(); await service.tick();
    expect(sender).not.toHaveBeenCalled();
    edition!.version = "526222"; now += 60_000; await service.tick();
    expect(sender).not.toHaveBeenCalled();
  });
  it("无缓存时首次完整同步仍只建立基准", async () => {
    const old = edition; edition = null;
    await activate(); await service.initialize();
    edition = old; await service.tick();
    expect(sender).not.toHaveBeenCalled();
    change(); now += 60_000; await service.tick();
    expect(sender).toHaveBeenCalledTimes(1);
  });
  it("图片变化每人单发一次，CID图片随邮件发送，重启/反复读不重复", async () => {
    await service.initialize(); await activate(); await activate("other@example.com");
    now += 60_000; change(); await service.tick();
    expect(sender).toHaveBeenCalledTimes(2);
    expect(sender.mock.calls.map(call => call[1].to).sort()).toEqual(["ninja@example.com", "other@example.com"]);
    for (const [,payload] of sender.mock.calls) {
      expect(payload.subject).toBe("木叶快报已经更新");
      expect(payload.attachments!.length).toBeGreaterThan(0);
      expect(payload.html).toContain('src="cid:konoha-1"');
      expect(payload.html).not.toContain('src="https://');
      expect(payload.text).toContain("/news/subscription/unsubscribe?token=");
      expect(payload.html).not.toContain(payload.to === "ninja@example.com" ? "other@example.com" : "ninja@example.com");
    }
    service = new NewsMailService(db, config, source, () => now, sender);
    await service.tick(); await service.tick();
    expect(sender).toHaveBeenCalledTimes(2);
  });
  it("缓存提交后进程退出，重启核对仍能补入队；缓存缺失不重置基准", async () => {
    await service.initialize(); await activate(); now += 60_000; change();
    service = new NewsMailService(db, config, source, () => now, sender);
    await service.tick(); expect(sender).toHaveBeenCalledTimes(1);
    const current = edition; edition = null; await service.tick(); edition = current;
    await service.tick(); expect(sender).toHaveBeenCalledTimes(1);
  });
  it("刚确认时已经展示的新一期不补发，恢复曾见过的旧图也不重发", async () => {
    await service.initialize(); change(); await activate(); await service.tick();
    expect(sender).not.toHaveBeenCalled();
    now += 60_000; change("a"); await service.tick();
    expect(sender).not.toHaveBeenCalled();
    change("c"); await service.tick(); expect(sender).toHaveBeenCalledTimes(1);
  });
  it("确认前预取链接没有状态变更；退订取消排队快报且不可用确认token退订", async () => {
    await service.initialize(); await activate(); now += 60_000; change(); await service.initialize();
    expect(jobs().some(job => job.status === "queued")).toBe(true);
    expect(() => service.unsubscribe(token("confirm"))).toThrow();
    service.unsubscribe(token("unsubscribe")); service.unsubscribe(token("unsubscribe"));
    await service.tick(); expect(sender).not.toHaveBeenCalled();
    expect(row().status).toBe("unsubscribed");
  });
});

describe("投递队列", () => {
  it("超时使用同幂等key与完全相同payload退避重试", async () => {
    await service.initialize(); await activate(); now += 60_000; change();
    sender.mockResolvedValueOnce({ status: "retry", delayMs: 60_000, reason: "provider-network" });
    await service.tick(); await service.tick();
    expect(sender).toHaveBeenCalledTimes(1);
    expect(jobs().find(job => job.status === "queued")!.attempts).toBe(1);
    now += 60_000;
    service = new NewsMailService(db, config, source, () => now, sender);
    await service.tick();
    expect(sender).toHaveBeenCalledTimes(2);
    expect(sender.mock.calls[1]).toEqual(sender.mock.calls[0]);
  });
  it("不确定结果永久停在unknown，其他收件人仍可发送", async () => {
    await service.initialize(); await activate(); await activate("other@example.com"); now += 60_000; change();
    sender.mockResolvedValueOnce({ status: "unknown", reason: "provider-uncertain-or-conflict" });
    await service.tick(); now += 86_400_000; await service.tick();
    expect(sender).toHaveBeenCalledTimes(2);
    expect(jobs().filter(job => job.status === "unknown")).toHaveLength(1);
  });
  it("恢复过期租约、同进程并发tick只发送一次", async () => {
    await service.initialize(); await activate(); now += 60_000; change(); await service.initialize();
    db.prepare("UPDATE news_mail_outbox SET status='sending',lease_until=? WHERE status='queued'").run(now - 1);
    await Promise.all([service.tick(), service.tick(), service.tick()]);
    expect(sender).toHaveBeenCalledTimes(1);
  });
  it("每轮最多5封，每分钟最多10次尝试，重启也受限", async () => {
    for (let i = 0; i < 12; i++) service.subscribe(`ninja${i}@example.com`, "127.0.0.1");
    await service.tick(); expect(sender).toHaveBeenCalledTimes(5);
    await service.tick(); expect(sender).toHaveBeenCalledTimes(10);
    service = new NewsMailService(db, config, source, () => now, sender);
    await service.tick(); expect(sender).toHaveBeenCalledTimes(10);
    now += 60_000; await service.tick(); expect(sender).toHaveBeenCalledTimes(12);
  });
});

describe("邮箱API契约", () => {
  const payload: MailPayload = { to: "ninja@example.com", subject: "木叶快报", text: "更新", html: "<p>更新</p>" };
  it.each([
    [200, {status: "sent", id: "message-1"}, "sent"], [202, {status: "processing"}, "retry"],
    [409, {status: "unknown"}, "unknown"], [409, {status: "conflict"}, "unknown"],
    [429, {}, "retry"], [503, {}, "retry"], [413, {}, "unknown"], [200, {status: "ok"}, "unknown"]
  ])("处理状态 %s %j", async (status, body, expected) => {
    const fake = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(body), {status: Number(status), headers: {"retry-after":"90"}}));
    const result = await sendMail(config.apiUrl, config.apiToken, "stable-key", payload, fake);
    expect(result.status).toBe(expected);
    expect(fake.mock.calls[0][1]).toMatchObject({ redirect: "error", headers: { Authorization: `Bearer ${config.apiToken}`, "Idempotency-Key": "stable-key" } });
  });
  it("网络响应丢失可重试且不换key", async () => {
    const fake = vi.fn<typeof fetch>().mockRejectedValue(new Error("network"));
    expect(await sendMail(config.apiUrl, config.apiToken, "stable-key", payload, fake)).toMatchObject({status: "retry", reason: "provider-network"});
  });
  it("200响应正文中途断流仍可用同key重试，完整畸形或超长正文才停止", async () => {
    const interrupted = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode('{"status":"sent",')); controller.error(new Error("connection-lost")); } });
    const fake = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(interrupted, {status: 200}));
    expect(await sendMail(config.apiUrl, config.apiToken, "stable-key", payload, fake)).toMatchObject({ status: "retry", reason: "provider-network" });
    fake.mockResolvedValueOnce(new Response('{"status":', {status:200}));
    expect(await sendMail(config.apiUrl, config.apiToken, "stable-key", payload, fake)).toMatchObject({status: "unknown", reason: "provider-invalid-response"});
    fake.mockResolvedValueOnce(new Response("x".repeat(33_000), {status:200}));
    expect(await sendMail(config.apiUrl, config.apiToken, "stable-key", payload, fake)).toMatchObject({status: "unknown", reason: "provider-invalid-response"});
  });
  it("API日限额耗尽不会在次日之前用尽重试次数", async () => {
    await service.initialize(); await activate(); now += 60_000; change(); await service.initialize();
    db.prepare("UPDATE news_mail_outbox SET attempts=12 WHERE status='queued'").run();
    sender.mockResolvedValueOnce({status:"retry",delayMs:3_600_000,reason:"provider-rate-limit"});
    await service.tick();
    expect(jobs().some(job => job.status === "queued" && job.attempts === 13)).toBe(true);
    now += 86_400_000; await service.tick();
    expect(jobs().some(job => job.status === "sent")).toBe(true);
  });
  it("超长图按段提供最多8张JPEG预览、保留清晰网页入口", async () => {
    const long = await sharp({ create: { width: 600, height: 20000, channels: 3, background: "#d08040" } }).png().toBuffer();
    const images = await makeMailImages({ ...edition!, pages: [{ key: "a".repeat(64)+".png", width: 600, height: 20000 }] }, async () => long);
    expect(images.attachments).toHaveLength(8); expect(images.preview).toBe(true);
    expect(images.attachments.reduce((total, image) => total + image.content.length, 0)).toBeLessThanOrEqual(4 * 1024 * 1024);
    expect((await sharp(Buffer.from(images.attachments[0].content, "base64")).metadata()).format).toBe("jpeg");
  });
});
