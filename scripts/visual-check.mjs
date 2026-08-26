import { chromium } from "playwright-core";
import Database from "better-sqlite3";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const output = path.join(root, "artifacts", "visual-check");
await fs.mkdir(output, { recursive: true });

const edgePath = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const browser = await chromium.launch({ executablePath: edgePath, headless: true });

const publicContext = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
const publicPage = await publicContext.newPage();
await publicPage.goto("http://localhost:3000/", { waitUntil: "networkidle" });
if (new URL(publicPage.url()).pathname !== "/") throw new Error("匿名访问首页不应被重定向到登录页");
if (!(await publicPage.getByRole("heading", { level: 1, name: /火影手游资料库/ }).isVisible())) throw new Error("公开首页主标题未显示");
if (!(await publicPage.getByRole("navigation", { name: "公开导航" }).isVisible())) throw new Error("公开首页导航未显示");
const publicLoginLink = publicPage.getByRole("link", { name: "组织登录" });
if (!(await publicLoginLink.isVisible()) || await publicLoginLink.getAttribute("href") !== "/login") throw new Error("公开首页组织登录入口不正确");
const accessoryEntry = publicPage.getByRole("link", { name: "查询饰品数据" });
if (!(await accessoryEntry.isVisible()) || await accessoryEntry.getAttribute("href") !== "/accessories") throw new Error("公开首页饰品资料入口不正确");
await publicPage.screenshot({ path: path.join(output, "public-home-desktop.png"), fullPage: true });

await publicPage.goto("http://localhost:3000/accessories", { waitUntil: "networkidle" });
if (!(await publicPage.getByRole("heading", { level: 1, name: "饰品资料库" }).isVisible())) throw new Error("公开饰品资料页未显示");
if (!(await publicPage.getByRole("link", { name: "组织登录" }).isVisible())) throw new Error("饰品资料页未保留组织登录入口");
const antiMagicInput = publicPage.getByRole("spinbutton", { name: "输入抗魔值" });
if (!(await antiMagicInput.isVisible())) throw new Error("抗魔值查询输入框未显示");
await antiMagicInput.fill("29161");
const accessoryResult = publicPage.getByRole("region", { name: "抗魔值查询结果" });
if (!(await accessoryResult.getByText("祈愿", { exact: true }).isVisible())) throw new Error("29161 抗魔值未查询到祈愿饰品");
const accessoryTable = publicPage.getByRole("table", { name: "饰品系列完整数据" });
if (!(await accessoryTable.isVisible())) throw new Error("饰品系列完整数据表未显示");
if ((await accessoryTable.locator("tbody tr").count()) !== 14) throw new Error("饰品系列完整数据表不是14项");
if (!(await accessoryTable.getByText("云迹", { exact: true }).isVisible())) throw new Error("饰品完整数据表缺少云迹");
await publicPage.screenshot({ path: path.join(output, "accessories-desktop.png"), fullPage: true });

const anonymousGuardPage = await publicContext.newPage();
await anonymousGuardPage.goto("http://localhost:3000/scores", { waitUntil: "networkidle" });
if (new URL(anonymousGuardPage.url()).pathname !== "/login") throw new Error("匿名访客访问内部战绩页时未跳转到登录页");
await anonymousGuardPage.close();

const loginPage = publicPage;
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
if (await loginPage.getByText(/初始密码|默认密码/).count()) throw new Error("登录页不应公开初始密码说明");
await loginPage.screenshot({ path: path.join(output, "login-desktop.png"), fullPage: true });

