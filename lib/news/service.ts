import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { fetchNewsResource, type NewsFetch } from "@/lib/news/fetch";
import { isAllowedSourceUrl, parseNewsEntry, parseNewsPosters } from "@/lib/news/parser";
import { firstNewsWindow, newsSchedule, newsWeek } from "@/lib/news/schedule";
import { NEWS_MANUAL_COOLDOWN_MS, NEWS_SOURCE_URL, type NewsEdition, type NewsPage, type NewsState } from "@/lib/news/types";

export const NEWS_IMAGE_KEY = /^[a-f0-9]{64}\.(?:jpg|png|webp)$/;
type Cycle = { week: string; baseline: string | null; observedAt: number | null; complete: boolean };
type StoredNews = {
  signature: string;
  edition: NewsEdition | null;
  cycle: Cycle | null;
  attemptedAt: number | null;
  checkedAt: string | null;
  failed: boolean;
};
const fingerprint = (edition: NewsEdition | null) => edition?.pages.map(page => page.key).join(",") || null;

export class NewsService {
  private stored: StoredNews = { signature: "", edition: null, cycle: null, attemptedAt: null, checkedAt: null, failed: false };
  private loading: Promise<void> | null = null;
  private pending: Promise<void> | null = null;
  constructor(private directory: string, private fetcher: NewsFetch = fetch, private clock = Date.now) {}

  private load() {
    return this.loading ||= this.loadCache();
  }

  private async loadCache() {
    try {
      const file = path.join(this.directory, "edition.json");
      if ((await fs.stat(file)).size > 64 * 1024) return;
      const value = JSON.parse(await fs.readFile(file, "utf8")) as Partial<StoredNews>;
      const edition = value.edition;
      if (edition) {
        if (typeof value.signature !== "string" || typeof edition.version !== "string" || !/^\d{1,16}$/.test(edition.version) ||
          edition.title !== "火影忍者手游木叶快报" || !isAllowedSourceUrl(edition.sourceUrl) || !Number.isFinite(Date.parse(edition.syncedAt)) ||
          !Array.isArray(edition.pages) || !edition.pages.length || edition.pages.length > 8) return;
        for (const page of edition.pages) {
          if (!NEWS_IMAGE_KEY.test(page.key) || !Number.isInteger(page.width) || !Number.isInteger(page.height) ||
            page.width < 1 || page.height < 1 || page.width * page.height > 30_000_000) return;
          await fs.access(path.join(this.directory, page.key));
        }
      }
      const cycle = value.cycle;
      const validCycle = cycle && /^\d{4}-\d{2}-\d{2}$/.test(cycle.week) && typeof cycle.complete === "boolean" &&
        (cycle.baseline === null || (typeof cycle.baseline === "string" && cycle.baseline.split(",").every(key => NEWS_IMAGE_KEY.test(key)))) &&
        (cycle.observedAt === null || Number.isFinite(cycle.observedAt));
      this.stored = {
        signature: value.signature || "", edition: edition || null,
        cycle: validCycle ? { ...cycle, complete: !!edition && cycle.complete } : null,
        attemptedAt: typeof value.attemptedAt === "number" && Number.isFinite(value.attemptedAt) && value.attemptedAt <= this.clock() ? value.attemptedAt : null,
        checkedAt: value.checkedAt && Number.isFinite(Date.parse(value.checkedAt)) ? value.checkedAt : edition?.syncedAt || null,
        failed: value.failed === true
      };
    } catch { /* A missing or invalid cache is rebuilt only during a scheduled or manual check. */ }
  }

  private async atomicWrite(name: string, content: string | Buffer) {
    await fs.mkdir(this.directory, { recursive: true });
    const temporary = path.join(this.directory, `${name}.${randomUUID()}.tmp`);
    try {
      await fs.writeFile(temporary, content);
      await fs.rename(temporary, path.join(this.directory, name));
    } finally { await fs.rm(temporary, { force: true }); }
  }

  private async save(value: StoredNews) {
    await this.atomicWrite("edition.json", JSON.stringify(value));
    this.stored = value;
  }

