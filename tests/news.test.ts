import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { isAllowedSourceUrl, parseNewsEntry, parseNewsPosters } from "@/lib/news/parser";
import { fetchNewsResource, type NewsFetch } from "@/lib/news/fetch";
import { NewsService } from "@/lib/news/service";
import { NEWS_SOURCE_URL, NEWS_USER_AGENT } from "@/lib/news/types";

const source = "https://act.supercore.qq.com/supercore/act/a572ef51becd748b4ab1c0b0199721be0/index.html?ShortLinkId=64140e3528855";
const app = new URL("js/app.7c7c3c7a.js", source).href;
const poster = "https://act.supercore.qq.com/activity/supercore/12854/2cba2270dd6c7e9900d74bd12b48488c.jpg";
function html(version = "526220") { return `<title>火影忍者手游木叶快报</title><script>window.CEIBA_ACT_VERSION=${version};</script><script defer src="js/app.7c7c3c7a.js"></script>`; }
function activity(image = poster, components: unknown[] = []) { return { activity_id: 12854, game_code: "hyrz", config: { pages: [{ id: "page" }], configs: { page: { canvasConfig: { backgroundImage: { src: image } }, componentConfig: components } } } }; }
function bundle(value: unknown = activity()) { return `module.exports=JSON.parse('${JSON.stringify(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'")}');`; }
let version: string;
let blocked: boolean;
let image: Buffer;
let fetcher: ReturnType<typeof vi.fn<NewsFetch>>;
let directory: string;
let now: number;
let service: NewsService;

beforeEach(async () => {
  directory = path.join(path.dirname(process.env.DATABASE_PATH!), `news-${crypto.randomUUID()}`);
  version = "526220";
  blocked = false;
  now = Date.parse("2026-09-08T07:00:00Z");
  image = await sharp({ create: { width: 30, height: 60, channels: 3, background: "#446644" } }).jpeg().toBuffer();
  fetcher = vi.fn<NewsFetch>(async (input) => {
    const url = String(input);
    if (blocked) return new Response("blocked", { status: 567 });
    if (url === NEWS_SOURCE_URL) return new Response(null, { status: 302, headers: { Location: source } });
    if (url === source) return new Response(html(version));
    if (url === app) return new Response(bundle());
    if (url === poster) return new Response(new Uint8Array(image), { headers: { "Content-Type": "image/jpeg" } });
    throw new Error("Unexpected test URL");
  });
  service = new NewsService(directory, fetcher, () => now);
});

describe("木叶快报源站解析", () => {
  it("读取已验证的发布版本和相对主程序地址", () => {
    expect(parseNewsEntry(html(), source)).toEqual({ version: "526220", scriptUrl: app, sourceUrl: source });
    expect(parseNewsPosters(bundle())).toEqual([poster]);
  });
  it("安全解码配置字符串中的引号、换行与 Unicode，不执行主程序", () => {
    const config = { ...activity(), description: "Itachi's report\n火之意志\\木叶" };
    const code = bundle(config).replace("木叶", "\\u6728\\u53f6") + ";throw new Error('MUST NOT EXECUTE');";
    expect(parseNewsPosters(code)).toEqual([poster]);
  });
  it.each(["<title>安全验证</title>", "<title>请求已被拦截</title>", "<title>火影忍者手游木叶快报</title>"])("200 中间页也不能被认作最新快报：%s", (body) => {
    expect(() => parseNewsEntry(body, source)).toThrow();
  });
  it.each(["http://act.supercore.qq.com/", "https://127.0.0.1/", "https://act.supercore.qq.com.evil.test/", "https://act.supercore.qq.com:8443/", "https://act.supercore.qq.com/activity/private.json", "file:///etc/passwd", "https://u:p@act.supercore.qq.com/"])("拒绝非公开内容地址 %s", (url) => {
    expect(isAllowedSourceUrl(url)).toBe(false);
  });
  it("拒绝图片地址注入及未知叠加布局，保留原图完整性", () => {
    expect(() => parseNewsPosters(bundle(activity("https://localhost/internal")))).toThrow("invalid-image");
    expect(() => parseNewsPosters(bundle(activity(poster, [{ text: "new overlay" }])))).toThrow("unsupported-layout");
    expect(() => parseNewsPosters(bundle({ ...activity(), activity_id: 1 }))).toThrow("missing-activity-config");
  });
  it("按配置页序读取多张长图并去重", () => {
    const second = poster.replace("2cba2270dd6c7e9900d74bd12b48488c", "second");
    const a = activity();
    const b = activity(second);
    const config = { ...a, config: { pages: [{ id: "b" }, { id: "a" }, { id: "a" }], configs: { a: a.config.configs.page, b: b.config.configs.page } } };
    expect(parseNewsPosters(bundle(config))).toEqual([second, poster]);
  });
});