const mobileLoginContext = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
const mobileLoginPage = await mobileLoginContext.newPage();
await mobileLoginPage.goto("http://localhost:3000/", { waitUntil: "networkidle" });
if (!(await mobileLoginPage.getByRole("heading", { level: 1, name: /火影手游资料库/ }).isVisible())) throw new Error("手机端公开首页主标题未显示");
if (!(await mobileLoginPage.getByRole("link", { name: "组织登录" }).isVisible())) throw new Error("手机端公开首页登录入口未显示");
if (await mobileLoginPage.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)) throw new Error("手机端公开首页存在横向溢出");
await mobileLoginPage.screenshot({ path: path.join(output, "public-home-mobile.png"), fullPage: true });
await mobileLoginPage.goto("http://localhost:3000/accessories", { waitUntil: "networkidle" });
if (!(await mobileLoginPage.getByRole("heading", { level: 1, name: "饰品资料库" }).isVisible())) throw new Error("手机端饰品资料页未显示");
if (await mobileLoginPage.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)) throw new Error("手机端饰品资料页存在横向溢出");
if (!(await mobileLoginPage.getByText("← 左右滑动表格，查看全部字段 →", { exact: true }).isVisible())) throw new Error("手机端饰品表格缺少横向滑动提示");
const mobileAntiMagicInput = mobileLoginPage.getByRole("spinbutton", { name: "输入抗魔值" });
await mobileAntiMagicInput.fill("54351");
if (!(await mobileLoginPage.getByRole("region", { name: "抗魔值查询结果" }).getByText("云迹", { exact: true }).isVisible())) throw new Error("手机端54351抗魔值未查询到云迹饰品");
if ((await mobileLoginPage.getByRole("table", { name: "饰品系列完整数据" }).locator("tbody tr").count()) !== 14) throw new Error("手机端饰品数据表不是14项");
await mobileLoginPage.screenshot({ path: path.join(output, "accessories-mobile.png"), fullPage: true });
await mobileLoginPage.goto("http://localhost:3000/login", { waitUntil: "networkidle" });
if (!(await mobileLoginPage.getByText("让每一分战绩", { exact: true }).isVisible())) throw new Error("手机端未显示登录页主标题");
if (!(await mobileLoginPage.getByText("都有迹可循", { exact: true }).isVisible())) throw new Error("手机端未显示登录页强调标题");
await mobileLoginPage.screenshot({ path: path.join(output, "login-mobile.png"), fullPage: true });
await mobileLoginContext.close();

await publicContext.close();

const db = new Database(path.join(root, "data", "naruto-fortress.db"));
const admin = db.prepare("SELECT id FROM users WHERE username = ?").get("九天惊落");
const shanghaiToday = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit"
}).format(new Date());
const [todayYear, todayMonth, todayDay] = shanghaiToday.split("-").map(Number);
const todayWeekday = new Date(Date.UTC(todayYear, todayMonth - 1, todayDay)).getUTCDay();
const daysSinceSaturday = (todayWeekday + 1) % 7;
const visualCycleDate = new Date(Date.UTC(todayYear, todayMonth - 1, todayDay - daysSinceSaturday)).toISOString().slice(0, 10);
let visualWeekId = null;
if (!db.prepare("SELECT id FROM weeks WHERE event_date = ?").get(visualCycleDate)) {
  visualWeekId = Number(db.prepare(`
    INSERT INTO weeks (title, event_date, status) VALUES ('视觉回归临时周', ?, 'published')
  `).run(visualCycleDate).lastInsertRowid);
  db.prepare(`
    INSERT INTO weekly_scores (week_id, user_id, score)
    SELECT ?, u.id, COALESCE((
      SELECT history.score FROM weekly_scores history
      JOIN weeks history_week ON history_week.id = history.week_id
      WHERE history.user_id = u.id
      ORDER BY history_week.event_date DESC, history_week.id DESC LIMIT 1
    ), 0)
    FROM users u
    WHERE u.is_active = 1 AND u.account_type = 'member' AND u.deleted_at IS NULL
  `).run(visualWeekId);
}
const token = randomBytes(32).toString("base64url");
const tokenHash = createHash("sha256").update(token).digest("hex");
db.prepare("INSERT INTO sessions (user_id, token_hash, expires_at) VALUES (?, ?, ?)")
  .run(admin.id, tokenHash, new Date(Date.now() + 3_600_000).toISOString());
db.close();
const cleanupSession = () => {
  try {
    const cleanupDb = new Database(path.join(root, "data", "naruto-fortress.db"));
    cleanupDb.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
    if (visualWeekId) cleanupDb.prepare("DELETE FROM weeks WHERE id = ?").run(visualWeekId);
    cleanupDb.close();
  } catch {
    // The visual check must not mask its original failure with cleanup errors.
  }
};
process.once("exit", cleanupSession);

const appContext = await browser.newContext({ viewport: { width: 1600, height: 1100 }, deviceScaleFactor: 1 });
await appContext.addCookies([
  { name: "fortress_session", value: token, url: "http://localhost:3000", httpOnly: true, sameSite: "Strict" },
  { name: "__Host-fortress_session", value: token, url: "https://localhost:3000", httpOnly: true, secure: true, sameSite: "Strict" }
]);
const page = await appContext.newPage();
await page.goto("http://localhost:3000/home", { waitUntil: "networkidle" });
if (!(await page.getByText("今日发包提醒", { exact: true }).isVisible())) throw new Error("我的作战室未显示今日发包提醒");
if (!(await page.getByText("下一目标", { exact: true }).isVisible())) throw new Error("我的作战室未显示下一目标");
await page.screenshot({ path: path.join(output, "home-desktop.png"), fullPage: false });

