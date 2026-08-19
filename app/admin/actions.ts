"use server";

import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import readExcelFile from "read-excel-file/node";
import { z } from "zod";
import { requireAdmin, revokeUserSessions, writeAuditLog } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getShanghaiDate } from "@/lib/data";
import { recordPackageDeduction, recordPackageDeductionCorrection } from "@/lib/package-deductions";
import { hashPassword } from "@/lib/password";
import { recordScoreChange } from "@/lib/score-changes";
import { backupDirectory } from "@/lib/storage-paths";

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

async function pruneAutomaticBackups(directory: string, keep = 30) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const backups = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".db")).map((entry) => entry.name).sort().reverse();
  await Promise.all(backups.slice(keep).map((filename) => fs.unlink(path.join(directory, filename)).catch(() => undefined)));
}

const memberSchema = z.object({
  displayName: z.string().trim().min(1, "请输入游戏昵称。").max(40),
  initialPassword: z.string().min(8, "初始密码至少需要8位。").max(128, "初始密码不能超过128位。"),
  accountType: z.enum(["member", "guest"]),
  note: z.string().trim().max(30).optional()
});

export async function addMemberAction(_state: AdminFormState, formData: FormData): Promise<AdminFormState> {
  const admin = await requireAdmin();
  const parsed = memberSchema.safeParse({
    displayName: formData.get("displayName"),
    initialPassword: formData.get("initialPassword"),
    accountType: formData.get("accountType") || "member",
    note: formData.get("note") || undefined
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message.trim() };

  const db = getDb();
  const exists = db.prepare("SELECT id FROM users WHERE username = ? COLLATE NOCASE").get(parsed.data.displayName);
  if (exists) return { error: "这个登录账号已经存在。" };

  const passwordHash = await hashPassword(parsed.data.initialPassword);
  const currentDate = getShanghaiDate();
  let userId = 0;
  db.transaction(() => {
    const result = db.prepare(`
      INSERT INTO users (username, display_name, password_hash, account_type, note, roster_order)
      VALUES (?, ?, ?, ?, ?, (SELECT COALESCE(MAX(roster_order), 0) + 1 FROM users))
    `).run(parsed.data.displayName, parsed.data.displayName, passwordHash, parsed.data.accountType, parsed.data.note || null);
    userId = Number(result.lastInsertRowid);
    if (parsed.data.accountType === "member") {
      db.prepare(`
        INSERT INTO weekly_scores (week_id, user_id, score)
        SELECT id, ?, 0 FROM weeks
        WHERE event_date >= COALESCE(
          (SELECT MAX(event_date) FROM weeks WHERE event_date <= ?),
          (SELECT MIN(event_date) FROM weeks)
        )
      `).run(userId, currentDate);
    }
  }).immediate();
  writeAuditLog(admin.id, parsed.data.accountType === "guest" ? "添加游客" : "添加组员", userId, {
    username: parsed.data.displayName,
    accountType: parsed.data.accountType
  });
  revalidatePath("/admin");
  revalidatePath("/scores");
  revalidatePath("/packages");
  revalidatePath("/home");
  revalidatePath("/reports");
  revalidatePath("/compare");
  return { success: `已添加${parsed.data.accountType === "guest" ? "游客" : "组员"} ${parsed.data.displayName}，初始密码已加密保存。` };
}

export async function renameAccountAction(formData: FormData) {
  const admin = await requireAdmin();
  const userId = Number(formData.get("userId"));
  const parsedName = z.string().trim().min(1).max(40).safeParse(formData.get("displayName"));
  if (!Number.isInteger(userId) || userId <= 0 || !parsedName.success) return;
  const db = getDb();
  const account = db.prepare("SELECT username, display_name AS displayName FROM users WHERE id = ?")
    .get(userId) as { username: string; displayName: string } | undefined;
  if (!account || account.displayName === parsedName.data) return;
  const duplicate = db.prepare("SELECT id FROM users WHERE username = ? COLLATE NOCASE AND id != ?")
    .get(parsedName.data, userId);
  if (duplicate) return;
  db.prepare(`
    UPDATE users SET username = ?, display_name = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(parsedName.data, parsedName.data, userId);
  writeAuditLog(admin.id, "修改账号名称", userId, {
    previousName: account.displayName,
    displayName: parsedName.data
  });
  for (const route of ["/admin", "/scores", "/packages", "/profile", "/home", "/reports", "/compare"]) {
    revalidatePath(route);
  }
}

export async function setAccountTypeAction(formData: FormData) {
  const admin = await requireAdmin();
  const userId = Number(formData.get("userId"));
  const parsedType = z.enum(["member", "guest"]).safeParse(formData.get("accountType"));
  if (!Number.isInteger(userId) || userId <= 0 || userId === admin.id || !parsedType.success) return;
  const db = getDb();
  const account = db.prepare("SELECT account_type AS accountType FROM users WHERE id = ?")
    .get(userId) as { accountType: "member" | "guest" } | undefined;
  if (!account || account.accountType === parsedType.data) return;
  db.transaction(() => {
    db.prepare("UPDATE users SET account_type = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(parsedType.data, userId);
    if (parsedType.data === "member") {
      db.prepare(`
        INSERT OR IGNORE INTO weekly_scores (week_id, user_id, score)
        SELECT id, ?, 0 FROM weeks
        WHERE event_date >= COALESCE(
          (SELECT MAX(event_date) FROM weeks WHERE event_date <= ?),
          (SELECT MIN(event_date) FROM weeks)
        )
      `).run(userId, getShanghaiDate());
    }
  }).immediate();
  writeAuditLog(admin.id, parsedType.data === "guest" ? "设为游客" : "转为组员", userId, {
    previousType: account.accountType,
    accountType: parsedType.data
  });
  for (const route of ["/admin", "/scores", "/packages", "/profile", "/home", "/reports", "/compare"]) {
    revalidatePath(route);
  }
}

export async function resetPasswordAction(formData: FormData) {
  const admin = await requireAdmin();
  const userId = Number(formData.get("userId"));
  const parsedPassword = z.string().min(8).max(128).safeParse(formData.get("temporaryPassword"));
  if (!Number.isInteger(userId) || userId <= 0 || !parsedPassword.success) return;
  const passwordHash = await hashPassword(parsedPassword.data);
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
  const db = getDb();
  db.transaction(() => {
    db.prepare("UPDATE users SET is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(activate ? 1 : 0, userId);
    if (activate) {
      const today = getShanghaiDate();
      const account = db.prepare("SELECT account_type AS accountType FROM users WHERE id = ?")
        .get(userId) as { accountType: "member" | "guest" } | undefined;
      if (account?.accountType !== "member") return;
      db.prepare(`
        INSERT OR IGNORE INTO weekly_scores (week_id, user_id, score)
        SELECT id, ?, 0 FROM weeks
        WHERE event_date >= COALESCE(
          (SELECT MAX(event_date) FROM weeks WHERE event_date <= ?),
          (SELECT MIN(event_date) FROM weeks)
        )
      `).run(userId, today);
      const nextWeek = db.prepare(`
        SELECT id FROM weeks
        WHERE event_date > COALESCE(
          (SELECT MAX(event_date) FROM weeks WHERE event_date <= ?),
          ''
        )
        ORDER BY event_date ASC, id ASC
        LIMIT 1
      `).get(today) as { id: number } | undefined;
      if (nextWeek) {
        db.prepare(`
          UPDATE weekly_scores
          SET package_deductions = package_deductions +
            (SELECT package_deduction_pending FROM users WHERE id = ?),
            updated_at = CURRENT_TIMESTAMP
          WHERE week_id = ? AND user_id = ?
        `).run(userId, nextWeek.id, userId);
        db.prepare(`
          UPDATE users SET package_deduction_pending = 0, updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND package_deduction_pending > 0
        `).run(userId);
      }
    }
  }).immediate();
  if (!activate) revokeUserSessions(userId);
  writeAuditLog(admin.id, activate ? "恢复组员" : "停用组员", userId);
  revalidatePath("/admin");
  revalidatePath("/scores");
  revalidatePath("/packages");
  revalidatePath("/profile");
  revalidatePath("/home");
  revalidatePath("/reports");
  revalidatePath("/compare");
}

export async function saveScoresAction(formData: FormData) {
  const admin = await requireAdmin();
  const weekId = Number(formData.get("weekId"));
  const requestId = String(formData.get("deductionRequestId") || "").trim();
  if (!Number.isInteger(weekId) || weekId <= 0 || !/^[0-9a-f-]{36}$/i.test(requestId)) return;

  const db = getDb();
  const getWeek = db.prepare("SELECT id, event_date AS eventDate, status FROM weeks WHERE id = ?");
  const getNextWeek = db.prepare(`
    SELECT id, title FROM weeks
    WHERE event_date > ?
    ORDER BY event_date ASC, id ASC
    LIMIT 1
  `);
  const getRows = db.prepare(`
    SELECT ws.user_id AS userId, ws.score
    FROM weekly_scores ws
    JOIN users u ON u.id = ws.user_id
    WHERE ws.week_id = ? AND u.account_type = 'member'
  `);
  const update = db.prepare(`
    UPDATE weekly_scores SET score = ?, updated_at = CURRENT_TIMESTAMP
    WHERE week_id = ? AND user_id = ?
  `);
  db.transaction(() => {
    const week = getWeek.get(weekId) as { id: number; eventDate: string; status: string } | undefined;
    if (!week || week.status === "locked") return;
    const nextWeek = getNextWeek.get(week.eventDate) as { id: number; title: string } | undefined;
    const rows = getRows.all(weekId) as Array<{ userId: number; score: number }>;
    let totalDeductionAdjustment = 0;
    const deductionDetails: Array<{ userId: number; adjustment: number }> = [];

    for (const row of rows) {
      if (!formData.has(`score_${row.userId}`)) continue;
      const scoreValue = Number(formData.get(`score_${row.userId}`));
      if (!Number.isInteger(scoreValue) || scoreValue < 0) continue;
      recordScoreChange(db, {
        requestId,
        weekId,
        userId: row.userId,
        previousScore: row.score,
        newScore: scoreValue,
        source: "manual",
        actorUserId: admin.id
      });
      update.run(scoreValue, weekId, row.userId);

      const adjustment = Number(formData.get(`deduction_add_${row.userId}`));
      if (!Number.isInteger(adjustment) || adjustment === 0 || adjustment < -99 || adjustment > 99) continue;
      if (adjustment > 0) {
        const recorded = recordPackageDeduction(db, {
          requestId,
          sourceWeekId: weekId,
          effectiveWeekId: nextWeek?.id || null,
          userId: row.userId,
          amount: adjustment,
          createdBy: admin.id
        });
        if (!recorded) continue;
        totalDeductionAdjustment += adjustment;
        deductionDetails.push({ userId: row.userId, adjustment });
      } else {
        const removed = recordPackageDeductionCorrection(db, {
          requestId,
          sourceWeekId: weekId,
          preferredWeekId: nextWeek?.id || null,
          userId: row.userId,
          amount: Math.abs(adjustment),
          createdBy: admin.id
        });
        if (!removed) continue;
        totalDeductionAdjustment -= removed;
        deductionDetails.push({ userId: row.userId, adjustment: -removed });
      }
    }

    writeAuditLog(admin.id, "批量更新要塞分数", undefined, { weekId, memberCount: rows.length });
    if (deductionDetails.length > 0) {
      writeAuditLog(admin.id, "调整扣包记录", undefined, {
        requestId,
        sourceWeekId: weekId,
        effectiveWeekId: nextWeek?.id || null,
        adjustment: totalDeductionAdjustment,
        members: deductionDetails
      });
    }
  }).immediate();
  revalidatePath("/scores");
  revalidatePath("/packages");
  revalidatePath("/profile");
  revalidatePath("/home");
  revalidatePath("/reports");
  revalidatePath("/compare");
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
    const week = db.prepare("SELECT id, title, event_date AS eventDate, status FROM weeks WHERE id = ?").get(weekId) as { id: number; title: string; eventDate: string; status: string } | undefined;
    if (!week) return { error: "目标统计周不存在。" };
    if (week.status === "locked") return { error: "这个统计周已经锁定，不能继续导入积分。" };
    const currentWeek = db.prepare(`
      SELECT event_date AS eventDate FROM weeks
      WHERE event_date <= ?
      ORDER BY event_date DESC, id DESC LIMIT 1
    `).get(getShanghaiDate()) as { eventDate: string } | undefined;
    const historical = Boolean(currentWeek && week.eventDate < currentWeek.eventDate);
    const members = db.prepare(`
      SELECT u.id, u.display_name AS displayName
      FROM users u
      JOIN weekly_scores ws ON ws.user_id = u.id AND ws.week_id = ?
      WHERE u.account_type = 'member' AND (? = 1 OR u.is_active = 1)
      ORDER BY COALESCE(u.roster_order, 999999), u.id
    `).all(weekId, historical ? 1 : 0) as Array<{ id: number; displayName: string }>;
    const memberMap = new Map(members.map((member) => [normalizedMemberName(member.displayName), member]));
    const unknownNames = importedRows.filter((row) => !memberMap.has(normalizedMemberName(row.name))).map((row) => row.name);
    if (unknownNames.length) return { error: `找不到这些有效组员：${listNames(unknownNames)}。请检查名字是否完全一致。` };
    const importedKeys = new Set(importedRows.map((row) => normalizedMemberName(row.name)));
    const missingNames = members.filter((member) => !importedKeys.has(normalizedMemberName(member.displayName))).map((member) => member.displayName);
    if (missingNames.length) return { error: `表格缺少有效组员：${listNames(missingNames)}。` };

    const backupDir = backupDirectory();
    await fs.mkdir(backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    await db.backup(path.join(backupDir, `naruto-fortress-before-import-${stamp}.db`));
    await pruneAutomaticBackups(backupDir);

    const importRequestId = randomUUID();
    const existingScores = new Map((db.prepare(`
      SELECT user_id AS userId, score FROM weekly_scores WHERE week_id = ?
    `).all(weekId) as Array<{ userId: number; score: number }>).map((row) => [row.userId, row.score]));
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
        recordScoreChange(db, {
          requestId: importRequestId,
          weekId,
          userId: member.id,
          previousScore: existingScores.get(member.id) || 0,
          newScore: score,
          source: "import",
          actorUserId: admin.id
        });
        upsert.run(weekId, member.id, score);
      }
    }).immediate();
    writeAuditLog(admin.id, "导入要塞积分", undefined, {
      weekId,
      memberCount: importedRows.length,
      filename: file.name
    });
    revalidatePath("/scores");
    revalidatePath("/packages");
    revalidatePath("/profile");
    revalidatePath("/home");
    revalidatePath("/reports");
    revalidatePath("/compare");
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
  let weekId = 0;
  let creationError = "";
  db.transaction(() => {
    if (db.prepare("SELECT id FROM weeks WHERE event_date = ?").get(parsed.data.eventDate)) {
      creationError = "这个日期已经存在统计周。";
      return;
    }
    const latestWeek = db.prepare(`
      SELECT event_date AS eventDate FROM weeks
      ORDER BY event_date DESC, id DESC
      LIMIT 1
    `).get() as { eventDate: string } | undefined;
    if (latestWeek && parsed.data.eventDate <= latestWeek.eventDate) {
      creationError = `新统计周必须晚于现有最后一周（${latestWeek.eventDate}），这样待扣次数才能准确顺延。`;
      return;
    }

    const result = db.prepare("INSERT INTO weeks (title, event_date, status) VALUES (?, ?, 'draft')")
      .run(parsed.data.title, parsed.data.eventDate);
    weekId = Number(result.lastInsertRowid);
    db.prepare(`
      INSERT INTO weekly_scores (week_id, user_id, score, package_deductions)
      SELECT ?, id, 0, package_deduction_pending FROM users
      WHERE is_active = 1 AND account_type = 'member'
    `).run(weekId);
    db.prepare(`
      UPDATE users SET package_deduction_pending = 0, updated_at = CURRENT_TIMESTAMP
      WHERE is_active = 1 AND account_type = 'member' AND package_deduction_pending > 0
    `).run();
  }).immediate();
  if (creationError) return { error: creationError };
  writeAuditLog(admin.id, "创建统计周", undefined, { weekId, ...parsed.data });
  revalidatePath("/scores");
  revalidatePath("/packages");
  revalidatePath("/home");
  revalidatePath("/reports");
  revalidatePath("/compare");
  revalidatePath("/admin");
  return { success: "新一周已经创建。" };
}

export async function renameWeekAction(formData: FormData) {
  const admin = await requireAdmin();
  const weekId = Number(formData.get("weekId"));
  const parsedTitle = z.string().trim().min(1).max(50).safeParse(formData.get("title"));
  if (!Number.isInteger(weekId) || weekId <= 0 || !parsedTitle.success) return;

  const db = getDb();
  const week = db.prepare("SELECT title FROM weeks WHERE id = ?").get(weekId) as { title: string } | undefined;
  if (!week || week.title === parsedTitle.data) return;

  db.prepare("UPDATE weeks SET title = ? WHERE id = ?").run(parsedTitle.data, weekId);
  writeAuditLog(admin.id, "重命名统计周", undefined, {
    weekId,
    previousTitle: week.title,
    title: parsedTitle.data
  });
  revalidatePath("/scores");
  revalidatePath("/packages");
  revalidatePath("/profile");
  revalidatePath("/home");
  revalidatePath("/reports");
  revalidatePath("/compare");
  revalidatePath("/admin");
}

export async function setWeekStatusAction(formData: FormData) {
  const admin = await requireAdmin();
  const weekId = Number(formData.get("weekId"));
  const parsedStatus = z.enum(["draft", "published", "locked"]).safeParse(formData.get("status"));
  if (!Number.isInteger(weekId) || weekId <= 0 || !parsedStatus.success) return;
  const db = getDb();
  const week = db.prepare("SELECT status FROM weeks WHERE id = ?").get(weekId) as { status: string } | undefined;
  if (!week || week.status === parsedStatus.data) return;
  db.prepare("UPDATE weeks SET status = ? WHERE id = ?").run(parsedStatus.data, weekId);
  writeAuditLog(admin.id, "修改统计周状态", undefined, { weekId, previousStatus: week.status, status: parsedStatus.data });
  for (const path of ["/scores", "/packages", "/reports", "/home", "/profile", "/compare", "/admin"]) revalidatePath(path);
}

export async function deleteWeekAction(formData: FormData) {
  const admin = await requireAdmin();
  const weekId = Number(formData.get("weekId"));
  if (!Number.isInteger(weekId) || weekId <= 0) return;

  const db = getDb();
  const week = db.prepare("SELECT id, title, event_date AS eventDate FROM weeks WHERE id = ?")
    .get(weekId) as { id: number; title: string; eventDate: string } | undefined;
  if (!week) return;
  if (week.eventDate <= getShanghaiDate()) return;

  const backupDir = backupDirectory();
  await fs.mkdir(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  await db.backup(path.join(backupDir, `naruto-fortress-before-delete-week-${week.id}-${stamp}.db`));
  await pruneAutomaticBackups(backupDir);

  let transferredDeductions = 0;
  let deleted = false;
  db.transaction(() => {
    const lockedWeek = db.prepare("SELECT id, title, event_date AS eventDate FROM weeks WHERE id = ?")
      .get(weekId) as { id: number; title: string; eventDate: string } | undefined;
    if (!lockedWeek) return;
    if (lockedWeek.eventDate <= getShanghaiDate()) return;

    if (lockedWeek.eventDate > getShanghaiDate()) {
      const deductions = db.prepare(`
        SELECT user_id AS userId, package_deductions AS amount
        FROM weekly_scores
        WHERE week_id = ? AND package_deductions > 0
      `).all(lockedWeek.id) as Array<{ userId: number; amount: number }>;
      const nextWeek = db.prepare(`
        SELECT id FROM weeks
        WHERE event_date > ? AND id != ?
        ORDER BY event_date ASC, id ASC
        LIMIT 1
      `).get(lockedWeek.eventDate, lockedWeek.id) as { id: number } | undefined;
      const addScheduled = db.prepare(`
        INSERT INTO weekly_scores (week_id, user_id, score, package_deductions)
        VALUES (?, ?, 0, ?)
        ON CONFLICT(week_id, user_id) DO UPDATE SET
          package_deductions = weekly_scores.package_deductions + excluded.package_deductions,
          updated_at = CURRENT_TIMESTAMP
      `);
      const addPending = db.prepare(`
        UPDATE users SET package_deduction_pending = package_deduction_pending + ?,
          updated_at = CURRENT_TIMESTAMP WHERE id = ?
      `);
      for (const deduction of deductions) {
        if (nextWeek) addScheduled.run(nextWeek.id, deduction.userId, deduction.amount);
        else addPending.run(deduction.amount, deduction.userId);
        transferredDeductions += deduction.amount;
      }
      if (nextWeek) {
        db.prepare("UPDATE package_deduction_events SET effective_week_id = ? WHERE effective_week_id = ?")
          .run(nextWeek.id, lockedWeek.id);
      }
    }
    db.prepare("DELETE FROM weeks WHERE id = ?").run(lockedWeek.id);
    deleted = true;
  }).immediate();
  if (!deleted) return;
  writeAuditLog(admin.id, "删除统计周", undefined, {
    weekId: week.id,
    title: week.title,
    eventDate: week.eventDate,
    transferredDeductions
  });
  revalidatePath("/scores");
  revalidatePath("/packages");
  revalidatePath("/profile");
  revalidatePath("/home");
  revalidatePath("/reports");
  revalidatePath("/compare");
  revalidatePath("/admin");
}
