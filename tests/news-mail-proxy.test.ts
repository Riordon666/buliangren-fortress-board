import Database from "better-sqlite3";
import { NewsMailService } from "@/lib/news-mail/service";
import type { NewsState } from "@/lib/news/types";
import { createServer } from "node:https";
import type { ServerResponse } from "node:http";
import { createServer as createTcpServer, connect, type Server, type Socket } from "node:net";
import { getCACertificates, setDefaultCACertificates } from "node:tls";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createMailFetcher } from "@/lib/news-mail/transport";
import { sendMail } from "@/lib/news-mail/provider";

// Disposable test PKI; no production credentials. The leaf is trusted only by
// this test worker, and the HTTPS client always verifies its certificate/SNI.
const ca = `-----BEGIN CERTIFICATE-----
MIIBdzCCAR6gAwIBAgIUcxapn581hYhOx9KlQvuY8i+0gaswCgYIKoZIzj0EAwIw
IjEgMB4GA1UEAwwXTmV3cyBtYWlsIHByb3h5IHRlc3QgQ0EwHhcNMjYwOTEyMDY0
MzAwWhcNMzYwOTA5MDY0MzAwWjAiMSAwHgYDVQQDDBdOZXdzIG1haWwgcHJveHkg
dGVzdCBDQTBZMBMGByqGSM49AgEGCCqGSM49AwEHA0IABEuul+YMaZvGy4KPyrTo
nsk0azfKu/kxh4Gh8TMwMLKvLTDh571F+G1n2k4q/rE1DEjHLzkDeNrVigmRYwLU
vXajMjAwMB0GA1UdDgQWBBQjj2hNP3q7mmDYtqW4VY0S0zCzKDAPBgNVHRMBAf8E
BTADAQH/MAoGCCqGSM49BAMCA0cAMEQCIAhemynFPFPiaR0KwjVkhHg0YDnQLqAE
MV5xIL7glwW7AiB+JsVXaU7lJVsujXxnr/tRmq0BuhTVNNO8Bm00mB5lxw==
-----END CERTIFICATE-----`;
const cert = `-----BEGIN CERTIFICATE-----
MIIBjjCCATOgAwIBAgIUb9TWMHBAtW9msrlrH9mQm8PO2MIwCgYIKoZIzj0EAwIw
IjEgMB4GA1UEAwwXTmV3cyBtYWlsIHByb3h5IHRlc3QgQ0EwHhcNMjYwOTEyMDY0
MzAwWhcNMzYwOTA5MDY0MzAwWjAcMRowGAYDVQQDDBFtYWlsLnRlc3QuaW52YWxp
ZDBZMBMGByqGSM49AgEGCCqGSM49AwEHA0IABOWG+0LX9wR+4QPzldXI3YgqnX+n
BHuHzF2Om9yw2VmnzklOsj2iMLCdqEl4bOhFkD85GENbUllqU45lG9YuYnqjTTBL
MBwGA1UdEQQVMBOCEW1haWwudGVzdC5pbnZhbGlkMAkGA1UdEwQCMAAwCwYDVR0P
BAQDAgeAMBMGA1UdJQQMMAoGCCsGAQUFBwMBMAoGCCqGSM49BAMCA0kAMEYCIQDr
hvp9k81Er5CIxDiPbcDAmy1WkwAWGOJyiwEECTL+9gIhAMGtncPGWfwXbYyws8nj
13arajfEs2zK7T5YUKCWsFQm
-----END CERTIFICATE-----`;
const key = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgmq4Up6Ewh6NgV4nA
2chJtP2/NxqJQWa/pAcqks8AV8OhRANCAATlhvtC1/cEfuED85XVyN2IKp1/pwR7
h8xdjpvcsNlZp85JTrI9ojCwnahJeGzoRZA/ORhDW1JZalOOZRvWLmJ6
-----END PRIVATE KEY-----`;
const credentials = { username: "proxy-test", password: "test:p@ss word/%" };
const sockets = new Set<Socket>();
const servers: Server[] = [];
const priorCa = getCACertificates("default");
beforeAll(() => setDefaultCACertificates([...priorCa, ca]));
afterAll(() => setDefaultCACertificates(priorCa));
afterEach(async () => {
  vi.restoreAllMocks();
  for (const socket of sockets) socket.destroy();
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve()))));
  sockets.clear();
});
function track(socket: Socket) {
  sockets.add(socket);
  socket.on("error", () => {});
  socket.once("close", () => sockets.delete(socket));
  return socket;
}
async function listen(server: Server): Promise<number> {
  servers.push(server);
  server.on("connection", track);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  return (server.address() as { port: number }).port;
}
async function fixture(options: { rejectAuth?: boolean; stallTls?: boolean } = {}) {
  const calls: Array<{ path: string; host?: string; authorization?: string; key?: string; encoding?: string; body: string }> = [];
  const authenticated: Array<{ username: string; password: string }> = [];
  const destinations: Array<{ host: string; port: number }> = [];
  let response: ServerResponse | undefined;
  const target = options.stallTls ? createTcpServer(socket => socket.resume()) : createServer({ key, cert }, (request, outgoing) => {
    const chunks: Buffer[] = [];
    request.on("data", chunk => chunks.push(chunk));
    request.on("end", () => {
      response = outgoing;
      calls.push({ path: request.url!, host: request.headers.host, authorization: request.headers.authorization,
        key: request.headers["idempotency-key"] as string, encoding: request.headers["accept-encoding"], body: Buffer.concat(chunks).toString("utf8") });
      if (request.url === "/redirect") {
        outgoing.writeHead(302, { Location: "https://different.test.invalid/steal" }); outgoing.end();
      } else if (request.url === "/invalid-status") {
        outgoing.writeHead(600); outgoing.end("invalid provider response");
      } else if (request.url === "/cut") {
        outgoing.writeHead(200, { "Content-Length": 100 }); outgoing.write('{"status":');
        setTimeout(() => outgoing.destroy(), 25);
      } else if (request.url === "/stream") {
        outgoing.writeHead(200); outgoing.write('{"status":');
      } else if (request.url === "/large") {
        outgoing.writeHead(200); outgoing.end("x".repeat(50_000));
      } else {
        outgoing.writeHead(200, { "Content-Type": "application/json" }); outgoing.end(JSON.stringify({ status: "sent", id: "fixture-message" }));
      }
    });
  });
  const targetPort = await listen(target);
  const proxy = createTcpServer(client => {
    let stage = 0;
    let buffer = Buffer.alloc(0);
    const receive = (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (stage === 0) {
        if (buffer.length < 2 || buffer.length < 2 + buffer[1]) return;
        expect(buffer[0]).toBe(5);
        expect([...buffer.subarray(2, 2 + buffer[1])]).toContain(2);
        buffer = buffer.subarray(2 + buffer[1]);
        client.write(Buffer.from([5, 2])); stage = 1;
      }
      if (stage === 1) {
        if (buffer.length < 2) return;
        const userLength = buffer[1];
        if (buffer.length < 3 + userLength) return;
        const passwordLength = buffer[2 + userLength];
        if (buffer.length < 3 + userLength + passwordLength) return;
        const supplied = { username: buffer.subarray(2, 2 + userLength).toString(), password: buffer.subarray(3 + userLength, 3 + userLength + passwordLength).toString() };
        authenticated.push(supplied);
        if (options.rejectAuth || supplied.username !== credentials.username || supplied.password !== credentials.password) {
          client.end(Buffer.from([1, 1])); return;
        }
        client.write(Buffer.from([1, 0])); buffer = buffer.subarray(3 + userLength + passwordLength); stage = 2;
      }
      if (stage === 2) {
        if (buffer.length < 5) return;
        expect([...buffer.subarray(0, 4)]).toEqual([5, 1, 0, 3]);
        const hostnameLength = buffer[4];
        if (buffer.length < 7 + hostnameLength) return;
        destinations.push({ host: buffer.subarray(5, 5 + hostnameLength).toString(), port: buffer.readUInt16BE(5 + hostnameLength) });
        expect(destinations.at(-1)?.port).toBe(targetPort);
        buffer = buffer.subarray(7 + hostnameLength);
        stage = 3; client.off("data", receive);
        const upstream = track(connect(targetPort, "127.0.0.1", () => {
          client.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 0]));
          if (buffer.length) upstream.write(buffer);
          client.pipe(upstream); upstream.pipe(client);
        }));
        client.once("close", () => upstream.destroy());
        upstream.once("close", () => client.destroy());
      }
    };
    client.on("data", receive);
  });
  const proxyPort = await listen(proxy);
  return {
    calls, authenticated, destinations, get response() { return response; },
    url: `https://mail.test.invalid:${targetPort}`,
    proxyUrl: `socks5h://${encodeURIComponent(credentials.username)}:${encodeURIComponent(credentials.password)}@127.0.0.1:${proxyPort}`,
    fetcher: createMailFetcher(`socks5h://${encodeURIComponent(credentials.username)}:${encodeURIComponent(credentials.password)}@127.0.0.1:${proxyPort}`),
  };
}
const init = { method: "POST", redirect: "error" as const, headers: { Authorization: "Bearer fixture-only-token", "Idempotency-Key": "stable-key" }, body: JSON.stringify({ message: "木叶快报" }) };