await page.goto("http://localhost:3000/scores", { waitUntil: "networkidle" });
if (!(await page.getByText("要塞分数统计", { exact: true }).first().isVisible())) throw new Error("分数页未显示");
if (!(await page.getByText("2,287", { exact: true }).isVisible())) throw new Error("总分校验失败");
if (!(await page.getByText("是溅诗啊", { exact: true }).first().isVisible())) throw new Error("成员昵称纠正未生效");
const firstMemberRow = page.locator(".score-table tbody tr").filter({ hasText: "是溅诗啊" });
if (!(await firstMemberRow.getByText("第 1 轮", { exact: true }).isVisible())) throw new Error("第一轮标签未同步到战绩表");
if (!(await firstMemberRow.getByText("第 2 轮", { exact: true }).isVisible())) throw new Error("第二轮标签未同步到战绩表");
if ((await page.locator(".stat-card > .stat-icon").first().evaluate((element) => getComputedStyle(element).display)) !== "grid") throw new Error("统计图标未居中");
if ((await page.locator(".chart-bar").evaluate((element) => getComputedStyle(element).overflowY)) !== "visible") throw new Error("柱状图仍有内置滚动");
await page.waitForTimeout(900);
const barScoreLabels = page.locator(".chart-bar .bar-score-label");
const barScoreLabelCount = await barScoreLabels.count();
const scoreRowCount = await page.locator(".score-table tbody tr").count();
if (barScoreLabelCount !== scoreRowCount) throw new Error(`横向柱状图未给每名成员显示分数（标签 ${barScoreLabelCount} / 成员 ${scoreRowCount}）`);
if ((await barScoreLabels.first().textContent())?.trim() !== "192") throw new Error("横向柱状图柱尾分数不正确");
await page.screenshot({ path: path.join(output, "scores-desktop.png"), fullPage: false });
await page.locator(".score-table-panel").screenshot({ path: path.join(output, "scores-rounds-table.png") });
await page.locator(".visualization-panel").screenshot({ path: path.join(output, "scores-bar-values.png") });

await page.getByRole("button", { name: "选择统计周" }).click();
if (!(await page.getByText("战绩卷轴", { exact: true }).isVisible())) throw new Error("主题周次菜单未显示");
await page.locator(".week-menu").screenshot({ path: path.join(output, "scores-week-menu.png") });
await page.keyboard.press("Escape");

await page.getByRole("tab", { name: "组织雷达" }).click();
await page.waitForTimeout(1200);
await page.locator(".visualization-panel").screenshot({ path: path.join(output, "scores-radar.png") });

await page.goto("http://localhost:3000/packages", { waitUntil: "networkidle" });
if (!(await page.getByText("发包安排", { exact: true }).first().isVisible())) throw new Error("发包安排页未显示");
if (!(await page.getByText("累计扣包次数排行", { exact: true }).isVisible())) throw new Error("累计扣包排行榜未显示");
if ((await page.locator(".package-day-tab").count()) !== 8) throw new Error("发包周期不是8天");
if ((await page.locator(".package-day-card").count()) !== 1) throw new Error("发包页应只展开当前选中的一天");
let visibleAssignments = 0;
for (const tab of await page.locator(".package-day-tab").all()) {
  await tab.click();
  visibleAssignments += await page.locator(".package-day-card .package-member:not(.empty-slot)").count();
}
if (visibleAssignments !== 40) throw new Error(`8天发包名额不是40个，实际 ${visibleAssignments} 个`);
if (!(await page.getByText("今日发包状态", { exact: true }).isVisible())) throw new Error("今日发包状态未显示");
if (!(await page.getByText(/暂未发包|已发包/).first().isVisible())) throw new Error("今日发包状态内容未显示");
if ((await page.locator(".today-package-seat").count()) !== 5) throw new Error("今日发包状态未居中显示5个席位");
if (Number.parseFloat(await page.locator(".today-package-seat strong").first().evaluate((element) => getComputedStyle(element).fontSize)) < 18) throw new Error("今日发包成员名字字号过小");
const todayBox = await page.locator(".package-today").boundingBox();
const browserBox = await page.locator(".package-browser").boundingBox();
if (!todayBox || !browserBox || todayBox.y >= browserBox.y) throw new Error("今日发包状态没有置于8天安排之前");
await page.screenshot({ path: path.join(output, "packages-desktop.png"), fullPage: true });

