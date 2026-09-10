import { NewsService } from "@/lib/news/service";
import { NEWS_REFRESH_MS } from "@/lib/news/types";
import { newsCacheDirectory } from "@/lib/storage-paths";

type NewsRuntime = typeof globalThis & { __fortressNews?: NewsService; __fortressNewsTimer?: NodeJS.Timeout };
const runtime = globalThis as NewsRuntime;

export function getNewsService() {
  return runtime.__fortressNews ||= new NewsService(newsCacheDirectory());
}

export function startNewsScheduler() {
  if (runtime.__fortressNewsTimer) return;
  void getNewsService().refresh();
  runtime.__fortressNewsTimer = setInterval(() => { void getNewsService().refresh(); }, NEWS_REFRESH_MS);
  runtime.__fortressNewsTimer.unref();
}
