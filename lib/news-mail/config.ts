import { createHmac, timingSafeEqual } from "node:crypto";

export type MailConfig = { apiUrl: string; apiToken: string; subscriptionSecret: string; publicUrl: string };
export function getMailConfig(env: Record<string, string | undefined> = process.env): MailConfig | null {
  const apiToken = env.NEWS_MAIL_API_TOKEN?.trim() || "";
  const subscriptionSecret = env.NEWS_SUBSCRIPTION_SECRET?.trim() || "";
  if (apiToken.length < 32 || subscriptionSecret.length < 32 || apiToken === subscriptionSecret) return null;
  try {
    const api = new URL(env.NEWS_MAIL_API_URL || "");
    const site = new URL(env.NEWS_PUBLIC_URL || "");
    if (api.protocol !== "https:" || api.username || api.password || api.hash || api.search ||
        site.protocol !== "https:" || site.username || site.password || site.hash || site.search || site.pathname !== "/") return null;
    return { apiUrl: api.href, apiToken, subscriptionSecret, publicUrl: site.origin };
  } catch { return null; }
}
export function mailConfigured() { return getMailConfig() !== null; }
export function privateHash(secret: string, value: string) { return createHmac("sha256", secret).update(value).digest("hex"); }
export type SubscriptionToken = { id: string; generation: string; purpose: "confirm" | "unsubscribe" };
export function signSubscriptionToken(config: MailConfig, value: SubscriptionToken) {
  const encoded = Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encoded}.${privateHash(config.subscriptionSecret, encoded)}`;
}
export function parseSubscriptionToken(config: MailConfig, raw: unknown, purpose: SubscriptionToken["purpose"]): SubscriptionToken | null {
  if (typeof raw !== "string" || raw.length > 700 || !/^[A-Za-z0-9_-]+\.[a-f0-9]{64}$/.test(raw)) return null;
  const [encoded, signature] = raw.split(".");
  const expected = privateHash(config.subscriptionSecret, encoded);
  if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try {
    const value = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    return typeof value.id === "string" && value.id.length <= 50 && typeof value.generation === "string" && value.generation.length <= 50 && value.purpose === purpose ? value : null;
  } catch { return null; }
}