await page.goto("http://localhost:3000/reports", { waitUntil: "networkidle" });
if (!(await page.getByText("本周亮点", { exact: true }).isVisible())) throw new Error("每周战报亮点未显示");
const reportDownload = page.getByRole("link", { name: "下载本周战报图" });
const reportHref = await reportDownload.getAttribute("href");
if (!reportHref) throw new Error("周报分享图下载地址不存在");
const reportResponse = await appContext.request.get(`http://localhost:3000${reportHref}`);
if (!reportResponse.ok() || reportResponse.headers()["content-type"] !== "image/png") throw new Error("周报PNG生成失败");
await fs.writeFile(path.join(output, "weekly-report-share.png"), await reportResponse.body());
await page.screenshot({ path: path.join(output, "reports-desktop.png"), fullPage: false });

await page.goto("http://localhost:3000/compare", { waitUntil: "networkidle" });
if ((await page.locator(".comparison-selects select").count()) !== 3) throw new Error("成员对比选择器数量不正确");
if (!(await page.getByRole("button", { name: "排名趋势" }).isVisible())) throw new Error("排名趋势切换未显示");
await page.screenshot({ path: path.join(output, "compare-desktop.png"), fullPage: false });

await page.goto("http://localhost:3000/admin", { waitUntil: "networkidle" });
if (!(await page.getByText("账号与在线状态").isVisible())) throw new Error("管理员页未显示");
if (!(await page.getByLabel("游戏昵称 / 登录账号").isVisible())) throw new Error("合并后的组员账号输入框未显示");
if (!(await page.locator('input[name="initialPassword"]').isVisible())) throw new Error("自定义初始密码输入框未显示");
if (!(await page.locator('select[name="accountType"]').isVisible())) throw new Error("游客账号类型选择器未显示");
if (!(await page.getByText("游客（仅浏览，不参与统计）", { exact: true }).count())) throw new Error("游客账号说明未显示");
if (!(await page.getByText("已有统计周", { exact: true }).isVisible())) throw new Error("统计周管理列表未显示");
const futureDeleteButtons = page.getByRole("button", { name: "删除" });
if (await futureDeleteButtons.count() && !(await futureDeleteButtons.first().isVisible())) throw new Error("未来统计周删除入口不可见");
if (!(await page.getByRole("button", { name: "保存名称" }).first().isVisible())) throw new Error("重命名统计周入口未显示");
if (!(await page.getByText("表格导入积分").isVisible())) throw new Error("积分导入区域未显示");
if (!(await page.getByRole("link", { name: "下载标准模板" }).isVisible())) throw new Error("标准模板下载入口未显示");
if (!(await page.getByRole("columnheader", { name: "累计 / 调整扣包" }).isVisible())) throw new Error("管理员永久扣包设置入口未显示");
if (!(await page.locator('input[name^="deduction_add_"]').first().isVisible())) throw new Error("管理员新增扣包输入框未显示");
if ((await page.locator('input[name^="deduction_add_"]').first().getAttribute("min")) !== "-99") throw new Error("扣包输入框不支持负数修正");
if (!(await page.getByText("管理账号", { exact: true }).first().isVisible())) throw new Error("管理员改名入口未显示");
const managedMember = page.locator(".admin-member").filter({ hasNotText: "管理员" }).first();
const managedMemberBoxBefore = await managedMember.boundingBox();
await managedMember.getByRole("button", { name: "管理账号" }).click();
await page.locator(".member-actions-popover").waitFor({ state: "visible" });
if (!(await page.getByRole("button", { name: "删除账号" }).isVisible())) throw new Error("删除账号入口未显示");
const managedMemberBoxAfter = await managedMember.boundingBox();
if (!managedMemberBoxBefore || !managedMemberBoxAfter || Math.abs(managedMemberBoxBefore.height - managedMemberBoxAfter.height) > 1) throw new Error("管理账号展开仍会撑高成员行");
await page.screenshot({ path: path.join(output, "admin-account-popover.png"), fullPage: false });
await page.keyboard.press("Escape");
const addMemberBox = await page.locator(".add-member-card").boundingBox();
const scoreImportBox = await page.locator(".compact-score-import-panel").boundingBox();
const weekAdminBox = await page.locator(".week-admin-card").boundingBox();
if (!addMemberBox || !scoreImportBox || Math.abs(addMemberBox.width - scoreImportBox.width) > 2) throw new Error("添加组员与表格导入积分宽度不一致");
if (!weekAdminBox || weekAdminBox.height <= addMemberBox.height) throw new Error("统计周管理卡片高度不足");
if ((await page.locator(".week-management-list").evaluate((element) => getComputedStyle(element).overflowY)) !== "auto") throw new Error("统计周列表未启用内部滚动");
await page.screenshot({ path: path.join(output, "admin-desktop.png"), fullPage: false });
await page.locator(".score-editor-panel").screenshot({ path: path.join(output, "admin-score-editor.png") });

