import { createHash, timingSafeEqual } from "node:crypto";
import { botApiError, createBotApiRequestId } from "@/lib/bot-api/http";

export const BOT_API_TOKEN_HASH_ENV = "BOT_API_TOKEN_SHA256" as const;

const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/i;
const MAX_AUTHORIZATION_HEADER_LENGTH = 4096;

type BotAuthenticationOptions = {
  requestId?: string;
};

export type BotAuthenticationResult =
  | {
      ok: true;
      requestId: string;
      tokenDigest: string;
    }
  | {
      ok: false;
      requestId: string;
      response: Response;
    };

function unauthorized(requestId: string): BotAuthenticationResult {
  return {
    ok: false,
    requestId,
    response: botApiError("UNAUTHORIZED", {
      requestId,
      headers: { "WWW-Authenticate": "Bearer" }
    })
  };
}

export function authenticateBotRequest(
  request: Request,
  options: BotAuthenticationOptions = {}
): BotAuthenticationResult {
  const requestId = options.requestId ?? createBotApiRequestId();
  const configuredDigestHex = process.env[BOT_API_TOKEN_HASH_ENV]?.trim();

  if (!configuredDigestHex || !SHA256_HEX_PATTERN.test(configuredDigestHex)) {
    return {
      ok: false,
      requestId,
      response: botApiError("SERVICE_UNAVAILABLE", { requestId })
    };
  }

  const authorization = request.headers.get("authorization");
  if (!authorization || authorization.length > MAX_AUTHORIZATION_HEADER_LENGTH) {
    return unauthorized(requestId);
  }

  const match = /^Bearer[\t ]+([^\s]+)$/i.exec(authorization.trim());
  if (!match) return unauthorized(requestId);

  const presentedDigest = createHash("sha256").update(match[1], "utf8").digest();
  const configuredDigest = Buffer.from(configuredDigestHex, "hex");
  if (!timingSafeEqual(presentedDigest, configuredDigest)) {
    return unauthorized(requestId);
  }

  return {
    ok: true,
    requestId,
    tokenDigest: presentedDigest.toString("hex")
  };
}
