import { createHash, randomBytes } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { authenticateBotRequest, BOT_API_TOKEN_HASH_ENV } from "@/lib/bot-api/auth";
import {
  ambiguousMemberError,
  botApiError,
  botApiSuccess,
  BOT_API_MAX_RESPONSE_BYTES,
  methodNotAllowed
} from "@/lib/bot-api/http";
import { BotApiTokenBucket, enforceBotRateLimit } from "@/lib/bot-api/rate-limit";

const REQUEST_ID = "123e4567-e89b-42d3-a456-426614174000";
const originalTokenHash = process.env[BOT_API_TOKEN_HASH_ENV];

afterEach(() => {
  if (originalTokenHash === undefined) delete process.env[BOT_API_TOKEN_HASH_ENV];
  else process.env[BOT_API_TOKEN_HASH_ENV] = originalTokenHash;
});

function randomToken(): string {
  return randomBytes(48).toString("base64url");
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function authorizedRequest(token: string): Request {
  return new Request("https://example.test/api/bot/v1/health", {
    headers: { Authorization: `Bearer ${token}` }
  });
}

describe("Bot API HTTP 响应", () => {
  it("返回固定成功信封和安全响应头", async () => {
    const response = botApiSuccess({ score: 192 }, {
      requestId: REQUEST_ID,
      generatedAt: "2026-09-01T12:34:56.000Z",
      headers: { "Access-Control-Allow-Origin": "*" }
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-request-id")).toBe(REQUEST_ID);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(await response.json()).toEqual({
      ok: true,
      data: { score: 192 },
      meta: {
        apiVersion: "v1",
        timezone: "Asia/Shanghai",
        generatedAt: "2026-09-01T12:34:56.000Z",
        requestId: REQUEST_ID
      }
    });
  });

  it("只使用固定错误码、状态和中文安全消息", async () => {
    const response = botApiError("INTERNAL_ERROR", { requestId: REQUEST_ID });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      ok: false,
      error: { code: "INTERNAL_ERROR", message: "服务内部错误" },
      meta: { requestId: REQUEST_ID }
    });
  });

  it("405 响应带去重规范化的 Allow", async () => {
    const response = methodNotAllowed(["get", "POST", "GET"], REQUEST_ID);

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET, POST");
    expect((await response.json()).error.code).toBe("METHOD_NOT_ALLOWED");
  });

  it("重名详情仅保留最多五个安全字段并按 memberId 排序", async () => {
    const candidates = [6, 2, 5, 1, 4, 3].map((memberId) => ({
      memberId,
      displayName: `同名${memberId}`,
      username: "must-not-leak",
      lastSeenAt: "must-not-leak"
    }));
    const response = ambiguousMemberError(candidates, { requestId: REQUEST_ID });
    const text = await response.text();
    const body = JSON.parse(text);

    expect(response.status).toBe(409);
    expect(body.error.details.candidates).toEqual([
      { memberId: 1, displayName: "同名1" },
      { memberId: 2, displayName: "同名2" },
      { memberId: 3, displayName: "同名3" },
      { memberId: 4, displayName: "同名4" },
      { memberId: 5, displayName: "同名5" }
    ]);
    expect(text.includes("username") || text.includes("lastSeenAt") || text.includes("must-not-leak")).toBe(false);
  });

  it("超过 128KiB 或无法序列化时返回 503 小型通用错误", async () => {
    const oversized = botApiSuccess({ value: "大".repeat(BOT_API_MAX_RESPONSE_BYTES) }, { requestId: REQUEST_ID });
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const unserializable = botApiSuccess(circular, { requestId: REQUEST_ID });

    for (const response of [oversized, unserializable]) {
      const text = await response.text();
      expect(response.status).toBe(503);
      expect(Buffer.byteLength(text, "utf8")).toBeLessThanOrEqual(BOT_API_MAX_RESPONSE_BYTES);
      expect(JSON.parse(text).error).toEqual({ code: "SERVICE_UNAVAILABLE", message: "服务暂时不可用" });
    }
  });
});

