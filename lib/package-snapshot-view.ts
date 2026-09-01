import type { PackageAssignment, PackageDay } from "@/lib/package-plan";
import type { PackageAssignmentSnapshot } from "@/lib/types";

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
