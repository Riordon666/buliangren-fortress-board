import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sendMail, type MailPayload } from "@/lib/news-mail/provider";

const payload: MailPayload = { to: "ninja@example.test", subject: "Local test", text: "test", html: "<p>test</p>" };
const servers: Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

describe("邮件网络错误诊断", () => {
  it("真实 fetch 拒绝跳转，不将授权头转发到跳转目标", async () => {
    const paths: string[] = [];
    const server = createServer((request, response) => {
      paths.push(request.url!);
      response.writeHead(302, { Location: "/must-not-receive-token" });
      response.end();
    });
    servers.push(server);
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("missing test port");
    const result = await sendMail(`http://127.0.0.1:${address.port}/send`, "local-test-secret", "stable-key", payload);
    expect(result).toEqual({ status: "retry", delayMs: 60_000, reason: "provider-redirect" });
    expect(paths).toEqual(["/send"]);
  });
  it("真实 fetch 请求头含非字节字符时识别配置问题，不暴露密钥", async () => {
    const result = await sendMail("http://127.0.0.1:1/send", "敏感测试令牌", "stable-key", payload);
    expect(result).toEqual({ status: "retry", delayMs: 60_000, reason: "provider-request-header" });
    expect(JSON.stringify(result)).not.toContain("敏感");
  });
  it("嵌套连接超时在下次成功前保留相同幂等键和邮件内容", async () => {
    const cause = new AggregateError([
      Object.assign(new Error("internal-address"), { code: "ENETUNREACH" }),
      Object.assign(new Error("internal-address"), { code: "ETIMEDOUT" })
    ]);
    const fetcher = vi.fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("fetch failed", { cause }))
      .mockResolvedValueOnce(Response.json({ status: "sent", id: "accepted-id" }));
    expect(await sendMail("https://mail.example.test/send", "private-sentinel", "stable-key", payload, fetcher))
      .toEqual({ status: "retry", delayMs: 60_000, reason: "provider-network-timeout" });
    expect(await sendMail("https://mail.example.test/send", "private-sentinel", "stable-key", payload, fetcher))
      .toEqual({ status: "sent", id: "accepted-id" });
    expect(fetcher.mock.calls[0][1]?.headers).toEqual(fetcher.mock.calls[1][1]?.headers);
    expect(fetcher.mock.calls[0][1]?.body).toEqual(fetcher.mock.calls[1][1]?.body);
  });
  it.each([
    ["EAI_AGAIN", "provider-network-dns"],
    ["ERR_TLS_CERT_ALTNAME_INVALID", "provider-network-tls"],
    ["ECONNREFUSED", "provider-network-connection"]
  ])("从 fetch cause 识别 %s，返回固定类别而不公开原始错误", async (code, reason) => {
    const cause = Object.assign(new Error("private-token-in-original-message"), { code });
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("fetch failed", { cause }));
    const result = await sendMail("https://mail.example.test/send", "private-sentinel", "stable-key", payload, fetcher);
    expect(result).toEqual({ status: "retry", delayMs: 60_000, reason });
    expect(JSON.stringify(result)).not.toContain("private");
  });
  it("邮件接口已返回200后读取响应断线仍安全重试，不误标成未知或成功", async () => {
    const stream = new ReadableStream<Uint8Array>({ start(controller) {
      controller.error(Object.assign(new Error("private-response-fragment"), { code: "ECONNRESET" }));
    } });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(stream, { status: 200 }));
    expect(await sendMail("https://mail.example.test/send", "private-sentinel", "stable-key", payload, fetcher))
      .toEqual({ status: "retry", delayMs: 60_000, reason: "provider-network-connection" });
  });
  it("未知或循环的错误原因保留通用类别，不无限遍历或泄露原文", async () => {
    const error = new Error("private-sentinel");
    error.cause = error;
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(error);
    expect(await sendMail("https://mail.example.test/send", "private-sentinel", "stable-key", payload, fetcher))
      .toEqual({ status: "retry", delayMs: 60_000, reason: "provider-network" });
  });
});