import { getNewsService } from "@/lib/news/runtime";
import { NEWS_IMAGE_KEY } from "@/lib/news/service";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  if (!NEWS_IMAGE_KEY.test(key)) return new Response("Not found", { status: 404 });
  const body = await getNewsService().image(key);
  if (!body) return new Response("Not found", { status: 404 });
  const etag = `"${key}"`;
  const headers = {
    "Content-Type": key.endsWith(".jpg") ? "image/jpeg" : key.endsWith(".png") ? "image/png" : "image/webp",
    "Cache-Control": "public, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff",
    "Cross-Origin-Resource-Policy": "same-origin",
    ETag: etag
  };
  if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
  return new Response(new Uint8Array(body), { headers });
}
