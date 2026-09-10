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
  now = Date.parse("2026-09-10T02:00:00Z");
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

describe("自动同步与手动立即刷新", () => {
  it("首次读取即解析并缓存快报；并发访问只抓取一次", async () => {
    const states = await Promise.all(Array.from({ length: 8 }, () => service.read()));
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(states.every(state => state.status === "ready")).toBe(true);
    const page = states[0].edition!.pages[0];
    expect(page).toMatchObject({ width: 30, height: 60 });
    expect(await service.image(page.key)).toEqual(image);
    expect(JSON.parse(await fs.readFile(path.join(directory, "edition.json"), "utf8")).edition.version).toBe(version);
  });
  it("30 秒内复用结果，到期只核对入口；新版本再读取内容", async () => {
    await service.read();
    await service.read();
    expect(fetcher).toHaveBeenCalledTimes(4);
    now += 30_000;
    await service.read();
    expect(fetcher).toHaveBeenCalledTimes(6);
    version = "526221";
    now += 30_000;
    expect((await service.read()).edition?.version).toBe("526221");
    expect(fetcher).toHaveBeenCalledTimes(10);
  });
  it("手动刷新不等定时器，并重新读取配置和长图", async () => {
    const first = await service.read();
    image = await sharp({ create: { width: 30, height: 60, channels: 3, background: "#aa5522" } }).jpeg().toBuffer();
    now += 1_000;
    const forced = await service.forceRead();
    expect(forced?.status).toBe("ready");
    expect(forced?.edition?.pages[0].key).not.toBe(first.edition?.pages[0].key);
    expect(fetcher).toHaveBeenCalledTimes(8);
    expect(await service.forceRead()).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(8);
  });
  it("自动检查进行中点击刷新，完成后仍会重新抓取完整内容", async () => {
    await service.read();
    now += 30_000;
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    fetcher.mockImplementationOnce(async () => { await gate; return new Response(null, { status: 302, headers: { Location: source } }); });
    const automatic = service.read();
    await Promise.resolve();
    const manual = service.forceRead();
    release();
    await Promise.all([automatic, manual]);
    expect(fetcher).toHaveBeenCalledTimes(10);
    expect(fetcher.mock.calls.filter(([url]) => String(url) === app)).toHaveLength(2);
  });
  it("无变化的手动核对不会改变本期收录时间", async () => {
    const first = await service.read();
    now += 2_000;
    const forced = await service.forceRead();
    expect(forced?.edition?.syncedAt).toBe(first.edition?.syncedAt);
    expect(forced?.checkedAt).not.toBe(first.checkedAt);
  });
  it("源站失败时保留上一期和上次核对时间，恢复后自动追新", async () => {
    const first = await service.read();
    blocked = true;
    now += 30_000;
    const stale = await service.read();
    expect(stale).toMatchObject({ status: "stale", edition: first.edition, checkedAt: first.checkedAt });
    blocked = false;
    version = "526222";
    now += 30_000;
    expect(await service.read()).toMatchObject({ status: "ready", edition: { version: "526222" } });
  });
  it("返回 200 的验证页不会覆盖已有快报", async () => {
    const first = await service.read();
    fetcher.mockImplementation(async () => new Response("<title>安全验证</title>"));
    now += 30_000;
    expect(await service.read()).toMatchObject({ status: "stale", edition: first.edition });
  });
  it("新版本长图失败时不发布不完整更新，重试后可恢复", async () => {
    const first = await service.read();
    version = "526223";
    const validImage = image;
    image = Buffer.from("<html>blocked</html>");
    now += 30_000;
    expect(await service.read()).toMatchObject({ status: "stale", edition: first.edition });
    image = validImage;
    now += 30_000;
    expect((await service.read()).edition?.version).toBe("526223");
  });
  it("重启后源站不可用仍能读取持久缓存", async () => {
    const first = await service.read();
    blocked = true;
    const restarted = new NewsService(directory, fetcher, () => now);
    expect(await restarted.read()).toMatchObject({ status: "stale", edition: first.edition });
    expect(await restarted.image(first.edition!.pages[0].key)).toEqual(image);
  });
  it("没有成功内容时明确返回不可用，不编造快报", async () => {
    blocked = true;
    expect(await service.read()).toMatchObject({ status: "unavailable", edition: null, checkedAt: null });
  });
  it("图片接口不能读取缓存目录外的文件", async () => {
    expect(await service.image("../../package.json")).toBeNull();
    expect(await service.image("x.svg")).toBeNull();
  });
});
