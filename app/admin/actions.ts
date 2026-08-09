"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { INITIAL_PASSWORD } from "@/lib/constants";
import { requireAdmin, revokeUserSessions, writeAuditLog } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { hashPassword } from "@/lib/password";

export type AdminFormState = { error?: string; success?: string };

const memberSchema = z.object({
  username: z.string().trim().min(1, "请输入登录账号。 ").max(40),
  displayName: z.string().trim().min(1, "请输入游戏昵称。 ").max(40),
  note: z.string().trim().max(30).optional()
});

export async function addMemberAction(_state: AdminFormState, formData: FormData): Promise<AdminFormState> {
  const admin = await requireAdmin();
  const parsed = memberSchema.safeParse({
    username: formData.get("username"),
    displayName: formData.get("displayName"),
    note: formData.get("note") || undefined
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message.trim() };

  const db = getDb();
  const exists = db.prepare("SELECT id FROM users WHERE username = ? COLLATE NOCASE").get(parsed.data.username);
  if (exists) return { error: "这个登录账号已经存在。" };

  const passwordHash = await hashPassword(INITIAL_PASSWORD);
  let userId = 0;
  db.transaction(() => {
    const result = db.prepare(`
      INSERT INTO users (username, display_name, password_hash, note, roster_order)
      VALUES (?, ?, ?, ?, (SELECT COALESCE(MAX(roster_order), 0) + 1 FROM users))
    `).run(parsed.data.username, parsed.data.displayName, passwordHash, parsed.data.note || null);
    userId = Number(result.lastInsertRowid);
    const week = db.prepare("SELECT id FROM weeks ORDER BY event_date DESC, id DESC LIMIT 1")
      .get() as { id: number } | undefined;
    if (week) {
      db.prepare("INSERT INTO weekly_scores (week_id, user_id, score) VALUES (?, ?, 0)")
        .run(week.id, userId);
    }
  })();
  writeAuditLog(admin.id, "添加组员", userId, { username: parsed.data.username });
  revalidatePath("/admin");
  revalidatePath("/scores");
  return { success: `已添加 ${parsed.data.displayName}，初始密码为 ${INITIAL_PASSWORD}。` };
}

export async function resetPasswordAction(formData: FormData) {
  const admin = await requireAdmin();
  const userId = Number(formData.get("userId"));
  if (!Number.isInteger(userId) || userId <= 0) return;
  const passwordHash = await hashPassword(INITIAL_PASSWORD);
  getDb().prepare(`
    UPDATE users SET password_hash = ?, must_change_password = 1,
      updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `).run(passwordHash, userId);
  revokeUserSessions(userId);
  writeAuditLog(admin.id, "重置组员密码", userId);
  revalidatePath("/admin");
}

export async function toggleMemberAction(formData: FormData) {
  const admin = await requireAdmin();
  const userId = Number(formData.get("userId"));
  const activate = formData.get("activate") === "1";
  if (!Number.isInteger(userId) || userId <= 0 || userId === admin.id) return;
  getDb().prepare("UPDATE users SET is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .run(activate ? 1 : 0, userId);
  if (!activate) revokeUserSessions(userId);
  writeAuditLog(admin.id, activate ? "恢复组员" : "停用组员", userId);
  revalidatePath("/admin");
  revalidatePath("/scores");
}

export async function saveScoresAction(formData: FormData) {
  const admin = await requireAdmin();
  const weekId = Number(formData.get("weekId"));
  if (!Number.isInteger(weekId) || weekId <= 0) return;

  const db = getDb();
  const rows = db.prepare("SELECT user_id AS userId FROM weekly_scores WHERE week_id = ?")
    .all(weekId) as { userId: number }[];
  const update = db.prepare(`
    UPDATE weekly_scores SET score = ?, package_round = ?, updated_at = CURRENT_TIMESTAMP
    WHERE week_id = ? AND user_id = ?
  `);

  db.transaction(() => {
    for (const row of rows) {
      const scoreValue = Number(formData.get(`score_${row.userId}`));
      const roundRaw = String(formData.get(`round_${row.userId}`) || "").trim();
      const packageRound = roundRaw === "" ? null : Number(roundRaw);
      if (!Number.isInteger(scoreValue) || scoreValue < 0) continue;
      if (packageRound !== null && (!Number.isInteger(packageRound) || packageRound < 0)) continue;
      update.run(scoreValue, packageRound, weekId, row.userId);
    }
  })();
  writeAuditLog(admin.id, "批量更新要塞分数", undefined, { weekId, memberCount: rows.length });
  revalidatePath("/scores");
  revalidatePath("/admin");
}

const weekSchema = z.object({
  title: z.string().trim().min(1).max(50),
  eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
});

export async function createWeekAction(_state: AdminFormState, formData: FormData): Promise<AdminFormState> {
  const admin = await requireAdmin();
  const parsed = weekSchema.safeParse({ title: formData.get("title"), eventDate: formData.get("eventDate") });
  if (!parsed.success) return { error: "请填写有效的周次名称和日期。" };
  const db = getDb();
  if (db.prepare("SELECT id FROM weeks WHERE event_date = ?").get(parsed.data.eventDate)) {
    return { error: "这个日期已经存在统计周。" };
  }

  let weekId = 0;
  db.transaction(() => {
    const result = db.prepare("INSERT INTO weeks (title, event_date) VALUES (?, ?)")
      .run(parsed.data.title, parsed.data.eventDate);
    weekId = Number(result.lastInsertRowid);
    db.prepare(`
      INSERT INTO weekly_scores (week_id, user_id, score)
      SELECT ?, id, 0 FROM users WHERE is_active = 1
    `).run(weekId);
  })();
  writeAuditLog(admin.id, "创建统计周", undefined, { weekId, ...parsed.data });
  revalidatePath("/scores");
  revalidatePath("/admin");
  return { success: "新一周已经创建。" };
}
