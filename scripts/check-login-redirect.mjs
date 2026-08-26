import { chromium } from "playwright-core";
import Database from "better-sqlite3";
import { hash } from "@node-rs/argon2";

const baseUrl = process.env.CHECK_BASE_URL || "http://localhost:3000";
const actionOrigin = process.env.CHECK_ACTION_ORIGIN;
const username = "__login_redirect_test__";
const password = "RegressionPass!42";
const db = new Database(process.env.DATABASE_PATH || "data/naruto-fortress.db");

db.pragma("foreign_keys = ON");
db.prepare("DELETE FROM users WHERE username = ?").run(username);
const passwordHash = await hash(password);
const userId = Number(db.prepare(`
  INSERT INTO users (
    username, display_name, password_hash, role, account_type,
    note, is_active, must_change_password
  ) VALUES (?, ?, ?, 'member', 'guest', ?, 1, 0)
`).run(username, "登录跳转测试", passwordHash, "自动回归测试临时账号").lastInsertRowid);

const edgePath = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const browser = await chromium.launch({ executablePath: edgePath, headless: true });
const context = await browser.newContext();
const page = await context.newPage();
const events = [];
let homeDocumentRequests = 0;

if (actionOrigin) {
  await page.route("**/*", async (route) => {
    const request = route.request();
    if (request.method() !== "POST") return route.continue();
    await route.continue({ headers: { ...request.headers(), origin: actionOrigin } });
  });
}

page.on("console", (message) => events.push(`console:${message.type()}:${message.text()}`));
page.on("pageerror", (error) => events.push(`pageerror:${error.stack || error.message}`));
page.on("request", (request) => {
  const url = new URL(request.url());
  if (url.origin === new URL(baseUrl).origin && url.pathname === "/home") {
    events.push(`request:/home:${request.resourceType()}`);
  }
  if (url.origin === new URL(baseUrl).origin && url.pathname === "/home" && request.resourceType() === "document") {
    homeDocumentRequests += 1;
  }
});
page.on("response", (response) => {
  const url = new URL(response.url());
  if (url.origin === new URL(baseUrl).origin) {
    const redirect = response.headers()["x-action-redirect"];
    events.push(`response:${response.status()}:${url.pathname}${redirect ? `:x-action-redirect=${redirect}` : ""}`);
  }
});

try {
  await page.goto(`${baseUrl}/packages`, { waitUntil: "networkidle" });
  if (new URL(page.url()).pathname !== "/login") {
    throw new Error(`匿名访问 /packages 后未进入 /login，实际为 ${page.url()}`);
  }

  await page.getByRole("textbox", { name: "组织账号" }).fill(username);
  await page.getByLabel("通行口令").fill(password);
  const actionResponsePromise = page.waitForResponse((response) =>
    response.request().method() === "POST" && new URL(response.url()).pathname === "/login"
  );
  await page.getByRole("button", { name: "登录并进入内部" }).click();
  const actionResponse = await actionResponsePromise;
  if (!actionResponse.ok()) {
    events.push(`action-response-headers:${JSON.stringify(actionResponse.headers())}`);
    events.push(`action-response-body:${await actionResponse.text()}`);
  }
  await page.waitForURL((url) => url.pathname === "/home", { timeout: 15_000 });
  await page.getByText("我的作战室", { exact: true }).waitFor({ state: "visible", timeout: 15_000 });
  if (homeDocumentRequests !== 1) {
    throw new Error(`登录成功后应完整加载 /home 文档，实际文档请求数为 ${homeDocumentRequests}`);
  }
  console.log("Login redirect regression passed.");
} catch (error) {
  console.error(events.join("\n"));
  throw error;
} finally {
  await context.close();
  await browser.close();
  db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
  db.prepare("DELETE FROM users WHERE id = ?").run(userId);
  db.close();
}
