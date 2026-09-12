import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseEnv } from "node:util";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkProxyApi, configureProxy, proxyFromSettings, resumeNetworkJobs, withProxySetting } from "../scripts/configure-news-mail-proxy.mjs";

vi.mock("node:child_process", () => ({ spawnSync: vi.fn() }));
let directory, envPath, settingsPath, source;
const settings = { port: 38157, username: "ninja@local", password: 'private:#?"@ sentinel', controller_secret: "must-not-copy-controller-secret" };
beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "konoha-mail-proxy-test-"));
  envPath = path.join(directory, ".env.production");
  settingsPath = path.join(directory, "local-settings.json");
  source = '# preserve this comment\r\nNEWS_MAIL_API_URL=https://mail.riordon.xyz/api/integrations/konoha/send\r\nNEWS_MAIL_API_TOKEN=' + 'test-token'.repeat(5) + '\r\nNEWS_SUBSCRIPTION_SECRET="original-independent-signing-secret"\r\nDATABASE_PATH="missing-existing.db"\r\nPORT=3001\r\n';
  fs.writeFileSync(envPath, source, { mode: 0o640 });
  fs.writeFileSync(settingsPath, JSON.stringify(settings), { mode: 0o600 });
});
afterEach(() => { fs.rmSync(directory, { recursive: true, force: true }); });

