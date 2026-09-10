import { NewsService } from "@/lib/news/service";
import { newsCacheDirectory } from "@/lib/storage-paths";

type NewsRuntime = typeof globalThis & { __fortressNews?: NewsService; __fortressNewsTimer?: NodeJS.Timeout; __fortressNewsStarted?: boolean };
const runtime = globalThis as NewsRuntime;
export function getNewsService() { return runtime.__fortressNews ||= new NewsService(newsCacheDirectory()); }

export function startNewsScheduler() {
  if (runtime.__fortressNewsStarted) return;
  runtime.__fortressNewsStarted = true;
  const tick = async () => {
    let delay = 60_000;
    try {
      await getNewsService().refresh();
      const state = await getNewsService().read();
      delay = Math.max(1_000, Date.parse(state.schedule.nextCheckAt) - Date.now());
    } catch { console.warn("[news] scheduling unavailable; retrying the local schedule later."); }
    runtime.__fortressNewsTimer = setTimeout(() => { void tick(); }, Math.min(delay, 2_147_483_647));
    runtime.__fortressNewsTimer.unref();
  };
  void tick();
}
