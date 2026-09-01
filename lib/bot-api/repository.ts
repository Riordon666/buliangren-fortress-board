import type Database from "better-sqlite3";
import {
  FIRST_ROUND_MIN_SCORE,
  LATER_ROUND_MIN_SCORE,
  generatePackagePlan
} from "@/lib/package-plan";
import { snapshotsToAssignments } from "@/lib/package-snapshot-view";
import { getScoreOverview, queryScoreRows } from "@/lib/score-read-model";
import { getDateDayIndex, getShanghaiDate, selectCurrentWeek } from "@/lib/shanghai-date";
import type { PackageAssignmentSnapshot, ScoreRow } from "@/lib/types";
import { withBotReadTransaction } from "@/lib/bot-api/readonly-db";

export type BotWeekRef = "current" | number;

export type BotVisibleWeek = {
  id: number;
  title: string;
  eventDate: string;
  status: "published" | "locked";
};

export type BotLeaderboardEntry = {
  memberId: number;
  displayName: string;
  rank: number;
  score: number;
  firstRoundEligible: boolean;
  laterRoundEligible: boolean;
};

export type BotWeekSummaryFacts = {
  week: BotVisibleWeek;
  memberCount: number;
  participants: number;
  totalScore: number;
  averageScore: number;
  topScore: number;
  firstRoundEligible: number;
  laterRoundEligible: number;
  sentDays: number;
};

export type BotMemberCandidate = {
  memberId: number;
  displayName: string;
};

export type BotMemberLookupResult = {
  matchCount: number;
  candidates: BotMemberCandidate[];
};

export type BotMemberHistoryPoint = {
  weekId: number;
  title: string;
  eventDate: string;
  status: "published" | "locked";
  rank: number;
  score: number;
  firstRoundEligible: boolean;
  laterRoundEligible: boolean;
};

export type BotPackageAssignmentFact = {
  memberId: number;
  displayName: string;
  position: number;
  round: number;
  rank: number;
  score: number;
  firstRoundEligible: boolean;
  laterRoundEligible: boolean;
};

export type BotPackageCycleFacts = {
  week: BotVisibleWeek;
  date: string;
  dayIndex: number;
  sent: boolean;
  assignments: BotPackageAssignmentFact[];
};

const MAX_WEEK_LIST_LIMIT = 12;
const MAX_LEADERBOARD_LIMIT = 30;
const MAX_HISTORY_LIMIT = 12;
const MAX_MEMBER_CANDIDATES = 5;

