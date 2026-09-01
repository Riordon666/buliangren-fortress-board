import { botApiError, botApiSuccess, createBotApiRequestId, methodNotAllowed } from "@/lib/bot-api/http";
import { getBotWeeksData, handleBotApiRequest } from "@/lib/bot-api/service";
import {
  BOT_WEEKS_DEFAULT_LIMIT,
  BOT_WEEKS_MAX_LIMIT,
  validateLimitQuery
} from "@/lib/bot-api/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return handleBotApiRequest(request, (requestId) => {
    const query = validateLimitQuery(request, {
      defaultLimit: BOT_WEEKS_DEFAULT_LIMIT,
      maxLimit: BOT_WEEKS_MAX_LIMIT
    });
    if (!query.success) return botApiError("INVALID_ARGUMENT", { requestId });
    return botApiSuccess(getBotWeeksData(query.data.limit), { requestId });
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
