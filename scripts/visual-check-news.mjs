import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";

const base = process.env.NEWS_PREVIEW_URL || "http://127.0.0.1:3102";
const output = path.join(process.cwd(), "artifacts", "news-visual-check");
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", headless: true });
const errors = [];
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));
  const response = await context.request.get(base + "/api/news");
  assert.equal(response.status(), 200);
  const original = await response.json();
  assert.ok(["ready", "stale"].includes(original.status));
  assert.ok(original.edition.pages.length > 0);
  for (const width of [1440, 1280, 1024, 900, 768, 390, 320]) {
    await page.setViewportSize({ width, height: width < 600 ? 844 : 1000 });
    await page.goto(base + "/news", { waitUntil: "networkidle" });
    assert.equal(new URL(page.url()).pathname, "/news");
    assert.equal(await page.getByRole("heading", { name: "木叶快报", exact: true }).count(), 1);
    assert.equal(await page.getByRole("navigation", { name: "公开导航", exact: true }).getByRole("link").count(), 3);
    await page.locator(".news-poster img").first().evaluate(img => img.decode());
    assert.ok(await page.locator(".news-poster img").first().evaluate(img => img.naturalWidth > 0));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `overflow at ${width}`);
    assert.equal(await page.getByRole("button", { name: "立即刷新", exact: true }).isVisible(), true);
    if ([1440, 390, 320].includes(width)) await page.screenshot({ path: path.join(output, `news-${width}.png`) });
    if (width === 390) {
      await page.getByRole("button", { name: "放大阅读", exact: true }).click();
      await page.waitForFunction(() => { const el = document.querySelector(".news-poster-reader"); return el.scrollWidth > el.clientWidth; });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
      await page.screenshot({ path: path.join(output, "news-mobile-zoom.png") });
      await page.getByRole("button", { name: "适合屏幕", exact: true }).click();
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  const forcedResponse = page.waitForResponse(res => res.url().endsWith("/api/news") && res.request().method() === "POST");
  await page.getByRole("button", { name: "立即刷新", exact: true }).click();
  const forced = await forcedResponse;
  assert.equal(forced.status(), 200);
  const refreshed = await forced.json();
  assert.ok(["ready", "stale"].includes(refreshed.status));
  if (refreshed.status === "ready") {
    assert.ok(Date.parse(refreshed.checkedAt) >= Date.parse(original.checkedAt || original.edition.syncedAt));
    await page.getByText(/已重新核对源站，当前就是最新快报。|已从源站获取并显示最新快报。/).waitFor();
  } else {
    assert.deepEqual(refreshed.edition, original.edition);
    await page.getByText("源站暂时无法读取，已保留上次内容，稍后会自动重试。", { exact: true }).waitFor();
    assert.equal(await page.locator(".news-poster img").count(), original.edition.pages.length);
  }
  await page.screenshot({ path: path.join(output, "news-refresh-complete.png") });
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const route of ["/", "/accessories"]) {
      await page.goto(base + route, { waitUntil: "networkidle" });
      assert.equal(new URL(page.url()).pathname, route);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `${route} overflow at ${width}`);
      assert.equal(await page.getByRole("navigation", { name: "公开导航", exact: true }).getByRole("link", { name: "木叶快报", exact: true }).isVisible(), true);
    }
  }
  // Simulate a newly published edition and an unavailable upstream to exercise browser polling and fallback.
  const simulated = await context.newPage();
  simulated.on("pageerror", error => errors.push(error.message));
  await simulated.clock.install();
  await simulated.goto(base + "/news", { waitUntil: "networkidle" });
  let polling = 0;
  let next = { ...refreshed, status: "ready", edition: { ...refreshed.edition, version: "999999" } };
  await simulated.route("**/api/news", route => { polling++; return route.fulfill({ json: next }); });
  await simulated.clock.fastForward(30_001);
  await simulated.getByText("源站快报已更新，当前已切换为新内容。", { exact: true }).waitFor();
  assert.ok(polling > 0);
  next = { ...next, status: "stale" };
  await simulated.clock.fastForward(30_001);
  await simulated.getByText("暂时无法核对源站更新，正在展示上次成功同步的快报。页面会自动重试。", { exact: true }).waitFor();
  assert.equal(await simulated.locator(".news-poster img").count(), refreshed.edition.pages.length);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ sourceVersion: refreshed.edition.version, pages: refreshed.edition.pages, manualRefresh: { httpStatus: forced.status(), sourceStatus: refreshed.status }, widths: [1440,1280,1024,900,768,390,320], pollingAndStaleFallback: "passed", pageErrors: errors, screenshots: output }, null, 2));
} finally { await browser.close(); }
