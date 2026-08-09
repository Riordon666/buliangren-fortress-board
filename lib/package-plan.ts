import type { ScoreRow } from "@/lib/types";

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

export function generatePackagePlan(rows: ScoreRow[], startDate: string) {
  const firstRoundMembers = rows.filter((row) => row.score >= FIRST_ROUND_MIN_SCORE);
  const laterRoundMembers = rows.filter((row) => row.score >= LATER_ROUND_MIN_SCORE);
  const totalSlots = PACKAGE_DAYS * PACKAGES_PER_DAY;
  const assignments: PackageAssignment[] = [];

  let round = 1;
  let memberIndex = 0;
  for (let slot = 0; slot < totalSlots; slot += 1) {
    let eligible = round === 1 ? firstRoundMembers : laterRoundMembers;
    if (!eligible.length) break;
    if (memberIndex >= eligible.length) {
      round += 1;
      memberIndex = 0;
      eligible = laterRoundMembers;
      if (!eligible.length) break;
    }

    assignments.push({
      slot,
      dayIndex: Math.floor(slot / PACKAGES_PER_DAY),
      position: (slot % PACKAGES_PER_DAY) + 1,
      round,
      member: eligible[memberIndex]
    });
    memberIndex += 1;
  }

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
    totalSlots,
    unfilledSlots: totalSlots - assignments.length,
    maxRound: assignments.at(-1)?.round || 0
  };
}
