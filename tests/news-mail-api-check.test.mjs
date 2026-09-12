import { describe, expect, it, vi } from "vitest";
import { checkMailApi } from "../scripts/check-news-mail-api.mjs";

const token = "fixture-private-api-token-".repeat(3);
const proxyPassword = "fixture-proxy-password";
const proxyUrl = "socks5h://fixture-user:" + proxyPassword + "@127.0.0.1:38157";
const env = {
  NEWS_MAIL_API_URL: "https://mail.riordon.xyz/api/integrations/konoha/send",
  NEWS_MAIL_API_TOKEN: token
};
const response = (status, body) => ({
  status: 0,
  stdout: JSON.stringify(body) + "\n" + status,
  stderr: ""
});
const getOkay = () => response(405, { status: "invalid_request", code: "post_required" });
const postOkay = () => response(400, { status: "invalid_request", code: "idempotency_key_required" });
const successfulRun = () => vi.fn().mockReturnValueOnce(getOkay()).mockReturnValueOnce(postOkay());
function captureError(callback) {
  try { callback(); } catch (error) { return error; }
  throw new Error("Expected probe to reject");
}
function ensureSecretFree(error) {
  expect(error).toBeInstanceOf(Error);
  expect(error.message).not.toContain(token);
  expect(error.message).not.toContain(proxyPassword);
  expect(error.message).not.toContain("fixture-raw-response");
  expect(error.message).not.toContain("fixture-raw-stderr");
}