describe("仅邮件使用的 SOCKS5 传输", () => {
  it("无代理时动态委托当前 fetch，不改全局设置", async () => {
    const fetcher = createMailFetcher();
    const current = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("delegated"));
    expect(await (await fetcher("https://mail.test.invalid", init)).text()).toBe("delegated");
    expect(current).toHaveBeenCalledWith("https://mail.test.invalid", init);
  });
  it("认证真实 SOCKS5、远程解析目标域名，并校验证书及保持正文和幂等头", async () => {
    const local = await fixture();
    const response = await local.fetcher(local.url + "/sent", init);
    expect(await response.json()).toEqual({ status: "sent", id: "fixture-message" });
    expect(local.authenticated).toEqual([credentials]);
    expect(local.destinations[0].host).toBe("mail.test.invalid");
    expect(local.calls).toEqual([{ path: "/sent", host: new URL(local.url).host, authorization: init.headers.Authorization, key: "stable-key", encoding: "identity", body: init.body }]);
    await vi.waitFor(() => expect(sockets.size).toBe(0));
  });
  it("真实订阅队列通过默认发送器和专用代理完成确认邮件，不需注入假发送器", async () => {
    const local = await fixture();
    const db = new Database(":memory:");
    try {
      const service = new NewsMailService(db, {
        apiUrl: local.url + "/sent", apiToken: "fixture-mail-token", subscriptionSecret: "fixture-signing-secret", publicUrl: "https://site.example.invalid", proxyUrl: local.proxyUrl
      }, { read: async () => ({ edition: null } as NewsState), image: async () => null });
      service.subscribe("subscriber@example.invalid", "127.0.0.1");
      await service.tick();
      expect(db.prepare("SELECT status,attempts,provider_id FROM news_mail_outbox").get()).toEqual({status:"sent",attempts:1,provider_id:"fixture-message"});
      expect(local.calls).toHaveLength(1);
      expect(JSON.parse(local.calls[0].body)).toMatchObject({ to: "subscriber@example.invalid", subject: "确认订阅木叶快报更新提醒" });
      await service.tick();
      expect(local.calls).toHaveLength(1);
    } finally { db.close(); }
  });
  it("SOCKS 认证失败时不发出 HTTPS 请求", async () => {
    const local = await fixture({ rejectAuth: true });
    await expect(local.fetcher(local.url, init)).rejects.toThrow();
    expect(local.authenticated).toEqual([credentials]);
    expect(local.calls).toHaveLength(0);
    expect(local.destinations).toHaveLength(0);
  });
  it("拒绝证书域名不匹配，不把鉴权内容发送给未验证目标", async () => {
    const local = await fixture();
    await expect(local.fetcher(local.url.replace("mail.test.invalid", "wrong.test.invalid"), init)).rejects.toThrow();
    expect(local.destinations[0].host).toBe("wrong.test.invalid");
    expect(local.calls).toHaveLength(0);
  });
  it("拒绝不受信的CA，不向该目标发送鉴权请求", async () => {
    const local = await fixture();
    setDefaultCACertificates(priorCa);
    try {
      await expect(local.fetcher(local.url, init)).rejects.toThrow();
      expect(local.authenticated).toHaveLength(1);
      expect(local.calls).toHaveLength(0);
    } finally {
      setDefaultCACertificates([...priorCa, ca]);
    }
  });
  it("TLS 握手卡住时响应 AbortSignal 并清理已认证的代理 socket", async () => {
    const local = await fixture({ stallTls: true });
    const controller = new AbortController();
    const pending = local.fetcher(local.url, { ...init, signal: controller.signal });
    const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(local.destinations).toHaveLength(1));
    controller.abort();
    await rejected;
    await vi.waitFor(() => expect(sockets.size).toBe(0));
  });
  it("响应正文中断和取消均被传递，不转换成成功或完整JSON", async () => {
    const local = await fixture();
    const response = await local.fetcher(local.url + "/cut", init);
    await expect(response.text()).rejects.toThrow();
    const controller = new AbortController();
    const streamed = await local.fetcher(local.url + "/stream", { ...init, signal: controller.signal });
    const rejected = expect(streamed.text()).rejects.toThrow();
    controller.abort();
    await rejected;
    await vi.waitFor(() => expect(sockets.size).toBe(0));
  });
  it("拒绝重定向，不建立第二条连接、不转发 Authorization", async () => {
    const local = await fixture();
    await expect(local.fetcher(local.url + "/redirect", init)).rejects.toThrow("unexpected redirect");
    expect(local.destinations).toHaveLength(1);
    expect(local.calls).toHaveLength(1);
  });
  it("异常响应状态拒绝当前请求并清理socket，不抛未捕获事件异常", async () => {
    const local = await fixture();
    await expect(local.fetcher(local.url + "/invalid-status", init)).rejects.toThrow();
    await vi.waitFor(() => expect(sockets.size).toBe(0));
  });
  it("沿用 provider 的 32KiB 限额和断流幂等重试结果", async () => {
    const local = await fixture();
    const payload = { to: "fixture@example.invalid", subject: "fixture", text: "test", html: "test" };
    expect(await sendMail(local.url + "/large", "fixture", "same-key", payload, local.fetcher)).toEqual({ status: "unknown", reason: "provider-invalid-response" });
    expect(await sendMail(local.url + "/cut", "fixture", "same-key", payload, local.fetcher)).toMatchObject({ status: "retry", delayMs: 60_000 });
    expect(local.calls.map(call => call.key)).toEqual(["same-key", "same-key"]);
    await vi.waitFor(() => expect(sockets.size).toBe(0));
  });
  it("拒绝 HTTP 目标和非 socks5h 配置；取消后不创建连接", async () => {
    expect(() => createMailFetcher("socks5://127.0.0.1:1080")).toThrow("invalid-mail-proxy");
    const local = await fixture();
    await expect(local.fetcher("http://mail.test.invalid", init)).rejects.toThrow("invalid-mail-target");
    await expect(local.fetcher(local.url, { ...init, signal: AbortSignal.abort() })).rejects.toMatchObject({ name: "AbortError" });
    expect(local.authenticated).toHaveLength(0);
  });
});
