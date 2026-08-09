import { getDb } from "@/lib/db";
import type { MemberRow, ScoreRow, ScoreWeek, TrendPoint } from "@/lib/types";

export function getWeeks(): ScoreWeek[] {
  return getDb().prepare(`
    SELECT id, title, event_date AS eventDate, status
    FROM weeks ORDER BY event_date DESC, id DESC
  `).all() as ScoreWeek[];
}

export function getLatestWeek() {
  return getWeeks()[0] || null;
}

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

export function selectCurrentWeek(weeks: ScoreWeek[], today: string) {
  const orderedWeeks = [...weeks].sort((left, right) =>
    right.eventDate.localeCompare(left.eventDate) || right.id - left.id
  );
  return orderedWeeks.find((week) => week.eventDate <= today) || orderedWeeks.at(-1) || null;
}

export function getCurrentWeek(today = getShanghaiDate()) {
  return selectCurrentWeek(getWeeks(), today);
}

export function getWeekById(weekId: number) {
  return getDb().prepare(`
    SELECT id, title, event_date AS eventDate, status
    FROM weeks WHERE id = ?
  `).get(weekId) as ScoreWeek | undefined;
}

export function getScoreRows(weekId: number): ScoreRow[] {
  return getDb().prepare(`
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
    ORDER BY ws.score DESC, COALESCE(u.roster_order, 999999) ASC, u.display_name COLLATE NOCASE ASC
  `).all(weekId) as ScoreRow[];
}

export function getPackageDeductionRows(weekId: number): ScoreRow[] {
  return getDb().prepare(`
    SELECT
      u.id AS userId,
      u.username,
      u.display_name AS displayName,
      u.avatar_url AS avatarUrl,
      u.note,
      COALESCE(ws.score, 0) AS score,
      ws.package_round AS packageRound,
      COALESCE(ws.package_deductions, 0) AS packageDeductions,
      u.package_deduction_total AS packageDeductionTotal,
      u.package_deduction_pending AS packageDeductionPending,
      0 AS rank
    FROM users u
    LEFT JOIN weekly_scores ws ON ws.user_id = u.id AND ws.week_id = ?
    WHERE u.package_deduction_total > 0
    ORDER BY u.package_deduction_total DESC, COALESCE(ws.score, 0) DESC,
      COALESCE(u.roster_order, 999999) ASC, u.display_name COLLATE NOCASE ASC
  `).all(weekId) as ScoreRow[];
}

export function getScoreOverview(rows: ScoreRow[]) {
  const totalScore = rows.reduce((sum, row) => sum + row.score, 0);
  const participants = rows.filter((row) => row.score > 0).length;
  const average = participants ? Math.round(totalScore / participants) : 0;
  const topScore = rows[0]?.score || 0;
  const packageConfigured = rows.filter((row) => row.packageRound !== null).length;
  return { totalScore, participants, average, topScore, packageConfigured };
}

export function getMemberTrend(userId: number): TrendPoint[] {
  return getDb().prepare(`
    WITH ranked AS (
      SELECT ws.user_id, ws.week_id, ws.score,
        RANK() OVER (PARTITION BY ws.week_id ORDER BY ws.score DESC) AS rank
      FROM weekly_scores ws
    )
    SELECT w.id AS weekId, w.title AS weekTitle, w.event_date AS eventDate,
      ranked.score, ranked.rank
    FROM ranked
    JOIN weeks w ON w.id = ranked.week_id
    WHERE ranked.user_id = ?
    ORDER BY w.event_date ASC, w.id ASC
  `).all(userId) as TrendPoint[];
}

export function getMembers(includeInactive = true): MemberRow[] {
  const rows = getDb().prepare(`
    SELECT id, username, display_name AS displayName, avatar_url AS avatarUrl,
      role, note, is_active AS isActive,
      must_change_password AS mustChangePassword,
      last_seen_at AS lastSeenAt, created_at AS createdAt
    FROM users
    ${includeInactive ? "" : "WHERE is_active = 1"}
    ORDER BY is_active DESC, role = 'admin' DESC, display_name COLLATE NOCASE ASC
  `).all() as Array<Omit<MemberRow, "isActive" | "mustChangePassword"> & {
    isActive: number;
    mustChangePassword: number;
  }>;

  return rows.map((row) => ({
    ...row,
    isActive: Boolean(row.isActive),
    mustChangePassword: Boolean(row.mustChangePassword)
  }));
}

export type AuditRow = {
  id: number;
  actorName: string | null;
  targetName: string | null;
  action: string;
  details: string | null;
  createdAt: string;
};

export function getAuditLogs(limit = 12): AuditRow[] {
  return getDb().prepare(`
    SELECT l.id, actor.display_name AS actorName, target.display_name AS targetName,
      l.action, l.details, l.created_at AS createdAt
    FROM audit_logs l
    LEFT JOIN users actor ON actor.id = l.actor_user_id
    LEFT JOIN users target ON target.id = l.target_user_id
    ORDER BY l.id DESC LIMIT ?
  `).all(limit) as AuditRow[];
}
