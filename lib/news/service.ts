import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { fetchNewsResource, type NewsFetch } from "@/lib/news/fetch";
import { isAllowedSourceUrl, parseNewsEntry, parseNewsPosters } from "@/lib/news/parser";
import { NEWS_REFRESH_MS, NEWS_SOURCE_URL, type NewsEdition, type NewsPage, type NewsState } from "@/lib/news/types";

export const NEWS_IMAGE_KEY = /^[a-f0-9]{64}\.(?:jpg|png|webp)$/;

type StoredNews = { signature: string; edition: NewsEdition };

export class NewsService {
  private stored: StoredNews | null = null;
  private loaded = false;
  private pending: Promise<void> | null = null;
  private attemptedAt: number | null = null;
  private checkedAt: string | null = null;
  private failed = false;
  private forcedAt: number | null = null;
  private manualPending = false;

  constructor(private directory: string, private fetcher: NewsFetch = fetch, private clock = Date.now) {}

  private async load() {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const file = path.join(this.directory, "edition.json");
      if ((await fs.stat(file)).size > 64 * 1024) return;
      const value = JSON.parse(await fs.readFile(file, "utf8")) as StoredNews;
      const edition = value.edition;
      if (typeof value.signature !== "string" || typeof edition?.version !== "string" || !/^\d{1,16}$/.test(edition.version) ||
        edition.title !== "火影忍者手游木叶快报" || !isAllowedSourceUrl(edition.sourceUrl) || !Number.isFinite(Date.parse(edition.syncedAt)) ||
        !Array.isArray(edition.pages) || !edition.pages.length || edition.pages.length > 8) return;
      for (const page of edition.pages) {
        if (!NEWS_IMAGE_KEY.test(page.key) || !Number.isInteger(page.width) || !Number.isInteger(page.height) ||
          page.width < 1 || page.height < 1 || page.width * page.height > 30_000_000) return;
        await fs.access(path.join(this.directory, page.key));
      }
      this.stored = value;
    } catch { /* The source can rebuild a missing or incomplete local cache. */ }
  }

  private async atomicWrite(name: string, content: string | Buffer) {
    await fs.mkdir(this.directory, { recursive: true });
    const temporary = path.join(this.directory, `${name}.${randomUUID()}.tmp`);
    try {
      await fs.writeFile(temporary, content);
      await fs.rename(temporary, path.join(this.directory, name));
    } finally { await fs.rm(temporary, { force: true }); }
  }

  private async run(force: boolean) {
    await this.load();
    const now = this.clock();
    if (!force && this.attemptedAt !== null && now - this.attemptedAt < NEWS_REFRESH_MS) return;
    this.attemptedAt = now;
    try {
      const entryResource = await fetchNewsResource(NEWS_SOURCE_URL, 1024 * 1024, this.fetcher);
      const entry = parseNewsEntry(entryResource.bytes.toString("utf8"), entryResource.url);
      const signature = `${entry.sourceUrl}|${entry.version}|${entry.scriptUrl}`;
      if (force || this.stored?.signature !== signature) {
        const script = await fetchNewsResource(entry.scriptUrl, 2 * 1024 * 1024, this.fetcher);
        const images = parseNewsPosters(script.bytes.toString("utf8"));
        const pages: NewsPage[] = [];
        for (const imageUrl of images) {
          const image = await fetchNewsResource(imageUrl, 16 * 1024 * 1024, this.fetcher);
          const meta = await sharp(image.bytes, { limitInputPixels: 30_000_000 }).metadata();
          if (!meta.width || !meta.height || meta.width * meta.height > 30_000_000 || (meta.pages || 1) > 1 ||
            !["jpeg", "png", "webp"].includes(meta.format || "")) throw new Error("invalid-poster");
          const extension = meta.format === "jpeg" ? "jpg" : meta.format;
          const key = `${createHash("sha256").update(image.bytes).digest("hex")}.${extension}`;
          await this.atomicWrite(key, image.bytes);
          pages.push({ key, width: meta.width, height: meta.height });
        }
        const next: StoredNews = { signature, edition: {
          version: entry.version, title: "火影忍者手游木叶快报", sourceUrl: entry.sourceUrl,
          syncedAt: new Date(this.clock()).toISOString(), pages
        } };
        if (this.stored?.signature !== signature || pages.map(page => page.key).join() !== this.stored.edition.pages.map(page => page.key).join()) {
          await this.atomicWrite("edition.json", JSON.stringify(next));
          this.stored = next;
        }
      }
      this.checkedAt = new Date(this.clock()).toISOString();
      this.failed = false;
    } catch {
      this.failed = true;
    }
  }

  refresh(force = false): Promise<void> {
    if (!this.pending) this.pending = this.run(force).finally(() => { this.pending = null; });
    return this.pending;
  }

  async read(): Promise<NewsState> {
    await this.refresh();
    return this.state();
  }

  async forceRead(): Promise<NewsState | null> {
    const now = this.clock();
    if (this.manualPending || (this.forcedAt !== null && now - this.forcedAt < 5_000)) return null;
    this.forcedAt = now;
    this.manualPending = true;
    try {
      // A pending automatic check may only read the version. Always re-read the content after it.
      if (this.pending) await this.pending;
      await this.refresh(true);
      return this.state();
    } finally { this.manualPending = false; }
  }

  private state(): NewsState {
    return {
      status: !this.stored ? "unavailable" : this.failed ? "stale" : "ready",
      edition: this.stored?.edition || null,
      checkedAt: this.checkedAt,
      refreshSeconds: NEWS_REFRESH_MS / 1000
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
