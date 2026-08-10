import sharp from "sharp";
import { getSessionUser } from "@/lib/auth";
import { getPackageDayStatuses, getScoreRows, getWeekById } from "@/lib/data";
import { buildWeeklyReportSvg } from "@/lib/report-image";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ weekId: string }> }) {
  const user = await getSessionUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const { weekId: rawWeekId } = await context.params;
  const weekId = Number(rawWeekId);
  if (!Number.isInteger(weekId) || weekId <= 0) return new Response("Not found", { status: 404 });
  const week = getWeekById(weekId);
  if (!week) return new Response("Not found", { status: 404 });
  const svg = buildWeeklyReportSvg({ week, rows: getScoreRows(week.id), sentDays: getPackageDayStatuses(week.id).length });
  const png = await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
  return new Response(new Uint8Array(png), {
    headers: {
      "Content-Type": "image/png",
      "Content-Disposition": `attachment; filename="fortress-report-${week.eventDate}.png"`,
      "Cache-Control": "private, no-store"
    }
  });
}