function requireIntegerInRange(value: number, minimum: number, maximum: number, label: string) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${label} is outside the supported range`);
  }
}

function requirePositiveId(value: number, label: string) {
  requireIntegerInRange(value, 1, Number.MAX_SAFE_INTEGER, label);
}

function toLeaderboardEntry(row: ScoreRow): BotLeaderboardEntry {
  return {
    memberId: row.userId,
    displayName: row.displayName,
    rank: row.rank,
    score: row.score,
    firstRoundEligible: row.score >= FIRST_ROUND_MIN_SCORE,
    laterRoundEligible: row.score >= LATER_ROUND_MIN_SCORE
  };
}

export class BotRepositoryInvariantError extends Error {
  constructor() {
    super("Bot facts repository invariant failed");
    this.name = "BotRepositoryInvariantError";
  }
}

export class BotFactsRepository {
  constructor(private readonly database: Database.Database) {}

  health() {
    const row = this.database.prepare(`
      SELECT sqlite_version() AS sqliteVersion,
        (SELECT COUNT(*) FROM weeks WHERE status IN ('published', 'locked')) AS visibleWeekCount
    `).get() as { sqliteVersion: string; visibleWeekCount: number };
    return { sqliteVersion: row.sqliteVersion };
  }

  listWeeks(limit: number): BotVisibleWeek[] {
    requireIntegerInRange(limit, 1, MAX_WEEK_LIST_LIMIT, "limit");
    return this.database.prepare(`
      SELECT id, title, event_date AS eventDate, status
      FROM weeks
      WHERE status IN ('published', 'locked')
      ORDER BY event_date DESC, id DESC
      LIMIT ?
    `).all(limit) as BotVisibleWeek[];
  }

  resolveWeek(weekRef: BotWeekRef, today = getShanghaiDate()): BotVisibleWeek | null {
    if (weekRef !== "current") {
      requirePositiveId(weekRef, "weekRef");
      return this.getVisibleWeekById(weekRef);
    }
    return selectCurrentWeek(this.getAllVisibleWeeks(), today);
  }

  getWeekSummary(weekId: number, today = getShanghaiDate()): BotWeekSummaryFacts | null {
    requirePositiveId(weekId, "weekId");
    const week = this.getVisibleWeekById(weekId);
    if (!week) return null;
    const activeOnly = this.isCurrentOrFutureWeek(week, today);
    const rows = this.getVisibleScoreRows(week.id, activeOnly);
    const overview = getScoreOverview(rows);
    const sentDays = (this.database.prepare(`
      SELECT COUNT(*) AS count
      FROM package_day_statuses p
      JOIN weeks w ON w.id = p.week_id
      WHERE p.week_id = ? AND w.status IN ('published', 'locked')
    `).get(week.id) as { count: number }).count;
    return {
      week,
      memberCount: rows.length,
      participants: overview.participants,
      totalScore: overview.totalScore,
      averageScore: overview.average,
      topScore: overview.topScore,
      firstRoundEligible: rows.filter((row) => row.score >= FIRST_ROUND_MIN_SCORE).length,
      laterRoundEligible: rows.filter((row) => row.score >= LATER_ROUND_MIN_SCORE).length,
      sentDays
    };
  }

  getLeaderboard(weekId: number, limit: number, today = getShanghaiDate()) {
    requirePositiveId(weekId, "weekId");
    requireIntegerInRange(limit, 1, MAX_LEADERBOARD_LIMIT, "limit");
    const week = this.getVisibleWeekById(weekId);
    if (!week) return null;
    const activeOnly = this.isCurrentOrFutureWeek(week, today);
    const rows = this.getVisibleScoreRows(week.id, activeOnly);
    return { week, entries: rows.slice(0, limit).map(toLeaderboardEntry) };
  }

  findMemberCandidates(query: string): BotMemberLookupResult {
    const normalizedQuery = query.normalize("NFKC");
    const rows = this.database.prepare(`
      SELECT id AS memberId, display_name AS displayName
      FROM users
      WHERE account_type = 'member' AND deleted_at IS NULL
      ORDER BY COALESCE(roster_order, 999999) ASC, id ASC
    `).all() as BotMemberCandidate[];
    const matches = rows.filter((row) => row.displayName.normalize("NFKC") === normalizedQuery);
    return {
      matchCount: matches.length,
      candidates: matches.slice(0, MAX_MEMBER_CANDIDATES)
    };
  }

  getMemberHistory(memberId: number, limit: number): BotMemberHistoryPoint[] {
    requirePositiveId(memberId, "memberId");
    requireIntegerInRange(limit, 1, MAX_HISTORY_LIMIT, "historyLimit");
    const exists = Boolean(this.database.prepare(`
      SELECT 1 FROM users
      WHERE id = ? AND account_type = 'member' AND deleted_at IS NULL
    `).get(memberId));
    if (!exists) return [];
    const visibleWeeks = this.getAllVisibleWeeks();
    const currentWeek = selectCurrentWeek(visibleWeeks, getShanghaiDate());
    if (!currentWeek) return [];
    const history: BotMemberHistoryPoint[] = [];
    for (const week of visibleWeeks) {
      const activeOnly = week.eventDate >= currentWeek.eventDate;
      const row = this.getVisibleScoreRows(week.id, activeOnly)
        .find((score) => score.userId === memberId);
      if (!row) continue;
      history.push({
        weekId: week.id,
        title: week.title,
        eventDate: week.eventDate,
        status: week.status,
        rank: row.rank,
        score: row.score,
        firstRoundEligible: row.score >= FIRST_ROUND_MIN_SCORE,
        laterRoundEligible: row.score >= LATER_ROUND_MIN_SCORE
      });
      if (history.length >= limit) break;
    }
    return history;
  }

  getPackagesForDate(date: string): BotPackageCycleFacts[] {
    const weeks = this.database.prepare(`
      SELECT id, title, event_date AS eventDate, status
      FROM weeks
      WHERE status IN ('published', 'locked')
        AND event_date <= ?
        AND date(event_date, '+7 days') >= ?
      ORDER BY event_date ASC, id ASC
    `).all(date, date) as BotVisibleWeek[];

    if (weeks.length > 2) throw new BotRepositoryInvariantError();

    return weeks.map((week) => {
      const dayIndex = getDateDayIndex(week.eventDate, date);
      const sent = Boolean(this.database.prepare(`
        SELECT 1
        FROM package_day_statuses p
        JOIN weeks w ON w.id = p.week_id
        WHERE p.week_id = ? AND p.day_index = ?
          AND w.status IN ('published', 'locked')
      `).get(week.id, dayIndex));
      const assignments = sent
        ? this.getFrozenPackageAssignments(week.id, dayIndex)
        : this.getCurrentPackageAssignments(week, dayIndex);
      return {
        week,
        date,
        dayIndex,
        sent,
        assignments: assignments.map((assignment) => ({
          memberId: assignment.member.userId,
          displayName: assignment.member.displayName,
          position: assignment.position,
          round: assignment.round,
          rank: assignment.member.rank,
          score: assignment.member.score,
          firstRoundEligible: assignment.member.score >= FIRST_ROUND_MIN_SCORE,
          laterRoundEligible: assignment.member.score >= LATER_ROUND_MIN_SCORE
        }))
      };
    });
  }

  private getFrozenPackageAssignments(weekId: number, dayIndex: number) {
    const snapshots = this.getPackageSnapshots(weekId, dayIndex);
    if (snapshots.length > 0) this.assertCompleteSnapshot(snapshots);
    return snapshotsToAssignments(snapshots);
  }

  private getCurrentPackageAssignments(week: BotVisibleWeek, dayIndex: number) {
    const rows = this.getVisibleScoreRows(week.id, true);
    const plan = generatePackagePlan(rows, week.eventDate);
    const day = plan.days.find((item) => item.dayIndex === dayIndex);
    if (!day) throw new BotRepositoryInvariantError();
    return day.assignments;
  }

  private getAllVisibleWeeks(): BotVisibleWeek[] {
    return this.database.prepare(`
      SELECT id, title, event_date AS eventDate, status
      FROM weeks
      WHERE status IN ('published', 'locked')
      ORDER BY event_date DESC, id DESC
    `).all() as BotVisibleWeek[];
  }

  private getVisibleWeekById(weekId: number): BotVisibleWeek | null {
    return (this.database.prepare(`
      SELECT id, title, event_date AS eventDate, status
      FROM weeks
      WHERE id = ? AND status IN ('published', 'locked')
    `).get(weekId) as BotVisibleWeek | undefined) || null;
  }

  private isCurrentOrFutureWeek(week: BotVisibleWeek, today: string) {
    const currentWeek = selectCurrentWeek(this.getAllVisibleWeeks(), today);
    return Boolean(currentWeek && week.eventDate >= currentWeek.eventDate);
  }

  private getVisibleScoreRows(weekId: number, activeOnly: boolean): ScoreRow[] {
    return queryScoreRows(this.database, weekId, { activeOnly, visibleWeeksOnly: true });
  }

  private getPackageSnapshots(weekId: number, dayIndex: number): PackageAssignmentSnapshot[] {
    return this.database.prepare(`
      SELECT a.week_id AS weekId, a.day_index AS dayIndex, a.position, a.round,
        a.user_id AS userId, u.display_name AS displayName,
        NULL AS avatarUrl, NULL AS note,
        a.score_snapshot AS score, a.rank_snapshot AS rank
      FROM package_assignments a
      JOIN users u ON u.id = a.user_id
      JOIN weeks w ON w.id = a.week_id
      WHERE a.week_id = ? AND a.day_index = ?
        AND w.status IN ('published', 'locked')
      ORDER BY a.position ASC
    `).all(weekId, dayIndex) as PackageAssignmentSnapshot[];
  }

  private assertCompleteSnapshot(snapshots: PackageAssignmentSnapshot[]) {
    if (snapshots.length > 5 || snapshots.some((snapshot, index) => snapshot.position !== index + 1)) {
      throw new BotRepositoryInvariantError();
    }
  }
}

export function withBotFactsRepository<T>(reader: (repository: BotFactsRepository) => T): T {
  return withBotReadTransaction((database) => reader(new BotFactsRepository(database)));
}
