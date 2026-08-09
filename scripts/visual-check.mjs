import { chromium } from "playwright-core";
import Database from "better-sqlite3";
import { hashSync } from "@node-rs/argon2";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const output = path.join(root, "artifacts", "visual-check");
await fs.mkdir(output, { recursive: true });

const edgePath = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const browser = await chromium.launch({ executablePath: edgePath, headless: true });

const visualUsername = "__visual_check__";
const setupDb = new Database(path.join(root, "data", "naruto-fortress.db"));
setupDb.prepare("DELETE FROM users WHERE username = ?").run(visualUsername);
setupDb.prepare(`
  INSERT INTO users (username, display_name, password_hash, role, must_change_password)
  VALUES (?, '视觉测试账号', ?, 'member', 1)
`).run(visualUsername, hashSync("7891666", { memoryCost: 19_456, timeCost: 2, outputLen: 32, parallelism: 1 }));
setupDb.close();

const publicContext = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
const loginPage = await publicContext.newPage();
for (const width of [901, 1024, 1280, 1440, 1920, 2560]) {
  await loginPage.setViewportSize({ width, height: 1000 });
  await loginPage.goto("http://localhost:3000/login", { waitUntil: "networkidle" });
  const linesFit = await loginPage.locator(".login-story h1 span, .login-story h1 em").evaluateAll((elements) =>
    elements.every((element) => element.scrollWidth <= element.clientWidth + 1)
  );
  if (!linesFit) throw new Error(`登录标题在 ${width}px 宽度下发生换行或溢出`);
}
await loginPage.setViewportSize({ width: 1920, height: 1000 });
await loginPage.goto("http://localhost:3000/login", { waitUntil: "networkidle" });
await loginPage.screenshot({ path: path.join(output, "login-wide.png"), fullPage: false });
await loginPage.setViewportSize({ width: 1440, height: 1000 });
await loginPage.goto("http://localhost:3000/login", { waitUntil: "networkidle" });
if (!(await loginPage.getByText("欢迎归队").isVisible())) throw new Error("登录页标题未显示");
if (await loginPage.getByText("7891666", { exact: true }).count()) throw new Error("登录页不应公开初始密码");
await loginPage.screenshot({ path: path.join(output, "login-desktop.png"), fullPage: true });

const mobileLoginContext = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
const mobileLoginPage = await mobileLoginContext.newPage();
await mobileLoginPage.goto("http://localhost:3000/login", { waitUntil: "networkidle" });
if (!(await mobileLoginPage.getByText("让每一分战绩", { exact: true }).isVisible())) throw new Error("手机端未显示登录页主标题");
if (!(await mobileLoginPage.getByText("都有迹可循", { exact: true }).isVisible())) throw new Error("手机端未显示登录页强调标题");
await mobileLoginPage.screenshot({ path: path.join(output, "login-mobile.png"), fullPage: true });
await mobileLoginContext.close();

await loginPage.getByLabel("组员账号").fill(visualUsername);
await loginPage.getByLabel("通行口令").fill("7891666");
await loginPage.getByRole("button", { name: "进入作战室" }).click();
await loginPage.waitForURL(/\/profile\?required=1/);
if (!(await loginPage.getByText("需要先修改初始密码").isVisible())) throw new Error("首次登录改密限制未生效");
const loginSessionToken = (await publicContext.cookies()).find((cookie) => cookie.name === "fortress_session")?.value;
await publicContext.close();

const db = new Database(path.join(root, "data", "naruto-fortress.db"));
const admin = db.prepare("SELECT id FROM users WHERE username = ?").get("九天惊落");
const token = randomBytes(32).toString("base64url");
const tokenHash = createHash("sha256").update(token).digest("hex");
db.prepare("INSERT INTO sessions (user_id, token_hash, expires_at) VALUES (?, ?, ?)")
  .run(admin.id, tokenHash, new Date(Date.now() + 3_600_000).toISOString());
db.close();

