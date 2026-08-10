import type { ScoreRow } from "@/lib/types";
import type { DeductionSkip } from "@/lib/package-ledger";

export const PACKAGE_DAYS = 8;
export const PACKAGES_PER_DAY = 5;
export const FIRST_ROUND_MIN_SCORE = 40;
export const LATER_ROUND_MIN_SCORE = 60;

export type PackageAssignment = {
  slot: number;
  dayIndex: number;
  position: number;
  round: number;
  member: ScoreRow;
};

export type PackageDay = {
  dayIndex: number;
  date: string;
  weekday: string;
  assignments: PackageAssignment[];
};

export type PackageDeductionRank = {
  rank: number;
  count: number;
  scheduled: number;
  applied: number;
  member: ScoreRow;
};

export function getPackageRoundsByMember(assignments: PackageAssignment[]) {
  const roundsByMember = new Map<number, number[]>();
  for (const assignment of assignments) {
    const rounds = roundsByMember.get(assignment.member.userId) || [];
    if (!rounds.includes(assignment.round)) rounds.push(assignment.round);
    roundsByMember.set(assignment.member.userId, rounds);
  }
  return roundsByMember;
}

function addUtcDays(date: string, offset: number) {
  const [year, month, day] = date.split("-").map(Number);
  const value = new Date(Date.UTC(year, month - 1, day + offset));
  return value.toISOString().slice(0, 10);
}

function weekdayLabel(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"][
    new Date(Date.UTC(year, month - 1, day)).getUTCDay()
  ];
}

export function generatePackagePlan(rows: ScoreRow[], startDate: string, deductionRows = rows) {
  const firstRoundMembers = rows.filter((row) => row.score >= FIRST_ROUND_MIN_SCORE);
  const laterRoundMembers = rows.filter((row) => row.score >= LATER_ROUND_MIN_SCORE);
  const totalSlots = PACKAGE_DAYS * PACKAGES_PER_DAY;
  const assignments: PackageAssignment[] = [];
  const remainingDeductions = new Map(
    rows.map((row) => [row.userId, Math.max(0, Math.trunc(row.packageDeductions || 0))])
  );
  const appliedDeductions = new Map<number, number>();
  const deductionSkips: DeductionSkip[] = [];

  let round = 1;
  let memberIndex = 0;
  while (assignments.length < totalSlots) {
    let eligible = round === 1 ? firstRoundMembers : laterRoundMembers;
    if (!eligible.length) break;
    if (memberIndex >= eligible.length) {
      round += 1;
      memberIndex = 0;
      eligible = laterRoundMembers;
      if (!eligible.length) break;
    }

    const member = eligible[memberIndex];
    memberIndex += 1;
    const deductions = remainingDeductions.get(member.userId) || 0;
    if (round >= 2 && deductions > 0) {
      remainingDeductions.set(member.userId, deductions - 1);
      appliedDeductions.set(member.userId, (appliedDeductions.get(member.userId) || 0) + 1);
      deductionSkips.push({
        userId: member.userId,
        dayIndex: Math.min(PACKAGE_DAYS - 1, Math.floor(assignments.length / PACKAGES_PER_DAY)),
        round
      });
      continue;
    }

    const slot = assignments.length;
    assignments.push({
      slot,
      dayIndex: Math.floor(slot / PACKAGES_PER_DAY),
      position: (slot % PACKAGES_PER_DAY) + 1,
      round,
      member
    });
  }

  const deductionMembers = deductionRows
    .filter((row) => row.packageDeductionTotal > 0)
    .sort((left, right) =>
      right.packageDeductionTotal - left.packageDeductionTotal
      || right.score - left.score
      || left.displayName.localeCompare(right.displayName, "zh-CN")
    );
  let previousCount: number | null = null;
  let previousRank = 0;
  const deductionRanking: PackageDeductionRank[] = deductionMembers.map((member, index) => {
    if (member.packageDeductionTotal !== previousCount) previousRank = index + 1;
    previousCount = member.packageDeductionTotal;
    return {
      rank: previousRank,
      count: member.packageDeductionTotal,
      scheduled: member.packageDeductions,
      applied: appliedDeductions.get(member.userId) || 0,
      member
    };
  });

  const days: PackageDay[] = Array.from({ length: PACKAGE_DAYS }, (_, dayIndex) => {
    const date = addUtcDays(startDate, dayIndex);
    return {
      dayIndex,
      date,
      weekday: weekdayLabel(date),
      assignments: assignments.filter((assignment) => assignment.dayIndex === dayIndex)
    };
  });

  return {
    days,
    assignments,
    firstRoundEligible: firstRoundMembers.length,
    laterRoundEligible: laterRoundMembers.length,
    deductionRanking,
    deductionSkips,
    totalDeductions: deductionRanking.reduce((sum, item) => sum + item.count, 0),
    scheduledDeductionCount: deductionRanking.reduce((sum, item) => sum + item.scheduled, 0),
    appliedDeductionCount: deductionRanking.reduce((sum, item) => sum + item.applied, 0),
    totalSlots,
    unfilledSlots: totalSlots - assignments.length,
    maxRound: assignments.at(-1)?.round || 0
  };
}
