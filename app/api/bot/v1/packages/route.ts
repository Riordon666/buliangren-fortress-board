import { botApiError, botApiSuccess, createBotApiRequestId, methodNotAllowed } from "@/lib/bot-api/http";
import { getBotPackagesData, handleBotApiRequest } from "@/lib/bot-api/service";
import { validatePackagesQuery } from "@/lib/bot-api/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return handleBotApiRequest(request, (requestId) => {
    const query = validatePackagesQuery(request);
    if (!query.success) return botApiError("INVALID_ARGUMENT", { requestId });
    return botApiSuccess(getBotPackagesData(query.data.date), { requestId });
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
