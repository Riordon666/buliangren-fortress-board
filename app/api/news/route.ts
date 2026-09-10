import { getNewsService } from "@/lib/news/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const state = await getNewsService().read();
  return Response.json(state, {
    status: state.status === "unavailable" ? 503 : 200,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }
  });
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  // The production reverse proxy may send an internal Host. Use the known public origin,
  // while keeping local previews same-origin and never trusting arbitrary forwarded hosts.
  const allowedOrigins = new Set([new URL(request.url).origin, "https://naruto.riordon.xyz"]);
  const host = request.headers.get("host") || new URL(request.url).host;
  let originMismatch = false;
  if (origin !== null) {
    try {
      const parsed = new URL(origin);
      const directHost = parsed.host === host && ["http:", "https:"].includes(parsed.protocol);
      originMismatch = parsed.origin !== origin || (!allowedOrigins.has(origin) && !directHost);
    } catch { originMismatch = true; }
  }
  if (request.headers.get("sec-fetch-site") === "cross-site" || originMismatch) {
    return Response.json({ error: "请求来源不匹配" }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  const state = await getNewsService().forceRead();
  if (!state) return Response.json({ error: "刚刚已检查过快报，请稍后再试" }, { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": String(getNewsService().retryAfterSeconds() || 60) } });
  return Response.json(state, {
    status: state.status === "unavailable" ? 503 : 200,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }
  });
}