describe("Bot API Bearer 鉴权", () => {
  it("仅接受与环境变量 SHA-256 匹配的 Bearer Token", () => {
    const token = randomToken();
    process.env[BOT_API_TOKEN_HASH_ENV] = sha256Hex(token);

    const result = authenticateBotRequest(authorizedRequest(token), { requestId: REQUEST_ID });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.requestId).toBe(REQUEST_ID);
    expect(result.tokenDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.keys(result).sort()).toEqual(["ok", "requestId", "tokenDigest"]);
    expect(Object.values(result).includes(token)).toBe(false);
  });

  it("缺失或错误 Token 均返回不泄露凭据的 401", async () => {
    const token = randomToken();
    const wrongToken = randomToken();
    const configuredHash = sha256Hex(token);
    process.env[BOT_API_TOKEN_HASH_ENV] = configuredHash;

    const results = [
      authenticateBotRequest(new Request("https://example.test/api/bot/v1/health"), { requestId: REQUEST_ID }),
      authenticateBotRequest(authorizedRequest(wrongToken), { requestId: REQUEST_ID })
    ];

    for (const result of results) {
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      const body = await result.response.text();
      const leaked = body.includes(token) || body.includes(wrongToken) || body.includes(configuredHash);
      expect(result.response.status).toBe(401);
      expect(result.response.headers.get("www-authenticate")).toBe("Bearer");
      expect(JSON.parse(body).error).toEqual({ code: "UNAUTHORIZED", message: "未授权访问" });
      expect(leaked).toBe(false);
    }
  });

  it("缺失或格式错误的服务端摘要返回安全的 503", async () => {
    for (const configuredHash of [undefined, "not-a-sha256-digest"] as const) {
      if (configuredHash === undefined) delete process.env[BOT_API_TOKEN_HASH_ENV];
      else process.env[BOT_API_TOKEN_HASH_ENV] = configuredHash;
      const result = authenticateBotRequest(authorizedRequest(randomToken()), { requestId: REQUEST_ID });

      expect(result.ok).toBe(false);
      if (result.ok) continue;
      const body = await result.response.text();
      expect(result.response.status).toBe(503);
      expect(JSON.parse(body).error).toEqual({ code: "SERVICE_UNAVAILABLE", message: "服务暂时不可用" });
      expect(body.includes("BOT_API_TOKEN_SHA256") || body.includes("not-a-sha256-digest")).toBe(false);
    }
  });
});

describe("Bot API Token Bucket 限流", () => {
  it("每个摘要独立提供突发 10 次与每秒 1 次补充", () => {
    let now = 10_000;
    const limiter = new BotApiTokenBucket({ clock: () => now });
    const firstDigest = "a".repeat(64);
    const secondDigest = "b".repeat(64);

    for (let index = 0; index < 10; index += 1) {
      expect(limiter.consume(firstDigest).allowed).toBe(true);
    }
    expect(limiter.consume(firstDigest)).toEqual({ allowed: false, remaining: 0, retryAfterSeconds: 1 });
    expect(limiter.consume(secondDigest).allowed).toBe(true);

    now += 1_000;
    expect(limiter.consume(firstDigest).allowed).toBe(true);
    expect(limiter.consume(firstDigest)).toEqual({ allowed: false, remaining: 0, retryAfterSeconds: 1 });
  });

  it("429 返回 Retry-After 和固定安全信封", async () => {
    const limiter = new BotApiTokenBucket({ clock: () => 20_000 });
    const digest = "c".repeat(64);
    for (let index = 0; index < 10; index += 1) limiter.consume(digest);

    const result = enforceBotRateLimit(digest, { limiter, requestId: REQUEST_ID });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.retryAfterSeconds).toBe(1);
    expect(result.response.status).toBe(429);
    expect(result.response.headers.get("retry-after")).toBe("1");
    expect(result.response.headers.get("access-control-allow-origin")).toBeNull();
    expect((await result.response.json()).error).toEqual({
      code: "RATE_LIMITED",
      message: "请求过于频繁，请稍后重试"
    });
  });

  it("令牌桶达到键容量时不会重置现有 Token 的额度", () => {
    const limiter = new BotApiTokenBucket({ clock: () => 30_000, maxBuckets: 1 });
    const digest = "d".repeat(64);
    for (let index = 0; index < 10; index += 1) limiter.consume(digest);

    expect(limiter.consume(digest)).toEqual({ allowed: false, remaining: 0, retryAfterSeconds: 1 });
  });
});
