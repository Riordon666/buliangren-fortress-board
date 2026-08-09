"use server";

import fs from "node:fs/promises";
import path from "node:path";
import { revalidatePath } from "next/cache";
import readExcelFile from "read-excel-file/node";
import { z } from "zod";
import { INITIAL_PASSWORD } from "@/lib/constants";
import { requireAdmin, revokeUserSessions, writeAuditLog } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { hashPassword } from "@/lib/password";

export type AdminFormState = { error?: string; success?: string };

const scoreHeaderNames = new Set(["成员", "组员", "游戏昵称", "昵称"]);
const scoreHeaderValues = new Set(["分数", "总分"]);

function cellText(value: unknown) {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

function normalizedMemberName(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase("zh-CN");
}

function listNames(names: string[]) {
  const visible = names.slice(0, 6).join("、");
  return names.length > 6 ? `${visible} 等 ${names.length} 人` : visible;
}

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
    UPDATE weekly_scores SET score = ?, package_round = ?, package_deductions = ?, updated_at = CURRENT_TIMESTAMP
    WHERE week_id = ? AND user_id = ?
  `);

  db.transaction(() => {
    for (const row of rows) {
      const scoreValue = Number(formData.get(`score_${row.userId}`));
      const roundRaw = String(formData.get(`round_${row.userId}`) || "").trim();
      const packageRound = roundRaw === "" ? null : Number(roundRaw);
      const packageDeductions = Number(formData.get(`deductions_${row.userId}`));
      if (!Number.isInteger(scoreValue) || scoreValue < 0) continue;
      if (packageRound !== null && (!Number.isInteger(packageRound) || packageRound < 0)) continue;
      if (!Number.isInteger(packageDeductions) || packageDeductions < 0 || packageDeductions > 99) continue;
      update.run(scoreValue, packageRound, packageDeductions, weekId, row.userId);
    }
  })();
  writeAuditLog(admin.id, "批量更新要塞分数", undefined, { weekId, memberCount: rows.length });
  revalidatePath("/scores");
  revalidatePath("/packages");
  revalidatePath("/admin");
}

export async function importScoresAction(_state: AdminFormState, formData: FormData): Promise<AdminFormState> {
  const admin = await requireAdmin();
  const weekId = Number(formData.get("weekId"));
  const file = formData.get("scoreFile");
  if (!Number.isInteger(weekId) || weekId <= 0) return { error: "没有可导入的统计周。" };
  if (!(file instanceof File) || file.size === 0) return { error: "请选择积分表格。" };
  if (!file.name.toLowerCase().endsWith(".xlsx")) return { error: "请上传标准的 .xlsx 积分表。" };
  if (file.size > 1024 * 1024) return { error: "积分表不能超过 1MB。" };

  try {
    const workbook = await readExcelFile(Buffer.from(await file.arrayBuffer()));
    const sheet = workbook.find((item) => item.sheet === "积分导入") || workbook[0];
    if (!sheet) return { error: "表格中没有可读取的工作表。" };
    if (sheet.data.length > 150) return { error: "表格行数过多，请使用标准模板。" };

    const headerIndex = sheet.data.findIndex((row) =>
      scoreHeaderNames.has(cellText(row[0])) && scoreHeaderValues.has(cellText(row[1]))
    );
    if (headerIndex < 0) return { error: "没有找到“成员、分数”表头，请使用标准模板。" };

    const importedRows = sheet.data.slice(headerIndex + 1)
      .map((row, index) => ({
        excelRow: headerIndex + index + 2,
        name: cellText(row[0]),
        rawScore: row[1]
      }))
      .filter((row) => row.name || row.rawScore != null);
    if (!importedRows.length) return { error: "积分表中没有成员数据。" };

    const duplicateNames: string[] = [];
    const seen = new Set<string>();
    for (const row of importedRows) {
      const key = normalizedMemberName(row.name);
      if (seen.has(key)) duplicateNames.push(row.name);
      seen.add(key);
    }
    if (duplicateNames.length) return { error: `表格中存在重复成员：${listNames(duplicateNames)}。` };

    const invalidScores = importedRows.filter((row) => {
      const score = typeof row.rawScore === "number" ? row.rawScore : Number(cellText(row.rawScore));
      return !Number.isInteger(score) || score < 0 || score > 99_999;
    });
    if (invalidScores.length) {
      return { error: `分数必须是 0–99999 的整数，请检查第 ${invalidScores.slice(0, 6).map((row) => row.excelRow).join("、")} 行。` };
    }

    const db = getDb();
    const week = db.prepare("SELECT id, title FROM weeks WHERE id = ?").get(weekId) as { id: number; title: string } | undefined;
    if (!week) return { error: "目标统计周不存在。" };
    const members = db.prepare(`
      SELECT id, display_name AS displayName
      FROM users WHERE is_active = 1
      ORDER BY COALESCE(roster_order, 999999), id
    `).all() as Array<{ id: number; displayName: string }>;
    const memberMap = new Map(members.map((member) => [normalizedMemberName(member.displayName), member]));
    const unknownNames = importedRows.filter((row) => !memberMap.has(normalizedMemberName(row.name))).map((row) => row.name);
    if (unknownNames.length) return { error: `找不到这些有效组员：${listNames(unknownNames)}。请检查名字是否完全一致。` };
    const importedKeys = new Set(importedRows.map((row) => normalizedMemberName(row.name)));
    const missingNames = members.filter((member) => !importedKeys.has(normalizedMemberName(member.displayName))).map((member) => member.displayName);
    if (missingNames.length) return { error: `表格缺少有效组员：${listNames(missingNames)}。` };

    const backupDir = path.join(process.cwd(), "data", "backups");
    await fs.mkdir(backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    await db.backup(path.join(backupDir, `naruto-fortress-before-import-${stamp}.db`));

    const upsert = db.prepare(`
      INSERT INTO weekly_scores (week_id, user_id, score, updated_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(week_id, user_id) DO UPDATE SET
        score = excluded.score,
        updated_at = CURRENT_TIMESTAMP
    `);
    db.transaction(() => {
      for (const row of importedRows) {
        const member = memberMap.get(normalizedMemberName(row.name))!;
        const score = typeof row.rawScore === "number" ? row.rawScore : Number(cellText(row.rawScore));
        upsert.run(weekId, member.id, score);
      }
    })();
    writeAuditLog(admin.id, "导入要塞积分", undefined, {
      weekId,
      memberCount: importedRows.length,
      filename: file.name
    });
    revalidatePath("/scores");
    revalidatePath("/packages");
    revalidatePath("/admin");
    return { success: `已将 ${importedRows.length} 名组员的积分导入“${week.title}”，发包安排已自动更新。` };
  } catch (error) {
    console.error("Score import failed", error);
    return { error: "积分表读取失败，请确认文件未损坏并使用标准模板。" };
  }
}

const weekSchema = z.object({
  title: z.string().trim().min(1).max(50),
  eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
});

export async function createWeekAction(_state: AdminFormState, formData: FormData): Promise<AdminFormState> {
  const admin = await requireAdmin();
  const parsed = weekSchema.safeParse({ title: formData.get("title"), eventDate: formData.get("eventDate") });
  if (!parsed.success) return { error: "请填写有效的周次名称和日期。" };
  const [year, month, day] = parsed.data.eventDate.split("-").map(Number);
  if (new Date(Date.UTC(year, month - 1, day)).getUTCDay() !== 6) {
    return { error: "发包周期必须从周六开始，请重新选择日期。" };
  }
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
