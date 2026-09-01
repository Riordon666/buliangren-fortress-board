import type { ScoreWeek } from "@/lib/types";

export function getShanghaiDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function selectCurrentWeek<T extends ScoreWeek>(weeks: T[], today: string): T | null {
  const orderedWeeks = [...weeks].sort((left, right) =>
    right.eventDate.localeCompare(left.eventDate) || right.id - left.id
  );
  return orderedWeeks.find((week) => week.eventDate <= today) || orderedWeeks.at(-1) || null;
}

export function addDateDays(date: string, offset: number) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + offset)).toISOString().slice(0, 10);
}

export function getDateDayIndex(startDate: string, date: string) {
  const toUtc = (value: string) => {
    const [year, month, day] = value.split("-").map(Number);
    return Date.UTC(year, month - 1, day);
  };
  return Math.round((toUtc(date) - toUtc(startDate)) / 86_400_000);
}