describe("限定来源与读取大小", () => {
  it("使用标准手机请求头，禁止框架与浏览器旧缓存", async () => {
    await fetchNewsResource(NEWS_SOURCE_URL, 1_000_000, fetcher);
    expect(fetcher.mock.calls[0][1]).toMatchObject({ cache: "no-store", redirect: "manual", headers: { "User-Agent": NEWS_USER_AGENT, "Cache-Control": "no-cache" } });
  });
  it("跳转到内网时在第二次请求前拒绝", async () => {
    const denied = vi.fn<NewsFetch>().mockResolvedValue(new Response(null, { status: 302, headers: { Location: "http://127.0.0.1/private" } }));
    await expect(fetchNewsResource(NEWS_SOURCE_URL, 100, denied)).rejects.toThrow("untrusted-source");
    expect(denied).toHaveBeenCalledTimes(1);
  });
  it("限制重定向数量", async () => {
    const loop = vi.fn<NewsFetch>(async () => new Response(null, { status: 302, headers: { Location: NEWS_SOURCE_URL } }));
    await expect(fetchNewsResource(NEWS_SOURCE_URL, 100, loop)).rejects.toThrow("too-many-redirects");
    expect(loop).toHaveBeenCalledTimes(5);
  });
  it("限制未知 Content-Length 的流式正文大小", async () => {
    const large = vi.fn<NewsFetch>().mockResolvedValue(new Response("123456789"));
    await expect(fetchNewsResource(NEWS_SOURCE_URL, 8, large)).rejects.toThrow("source-too-large");
  });
});

