import type { NewsSchedule } from "@/lib/news/types";

const DAY = 86_400_000;
const SHANGHAI_OFFSET = 8 * 3_600_000;

export function newsWeek(now: number) {
  const local = new Date(now + SHANGHAI_OFFSET);
  const monday = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - ((local.getUTCDay() + 6) % 7) * DAY;
  return { key: new Date(monday).toISOString().slice(0, 10), start: monday - SHANGHAI_OFFSET };
}

export function firstNewsWindow(now: number) {
  return newsWeek(now).start + DAY + 15 * 3_600_000;
}

export function newsSchedule(now: number, completedWeek: string | null, attemptedAt: number | null): NewsSchedule {
  const week = newsWeek(now);
  const windows = [
    { start: week.start + DAY + 15 * 3_600_000, interval: 5 * 60_000 },
    { start: week.start + 2 * DAY + 15 * 3_600_000, interval: 60_000 }
  ];
  if (completedWeek !== week.key) {
    for (const window of windows) {
      const end = window.start + 5 * 3_600_000;
      const next = Math.max(window.start, now, attemptedAt === null ? 0 : attemptedAt + window.interval);
      if (next < end) return {
        week: week.key,
        phase: now >= window.start && now < end ? "active" : "scheduled",
        nextCheckAt: new Date(next).toISOString(),
        intervalSeconds: window.interval / 1000
      };
    }
  }
  return {
    week: week.key,
    phase: completedWeek === week.key ? "complete" : "scheduled",
    nextCheckAt: new Date(windows[0].start + 7 * DAY).toISOString(),
    intervalSeconds: 300
  };
}