describe("邮箱 API 升级只读检查", () => {
  it.each([false, true])("通过当前配置检查 GET 与空 POST，代理启用=%s", useProxy => {
    const run = successfulRun();
    const settings = { ...env, ...(useProxy ? { NEWS_MAIL_PROXY_URL: proxyUrl } : {}) };
    expect(checkMailApi(settings, { run })).toEqual({
      connection: useProxy ? "proxy" : "direct", get: 405, post: 400
    });
    expect(run).toHaveBeenCalledTimes(2);
    for (const [index, [command, args, options]] of run.mock.calls.entries()) {
      expect(command).toBe("curl");
      expect(args[0]).toBe("--disable");
      expect(args[args.indexOf("--request") + 1]).toBe(index === 0 ? "GET" : "POST");
      expect(args[args.indexOf("--config") + 1]).toBe("-");
      expect(args[args.indexOf("--noproxy") + 1]).toBe(useProxy ? "" : "*");
      expect(args).not.toContain("--location");
      expect(args).not.toContain("-L");
      expect(args).not.toContain("--insecure");
      expect(args).not.toContain("-k");
      expect(args).not.toContain("--retry");
      expect(args).not.toContain("--output");
      expect(args).not.toContain("-o");
      expect(options.timeout).toBeGreaterThan(0);
      expect(options.timeout).toBeLessThanOrEqual(60_000);
      expect(options.maxBuffer).toBeGreaterThan(0);
      expect(options.maxBuffer).toBeLessThanOrEqual(65_536);
      expect(JSON.stringify(args)).not.toContain(token);
      expect(JSON.stringify(args)).not.toContain(proxyPassword);
      const request = JSON.stringify(args) + (options.input || "");
      expect(request).not.toMatch(/Idempotency-Key/i);
      expect(request).not.toContain('"to"');
      expect(request).not.toContain("attachments");
      expect(request).not.toContain("subject");
      if (useProxy) expect(options.input).toContain(proxyUrl);
      else expect(options.input).toContain('proxy = ""');
    }
    const [, postArgs, postOptions] = run.mock.calls[1];
    expect(postArgs[postArgs.indexOf("--data") + 1]).toBe("{}");
    expect(postOptions.input).toContain("Authorization: Bearer " + token);
    expect(postOptions.input).toContain("Content-Type: application/json");
  });

  it("只需要邮箱接口相关配置，无需签名密钥、数据库或网站公开地址", () => {
    const run = successfulRun();
    const settings = { ...env, DATABASE_PATH: "should-not-be-opened.db" };
    expect(checkMailApi(settings, { run })).toEqual({ connection: "direct", get: 405, post: 400 });
    expect(run).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["empty URL", { NEWS_MAIL_API_URL: "" }],
    ["HTTP", { NEWS_MAIL_API_URL: "http://mail.riordon.xyz/api/integrations/konoha/send" }],
    ["userinfo", { NEWS_MAIL_API_URL: "https://private-user:private-password@mail.riordon.xyz/api/integrations/konoha/send" }],
    ["query", { NEWS_MAIL_API_URL: env.NEWS_MAIL_API_URL + "?token=private" }],
    ["fragment", { NEWS_MAIL_API_URL: env.NEWS_MAIL_API_URL + "#private" }],
    ["short token", { NEWS_MAIL_API_TOKEN: "short" }],
    ["token newline", { NEWS_MAIL_API_TOKEN: token + "\nInjected-Header: value" }],
    ["token Unicode", { NEWS_MAIL_API_TOKEN: token + "测试" }],
    ["wrong proxy scheme", { NEWS_MAIL_PROXY_URL: "http://127.0.0.1:38157" }],
    ["local proxy DNS", { NEWS_MAIL_PROXY_URL: "socks5://127.0.0.1:38157" }],
    ["missing proxy port", { NEWS_MAIL_PROXY_URL: "socks5h://127.0.0.1" }],
    ["zero proxy port", { NEWS_MAIL_PROXY_URL: "socks5h://127.0.0.1:0" }],
    ["proxy path", { NEWS_MAIL_PROXY_URL: proxyUrl + "/wrong" }],
    ["proxy query", { NEWS_MAIL_PROXY_URL: proxyUrl + "?private=value" }],
    ["bad proxy escape", { NEWS_MAIL_PROXY_URL: "socks5h://user:%zz@127.0.0.1:38157" }]
  ])("配置错误在联网前拒绝：%s", (_label, overrides) => {
    const run = successfulRun();
    const error = captureError(() => checkMailApi({ ...env, ...overrides }, { run }));
    ensureSecretFree(error);
    expect(run).not.toHaveBeenCalled();
  });

  it.each([
    response(200, { status: "ok" }),
    response(404, { status: "not_found" }),
    response(302, { status: "redirect" }),
    response(405, { status: "invalid_request", code: "different_contract" }),
    response(405, { status: "unexpected", code: "post_required" }),
    { status: 0, stdout: "<html>fixture-raw-response</html>\n405", stderr: "" }
  ])("GET 路由或校验契约不符则停止，不继续空 POST %#", first => {
    const run = vi.fn().mockReturnValueOnce(first);
    const error = captureError(() => checkMailApi(env, { run }));
    ensureSecretFree(error);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it.each([
    response(401, { status: "unauthorized" }),
    response(403, { status: "forbidden" }),
    response(404, { status: "not_found" }),
    response(302, { status: "redirect" }),
    response(429, { status: "rate_limited" }),
    response(500, { status: "unavailable" }),
    response(200, { status: "sent", id: "fixture-impossible-send" }),
    response(400, { status: "invalid_request", code: "different_contract" }),
    response(400, { status: "unexpected", code: "idempotency_key_required" }),
    { status: 0, stdout: "fixture-raw-response\n400", stderr: "" }
  ])("POST 认证或契约不符不会误报兼容成功 %#", second => {
    const run = vi.fn().mockReturnValueOnce(getOkay()).mockReturnValueOnce(second);
    const error = captureError(() => checkMailApi(env, { run }));
    ensureSecretFree(error);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it.each([
    { status: 28, stdout: "", stderr: "fixture-raw-stderr " + token + " " + proxyPassword },
    { status: null, stdout: "", stderr: "fixture-raw-stderr", error: new Error(token) },
    { status: 0, stdout: "", stderr: "" },
    { status: 0, stdout: "fixture-raw-response\nnot-a-status", stderr: "" }
  ])("网络或响应格式异常不泄露原始 stderr 和凭据 %#", failure => {
    const run = vi.fn().mockReturnValue(failure);
    const error = captureError(() => checkMailApi({ ...env, NEWS_MAIL_PROXY_URL: proxyUrl }, { run }));
    ensureSecretFree(error);
    expect(run).toHaveBeenCalledTimes(1);
  });
});
