import { getDb } from "@/lib/db";
import type { MemberRow, PackageAssignmentSnapshot, PackageDayStatus, ScoreChangeEvent, ScoreRow, ScoreWeek, TrendPoint } from "@/lib/types";

export function getWeeks(includeDrafts = true): ScoreWeek[] {
  return getDb().prepare(`
    SELECT id, title, event_date AS eventDate, status
    FROM weeks ${includeDrafts ? "" : "WHERE status != 'draft'"}
    ORDER BY event_date DESC, id DESC
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

export function getCurrentWeek(today = getShanghaiDate(), includeDrafts = false) {
  return selectCurrentWeek(getWeeks(includeDrafts), today);
}

function addDateDays(date: string, offset: number) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + offset)).toISOString().slice(0, 10);
}

export function getActivePackageWeeks(today = getShanghaiDate(), includeDrafts = false) {
  return getWeeks(includeDrafts)
    .filter((week) => week.eventDate <= today && addDateDays(week.eventDate, 7) >= today)
    .sort((left, right) => left.eventDate.localeCompare(right.eventDate) || left.id - right.id);
}

export function getWeekById(weekId: number) {
  return getDb().prepare(`
    SELECT id, title, event_date AS eventDate, status
    FROM weeks WHERE id = ?
  `).get(weekId) as ScoreWeek | undefined;
}

export function getScoreRows(weekId: number, activeOnly = false): ScoreRow[] {
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
    WHERE ws.week_id = ? AND u.account_type = 'member' ${activeOnly ? "AND u.is_active = 1" : ""}
    ORDER BY ws.score DESC, COALESCE(u.roster_order, 999999) ASC, u.display_name COLLATE NOCASE ASC
  `).all(weekId) as ScoreRow[];
}

export function getPackagePlanRows(weekId: number, activeOnly = true): ScoreRow[] {
  const applied = new Map(getPackageDeductionApplications(weekId).map((item) => [item.userId, item.amount]));
  return getScoreRows(weekId, activeOnly).map((row) => ({
    ...row,
    packageDeductions: Math.max(0, row.packageDeductions - (applied.get(row.userId) || 0))
  }));
}

export function getLeaderboardRows(week: ScoreWeek): ScoreRow[] {
  const currentWeek = getCurrentWeek();
  return getScoreRows(week.id, Boolean(currentWeek && week.eventDate >= currentWeek.eventDate));
}

export function getPackageAssignmentSnapshots(weekId: number): PackageAssignmentSnapshot[] {
  return getDb().prepare(`
    SELECT a.week_id AS weekId, a.day_index AS dayIndex, a.position, a.round,
      a.user_id AS userId, u.display_name AS displayName, u.avatar_url AS avatarUrl,
      u.note, a.score_snapshot AS score, a.rank_snapshot AS rank
    FROM package_assignments a
    JOIN users u ON u.id = a.user_id
    WHERE a.week_id = ?
    ORDER BY a.day_index ASC, a.position ASC
  `).all(weekId) as PackageAssignmentSnapshot[];
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
    WHERE u.package_deduction_total > 0 AND u.account_type = 'member'
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
      JOIN users member_user ON member_user.id = ws.user_id
      WHERE member_user.account_type = 'member'
    )
    SELECT w.id AS weekId, w.title AS weekTitle, w.event_date AS eventDate,
      ranked.score, ranked.rank
    FROM ranked
    JOIN weeks w ON w.id = ranked.week_id
    WHERE ranked.user_id = ? AND w.status != 'draft'
    ORDER BY w.event_date ASC, w.id ASC
  `).all(userId) as TrendPoint[];
}

export function getAllMemberTrends(): Array<TrendPoint & { userId: number; displayName: string; avatarUrl: string | null }> {
  return getDb().prepare(`
    WITH ranked AS (
      SELECT ws.user_id, ws.week_id, ws.score,
        RANK() OVER (PARTITION BY ws.week_id ORDER BY ws.score DESC) AS rank
      FROM weekly_scores ws
      JOIN users member_user ON member_user.id = ws.user_id
      WHERE member_user.account_type = 'member'
    )
    SELECT u.id AS userId, u.display_name AS displayName, u.avatar_url AS avatarUrl,
      w.id AS weekId, w.title AS weekTitle, w.event_date AS eventDate,
      ranked.score, ranked.rank
    FROM ranked
    JOIN weeks w ON w.id = ranked.week_id
    JOIN users u ON u.id = ranked.user_id
    WHERE u.is_active = 1 AND u.account_type = 'member' AND w.status != 'draft'
    ORDER BY w.event_date ASC, w.id ASC, COALESCE(u.roster_order, 999999), u.id
  `).all() as Array<TrendPoint & { userId: number; displayName: string; avatarUrl: string | null }>;
}

export function getPackageDayStatuses(weekId: number): PackageDayStatus[] {
  return getDb().prepare(`
    SELECT p.week_id AS weekId, p.day_index AS dayIndex, p.marked_by AS markedBy,
      u.display_name AS markedByName, p.sent_at AS sentAt
    FROM package_day_statuses p
    LEFT JOIN users u ON u.id = p.marked_by
    WHERE p.week_id = ? ORDER BY p.day_index ASC
  `).all(weekId) as PackageDayStatus[];
}

export function getPackageDeductionApplications(weekId: number) {
  return getDb().prepare(`
    SELECT user_id AS userId, SUM(amount) AS amount
    FROM package_deduction_applications
    WHERE week_id = ?
    GROUP BY user_id
    ORDER BY user_id
  `).all(weekId) as Array<{ userId: number; amount: number }>;
}

export function getScoreChangeEvents(userId: number, limit = 12): ScoreChangeEvent[] {
  return getDb().prepare(`
    SELECT e.id, e.week_id AS weekId, w.title AS weekTitle,
      e.previous_score AS previousScore, e.new_score AS newScore, e.delta,
      e.source, actor.display_name AS actorName, e.created_at AS createdAt
    FROM score_change_events e
    JOIN weeks w ON w.id = e.week_id
    LEFT JOIN users actor ON actor.id = e.actor_user_id
    WHERE e.user_id = ?
    ORDER BY e.id DESC LIMIT ?
  `).all(userId, limit) as ScoreChangeEvent[];
}

export function getMembers(includeInactive = true): MemberRow[] {
  const rows = getDb().prepare(`
    SELECT id, username, display_name AS displayName, avatar_url AS avatarUrl,
      role, account_type AS accountType, note, is_active AS isActive,
      must_change_password AS mustChangePassword,
      last_seen_at AS lastSeenAt, created_at AS createdAt
    FROM users
    ${includeInactive ? "" : "WHERE is_active = 1"}
    ORDER BY is_active DESC, role = 'admin' DESC, account_type = 'member' DESC, display_name COLLATE NOCASE ASC
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
