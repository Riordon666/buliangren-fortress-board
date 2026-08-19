import sharp from "sharp";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { getSessionUser } from "@/lib/auth";
import { getLeaderboardRows, getPackageDayStatuses, getWeekById } from "@/lib/data";
import { buildWeeklyReportSvg } from "@/lib/report-image";
import { reportCacheDirectory } from "@/lib/storage-paths";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ weekId: string }> }) {
  const user = await getSessionUser();
  if (!user || (user.accountType !== "guest" && user.mustChangePassword)) return new Response("Unauthorized", { status: 401 });
  const { weekId: rawWeekId } = await context.params;
  const weekId = Number(rawWeekId);
  if (!Number.isInteger(weekId) || weekId <= 0) return new Response("Not found", { status: 404 });
  const week = getWeekById(weekId);
  if (!week) return new Response("Not found", { status: 404 });
  if (week.status === "draft" && user.role !== "admin") return new Response("Not found", { status: 404 });
  const rows = getLeaderboardRows(week);
  const statuses = getPackageDayStatuses(week.id);
  const signature = createHash("sha256").update(JSON.stringify({
    title: week.title,
    rows: rows.map((row) => [row.userId, row.score, row.rank]),
    statuses: statuses.map((status) => [status.dayIndex, status.sentAt])
  })).digest("hex").slice(0, 16);
  const cacheDir = reportCacheDirectory();
  const cachePath = path.join(cacheDir, `week-${week.id}-${signature}.png`);
  let png: Buffer;
  try {
    png = await fs.readFile(cachePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const svg = buildWeeklyReportSvg({ week, rows, sentDays: statuses.length });
    png = await sharp(Buffer.from(svg)).png({ compressionLevel: 7 }).toBuffer();
    await fs.mkdir(cacheDir, { recursive: true });
    await fs.writeFile(cachePath, png);
    const oldFiles = (await fs.readdir(cacheDir)).filter((filename) => filename.startsWith(`week-${week.id}-`) && filename !== path.basename(cachePath));
    await Promise.all(oldFiles.map((filename) => fs.unlink(path.join(cacheDir, filename)).catch(() => undefined)));
  }
  return new Response(new Uint8Array(png), {
    headers: {
      "Content-Type": "image/png",
      "Content-Disposition": `attachment; filename="fortress-report-${week.eventDate}.png"`,
      "Cache-Control": "private, max-age=300"
    }
  });
}
