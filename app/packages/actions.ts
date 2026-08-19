"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getShanghaiDate } from "@/lib/data";
import { confirmPackageDay } from "@/lib/package-delivery";

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
  const marked = confirmPackageDay(database, {
    weekId,
    dayIndex,
    source: "manual",
    markedBy: admin.id
  });
  if (!marked) return;
  revalidatePath("/packages");
  revalidatePath("/home");
  revalidatePath("/reports");
}
