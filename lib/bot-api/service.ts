import { authenticateBotRequest } from "@/lib/bot-api/auth";
import { botApiError, createBotApiRequestId } from "@/lib/bot-api/http";
import { enforceBotRateLimit } from "@/lib/bot-api/rate-limit";
import { BotReadDatabaseUnavailableError } from "@/lib/bot-api/readonly-db";
import {
  BotRepositoryInvariantError,
  type BotMemberCandidate,
  type BotVisibleWeek,
  type BotWeekRef,
  withBotFactsRepository
} from "@/lib/bot-api/repository";
import {
  FIRST_ROUND_MIN_SCORE,
  LATER_ROUND_MIN_SCORE,
  PACKAGE_DAYS,
  PACKAGES_PER_DAY
} from "@/lib/package-plan";
import { getShanghaiDate } from "@/lib/shanghai-date";

export type BotApiWeek = {
  weekId: number;
  title: string;
  eventDate: string;
  status: "published" | "locked";
};

export type BotWeekSummaryData = {
  week: BotApiWeek;
  summary: {
    memberCount: number;
    participantCount: number;
    totalScore: number;
    averageParticipantScore: number;
    topScore: number;
    firstRoundEligibleCount: number;
    laterRoundEligibleCount: number;
    sentPackageDays: number;
    totalPackageDays: number;
    packagesPerDay: number;
  };
  eligibilityThresholds: {
    firstRoundMinScore: number;
    laterRoundsMinScore: number;
  };
};

export type BotLeaderboardData = {
  week: BotApiWeek;
  entries: Array<{
    memberId: number;
    displayName: string;
    rank: number;
    score: number;
    firstRoundEligible: boolean;
    laterRoundsEligible: boolean;
  }>;
};

export type BotMemberData = {
  member: BotMemberCandidate;
  history: Array<{
    weekId: number;
    title: string;
    eventDate: string;
    status: "published" | "locked";
    rank: number;
    score: number;
    firstRoundEligible: boolean;
    laterRoundsEligible: boolean;
  }>;
};

export type BotMemberLookupServiceResult =
  | { kind: "found"; data: BotMemberData }
  | { kind: "not-found" }
  | { kind: "ambiguous"; candidates: BotMemberCandidate[] };

export type BotPackagesData = {
  date: string;
  cycles: Array<{
    week: BotApiWeek;
    isSent: boolean;
    assignments: Array<{
      memberId: number;
      displayName: string;
      position: number;
      round: number;
      rank: number;
      score: number;
      firstRoundEligible: boolean;
      laterRoundsEligible: boolean;
    }>;
  }>;
};

type BotApiOperation = (requestId: string) => Response | Promise<Response>;

function toApiWeek(week: BotVisibleWeek): BotApiWeek {
  return {
    weekId: week.id,
    title: week.title,
    eventDate: week.eventDate,
    status: week.status
  };
}

export async function handleBotApiRequest(request: Request, operation: BotApiOperation): Promise<Response> {
  const requestId = createBotApiRequestId();
  try {
    const authentication = authenticateBotRequest(request, { requestId });
    if (!authentication.ok) return authentication.response;

    const rateLimit = enforceBotRateLimit(authentication.tokenDigest, { requestId });
    if (!rateLimit.ok) return rateLimit.response;

    return await operation(requestId);
  } catch (error) {
    const unavailable = error instanceof BotReadDatabaseUnavailableError
      || error instanceof BotRepositoryInvariantError;
    const code = unavailable ? "SERVICE_UNAVAILABLE" : "INTERNAL_ERROR";
    console.error(`[bot-api] ${code} requestId=${requestId}`);
    return botApiError(code, { requestId });
  }
}

export function getBotHealthData() {
  return withBotFactsRepository((repository) => {
    repository.health();
    return { healthy: true } as const;
  });
}

export function getBotWeeksData(limit: number) {
  return withBotFactsRepository((repository) => ({
    weeks: repository.listWeeks(limit).map(toApiWeek)
  }));
}

export function getBotWeekSummaryData(weekRef: BotWeekRef): BotWeekSummaryData | null {
  return withBotFactsRepository((repository) => {
    const today = getShanghaiDate();
    const week = repository.resolveWeek(weekRef, today);
    if (!week) return null;
    const facts = repository.getWeekSummary(week.id, today);
    if (!facts) return null;
    return {
      week: toApiWeek(facts.week),
      summary: {
        memberCount: facts.memberCount,
        participantCount: facts.participants,
        totalScore: facts.totalScore,
        averageParticipantScore: facts.averageScore,
        topScore: facts.topScore,
        firstRoundEligibleCount: facts.firstRoundEligible,
        laterRoundEligibleCount: facts.laterRoundEligible,
        sentPackageDays: facts.sentDays,
        totalPackageDays: PACKAGE_DAYS,
        packagesPerDay: PACKAGES_PER_DAY
      },
      eligibilityThresholds: {
        firstRoundMinScore: FIRST_ROUND_MIN_SCORE,
        laterRoundsMinScore: LATER_ROUND_MIN_SCORE
      }
    };
  });
}

export function getBotLeaderboardData(weekRef: BotWeekRef, limit: number): BotLeaderboardData | null {
  return withBotFactsRepository((repository) => {
    const today = getShanghaiDate();
    const week = repository.resolveWeek(weekRef, today);
    if (!week) return null;
    const facts = repository.getLeaderboard(week.id, limit, today);
    if (!facts) return null;
    return {
      week: toApiWeek(facts.week),
      entries: facts.entries.map((entry) => ({
        memberId: entry.memberId,
        displayName: entry.displayName,
        rank: entry.rank,
        score: entry.score,
        firstRoundEligible: entry.firstRoundEligible,
        laterRoundsEligible: entry.laterRoundEligible
      }))
    };
  });
}

export function lookupBotMemberData(query: string, historyLimit: number): BotMemberLookupServiceResult {
  return withBotFactsRepository((repository) => {
    const lookup = repository.findMemberCandidates(query);
    if (lookup.matchCount === 0) return { kind: "not-found" };
    if (lookup.matchCount !== 1 || lookup.candidates.length !== 1) {
      return { kind: "ambiguous", candidates: lookup.candidates };
    }

    const member = lookup.candidates[0];
    const history = repository.getMemberHistory(member.memberId, historyLimit).map((point) => ({
      weekId: point.weekId,
      title: point.title,
      eventDate: point.eventDate,
      status: point.status,
      rank: point.rank,
      score: point.score,
      firstRoundEligible: point.firstRoundEligible,
      laterRoundsEligible: point.laterRoundEligible
    }));
    return { kind: "found", data: { member, history } };
  });
}

export function getBotPackagesData(date: string): BotPackagesData {
  return withBotFactsRepository((repository) => ({
    date,
    cycles: repository.getPackagesForDate(date).map((cycle) => ({
      week: toApiWeek(cycle.week),
      isSent: cycle.sent,
      assignments: cycle.assignments.map((assignment) => ({
        memberId: assignment.memberId,
        displayName: assignment.displayName,
        position: assignment.position,
        round: assignment.round,
        rank: assignment.rank,
        score: assignment.score,
        firstRoundEligible: assignment.firstRoundEligible,
        laterRoundsEligible: assignment.laterRoundEligible
      }))
    }))
  }));
}
