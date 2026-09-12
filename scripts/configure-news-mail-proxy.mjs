import fs from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const API_URL = "https://mail.riordon.xyz/api/integrations/konoha/send";
export function proxyFromSettings(settings) {
  if (!settings || !Number.isInteger(settings.port) || settings.port < 1024 || settings.port > 65535 ||
      typeof settings.username !== "string" || !settings.username || settings.username.length > 128 ||
      typeof settings.password !== "string" || settings.password.length < 10) {
    throw new Error("现有代理设置不完整，未修改网站配置。");
  }
  return `socks5h://${encodeURIComponent(settings.username)}:${encodeURIComponent(settings.password)}@127.0.0.1:${settings.port}`;
}
export function withProxySetting(source, proxyUrl) {
  const previous = parseEnv(source).NEWS_MAIL_PROXY_URL;
  if (previous && /[\r\n]/.test(previous)) throw new Error("现有代理配置跨行，请先整理为单行；未修改网站配置。");
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  const lines = source.split(/\r?\n/);
  let replaced = false;
  const output = lines.flatMap(line => {
    if (!/^\s*(?:export\s+)?NEWS_MAIL_PROXY_URL\s*=/.test(line)) return [line];
    if (replaced) return [];
    replaced = true;
    return [`NEWS_MAIL_PROXY_URL=${proxyUrl}`];
  });
  if (!replaced) {
    if (output.at(-1) !== "") output.push("");
    output.push("# Only the Konoha mail API uses this existing local proxy.", `NEWS_MAIL_PROXY_URL=${proxyUrl}`, "");
  }
  return output.join(newline);
}
export function checkProxyApi(proxyUrl, token) {
  // Secrets go through stdin, never argv, stdout, stderr, or shell interpolation.
  const configuration = [
    `proxy = ${JSON.stringify(proxyUrl)}`,
    `header = ${JSON.stringify(`Authorization: Bearer ${token}`)}`,
    'header = "Content-Type: application/json"'
  ].join("\n") + "\n";
  const result = spawnSync("curl", ["--disable", "--config", "-", "--noproxy", "", "--silent", "--show-error",
    "--connect-timeout", "15", "--max-time", "25", "--request", "POST", "--data", "{}",
    "--write-out", "\n%{http_code}", API_URL], { input: configuration, encoding: "utf8", timeout: 30_000, maxBuffer: 65_536 });
  if (result.error || result.status !== 0) throw new Error("通过代理连接邮箱接口失败，未修改网站配置。请检查现有代理线路。");
  const position = result.stdout.lastIndexOf("\n");
  const status = Number(result.stdout.slice(position + 1));
  if (status === 401 || status === 403) throw new Error("代理连接已通，但邮箱接口认证失败；请核对 NEWS_MAIL_API_TOKEN，未修改网站配置。");
  let body;
  try { body = JSON.parse(result.stdout.slice(0, position)); } catch { /* Only the exact non-sending response is accepted. */ }
  if (status !== 400 || body?.status !== "invalid_request" || body?.code !== "idempotency_key_required") {
    throw new Error("邮箱接口未返回预期的认证探针结果，未修改网站配置。");
  }
}
export function resumeNetworkJobs(filename, now = Date.now()) {
  if (!fs.existsSync(filename)) return 0;
  const db = new Database(filename, { fileMustExist: true });
  try {
    db.pragma("busy_timeout = 5000");
    if (!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='news_mail_outbox'").get()) return 0;
    return db.prepare("UPDATE news_mail_outbox SET next_attempt_at=? WHERE status='queued' AND next_attempt_at>? AND (last_error='provider-network' OR last_error GLOB 'provider-network-*')")
      .run(now, now).changes;
  } finally { db.close(); }
}
export function configureProxy({ envPath, settingsPath, apply = false, probe = checkProxyApi, now = Date.now() }) {
  const resolvedEnv = fs.realpathSync(envPath);
  const source = fs.readFileSync(resolvedEnv, "utf8");
  const env = parseEnv(source);
  const token = (env.NEWS_MAIL_API_TOKEN || "").trim();
  if (env.NEWS_MAIL_API_URL !== API_URL || !/^[\x21-\x7e]{32,1024}$/.test(token)) throw new Error("网站邮件 API 地址或密钥格式不正确，未修改配置。");
  const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
  const proxyUrl = proxyFromSettings(settings);
  const output = withProxySetting(source, proxyUrl);
  probe(proxyUrl, token); // No recipient, mail contents or idempotency key; cannot send a message.
  if (!apply) return { checked: true, applied: false };
  const stat = fs.statSync(resolvedEnv);
  const backupPath = `${resolvedEnv}.mail-proxy-${now}-${randomUUID()}.bak`;
  const temporary = `${resolvedEnv}.${randomUUID()}.tmp`;
  const preservePermissions = filename => {
    if (process.platform !== "win32") fs.chownSync(filename, stat.uid, stat.gid);
    fs.chmodSync(filename, stat.mode & 0o777);
  };
  fs.copyFileSync(resolvedEnv, backupPath, fs.constants.COPYFILE_EXCL);
  preservePermissions(backupPath);
  try {
    fs.writeFileSync(temporary, output, { flag: "wx", mode: stat.mode & 0o777 });
    preservePermissions(temporary);
    // Avoid overwriting a concurrent manual edit made while the connection probe was running.
    if (fs.readFileSync(resolvedEnv, "utf8") !== source) throw new Error("环境文件同时被修改，请重试；已保留备份。");
    fs.renameSync(temporary, resolvedEnv);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
  let resumed = null;
  try { resumed = resumeNetworkJobs(path.resolve(path.dirname(resolvedEnv), env.DATABASE_PATH || "data/naruto-fortress.db"), now); }
  catch { /* The saved proxy configuration is valid; original retry dates remain intact on failure. */ }
  return { checked: true, applied: true, resumed, backup: path.basename(backupPath) };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const unknown = process.argv.slice(2).filter(arg => arg !== "--apply");
    if (unknown.length) throw new Error("只支持 --apply；不带参数仅检测连接。");
    const result = configureProxy({ envPath: path.resolve(".env.production"), settingsPath: "/etc/mihomo/local-settings.json", apply: process.argv.includes("--apply") });
    console.log("代理连接与邮箱接口认证检查通过；检测没有发送邮件。");
    if (result.applied) {
      console.log("已保存邮件专用代理配置，原文件已备份：" + result.backup);
      console.log(result.resumed === null ? "重试时间未调整，原队列仍会按计划处理。" : `已将 ${result.resumed} 个网络失败任务恢复为到期可重试，保留原任务编号。`);
      console.log("请在宝塔启动或重启要塞 Node 项目，再运行邮件状态脚本核对发送结果。");
    } else console.log("仅检查通过；使用 --apply 可备份并写入邮件专用代理配置。");
  } catch (error) {
    const safe = error instanceof Error && /^[\u4e00-\u9fff]/.test(error.message) ? error.message : "配置助手未能完成，请确认在网站运行目录以 root 执行，且配置文件存在；不要公开配置内容。";
    console.error(safe);
    process.exitCode = 1;
  }
}