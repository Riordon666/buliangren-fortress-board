import { z } from "zod";

export const BOT_WEEKS_DEFAULT_LIMIT = 12;
export const BOT_WEEKS_MAX_LIMIT = 12;
export const BOT_LEADERBOARD_DEFAULT_LIMIT = 30;
export const BOT_LEADERBOARD_MAX_LIMIT = 30;
export const BOT_MEMBER_HISTORY_DEFAULT_LIMIT = 8;
export const BOT_MEMBER_HISTORY_MAX_LIMIT = 12;
export const BOT_MEMBER_QUERY_MAX_LENGTH = 40;
export const BOT_MEMBER_LOOKUP_MAX_BODY_BYTES = 4 * 1024;

export type ValidationResult<T> =
  | { success: true; data: T }
  | { success: false };

const positiveIntegerText = z.string().regex(/^[1-9]\d*$/).transform(Number)
  .pipe(z.number().int().positive().safe());

const strictCalendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
});

const memberLookupSchema = z.strictObject({
  query: z.string().trim().min(1).max(BOT_MEMBER_QUERY_MAX_LENGTH)
    .transform((value) => value.normalize("NFKC"))
    .refine((value) => value.length >= 1 && value.length <= BOT_MEMBER_QUERY_MAX_LENGTH),
  historyLimit: z.number().int().min(1).max(BOT_MEMBER_HISTORY_MAX_LIMIT)
    .default(BOT_MEMBER_HISTORY_DEFAULT_LIMIT)
});

function hasOnlySingleKnownQueryParameters(searchParams: URLSearchParams, known: ReadonlySet<string>) {
  const counts = new Map<string, number>();
  for (const key of searchParams.keys()) {
    if (!known.has(key)) return false;
    const count = (counts.get(key) || 0) + 1;
    if (count > 1) return false;
    counts.set(key, count);
  }
  return true;
}

function getSearchParams(request: Request) {
  try {
    return new URL(request.url).searchParams;
  } catch {
    return null;
  }
}

async function readUtf8BodyWithinLimit(request: Request, maximumBytes: number) {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > maximumBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

export function validateNoQueryParameters(request: Request): ValidationResult<Record<string, never>> {
  const params = getSearchParams(request);
  if (!params || !hasOnlySingleKnownQueryParameters(params, new Set())) return { success: false };
  return { success: true, data: {} };
}

export function validateLimitQuery(request: Request, options: {
  defaultLimit: number;
  maxLimit: number;
}): ValidationResult<{ limit: number }> {
  const params = getSearchParams(request);
  if (!params || !hasOnlySingleKnownQueryParameters(params, new Set(["limit"]))) {
    return { success: false };
  }
  const raw = params.get("limit");
  if (raw === null) return { success: true, data: { limit: options.defaultLimit } };
  const parsed = positiveIntegerText.pipe(z.number().max(options.maxLimit)).safeParse(raw);
  return parsed.success
    ? { success: true, data: { limit: parsed.data } }
    : { success: false };
}

export function validatePackagesQuery(request: Request): ValidationResult<{ date: string }> {
  const params = getSearchParams(request);
  if (!params || !hasOnlySingleKnownQueryParameters(params, new Set(["date"]))) {
    return { success: false };
  }
  const parsed = strictCalendarDate.safeParse(params.get("date"));
  return parsed.success
    ? { success: true, data: { date: parsed.data } }
    : { success: false };
}

export function validateWeekRef(value: string): ValidationResult<"current" | number> {
  if (value === "current") return { success: true, data: value };
  const parsed = positiveIntegerText.safeParse(value);
  return parsed.success
    ? { success: true, data: parsed.data }
    : { success: false };
}

export async function validateMemberLookupRequest(request: Request): Promise<ValidationResult<{
  query: string;
  historyLimit: number;
}>> {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    if (!/^\d+$/.test(declaredLength)
      || Number(declaredLength) > BOT_MEMBER_LOOKUP_MAX_BODY_BYTES) return { success: false };
  }

  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") return { success: false };

  const text = await readUtf8BodyWithinLimit(request, BOT_MEMBER_LOOKUP_MAX_BODY_BYTES);
  if (text === null) return { success: false };

  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { success: false };
  }
  const parsed = memberLookupSchema.safeParse(value);
  return parsed.success
    ? { success: true, data: parsed.data }
    : { success: false };
}
