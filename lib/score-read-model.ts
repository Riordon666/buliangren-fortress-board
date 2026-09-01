import type Database from "better-sqlite3";
import type { ScoreRow } from "@/lib/types";

export type ScoreReadOptions = {
  activeOnly?: boolean;
  visibleWeeksOnly?: boolean;
};

export function queryScoreRows(
  database: Database.Database,
  weekId: number,
  options: ScoreReadOptions = {}
): ScoreRow[] {
  const activeFilter = options.activeOnly ? "AND u.is_active = 1 AND u.deleted_at IS NULL" : "";
  const visibleWeekFilter = options.visibleWeeksOnly ? "AND w.status IN ('published', 'locked')" : "";
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
    JOIN weeks w ON w.id = ws.week_id
    WHERE ws.week_id = ? AND u.account_type = 'member'
      ${activeFilter}
      ${visibleWeekFilter}
    ORDER BY ws.score DESC, COALESCE(u.roster_order, 999999) ASC, u.display_name COLLATE NOCASE ASC
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
