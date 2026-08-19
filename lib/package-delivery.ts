import type Database from "better-sqlite3";
import { generatePackagePlan } from "@/lib/package-plan";
import { recordDeductionApplications } from "@/lib/package-ledger";
import { savePackageDaySnapshot } from "@/lib/package-snapshots";
import type { ScoreRow } from "@/lib/types";

export type PackageConfirmationSource = "manual" | "automatic";

type ConfirmPackageDayInput = {
  weekId: number;
  dayIndex: number;
  source: PackageConfirmationSource;
  markedBy?: number | null;
};

function addDays(date: string, offset: number) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + offset)).toISOString().slice(0, 10);
}

export function getShanghaiClock(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    minutes: Number(values.hour) * 60 + Number(values.minute)
  };
}

function getPlanRows(database: Database.Database, weekId: number): ScoreRow[] {
  return database.prepare(`
    SELECT
      u.id AS userId,
      u.username,
      u.display_name AS displayName,
      u.avatar_url AS avatarUrl,
      u.note,
      ws.score,
      ws.package_round AS packageRound,
      ws.package_deductions AS packageDeductions,
      u.package_deduction_total AS packageDeductionTotal,
      u.package_deduction_pending AS packageDeductionPending,
      RANK() OVER (ORDER BY ws.score DESC) AS rank
    FROM weekly_scores ws
    JOIN users u ON u.id = ws.user_id
    WHERE ws.week_id = ?
      AND u.is_active = 1
      AND u.account_type = 'member'
      AND u.deleted_at IS NULL
    ORDER BY ws.score DESC, COALESCE(u.roster_order, 999999), u.display_name COLLATE NOCASE
  `).all(weekId) as ScoreRow[];
}

export function confirmPackageDay(database: Database.Database, input: ConfirmPackageDayInput) {
  if (!Number.isInteger(input.weekId) || input.weekId <= 0 ||
    !Number.isInteger(input.dayIndex) || input.dayIndex < 0 || input.dayIndex > 7) {
    return false;
  }

  return database.transaction(() => {
    const week = database.prepare(`
      SELECT event_date AS eventDate, status FROM weeks WHERE id = ?
    `).get(input.weekId) as { eventDate: string; status: string } | undefined;
    if (!week || (input.source === "automatic" && week.status === "draft")) return false;

    const result = database.prepare(`
      INSERT OR IGNORE INTO package_day_statuses (
        week_id, day_index, marked_by, confirmation_source
      ) VALUES (?, ?, ?, ?)
    `).run(input.weekId, input.dayIndex, input.markedBy || null, input.source);
    if (!result.changes) return false;

    const plan = generatePackagePlan(getPlanRows(database, input.weekId), week.eventDate);
    const day = plan.days[input.dayIndex];
    savePackageDaySnapshot(database, input.weekId, input.dayIndex, day?.assignments || []);
    recordDeductionApplications(database, input.weekId, input.dayIndex, plan.deductionSkips);
    database.prepare(`
      INSERT INTO audit_logs (actor_user_id, action, details)
      VALUES (?, ?, ?)
    `).run(
      input.markedBy || null,
      input.source === "automatic" ? "系统自动确认发包" : "确认今日已发包",
      JSON.stringify({
        weekId: input.weekId,
        dayIndex: input.dayIndex,
        source: input.source,
        members: (day?.assignments || []).map((assignment) => assignment.member.userId)
      })
    );
    return true;
  }).immediate();
}

export function autoConfirmDuePackageDays(database: Database.Database, now = new Date()) {
  const clock = getShanghaiClock(now);
  database.prepare(`
    INSERT OR IGNORE INTO app_settings (key, value)
    VALUES ('package_auto_confirm_start_date', ?)
  `).run(clock.date);
  const startDate = (database.prepare(`
    SELECT value FROM app_settings WHERE key = 'package_auto_confirm_start_date'
  `).get() as { value: string }).value;
  const dueThrough = clock.minutes >= 23 * 60 + 30 ? clock.date : addDays(clock.date, -1);
  if (dueThrough < startDate) return 0;

  const weeks = database.prepare(`
    SELECT id, event_date AS eventDate
    FROM weeks
    WHERE status != 'draft'
      AND event_date <= ?
      AND date(event_date, '+7 days') >= ?
    ORDER BY event_date ASC, id ASC
  `).all(dueThrough, startDate) as Array<{ id: number; eventDate: string }>;
  const dueDays = weeks.flatMap((week) => Array.from({ length: 8 }, (_, dayIndex) => ({
    weekId: week.id,
    dayIndex,
    date: addDays(week.eventDate, dayIndex)
  }))).filter((item) => item.date >= startDate && item.date <= dueThrough)
    .sort((left, right) => left.date.localeCompare(right.date) || left.dayIndex - right.dayIndex || left.weekId - right.weekId);

  let confirmed = 0;
  for (const day of dueDays) {
    if (confirmPackageDay(database, {
      weekId: day.weekId,
      dayIndex: day.dayIndex,
      source: "automatic",
      markedBy: null
    })) confirmed += 1;
  }
  return confirmed;
}
