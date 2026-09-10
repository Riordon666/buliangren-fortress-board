import { isAllowedSourceUrl } from "@/lib/news/parser";
import { NEWS_USER_AGENT } from "@/lib/news/types";

export type NewsFetch = typeof fetch;

export async function fetchNewsResource(url: string, maxBytes: number, fetcher: NewsFetch = fetch) {
  let current = url;
  const signal = AbortSignal.timeout(15_000);
  for (let redirect = 0; redirect <= 4; redirect++) {
    if (!isAllowedSourceUrl(current)) throw new Error("untrusted-source");
    const response = await fetcher(current, {
      cache: "no-store",
      redirect: "manual",
      signal,
      headers: {
        "User-Agent": NEWS_USER_AGENT,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Cache-Control": "no-cache"
      }
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location) throw new Error("missing-redirect");
      current = new URL(location, current).href;
      continue;
    }
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      throw new Error("source-unavailable");
    }
    const advertisedSize = Number(response.headers.get("content-length") || 0);
    if (advertisedSize > maxBytes) { await response.body.cancel(); throw new Error("source-too-large"); }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        total += part.value.byteLength;
        if (total > maxBytes) { await reader.cancel(); throw new Error("source-too-large"); }
        chunks.push(part.value);
      }
    } finally { reader.releaseLock(); }
    return { url: current, bytes: Buffer.concat(chunks), contentType: response.headers.get("content-type") || "" };
  }
  throw new Error("too-many-redirects");
}
