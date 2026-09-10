import { describe, expect, it } from "vitest";
import { newsSchedule, newsWeek } from "@/lib/news/schedule";
const t = (value: string) => Date.parse(value + "+08:00");
const plan = (value: string, done: string | null = null, last: string | null = null) => newsSchedule(t(value), done, last ? t(last) : null);

describe("北京时间木叶快报更新窗口", () => {
  it.each([
    ["2026-09-08T14:59:59", "scheduled", "2026-09-08T15:00:00", 300],
    ["2026-09-08T15:00:00", "active", "2026-09-08T15:00:00", 300],
    ["2026-09-08T19:59:59", "active", "2026-09-08T19:59:59", 300],
    ["2026-09-08T20:00:00", "scheduled", "2026-09-09T15:00:00", 60],
    ["2026-09-09T14:59:59", "scheduled", "2026-09-09T15:00:00", 60],
    ["2026-09-09T15:00:00", "active", "2026-09-09T15:00:00", 60],
    ["2026-09-09T20:00:00", "scheduled", "2026-09-15T15:00:00", 300],
    ["2026-09-13T18:00:00", "scheduled", "2026-09-15T15:00:00", 300]
  ])("%s 的检查时段与边界正确", (now, phase, next, interval) => {
    expect(plan(now)).toMatchObject({ phase, nextCheckAt: new Date(t(next)).toISOString(), intervalSeconds: interval });
  });
  it("周二五分钟、周三一分钟，没有窗口尾部额外请求", () => {
    expect(plan("2026-09-08T15:01:00", null, "2026-09-08T15:00:00").nextCheckAt).toBe(new Date(t("2026-09-08T15:05:00")).toISOString());
    expect(plan("2026-09-09T15:00:30", null, "2026-09-09T15:00:00").nextCheckAt).toBe(new Date(t("2026-09-09T15:01:00")).toISOString());
    expect(plan("2026-09-08T19:57:00", null, "2026-09-08T19:55:00").nextCheckAt).toBe(new Date(t("2026-09-09T15:00:00")).toISOString());
  });
  it("周二完成后跳过周三，下周自动恢复", () => {
    expect(plan("2026-09-09T16:00:00", "2026-09-07")).toMatchObject({ phase: "complete", nextCheckAt: new Date(t("2026-09-15T15:00:00")).toISOString() });
    expect(plan("2026-09-15T15:00:00", "2026-09-07").phase).toBe("active");
  });
  it("跨年按上海周一划分周期，与服务器时区无关", () => {
    expect(newsWeek(t("2026-01-01T01:00:00")).key).toBe("2025-12-29");
    expect(plan("2026-01-01T01:00:00").nextCheckAt).toBe(new Date(t("2026-01-06T15:00:00")).toISOString());
  });
  it("一整周没有新内容时最多执行 360 次计划检查", () => {
    let now = t("2026-09-07T00:00:00");
    let last: number | null = null;
    let count = 0;
    const end = t("2026-09-14T00:00:00");
    while (now < end) {
      const next = Date.parse(newsSchedule(now, null, last).nextCheckAt);
      if (next >= end) break;
      count++; last = next; now = next + 1;
    }
    expect(count).toBe(360);
  });
});
