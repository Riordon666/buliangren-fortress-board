import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

class MailApiCheckError extends Error {}
const fail = message => { throw new MailApiCheckError(message); };

// Read-only API check: no recipient, message, idempotency key, database or settings writes.
export function checkMailApi(env = process.env, { run = spawnSync } = {}) {
  const token = (env.NEWS_MAIL_API_TOKEN || "").trim();
  if (!/^[\x21-\x7e]{32,1024}$/.test(token)) fail("邮件 API 密钥未配置或格式不正确，请检查 NEWS_MAIL_API_TOKEN。");
  let api;
  let proxy;
  try {
    const input = env.NEWS_MAIL_API_URL || "";
    api = new URL(input);
    if (/[\r\n]/.test(input) || api.protocol !== "https:" || api.username || api.password || api.search || api.hash) throw new Error();
  } catch { fail("邮件 API 地址不正确，需要不带账号、查询参数和片段的 HTTPS 地址。"); }
  const proxyInput = env.NEWS_MAIL_PROXY_URL?.trim();
  if (proxyInput) {
    try {
      proxy = new URL(proxyInput);
      const port = Number(proxy.port);
      if (/[\r\n]/.test(proxyInput) || proxy.protocol !== "socks5h:" || !proxy.hostname || !proxy.port ||
          !Number.isInteger(port) || port < 1 || port > 65535 || proxy.hash || proxy.search || (proxy.pathname && proxy.pathname !== "/")) throw new Error();
      decodeURIComponent(proxy.username);
      decodeURIComponent(proxy.password);
    } catch { fail("邮件代理配置不正确，需要完整的 socks5h 地址和端口。"); }
  }
  // Ignore curlrc and ambient proxies; use only the website's own mail configuration.
  // Credentials stay in stdin, never command arguments, output or exception messages.
  const configuration = [
    `proxy = ${JSON.stringify(proxy?.href || "")}`,
    `header = ${JSON.stringify(`Authorization: Bearer ${token}`)}`,
    'header = "Content-Type: application/json"'
  ].join("\n") + "\n";
  const request = (method, expectedStatus, expectedCode) => {
    const args = ["--disable", "--config", "-", "--noproxy", proxy ? "" : "*", "--silent", "--show-error",
      "--connect-timeout", "10", "--max-time", "20", "--request", method,
      ...(method === "POST" ? ["--data", "{}"] : []), "--write-out", "\n%{http_code}", api.href];
    let result;
    try { result = run("curl", args, { input: configuration, encoding: "utf8", timeout: 25_000, maxBuffer: 65_536 }); }
    catch { fail("无法执行邮箱连接检查，请确认 curl 可用以及服务器网络正常。"); }
    if (result?.error || result?.status !== 0 || typeof result.stdout !== "string" || Buffer.byteLength(result.stdout) > 65_536) {
      fail("邮箱连接检查失败，请检查网络、邮件代理和 HTTPS 证书；未发送邮件。");
    }
    const position = result.stdout.lastIndexOf("\n");
    const statusText = result.stdout.slice(position + 1).trim();
    if (position < 0 || !/^\d{3}$/.test(statusText)) fail("邮箱接口响应不符合预期，请检查地址及反向代理。");
    const status = Number(statusText);
    if (status === 401 || status === 403) fail("邮箱接口拒绝认证，请核对两端专用密钥及访问限制。");
    if (status === 404 || status === 405 && method === "POST") fail("邮箱专用发信路由不可用，请确认升级后保留了原接口。");
    if (status >= 300 && status < 400) fail("邮箱接口发生重定向，请检查 NEWS_MAIL_API_URL；检查不会跟随跳转。");
    if (status >= 500) fail("邮箱接口暂不可用，请检查升级状态、发信配置和服务日志。");
    let body;
    try { body = JSON.parse(result.stdout.slice(0, position)); } catch { /* No response content is logged. */ }
    if (status !== expectedStatus || body?.status !== "invalid_request" || body?.code !== expectedCode) {
      fail("邮箱接口校验格式与本站约定不一致，请确认升级后专用接口仍兼容。");
    }
    return status;
  };
  const get = request("GET", 405, "post_required");
  const post = request("POST", 400, "idempotency_key_required");
  return { connection: proxy ? "proxy" : "direct", get, post };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length > 2) fail("用法：node --env-file=.env.production scripts/check-news-mail-api.mjs（无需其他参数）。");
    console.log(JSON.stringify(checkMailApi(), null, 2));
    console.log("邮箱接口连接、认证和基础校验通过。未发送邮件，未修改配置或订阅队列。");
    console.log("此检查不验证真实发信、图片或收件箱送达；这些仍需实际邮件验收。");
  } catch (error) {
    console.error(error instanceof MailApiCheckError ? error.message : "检查未完成，请在网站运行目录加载 .env.production 后重试。");
    process.exitCode = 1;
  }
}
