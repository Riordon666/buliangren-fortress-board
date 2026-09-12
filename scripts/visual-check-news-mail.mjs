import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";

const base = new URL(process.env.NEWS_PREVIEW_URL || "http://127.0.0.1:3102");
const output = path.join(process.cwd(), "artifacts", "news-mail-visual-check");
const executablePath = process.env.NEWS_BROWSER_PATH || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const widths = [1440, 1024, 768, 390, 320];
const endpoint = "/api/news/subscriptions";
const screenshots = [];
const pageErrors = [];
const requests = [];
const unexpectedPosts = [];
const checks = [];
let responsePlan = { status: 200, json: { message: "请前往邮箱确认订阅。" } };
let releasePending;
let pendingGate;
let passed = false;
await fs.mkdir(output, { recursive: true });

const browser = await chromium.launch({ executablePath, headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1, serviceWorkers: "block" });
  // Every subscription endpoint is mocked here. No real email or subscription mutation is sent.
  await context.route("**/api/news/subscriptions**", async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    assert.ok([endpoint, `${endpoint}/confirm`, `${endpoint}/unsubscribe`].includes(pathname), "unexpected subscription endpoint");
    const headers = await request.allHeaders();
    requests.push({ path: pathname, method: request.method(), body: request.postDataJSON(), referer: headers.referer ?? null });
    const plan = responsePlan;
    if (plan.pending) await pendingGate;
    if (plan.abort) return route.abort("failed");
    return route.fulfill({ status: plan.status ?? 200, contentType: "application/json", body: JSON.stringify(plan.json ?? {}) });
  });
  context.on("request", (request) => {
    if (request.method() === "POST" && !new URL(request.url()).pathname.startsWith(endpoint)) {
      unexpectedPosts.push(new URL(request.url()).pathname);
    }
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const href = (route) => new URL(route, base).href;
  const card = page.locator(".news-subscription-card");
  const input = card.getByLabel("接收邮箱", { exact: true });
  const submit = card.getByRole("button", { name: "发送订阅确认邮件", exact: true });

  async function noOverflow(label) {
    const sizes = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
    assert.ok(sizes.document <= sizes.viewport + 1 && sizes.body <= sizes.viewport + 1, `${label}: horizontal overflow ${JSON.stringify(sizes)}`);
  }
  async function saveScreenshot(locator, name) {
    const file = path.join(output, name);
    await locator.screenshot({ path: file, animations: "disabled" });
    screenshots.push(file);
  }
  async function checkMetadata() {
    assert.equal(await page.locator('meta[name="referrer"]').getAttribute("content"), "no-referrer");
    assert.match(await page.locator('meta[name="robots"]').getAttribute("content"), /\bnoindex\b/);
    const linkedTokens = await page.locator("a[href]").evaluateAll((links) => links.filter((link) => new URL(link.href).searchParams.has("token")).length);
    assert.equal(linkedTokens, 0, "navigation links must not propagate the email token");
  }

  await page.goto(href("/news"), { waitUntil: "networkidle" });
  assert.equal(await input.isEnabled(), true, "preview must enable subscriptions with fake mail configuration before this script runs");
  assert.equal(requests.length, 0, "loading the news page must not submit a subscription");
  for (const width of widths) {
    await page.setViewportSize({ width, height: width < 600 ? 844 : 1000 });
    await card.scrollIntoViewIfNeeded();
    assert.equal(await card.isVisible(), true, `subscription card hidden at ${width}px`);
    const cardBounds = await card.evaluate((element) => { const rect = element.getBoundingClientRect(); return { top: rect.top, bottom: rect.bottom, viewportHeight: innerHeight }; });
    assert.ok(cardBounds.top >= -1 && cardBounds.bottom <= cardBounds.viewportHeight + 1, `entire subscription card must scroll into view at ${width}px: ${JSON.stringify(cardBounds)}`);
    await noOverflow(`news ${width}px`);
    const fontSizes = await card.locator("h2, p, label, input, button, .news-subscription-status, .news-subscription-heading > div > span").evaluateAll((elements) => elements.map((element) => ({ tag: element.tagName, size: Number.parseFloat(getComputedStyle(element).fontSize) })));
    assert.ok(fontSizes.every((entry) => entry.size >= 15), `subscription text smaller than 15px at ${width}px: ${JSON.stringify(fontSizes)}`);
    if ([1440, 390].includes(width)) await saveScreenshot(card, `subscription-card-${width}.png`);
  }
  checks.push("entire subscription card scrolls into view, no horizontal overflow, and text/input fonts >= 15px at all five widths");

  await page.setViewportSize({ width: 390, height: 844 });
  await input.fill("not-an-email");
  await submit.click();
  assert.equal(await input.evaluate((element) => element.checkValidity()), false);
  assert.equal(requests.length, 0, "invalid email must not trigger an API request");
  checks.push("browser rejects invalid email before submission");

  await input.fill("preview.reader@example.invalid");
  pendingGate = new Promise((resolve) => { releasePending = resolve; });
  responsePlan = { pending: true, status: 200, json: { message: "确认邮件已准备好，请前往邮箱确认订阅。" } };
  const submissionRequest = page.waitForRequest((request) => new URL(request.url()).pathname === endpoint && request.method() === "POST");
  await submit.click();
  assert.deepEqual((await submissionRequest).postDataJSON(), { email: "preview.reader@example.invalid" });
  const pendingButton = card.getByRole("button", { name: "正在发送…", exact: true });
  await pendingButton.waitFor();
  assert.equal(await pendingButton.isDisabled(), true);
  assert.equal(await input.isDisabled(), true);
  assert.equal(await card.locator("form").getAttribute("aria-busy"), "true");
  // A real native click on a disabled button cannot enqueue another request.
  await pendingButton.evaluate((button) => { button.click(); button.click(); });
  await page.waitForTimeout(100);
  assert.equal(requests.length, 1, "loading state must prevent duplicate submissions");
  releasePending();
  await card.getByText("确认邮件已准备好，请前往邮箱确认订阅。", { exact: true }).waitFor();
  assert.equal(await card.locator(".news-subscription-status").evaluate((element) => element.classList.contains("is-success")), true);
  checks.push("valid email POST body, pending state, duplicate click prevention, and confirmation-mail success");

  for (const scenario of [
    { name: "rate-limit", status: 429, json: { message: "提交过于频繁，请一分钟后再试。" }, expected: "提交过于频繁，请一分钟后再试。" },
    { name: "unavailable", status: 503, json: {}, expected: "邮件订阅暂时不可用，请稍后再试。" },
    { name: "invalid-server-email", status: 400, json: { message: "请填写有效邮箱地址。" }, expected: "请填写有效邮箱地址。" },
    { name: "network-error", abort: true, expected: "暂时未收到发送结果，请先检查收件箱，稍后可重新提交。" }
  ]) {
    await input.fill(`${scenario.name}@example.invalid`);
    responsePlan = scenario;
    const count = requests.length;
    await submit.click();
    await card.getByText(scenario.expected, { exact: true }).waitFor();
    assert.equal(requests.length, count + 1, `${scenario.name} should issue exactly one mocked POST`);
    assert.equal(await card.locator(".news-subscription-status").evaluate((element) => element.classList.contains("is-error")), true);
    assert.equal(await submit.isEnabled(), true, `${scenario.name} must allow a later retry`);
    checks.push(`subscription ${scenario.name} error state`);
  }

  for (const action of ["confirm", "unsubscribe"]) {
    const token = `preview-only-${action}.no-real-subscription-token`;
    const count = requests.length;
    const actionPath = `/news/subscription/${action}`;
    await page.goto(href(`${actionPath}?${new URLSearchParams({ token })}`), { waitUntil: "networkidle" });
    assert.equal(requests.length, count, `${action} GET/hydration must never POST`);
    await checkMetadata();
    const actionPanel = page.locator(".news-subscription-action");
    for (const width of widths) {
      await page.setViewportSize({ width, height: width < 600 ? 844 : 1000 });
      await noOverflow(`${action} ${width}px`);
      if (action === "confirm" && [1440, 390].includes(width)) await saveScreenshot(actionPanel, `confirmation-${width}.png`);
    }
    assert.equal(requests.length, count, `${action} viewing/resizing must not POST`);
    responsePlan = { status: 200, json: { message: action === "confirm" ? "订阅确认成功，下一期更新时将发送邮件。" : "退订成功，不再接收木叶快报邮件。" } };
    const actionRequest = page.waitForRequest((request) => new URL(request.url()).pathname === `${endpoint}/${action}` && request.method() === "POST");
    await actionPanel.getByRole("button", { name: action === "confirm" ? "确认订阅" : "确认退订", exact: true }).click();
    const submitted = await actionRequest;
    assert.deepEqual(submitted.postDataJSON(), { token });
    const headers = await submitted.allHeaders();
    assert.equal(headers.referer, undefined, `${action} POST must not send its token-bearing page in Referer`);
    await page.getByRole("heading", { level: 1, name: action === "confirm" ? "订阅已确认" : "已完成退订", exact: true }).waitFor();
    await page.waitForURL((url) => url.pathname === actionPath && !url.searchParams.has("token"));
    assert.equal(new URL(page.url()).search, "", `${action} success must clear the query string`);
    assert.equal(await actionPanel.getByRole("button").count(), 0, `${action} completed action must not remain clickable`);
    assert.equal(requests.length, count + 1);
    checks.push(`${action}: passive GET, explicit POST with exact token, no Referer, success clears URL token`);

    const afterAction = requests.length;
    for (const query of ["", "?token=", "?token=one&token=two"]) {
      await page.goto(href(actionPath + query), { waitUntil: "networkidle" });
      await checkMetadata();
      assert.equal(await page.getByRole("button", { name: action === "confirm" ? "确认订阅" : "确认退订", exact: true }).isDisabled(), true);
      await page.getByText("链接缺少有效信息，请从邮件中重新打开完整链接。", { exact: true }).waitFor();
      assert.equal(requests.length, afterAction, `${action} missing/ambiguous token must not POST`);
    }
    checks.push(`${action}: missing, empty, and repeated token disable the action without network mutation`);
  }
  assert.deepEqual(unexpectedPosts, [], "no source refresh or other real POST may occur during this check");
  assert.deepEqual(pageErrors, [], "browser must not report uncaught page errors");
  assert.ok(requests.every((request) => request.method === "POST"));
  passed = true;
  await context.close();
} finally {
  if (releasePending) releasePending();
  await browser.close();
  const report = { passed, preview: base.origin, widths, mockedSubscriptionRequests: requests.length, realMailRequests: 0, unexpectedPosts, checks, pageErrors, screenshots };
  await fs.writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
}
