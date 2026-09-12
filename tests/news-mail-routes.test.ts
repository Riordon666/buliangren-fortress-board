import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST as subscribe } from "@/app/api/news/subscriptions/route";
import { POST as confirm } from "@/app/api/news/subscriptions/confirm/route";
import { POST as unsubscribe } from "@/app/api/news/subscriptions/unsubscribe/route";
import { MailRequestError } from "@/lib/news-mail/store";
const mocks = vi.hoisted(() => ({ config: vi.fn(), service: vi.fn(), subscribe: vi.fn(), confirm: vi.fn(), unsubscribe: vi.fn() }));
vi.mock("@/lib/news-mail/config", () => ({ getMailConfig: mocks.config }));
vi.mock("@/lib/news-mail/runtime", () => ({ getNewsMailService: mocks.service }));
const request = (body: unknown, headers: HeadersInit = {}) => new Request("https://naruto.riordon.xyz/api/news/subscriptions", { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://naruto.riordon.xyz", ...headers }, body: JSON.stringify(body) });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.config.mockReturnValue({ publicUrl: "https://naruto.riordon.xyz" });
  mocks.service.mockReturnValue({ subscribe: mocks.subscribe, confirm: mocks.confirm, unsubscribe: mocks.unsubscribe });
});
describe("公开邮件订阅接口", () => {
  it("关闭配置时503且不读取数据库或收集邮箱", async () => {
    mocks.config.mockReturnValue(null);
    const response = await subscribe(request({email:"ninja@example.com"}));
    expect(response.status).toBe(503); expect(mocks.service).not.toHaveBeenCalled();
    expect(await response.json()).toEqual({ message: expect.any(String) });
  });
  it.each<HeadersInit>([{Origin:"https://evil.example"},{Origin:"null"},{"Sec-Fetch-Site":"cross-site"}])("拒绝跨站请求 %j", async headers => {
    expect((await subscribe(request({email:"ninja@example.com"}, headers))).status).toBe(403);
    expect(mocks.service).not.toHaveBeenCalled();
  });
  it("可信反向代理内部Host不影响本站订阅", async () => {
    const response = await subscribe(new Request("http://127.0.0.1:3001/api/news/subscriptions", { method:"POST", headers:{"Content-Type":"application/json",Origin:"https://naruto.riordon.xyz",Host:"127.0.0.1:3001","X-Real-IP":"192.0.2.1"}, body:JSON.stringify({email:"ninja@example.com"}) }));
    expect(response.status).toBe(200);
    expect(mocks.subscribe).toHaveBeenCalledWith("ninja@example.com", "192.0.2.1");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it("确认和退订只调用自己的POST操作，均返回message", async () => {
    expect(await (await confirm(request({token:"confirm-token"}))).json()).toEqual({message: expect.any(String)});
    expect(await (await unsubscribe(request({token:"unsubscribe-token"}))).json()).toEqual({message: expect.any(String)});
    expect(mocks.confirm).toHaveBeenCalledWith("confirm-token");
    expect(mocks.unsubscribe).toHaveBeenCalledWith("unsubscribe-token");
    expect(mocks.subscribe).not.toHaveBeenCalled();
  });
  it("限流返回429+Retry-After且不泄露内部信息", async () => {
    mocks.subscribe.mockImplementation(() => { throw new MailRequestError(429,"请稍后重试",60); });
    const response = await subscribe(request({email:"ninja@example.com"}));
    expect(response.status).toBe(429); expect(response.headers.get("retry-after")).toBe("60");
  });
  it.each([
    { operation: "subscribe", status: 400, message: "请输入有效的邮箱地址。", retryAfter: undefined },
    { operation: "subscribe", status: 429, message: "请求较频繁，请稍后再试。", retryAfter: 60 },
    { operation: "confirm", status: 400, message: "确认链接已过期，请重新申请订阅。", retryAfter: undefined },
    { operation: "unsubscribe", status: 400, message: "退订链接无效，请使用最近一封提醒邮件中的链接。", retryAfter: undefined },
    { operation: "factory", status: 503, message: "邮件提醒暂未开放，请稍后再来。", retryAfter: undefined }
  ])("保留启动bundle的$operation错误状态$status，不因类实例不同变成通用503", async ({operation,status,message,retryAfter}) => {
    // Force a second evaluated copy of the actual module, as Next's startup/request chunks do.
    vi.resetModules();
    const { MailRequestError: StartupMailRequestError } = await import("@/lib/news-mail/store");
    expect(StartupMailRequestError).not.toBe(MailRequestError);
    const error = new StartupMailRequestError(status, message, retryAfter);
    expect(error).not.toBeInstanceOf(MailRequestError);
    const failing = () => { throw error; };
    const handler = operation === "confirm" ? confirm : operation === "unsubscribe" ? unsubscribe : subscribe;
    if (operation === "factory") mocks.service.mockImplementation(failing);
    else if (operation === "subscribe") mocks.subscribe.mockImplementation(failing);
    else if (operation === "confirm") mocks.confirm.mockImplementation(failing);
    else mocks.unsubscribe.mockImplementation(failing);
    const response = await handler(request({email:"ninja@example.com",token:"test-token"}));
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({message});
    expect(response.headers.get("retry-after")).toBe(retryAfter ? String(retryAfter) : null);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it("普通异常或损坏的品牌错误不会把内部message或无效状态透给访客", async () => {
    const ordinary = Object.assign(new Error("internal-only-sentinel"), {status:400,retryAfter:60});
    const malformed = new MailRequestError(200, "internal-only-sentinel", -1);
    for (const error of [ordinary, malformed]) {
      mocks.subscribe.mockImplementation(() => { throw error; });
      const response = await subscribe(request({email:"ninja@example.com"}));
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({message:"邮件服务暂时不可用，请稍后重试。"});
      expect(response.headers.get("retry-after")).toBeNull();
    }
  });
  it("拒绝错误Content-Type和超大JSON", async () => {
    expect((await subscribe(request({email:"ninja@example.com"},{"Content-Type":"text/plain"}))).status).toBe(400);
    expect((await subscribe(request({email:"a".repeat(3000)}))).status).toBe(400);
    expect(mocks.service).not.toHaveBeenCalled();
  });
});