const appContext = await browser.newContext({ viewport: { width: 1600, height: 1100 }, deviceScaleFactor: 1 });
await appContext.addCookies([{ name: "fortress_session", value: token, url: "http://localhost:3000", httpOnly: true, sameSite: "Strict" }]);
const page = await appContext.newPage();
await page.goto("http://localhost:3000/scores", { waitUntil: "networkidle" });
if (!(await page.getByText("要塞分数统计", { exact: true }).first().isVisible())) throw new Error("分数页未显示");
if (!(await page.getByText("2,287", { exact: true }).isVisible())) throw new Error("总分校验失败");
if (!(await page.getByText("是溅诗啊", { exact: true }).first().isVisible())) throw new Error("成员昵称纠正未生效");
if ((await page.locator(".stat-card > .stat-icon").first().evaluate((element) => getComputedStyle(element).display)) !== "grid") throw new Error("统计图标未居中");
if ((await page.locator(".chart-bar").evaluate((element) => getComputedStyle(element).overflowY)) !== "visible") throw new Error("柱状图仍有内置滚动");
await page.screenshot({ path: path.join(output, "scores-desktop.png"), fullPage: false });

await page.getByRole("button", { name: "选择统计周" }).click();
if (!(await page.getByText("战绩卷轴", { exact: true }).isVisible())) throw new Error("主题周次菜单未显示");
await page.locator(".week-menu").screenshot({ path: path.join(output, "scores-week-menu.png") });
await page.keyboard.press("Escape");

await page.getByRole("tab", { name: "组织雷达" }).click();
await page.waitForTimeout(1200);
await page.locator(".visualization-panel").screenshot({ path: path.join(output, "scores-radar.png") });

await page.goto("http://localhost:3000/packages", { waitUntil: "networkidle" });
if (!(await page.getByText("发包安排", { exact: true }).first().isVisible())) throw new Error("发包安排页未显示");
if (!(await page.getByText("本期扣包次数排行", { exact: true }).isVisible())) throw new Error("扣包排行榜未显示");
if ((await page.locator(".package-day-card").count()) !== 8) throw new Error("发包周期不是8天");
if ((await page.locator(".package-member:not(.empty-slot)").count()) !== 40) throw new Error("发包名额不是40个");
if ((await page.getByText("第 2 轮", { exact: true }).count()) !== 13) throw new Error("第二轮发包数量不正确");
await page.screenshot({ path: path.join(output, "packages-desktop.png"), fullPage: true });

await page.goto("http://localhost:3000/admin", { waitUntil: "networkidle" });
if (!(await page.getByText("组员与在线状态").isVisible())) throw new Error("管理员页未显示");
if (!(await page.getByText("表格导入积分").isVisible())) throw new Error("积分导入区域未显示");
if (!(await page.getByRole("link", { name: "下载标准模板" }).isVisible())) throw new Error("标准模板下载入口未显示");
if (!(await page.getByRole("columnheader", { name: "扣包次数" }).isVisible())) throw new Error("管理员扣包设置入口未显示");
await page.screenshot({ path: path.join(output, "admin-desktop.png"), fullPage: false });

await page.goto("http://localhost:3000/profile", { waitUntil: "networkidle" });
if (!(await page.getByText("个人信息", { exact: true }).first().isVisible())) throw new Error("个人页未显示");
await page.screenshot({ path: path.join(output, "profile-desktop.png"), fullPage: false });
await appContext.close();

const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
await mobileContext.addCookies([{ name: "fortress_session", value: token, url: "http://localhost:3000", httpOnly: true, sameSite: "Strict" }]);
const mobilePage = await mobileContext.newPage();
await mobilePage.goto("http://localhost:3000/scores", { waitUntil: "networkidle" });
await mobilePage.screenshot({ path: path.join(output, "scores-mobile.png"), fullPage: false });
await mobilePage.goto("http://localhost:3000/packages", { waitUntil: "networkidle" });
if ((await mobilePage.locator(".package-day-card").count()) !== 8) throw new Error("手机端发包周期不是8天");
await mobilePage.screenshot({ path: path.join(output, "packages-mobile.png"), fullPage: true });
await mobileContext.close();

await browser.close();
const cleanupDb = new Database(path.join(root, "data", "naruto-fortress.db"));
cleanupDb.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
if (loginSessionToken) {
  cleanupDb.prepare("DELETE FROM sessions WHERE token_hash = ?")
    .run(createHash("sha256").update(loginSessionToken).digest("hex"));
}
cleanupDb.prepare("DELETE FROM users WHERE username = ?").run(visualUsername);
cleanupDb.close();
console.log(`Visual checks passed. Screenshots: ${output}`);
