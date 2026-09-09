"use server";

import { revalidatePath } from "next/cache";
import { requirePackageConfirmer } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getShanghaiDate } from "@/lib/data";
import { confirmPackageDay } from "@/lib/package-delivery";

function addDays(date: string, days: number) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

export async function markPackageSentAction(formData: FormData) {
  const user = await requirePackageConfirmer();
  const weekValue = formData.get("weekId");
  const dayValue = formData.get("dayIndex");
  if (typeof weekValue !== "string" || !weekValue.trim() || typeof dayValue !== "string" || !dayValue.trim()) return;
  const weekId = Number(weekValue);
  const dayIndex = Number(dayValue);
  if (!Number.isSafeInteger(weekId) || weekId <= 0 || !Number.isInteger(dayIndex) || dayIndex < 0 || dayIndex > 7) return;

  const database = getDb();
  const week = database.prepare("SELECT event_date AS eventDate, status FROM weeks WHERE id = ?")
    .get(weekId) as { eventDate: string; status: string } | undefined;
  if (!week || addDays(week.eventDate, dayIndex) !== getShanghaiDate()) return;
  if (week.status === "draft" && user.role !== "admin") return;
  confirmPackageDay(database, {
    weekId,
    dayIndex,
    source: "manual",
    markedBy: user.id
  });
  // Refresh stale pages even when another confirmer has already frozen this day.
  revalidatePath("/packages");
  revalidatePath("/home");
  revalidatePath("/reports");
}
