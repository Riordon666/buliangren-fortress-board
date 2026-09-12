import { isIP } from "node:net";
import { getMailConfig } from "@/lib/news-mail/config";
import { getNewsMailService } from "@/lib/news-mail/runtime";
import { isMailRequestError, MailRequestError } from "@/lib/news-mail/store";

async function smallJson(request: Request) {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new MailRequestError(400, "请求格式不正确，请刷新页面后重试。");
  const reader = request.body?.getReader();
  if (!reader) throw new MailRequestError(400, "请求内容不能为空。");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const {done,value} = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 2048) { await reader.cancel(); throw new MailRequestError(400, "请求内容过长。"); }
      chunks.push(value);
    }
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid-body");
    return value as Record<string, unknown>;
  } catch (error) {
    if (isMailRequestError(error)) throw error;
    throw new MailRequestError(400, "请求格式不正确，请刷新页面后重试。");
  } finally { reader.releaseLock(); }
}
function checkOrigin(request: Request, publicUrl: string) {
  const origin = request.headers.get("origin");
  const allowed = new Set([new URL(request.url).origin, publicUrl]);
  const host = request.headers.get("host") || new URL(request.url).host;
  let mismatch = false;
  if (origin !== null) {
    try {
      const parsed = new URL(origin);
      const directHost = parsed.host === host && ["http:", "https:"].includes(parsed.protocol);
      mismatch = parsed.origin !== origin || (!allowed.has(origin) && !directHost);
    } catch { mismatch = true; }
  }
  if (mismatch || request.headers.get("sec-fetch-site") === "cross-site") throw new MailRequestError(403, "请求来源不匹配，请回到本站操作。");
}
export async function subscriptionRequest(request: Request, operation: "subscribe" | "confirm" | "unsubscribe") {
  const headers: Record<string, string> = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
  try {
    const config = getMailConfig();
    if (!config) throw new MailRequestError(503, "邮件提醒暂未开放，请稍后再来。");
    checkOrigin(request, config.publicUrl);
    const body = await smallJson(request);
    const service = getNewsMailService();
    if (operation === "subscribe") {
      // This header must be overwritten by the trusted reverse proxy; global/email limits still apply without it.
      const address = request.headers.get("x-real-ip") || "";
      service.subscribe(body.email, isIP(address) ? address : "unknown");
      return Response.json({ message: "申请已受理。请查收确认邮件，确认后接收后续快报通知；若已订阅，无需重复操作。" }, { headers });
    }
    if (operation === "confirm") {
      await service.confirm(body.token);
      return Response.json({ message: "订阅成功！后续木叶快报更新时，你会收到邮件提醒和活动图片。" }, { headers });
    }
    service.unsubscribe(body.token);
    return Response.json({ message: "已取消订阅，之后不会再收到木叶快报更新提醒。" }, { headers });
  } catch (error) {
    if (isMailRequestError(error)) {
      if (error.retryAfter) headers["Retry-After"] = String(error.retryAfter);
      return Response.json({ message: error.message }, { status: error.status, headers });
    }
    console.warn("[news-mail] subscription request unavailable.");
    return Response.json({ message: "邮件服务暂时不可用，请稍后重试。" }, { status: 503, headers });
  }
}
