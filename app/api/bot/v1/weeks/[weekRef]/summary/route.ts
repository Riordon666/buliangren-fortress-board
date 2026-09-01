import { botApiError, botApiSuccess, createBotApiRequestId, methodNotAllowed } from "@/lib/bot-api/http";
import { getBotWeekSummaryData, handleBotApiRequest } from "@/lib/bot-api/service";
import { validateNoQueryParameters, validateWeekRef } from "@/lib/bot-api/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SummaryRouteContext = { params: Promise<{ weekRef: string }> };

export function GET(request: Request, context: SummaryRouteContext) {
  return handleBotApiRequest(request, async (requestId) => {
    if (!validateNoQueryParameters(request).success) {
      return botApiError("INVALID_ARGUMENT", { requestId });
    }
    const params = await context.params;
    const weekRef = validateWeekRef(params.weekRef);
    if (!weekRef.success) return botApiError("INVALID_ARGUMENT", { requestId });
    const data = getBotWeekSummaryData(weekRef.data);
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
