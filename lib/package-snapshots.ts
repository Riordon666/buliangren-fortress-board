import type Database from "better-sqlite3";
import { generatePackagePlan, type PackageAssignment, type PackageDay } from "@/lib/package-plan";
import type { PackageAssignmentSnapshot, ScoreRow } from "@/lib/types";
import { recordDeductionApplications } from "@/lib/package-ledger";

export function savePackageDaySnapshot(
  database: Database.Database,
  weekId: number,
  dayIndex: number,
  assignments: PackageAssignment[]
) {
  const insert = database.prepare(`
    INSERT OR IGNORE INTO package_assignments (
      week_id, day_index, position, user_id, round, score_snapshot, rank_snapshot
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  for (const assignment of assignments) {
    insert.run(
      weekId,
      dayIndex,
      assignment.position,
      assignment.member.userId,
      assignment.round,
      assignment.member.score,
      assignment.member.rank
    );
  }
}

export function snapshotsToAssignments(snapshots: PackageAssignmentSnapshot[]): PackageAssignment[] {
  return snapshots.map((snapshot) => ({
    slot: snapshot.dayIndex * 5 + snapshot.position - 1,
    dayIndex: snapshot.dayIndex,
    position: snapshot.position,
    round: snapshot.round,
    member: {
      userId: snapshot.userId,
      username: snapshot.displayName,
      displayName: snapshot.displayName,
      avatarUrl: snapshot.avatarUrl,
      note: snapshot.note,
      score: snapshot.score,
      rank: snapshot.rank,
      packageRound: null,
      packageDeductions: 0,
      packageDeductionTotal: 0,
      packageDeductionPending: 0
    }
  }));
}

export function mergePackagePlanDays(
  days: PackageDay[],
  snapshots: PackageAssignmentSnapshot[],
  sentDayIndexes: Iterable<number>
) {
  const sent = new Set(sentDayIndexes);
  const savedAssignments = snapshotsToAssignments(snapshots);
  return days.map((day) => sent.has(day.dayIndex) ? {
    ...day,
    assignments: savedAssignments.filter((assignment) => assignment.dayIndex === day.dayIndex)
  } : day);
}

export function backfillMissingPackageSnapshots(database: Database.Database) {
  const missing = database.prepare(`
    SELECT p.week_id AS weekId, p.day_index AS dayIndex, w.event_date AS eventDate
    FROM package_day_statuses p
    JOIN weeks w ON w.id = p.week_id
    WHERE NOT EXISTS (
      SELECT 1 FROM package_assignments a
      WHERE a.week_id = p.week_id AND a.day_index = p.day_index
    )
    ORDER BY w.event_date ASC, p.day_index ASC
  `).all() as Array<{ weekId: number; dayIndex: number; eventDate: string }>;
  const getRows = database.prepare(`
    SELECT u.id AS userId, u.username, u.display_name AS displayName,
      u.avatar_url AS avatarUrl, u.note, ws.score, ws.package_round AS packageRound,
      ws.package_deductions AS packageDeductions,
      u.package_deduction_total AS packageDeductionTotal,
      u.package_deduction_pending AS packageDeductionPending,
      RANK() OVER (ORDER BY ws.score DESC) AS rank
    FROM weekly_scores ws JOIN users u ON u.id = ws.user_id
    WHERE ws.week_id = ? AND u.is_active = 1 AND u.account_type = 'member'
    ORDER BY ws.score DESC, COALESCE(u.roster_order, 999999), u.display_name COLLATE NOCASE
  `);
  database.transaction(() => {
    for (const item of missing) {
      const plan = generatePackagePlan(getRows.all(item.weekId) as ScoreRow[], item.eventDate);
      savePackageDaySnapshot(database, item.weekId, item.dayIndex, plan.days[item.dayIndex]?.assignments || []);
      recordDeductionApplications(database, item.weekId, item.dayIndex, plan.deductionSkips);
    }
  }).immediate();
}
