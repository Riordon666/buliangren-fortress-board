"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin, writeAuditLog } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getShanghaiDate } from "@/lib/data";

function addDays(date: string, days: number) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

export async function markPackageSentAction(formData: FormData) {
  const admin = await requireAdmin();
  const weekId = Number(formData.get("weekId"));
  const dayIndex = Number(formData.get("dayIndex"));
  if (!Number.isInteger(weekId) || weekId <= 0 || !Number.isInteger(dayIndex) || dayIndex < 0 || dayIndex > 7) return;

  const database = getDb();
  const week = database.prepare("SELECT event_date AS eventDate FROM weeks WHERE id = ?")
    .get(weekId) as { eventDate: string } | undefined;
  if (!week || addDays(week.eventDate, dayIndex) !== getShanghaiDate()) return;

  const result = database.prepare(`
    INSERT OR IGNORE INTO package_day_statuses (week_id, day_index, marked_by)
    VALUES (?, ?, ?)
  `).run(weekId, dayIndex, admin.id);
  if (!result.changes) return;

  writeAuditLog(admin.id, "确认今日已发包", undefined, { weekId, dayIndex });
  revalidatePath("/packages");
  revalidatePath("/home");
  revalidatePath("/reports");
}