describe("邮件代理本机配置助手", () => {
  it("正确编码代理认证，仅使用SOCKS字段，不复制控制接口密钥", () => {
    const proxy = new URL(proxyFromSettings(settings));
    expect(proxy.hostname).toBe("127.0.0.1");
    expect(proxy.port).toBe("38157");
    expect(decodeURIComponent(proxy.username)).toBe(settings.username);
    expect(decodeURIComponent(proxy.password)).toBe(settings.password);
    expect(proxy.href).not.toContain(settings.controller_secret);
    expect(() => proxyFromSettings({ ...settings, port: 0 })).toThrow();
  });
  it("认证探针通过stdin传递凭据，参数无密码、无收件人、无任务键和跳转", () => {
    spawnSync.mockReturnValue({status:0,stdout:'{"status":"invalid_request","code":"idempotency_key_required"}\n400'});
    checkProxyApi(proxyFromSettings(settings), "fixture-api-token");
    const [command, args, options] = spawnSync.mock.calls.at(-1);
    expect(command).toBe("curl");
    expect(args[0]).toBe("--disable");
    expect(args).not.toContain("--location");
    expect(args[args.indexOf("--data") + 1]).toBe("{}");
    expect(JSON.stringify(args)).not.toContain("fixture-api-token");
    expect(JSON.stringify(args)).not.toContain("private");
    expect(options.input).toContain("Authorization: Bearer fixture-api-token");
    expect(options.input).not.toContain("Idempotency-Key");
    expect(options.input).not.toContain(settings.controller_secret);
  });
  it("代理连通但API密钥错误时停止，原环境及队列不变", () => {
    spawnSync.mockReturnValue({status:0,stdout:'{"status":"unauthorized"}\n401'});
    expect(() => configureProxy({ envPath, settingsPath, apply: true })).toThrow("认证失败");
    expect(fs.readFileSync(envPath, "utf8")).toBe(source);
    expect(fs.readdirSync(directory)).toHaveLength(2);
  });
  it("默认只调用不发信的探针，文件保持原样且不建立备份", () => {
    const probe = vi.fn();
    const result = configureProxy({ envPath, settingsPath, probe });
    expect(result).toEqual({ checked: true, applied: false });
    expect(probe).toHaveBeenCalledWith(proxyFromSettings(settings), 'test-token'.repeat(5));
    expect(fs.readFileSync(envPath, "utf8")).toBe(source);
    expect(fs.readdirSync(directory)).toHaveLength(2);
  });
  it("通过探针后写入代理，保留其他环境配置、换行、权限和完整备份", () => {
    const originalMode = fs.statSync(envPath).mode & 0o777;
    const result = configureProxy({ envPath, settingsPath, apply: true, probe: vi.fn(), now: 12345 });
    const output = fs.readFileSync(envPath, "utf8");
    const env = parseEnv(output);
    expect(env.NEWS_MAIL_PROXY_URL).toBe(proxyFromSettings(settings));
    delete env.NEWS_MAIL_PROXY_URL;
    expect(env).toEqual(parseEnv(source));
    expect(output.startsWith(source)).toBe(true);
    expect(output.replaceAll("\r\n", "")).not.toContain("\n");
    expect(fs.readFileSync(path.join(directory, result.backup), "utf8")).toBe(source);
    expect(fs.statSync(envPath).mode & 0o777).toBe(originalMode);
    expect(fs.readFileSync(settingsPath, "utf8")).toBe(JSON.stringify(settings));
    expect(result.resumed).toBe(0);
    expect(JSON.stringify(result)).not.toContain("private");
  });
  it("探针失败不修改环境、不建立备份、不泄露代理设置", () => {
    const probe = vi.fn(() => { throw new Error("safe probe rejection"); });
    expect(() => configureProxy({ envPath, settingsPath, apply: true, probe })).toThrow("safe probe rejection");
    expect(fs.readFileSync(envPath, "utf8")).toBe(source);
    expect(fs.readdirSync(directory)).toHaveLength(2);
  });
  it("配置被并发修改时不覆盖用户新内容，并清理临时文件", () => {
    const probe = () => fs.appendFileSync(envPath, "MANUAL_CHANGE=keep\r\n");
    expect(() => configureProxy({ envPath, settingsPath, apply: true, probe })).toThrow("同时被修改");
    expect(fs.readFileSync(envPath, "utf8")).toBe(source + "MANUAL_CHANGE=keep\r\n");
    expect(fs.readdirSync(directory).some(file => file.endsWith(".tmp"))).toBe(false);
  });
  it("重复配置仅留下一个代理设置，保留其他行；不接受跨行代理值", () => {
    const output = withProxySetting(source + "export NEWS_MAIL_PROXY_URL=socks5h://127.0.0.1:1\r\nNEWS_MAIL_PROXY_URL=socks5h://127.0.0.1:2\r\n", proxyFromSettings(settings));
    expect(output.match(/NEWS_MAIL_PROXY_URL=/g)).toHaveLength(1);
    expect(parseEnv(output).NEWS_MAIL_PROXY_URL).toBe(proxyFromSettings(settings));
    expect(() => withProxySetting('NEWS_MAIL_PROXY_URL="one\ntwo"', proxyFromSettings(settings))).toThrow("跨行");
  });
  it("只提前等待网络重试的任务，原任务编号、尝试次数、邮件内容和其他状态不变", () => {
    const filename = path.join(directory, "queue.db");
    const db = new Database(filename);
    db.exec("CREATE TABLE news_mail_outbox(id TEXT PRIMARY KEY,status TEXT,last_error TEXT,next_attempt_at INTEGER,attempts INTEGER,payload_json TEXT)");
    const rows = [
      ["queued", "provider-network", 2000], ["queued", "provider-network-timeout", 2000],
      ["queued", "provider-authorization", 2000], ["unknown", "provider-network", 2000],
      ["sent", "provider-network", 2000], ["cancelled", "provider-network", 2000],
      ["sending", "provider-network", 2000], ["queued", null, 2000], ["queued", "provider-network", 500]
    ];
    rows.forEach((row, index) => db.prepare("INSERT INTO news_mail_outbox VALUES(?,?,?,?,6,?)").run(String(index), ...row, 'unchanged-private-payload'));
    const before = db.prepare("SELECT * FROM news_mail_outbox ORDER BY id").all();
    db.close();
    expect(resumeNetworkJobs(filename, 1000)).toBe(2);
    const check = new Database(filename, { readonly: true });
    const after = check.prepare("SELECT * FROM news_mail_outbox ORDER BY id").all();
    check.close();
    expect(after).toEqual(before.map((row, index) => index < 2 ? { ...row, next_attempt_at: 1000 } : row));
    expect(resumeNetworkJobs(filename, 1000)).toBe(0);
  });
});