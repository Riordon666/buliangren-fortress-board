import {
  ambiguousMemberError,
  botApiError,
  botApiSuccess,
  createBotApiRequestId,
  methodNotAllowed
} from "@/lib/bot-api/http";
import { handleBotApiRequest, lookupBotMemberData } from "@/lib/bot-api/service";
import { validateMemberLookupRequest, validateNoQueryParameters } from "@/lib/bot-api/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(request: Request) {
  return handleBotApiRequest(request, async (requestId) => {
    if (!validateNoQueryParameters(request).success) {
      return botApiError("INVALID_ARGUMENT", { requestId });
    }
    const body = await validateMemberLookupRequest(request);
    if (!body.success) return botApiError("INVALID_ARGUMENT", { requestId });
    const result = lookupBotMemberData(body.data.query, body.data.historyLimit);
    if (result.kind === "not-found") return botApiError("NOT_FOUND", { requestId });
    if (result.kind === "ambiguous") {
      return ambiguousMemberError(result.candidates, { requestId });
    }
    return botApiSuccess(result.data, { requestId });
  });
}

function unsupportedMethod() {
  return methodNotAllowed(["POST"], createBotApiRequestId());
}

export const GET = unsupportedMethod;
export const HEAD = unsupportedMethod;
export const PUT = unsupportedMethod;
export const PATCH = unsupportedMethod;
export const DELETE = unsupportedMethod;
export const OPTIONS = unsupportedMethod;
