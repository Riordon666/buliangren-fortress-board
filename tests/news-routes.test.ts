import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/news/route";
import { GET as imageGET } from "@/app/api/news/images/[key]/route";

const service = vi.hoisted(() => ({ read: vi.fn(), forceRead: vi.fn(), image: vi.fn() }));
vi.mock("@/lib/news/runtime", () => ({ getNewsService: () => service }));
const state = { status: "ready", edition: { version: "526220" }, checkedAt: "2026-09-10T02:00:00Z", refreshSeconds: 30 };
beforeEach(() => { vi.resetAllMocks(); service.read.mockResolvedValue(state); service.forceRead.mockResolvedValue(state); });
const request = (headers: HeadersInit = {}) => new Request("https://naruto.riordon.xyz/api/news", { method: "POST", headers });

describe("公开快报刷新接口", () => {
  it("匿名 POST 强制更新，不复用普通读取入口", async () => {
    const response = await POST(request({ Origin: "https://naruto.riordon.xyz", Host: "naruto.riordon.xyz" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(state);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(service.forceRead).toHaveBeenCalledOnce();
    expect(service.read).not.toHaveBeenCalled();
  });
  it.each<HeadersInit>([{ Origin: "https://evil.test" }, { Origin: "null" }, { Origin: "malformed" }, { "Sec-Fetch-Site": "cross-site" }])("拒绝跨站或异常来源且不触发抓取 %j", async (headers) => {
    expect((await POST(request(headers))).status).toBe(403);
    expect(service.forceRead).not.toHaveBeenCalled();
  });
  it("重复刷新返回短暂等待提示", async () => {
    service.forceRead.mockResolvedValue(null);
    const response = await POST(request());
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("5");
  });
  it("首次同步失败返回 503，已有缓存失败仍可阅读", async () => {
    service.read.mockResolvedValueOnce({ ...state, status: "unavailable", edition: null });
    expect((await GET()).status).toBe(503);
    service.read.mockResolvedValueOnce({ ...state, status: "stale" });
    const response = await GET();
    expect(response.status).toBe(200);
    expect((await response.json()).status).toBe("stale");
  });
  it("图片按内容哈希缓存，同时支持条件请求", async () => {
    const key = "a".repeat(64) + ".jpg";
    service.image.mockResolvedValue(Buffer.from("verified-image"));
    const context = { params: Promise.resolve({ key }) };
    const response = await imageGET(new Request("https://naruto.riordon.xyz/api/news/images/" + key), context);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(response.headers.get("cache-control")).toContain("immutable");
    const etag = response.headers.get("etag")!;
    const cached = await imageGET(new Request("https://naruto.riordon.xyz/api/news/images/" + key, { headers: { "If-None-Match": etag } }), context);
    expect(cached.status).toBe(304);
  });
  it("无效图片路径不会访问文件系统", async () => {
    expect((await imageGET(new Request("https://naruto.riordon.xyz/api/news/images/x"), { params: Promise.resolve({ key: "../edition.json" }) })).status).toBe(404);
    expect(service.image).not.toHaveBeenCalled();
  });
});