await page.goto("http://localhost:3000/profile", { waitUntil: "networkidle" });
if (!(await page.getByText("个人信息", { exact: true }).first().isVisible())) throw new Error("个人页未显示");
if (!(await page.getByText("我的战绩轨迹", { exact: true }).isVisible())) throw new Error("个人战绩轨迹未显示");
if (!(await page.getByText("最近分数变动", { exact: true }).isVisible())) throw new Error("个人分数变动记录未显示");
await page.screenshot({ path: path.join(output, "profile-desktop.png"), fullPage: false });
await appContext.close();

const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
await mobileContext.addCookies([
  { name: "fortress_session", value: token, url: "http://localhost:3000", httpOnly: true, sameSite: "Strict" },
  { name: "__Host-fortress_session", value: token, url: "https://localhost:3000", httpOnly: true, secure: true, sameSite: "Strict" }
]);
const mobilePage = await mobileContext.newPage();
await mobilePage.goto("http://localhost:3000/home", { waitUntil: "networkidle" });
if ((await mobilePage.locator(".mobile-primary-nav > a, .mobile-primary-nav > button").count()) !== 4) throw new Error("手机端主导航应保持4个固定入口");
await mobilePage.getByRole("button", { name: "更多", exact: true }).click();
if (!(await mobilePage.getByRole("link", { name: "每周战报" }).isVisible())) throw new Error("手机端更多菜单未显示次要功能");
await mobilePage.getByRole("button", { name: "关闭更多菜单" }).click();
await mobilePage.screenshot({ path: path.join(output, "home-mobile.png"), fullPage: true });
await mobilePage.goto("http://localhost:3000/scores", { waitUntil: "networkidle" });
await mobilePage.screenshot({ path: path.join(output, "scores-mobile.png"), fullPage: false });
await mobilePage.waitForTimeout(900);
const mobileBarLabels = mobilePage.locator(".chart-bar .bar-score-label");
if ((await mobileBarLabels.count()) !== scoreRowCount) throw new Error("手机端横向柱状图分数标签不完整");
const mobileChartBox = await mobilePage.locator(".visualization-panel").boundingBox();
const mobileLabelRight = await mobileBarLabels.evaluateAll((labels) => Math.max(...labels.map((label) => label.getBoundingClientRect().right)));
if (!mobileChartBox || mobileLabelRight > mobileChartBox.x + mobileChartBox.width) throw new Error("手机端柱尾分数被右侧裁切");
await mobilePage.locator(".visualization-panel").screenshot({ path: path.join(output, "scores-bar-values-mobile.png") });
await mobilePage.goto("http://localhost:3000/packages", { waitUntil: "networkidle" });
if ((await mobilePage.locator(".package-day-tab").count()) !== 8 || (await mobilePage.locator(".package-day-card").count()) !== 1) throw new Error("手机端发包日期浏览器不正确");
if ((await mobilePage.locator(".today-package-seat").count()) !== 5) throw new Error("手机端今日发包五人席位不完整");
await mobilePage.screenshot({ path: path.join(output, "packages-mobile.png"), fullPage: true });
await mobilePage.goto("http://localhost:3000/reports", { waitUntil: "networkidle" });
await mobilePage.screenshot({ path: path.join(output, "reports-mobile.png"), fullPage: true });
await mobilePage.goto("http://localhost:3000/compare", { waitUntil: "networkidle" });
await mobilePage.screenshot({ path: path.join(output, "compare-mobile.png"), fullPage: true });
await mobilePage.goto("http://localhost:3000/admin", { waitUntil: "networkidle" });
if (!(await mobilePage.getByText("已有统计周", { exact: true }).isVisible())) throw new Error("手机端统计周管理未显示");
await mobilePage.screenshot({ path: path.join(output, "admin-mobile.png"), fullPage: false });
await mobileContext.close();

await browser.close();
cleanupSession();
process.removeListener("exit", cleanupSession);
console.log(`Visual checks passed. Screenshots: ${output}`);