describe("按周计划同步与手动更新", () => {
  const sync = async () => { await service.refresh(); return service.read(); };
  const changedImage = async () => { image = await sharp({ create: { width: 30, height: 60, channels: 3, background: "#aa5522" } }).jpeg().toBuffer(); };

  it("页面、GET 和并发访客只读本站缓存，不触发源站请求", async () => {
    const states = await Promise.all(Array.from({ length: 20 }, () => service.read()));
    expect(states.every(state => state.status === "unavailable")).toBe(true);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("非检查时段即使缓存为空也不自动请求", async () => {
    now = Date.parse("2026-09-10T10:00:00+08:00");
    await service.refresh();
    expect(fetcher).not.toHaveBeenCalled();
    expect((await service.read()).schedule.nextCheckAt).toBe("2026-09-15T07:00:00.000Z");
  });
  it("首次计划检查缓存完整长图；只建立基准，不误判本周已更新", async () => {
    await Promise.all(Array.from({ length: 8 }, () => service.refresh()));
    const state = await service.read();
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(state).toMatchObject({ status: "ready", schedule: { phase: "active" } });
    expect(await service.image(state.edition!.pages[0].key)).toEqual(image);
  });
  it("周二五分钟才再次读取入口；成功读取旧内容不暂停", async () => {
    await sync();
    now += 299_999;
    await sync();
    expect(fetcher).toHaveBeenCalledTimes(4);
    now++;
    const checked = await sync();
    expect(fetcher).toHaveBeenCalledTimes(6);
    expect(checked.schedule.phase).toBe("active");
  });
  it("只有版本号变化、长图未变时继续检查，收录时间不变", async () => {
    const first = await sync();
    version = "526221"; now += 300_000;
    const next = await sync();
    expect(next.edition?.version).toBe(version);
    expect(next.edition?.syncedAt).toBe(first.edition?.syncedAt);
    expect(next.schedule.phase).toBe("active");
  });
  it("检测到新长图后暂停本周，周三不再抓取", async () => {
    await sync();
    version = "526221"; await changedImage(); now += 300_000;
    expect((await sync()).schedule).toMatchObject({ phase: "complete", nextCheckAt: "2026-09-15T07:00:00.000Z" });
    const calls = fetcher.mock.calls.length;
    now = Date.parse("2026-09-09T16:00:00+08:00");
    await sync();
    expect(fetcher).toHaveBeenCalledTimes(calls);
  });
  it("本周暂停状态跨重启保留，下周恢复且不会把上一期当新一期", async () => {
    await sync();
    version = "526221"; await changedImage(); now += 300_000;
    await sync();
    service = new NewsService(directory, fetcher, () => now);
    expect((await service.read()).schedule.phase).toBe("complete");
    const count = fetcher.mock.calls.length;
    await sync();
    expect(fetcher).toHaveBeenCalledTimes(count);
    now = Date.parse("2026-09-15T15:00:00+08:00");
    expect((await sync()).schedule.phase).toBe("active");
    expect(fetcher).toHaveBeenCalledTimes(count + 2);
  });
  it("周二20点停止，周三15点恢复且间隔一分钟", async () => {
    now = Date.parse("2026-09-08T19:55:00+08:00");
    await sync();
    now += 300_000; await sync();
    expect(fetcher).toHaveBeenCalledTimes(4);
    now = Date.parse("2026-09-09T15:00:00+08:00"); await sync();
    now += 59_999; await sync();
    expect(fetcher).toHaveBeenCalledTimes(6);
    now++; await sync();
    expect(fetcher).toHaveBeenCalledTimes(8);
  });
  it("检查间隔也持久化，重启不会导致额外请求", async () => {
    await sync();
    service = new NewsService(directory, fetcher, () => now);
    await sync();
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(await service.forceRead()).toBeNull();
    expect(service.retryAfterSeconds()).toBe(60);
  });
  it("时段外可手动更新，一分钟内重复点击不会重复访问", async () => {
    now = Date.parse("2026-09-10T10:00:00+08:00");
    const first = await service.forceRead();
    expect(first?.status).toBe("ready");
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(await service.forceRead()).toBeNull();
    now += 60_000; await changedImage();
    const forced = await service.forceRead();
    expect(forced?.edition?.pages[0].key).not.toBe(first?.edition?.pages[0].key);
    expect(fetcher).toHaveBeenCalledTimes(8);
  });
  it("自动和手动同时触发时共用进行中的一次更新", async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    fetcher.mockImplementationOnce(async () => { await gate; return new Response(null, { status: 302, headers: { Location: source } }); });
    const automatic = service.refresh();
    const manual = service.forceRead();
    release();
    await Promise.all([automatic, manual]);
    expect(fetcher).toHaveBeenCalledTimes(4);
  });
  it("未知新旧的首次内容和断档多周的缓存不会直接停止当前周期", async () => {
    const first = await sync();
    const old = JSON.parse(await fs.readFile(path.join(directory, "edition.json"), "utf8"));
    old.checkedAt = "2026-08-01T00:00:00Z"; old.cycle = null; old.attemptedAt = null;
    await fs.writeFile(path.join(directory, "edition.json"), JSON.stringify(old));
    service = new NewsService(directory, fetcher, () => now);
    version = "526221"; await changedImage();
    const next = await sync();
    expect(next.edition?.pages[0].key).not.toBe(first.edition?.pages[0].key);
    expect(next.schedule.phase).toBe("active");
  });
  it("兼容旧版 edition.json，升级后时段外直接读取原有图片", async () => {
    const first = await sync();
    const stored = JSON.parse(await fs.readFile(path.join(directory, "edition.json"), "utf8"));
    await fs.writeFile(path.join(directory, "edition.json"), JSON.stringify({ signature: stored.signature, edition: stored.edition }));
    now = Date.parse("2026-09-10T10:00:00+08:00");
    service = new NewsService(directory, fetcher, () => now);
    expect((await service.read()).edition).toEqual(first.edition);
    await sync();
    expect(fetcher).toHaveBeenCalledTimes(4);
  });
  it("验证页不会覆盖内容或完成本周；失败状态跨重启保留", async () => {
    const first = await sync();
    fetcher.mockImplementation(async () => new Response("<title>安全验证</title>"));
    now += 300_000;
    expect(await sync()).toMatchObject({ status: "stale", edition: first.edition, checkedAt: first.checkedAt, schedule: { phase: "active" } });
    service = new NewsService(directory, fetcher, () => now);
    expect((await service.read()).status).toBe("stale");
    await sync();
    expect(fetcher).toHaveBeenCalledTimes(5);
  });
  it("新版本图片失败时不暂停、不发布半成品，下次完整成功才暂停", async () => {
    const first = await sync();
    version = "526221";
    image = Buffer.from("blocked"); now += 300_000;
    expect(await sync()).toMatchObject({ status: "stale", edition: first.edition, schedule: { phase: "active" } });
    await changedImage(); now += 300_000;
    expect(await sync()).toMatchObject({ status: "ready", schedule: { phase: "complete" } });
  });
  it("源站失败也计入检查间隔，没有请求风暴", async () => {
    blocked = true;
    await sync(); await sync(); await service.read();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect((await service.read()).status).toBe("unavailable");
    now += 300_000; blocked = false;
    expect((await sync()).status).toBe("ready");
  });
  it("本周暂停后仍可手动检查，而周一的内容变化不提前暂停周二", async () => {
    await sync();
    version = "526221"; await changedImage(); now += 300_000;
    await sync();
    now += 60_000;
    expect((await service.forceRead())?.schedule.phase).toBe("complete");
    now = Date.parse("2026-09-14T16:00:00+08:00");
    version = "526222";
    image = await sharp({ create: { width: 30, height: 60, channels: 3, background: "#2222bb" } }).jpeg().toBuffer();
    expect((await service.forceRead())?.schedule.phase).toBe("scheduled");
    now = Date.parse("2026-09-15T15:00:00+08:00");
    expect((await sync()).schedule.phase).toBe("active");
  });
  it("图片接口不能读取缓存目录外的文件", async () => {
    expect(await service.image("../../package.json")).toBeNull();
    expect(await service.image("x.svg")).toBeNull();
  });
});