  private async run(manual: boolean) {
    await this.load();
    const now = this.clock();
    if (!manual && Date.parse(this.state().schedule.nextCheckAt) > now) return;
    const week = newsWeek(now);
    const cycle = this.stored.cycle?.week === week.key ? { ...this.stored.cycle } : {
      week: week.key, baseline: fingerprint(this.stored.edition),
      observedAt: this.stored.checkedAt ? Date.parse(this.stored.checkedAt) : null, complete: false
    };
    let stage = "cache";
    try {
      // Persist attempts before networking, so restarts cannot reset the request interval.
      await this.save({ ...this.stored, cycle, attemptedAt: now });
      stage = "entry";
      const resource = await fetchNewsResource(NEWS_SOURCE_URL, 1024 * 1024, this.fetcher);
      const entry = parseNewsEntry(resource.bytes.toString("utf8"), resource.url);
      const signature = `${entry.sourceUrl}|${entry.version}|${entry.scriptUrl}`;
      let edition = this.stored.edition;
      if (manual || !edition || this.stored.signature !== signature) {
        stage = "config";
        const script = await fetchNewsResource(entry.scriptUrl, 2 * 1024 * 1024, this.fetcher);
        const images = parseNewsPosters(script.bytes.toString("utf8"));
        const pages: NewsPage[] = [];
        for (const imageUrl of images) {
          stage = "image";
          const image = await fetchNewsResource(imageUrl, 16 * 1024 * 1024, this.fetcher);
          const meta = await sharp(image.bytes, { limitInputPixels: 30_000_000 }).metadata();
          if (!meta.width || !meta.height || meta.width * meta.height > 30_000_000 || (meta.pages || 1) > 1 ||
            !["jpeg", "png", "webp"].includes(meta.format || "")) throw new Error("invalid-poster");
          const key = `${createHash("sha256").update(image.bytes).digest("hex")}.${meta.format === "jpeg" ? "jpg" : meta.format}`;
          stage = "cache";
          await this.atomicWrite(key, image.bytes);
          pages.push({ key, width: meta.width, height: meta.height });
        }
        edition = {
          version: entry.version, title: "火影忍者手游木叶快报", sourceUrl: entry.sourceUrl,
          syncedAt: pages.map(page => page.key).join(",") === fingerprint(edition) ? edition!.syncedAt : new Date(this.clock()).toISOString(), pages
        };
      }
      const current = fingerprint(edition);
      // No date is exposed by the poster. First observations and old caches establish a baseline;
      // only a fully downloaded content change from a recent baseline completes the weekly cycle.
      if (now < firstNewsWindow(now) || !cycle.baseline || cycle.observedAt === null || cycle.observedAt < week.start - 7 * 86_400_000) {
        cycle.baseline = current;
        cycle.observedAt = now;
      } else if (current !== cycle.baseline) {
        cycle.complete = true;
      }
      stage = "cache";
      await this.save({ ...this.stored, signature, edition, cycle, checkedAt: new Date(this.clock()).toISOString(), failed: false });
    } catch {
      this.stored = { ...this.stored, attemptedAt: now, failed: true };
      try { await this.save(this.stored); } catch { /* Preserve the in-memory copy when storage is unavailable. */ }
      console.warn(`[news] ${stage} check failed; keeping the last complete edition.`);
    }
  }

  private enqueue(manual: boolean) {
    if (!this.pending) this.pending = this.run(manual).finally(() => { this.pending = null; });
    return this.pending;
  }

  refresh(): Promise<void> { return this.enqueue(false); }

  // Public page/API reads never contact Tencent, regardless of visitor count or focus events.
  async read(): Promise<NewsState> { await this.load(); return this.state(); }

  async forceRead(): Promise<NewsState | null> {
    await this.load();
    if (this.pending) { await this.pending; return this.state(); }
    if (this.retryAfterSeconds() > 0) return null;
    await this.enqueue(true);
    return this.state();
  }

  retryAfterSeconds() {
    return this.stored.attemptedAt === null ? 0 : Math.max(0, Math.ceil((this.stored.attemptedAt + NEWS_MANUAL_COOLDOWN_MS - this.clock()) / 1000));
  }

  private state(): NewsState {
    const now = this.clock();
    const schedule = newsSchedule(now, this.stored.cycle?.complete ? this.stored.cycle.week : null, this.stored.attemptedAt);
    return {
      status: !this.stored.edition ? "unavailable" : this.stored.failed ? "stale" : "ready",
      edition: this.stored.edition, checkedAt: this.stored.checkedAt, schedule,
      refreshSeconds: Math.max(5, Math.ceil((Date.parse(schedule.nextCheckAt) - now) / 1000) + 3)
    };
  }

  async image(key: string) {
    if (!NEWS_IMAGE_KEY.test(key)) return null;
    try {
      const file = path.join(this.directory, key);
      if ((await fs.stat(file)).size > 16 * 1024 * 1024) return null;
      return await fs.readFile(file);
    } catch { return null; }
  }
}
