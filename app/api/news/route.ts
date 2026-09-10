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
  const host = request.headers.get("host") || new URL(request.url).host;
  let originMismatch = false;
  try { originMismatch = !!origin && new URL(origin).host !== host; } catch { originMismatch = true; }
  if (request.headers.get("sec-fetch-site") === "cross-site" || originMismatch) {
    return Response.json({ error: "请求来源不匹配" }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  const state = await getNewsService().forceRead();
  if (!state) return Response.json({ error: "刷新请求过于频繁，请稍后再试" }, { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": "5" } });
  return Response.json(state, {
    status: state.status === "unavailable" ? 503 : 200,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }
  });
}
