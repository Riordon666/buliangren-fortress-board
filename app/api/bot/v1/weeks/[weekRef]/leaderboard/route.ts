import { botApiError, botApiSuccess, createBotApiRequestId, methodNotAllowed } from "@/lib/bot-api/http";
import { getBotLeaderboardData, handleBotApiRequest } from "@/lib/bot-api/service";
import {
  BOT_LEADERBOARD_DEFAULT_LIMIT,
  BOT_LEADERBOARD_MAX_LIMIT,
  validateLimitQuery,
  validateWeekRef
} from "@/lib/bot-api/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type LeaderboardRouteContext = { params: Promise<{ weekRef: string }> };

export function GET(request: Request, context: LeaderboardRouteContext) {
  return handleBotApiRequest(request, async (requestId) => {
    const query = validateLimitQuery(request, {
      defaultLimit: BOT_LEADERBOARD_DEFAULT_LIMIT,
      maxLimit: BOT_LEADERBOARD_MAX_LIMIT
    });
    if (!query.success) return botApiError("INVALID_ARGUMENT", { requestId });
    const params = await context.params;
    const weekRef = validateWeekRef(params.weekRef);
    if (!weekRef.success) return botApiError("INVALID_ARGUMENT", { requestId });
    const data = getBotLeaderboardData(weekRef.data, query.data.limit);
    return data
      ? botApiSuccess(data, { requestId })
      : botApiError("NOT_FOUND", { requestId });
  });
}

function unsupportedMethod() {
  return methodNotAllowed(["GET"], createBotApiRequestId());
}

export const HEAD = unsupportedMethod;
export const POST = unsupportedMethod;
export const PUT = unsupportedMethod;
export const PATCH = unsupportedMethod;
export const DELETE = unsupportedMethod;
export const OPTIONS = unsupportedMethod;
