import { randomUUID } from "node:crypto";

export const BOT_API_VERSION = "v1" as const;
export const BOT_API_TIMEZONE = "Asia/Shanghai" as const;
export const BOT_API_MAX_RESPONSE_BYTES = 128 * 1024;

export const BOT_API_ERROR_STATUS = {
  INVALID_ARGUMENT: 400,
  UNAUTHORIZED: 401,
  NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  AMBIGUOUS_MEMBER: 409,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
  SERVICE_UNAVAILABLE: 503
} as const;

export const BOT_API_ERROR_MESSAGES = {
  INVALID_ARGUMENT: "参数不正确",
  UNAUTHORIZED: "未授权访问",
  NOT_FOUND: "未找到请求的资源",
  METHOD_NOT_ALLOWED: "请求方法不允许",
  AMBIGUOUS_MEMBER: "存在多个同名成员",
  RATE_LIMITED: "请求过于频繁，请稍后重试",
  INTERNAL_ERROR: "服务内部错误",
  SERVICE_UNAVAILABLE: "服务暂时不可用"
} as const satisfies Record<keyof typeof BOT_API_ERROR_STATUS, string>;

export type BotApiErrorCode = keyof typeof BOT_API_ERROR_STATUS;

export type AmbiguousMemberCandidate = {
  memberId: number;
  displayName: string;
};

type BotApiResponseOptions = {
  requestId?: string;
  headers?: HeadersInit;
};

type BotApiSuccessOptions = BotApiResponseOptions & {
  status?: number;
  generatedAt?: Date | string;
};

type BotApiSuccessPayload<T> = {
  ok: true;
  data: T;
  meta: {
    apiVersion: typeof BOT_API_VERSION;
    timezone: typeof BOT_API_TIMEZONE;
    generatedAt: string;
    requestId: string;
  };
};

type BotApiErrorPayload = {
  ok: false;
  error: {
    code: BotApiErrorCode;
    message: string;
    details?: {
      candidates: AmbiguousMemberCandidate[];
    };
  };
  meta: {
    requestId: string;
  };
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createBotApiRequestId(): string {
  return randomUUID();
}

function safeRequestId(candidate?: string): string {
  return candidate && UUID_PATTERN.test(candidate) ? candidate : createBotApiRequestId();
}

function responseHeaders(requestId: string, extra?: HeadersInit): Headers {
  const headers = new Headers(extra);
  headers.set("Cache-Control", "no-store");
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Request-Id", requestId);
  headers.delete("Access-Control-Allow-Origin");
  return headers;
}

function serviceUnavailablePayload(requestId: string): BotApiErrorPayload {
  return {
    ok: false,
    error: {
      code: "SERVICE_UNAVAILABLE",
      message: BOT_API_ERROR_MESSAGES.SERVICE_UNAVAILABLE
    },
    meta: { requestId }
  };
}

function serializeWithinLimit(payload: unknown): string | null {
  try {
    const body = JSON.stringify(payload);
    if (body === undefined || Buffer.byteLength(body, "utf8") > BOT_API_MAX_RESPONSE_BYTES) {
      return null;
    }
    return body;
  } catch {
    return null;
  }
}

function jsonResponse(payload: unknown, status: number, requestId: string, extraHeaders?: HeadersInit): Response {
  const headers = responseHeaders(requestId, extraHeaders);
  const body = serializeWithinLimit(payload);
  if (body !== null) {
    return new Response(body, { status, headers });
  }

  const fallbackBody = JSON.stringify(serviceUnavailablePayload(requestId));
  headers.delete("Retry-After");
  headers.delete("Allow");
  return new Response(fallbackBody, { status: BOT_API_ERROR_STATUS.SERVICE_UNAVAILABLE, headers });
}

function generatedAtIso(value?: Date | string): string {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? new Date().toISOString() : value.toISOString();
  }
  if (typeof value === "string") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return new Date().toISOString();
}

export function botApiSuccess<T>(data: T, options: BotApiSuccessOptions = {}): Response {
  const requestId = safeRequestId(options.requestId);
  const status = Number.isInteger(options.status) && options.status! >= 200 && options.status! <= 299
    ? options.status!
    : 200;
  const payload: BotApiSuccessPayload<T | null> = {
    ok: true,
    data: data === undefined ? null : data,
    meta: {
      apiVersion: BOT_API_VERSION,
      timezone: BOT_API_TIMEZONE,
      generatedAt: generatedAtIso(options.generatedAt),
      requestId
    }
  };
  return jsonResponse(payload, status, requestId, options.headers);
}

export function botApiError(code: BotApiErrorCode, options: BotApiResponseOptions = {}): Response {
  const requestId = safeRequestId(options.requestId);
  const payload: BotApiErrorPayload = {
    ok: false,
    error: {
      code,
      message: BOT_API_ERROR_MESSAGES[code]
    },
    meta: { requestId }
  };
  return jsonResponse(payload, BOT_API_ERROR_STATUS[code], requestId, options.headers);
}

export function ambiguousMemberError(
  candidates: readonly AmbiguousMemberCandidate[],
  options: BotApiResponseOptions = {}
): Response {
  const requestId = safeRequestId(options.requestId);
  const safeCandidates = candidates
    .filter((candidate) => Number.isSafeInteger(candidate.memberId) && candidate.memberId > 0
      && typeof candidate.displayName === "string" && candidate.displayName.length > 0)
    .map(({ memberId, displayName }) => ({ memberId, displayName }))
    .sort((left, right) => left.memberId - right.memberId)
    .slice(0, 5);
  const payload: BotApiErrorPayload = {
    ok: false,
    error: {
      code: "AMBIGUOUS_MEMBER",
      message: BOT_API_ERROR_MESSAGES.AMBIGUOUS_MEMBER,
      details: { candidates: safeCandidates }
    },
    meta: { requestId }
  };
  return jsonResponse(payload, BOT_API_ERROR_STATUS.AMBIGUOUS_MEMBER, requestId, options.headers);
}

export function methodNotAllowed(allowed: readonly string[], requestId?: string): Response {
  const allow = [...new Set(allowed.map((method) => method.trim().toUpperCase()).filter(Boolean))].join(", ");
  return botApiError("METHOD_NOT_ALLOWED", {
    requestId,
    headers: { Allow: allow }
  });
}
