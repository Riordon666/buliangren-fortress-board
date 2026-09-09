import { createHash, randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { revalidatePath } from "next/cache";
import { markPackageSentAction } from "@/app/packages/actions";
import { requireAdmin, requirePackageConfirmer } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { autoConfirmDuePackageDays } from "@/lib/package-delivery";

const cookieState = vi.hoisted(() => ({ token: undefined as string | undefined }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => cookieState.token ? { value: cookieState.token } : undefined })
}));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => { throw new Error(`redirect:${path}`); }
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

let db: ReturnType<typeof getDb>;
let weekId: number;
let leaderId: number;
let adminId: number;
let memberId: number;

function createWeek(date: string, status = "published") {
  const id = Number(db.prepare("INSERT INTO weeks (title, event_date, status) VALUES (?, ?, ?)")
    .run("发包权限测试周", date, status).lastInsertRowid);
  db.prepare(`INSERT INTO weekly_scores (week_id, user_id, score)
    SELECT ?, id, 100 FROM users WHERE is_active = 1 AND account_type = 'member' AND deleted_at IS NULL`).run(id);
  return id;
}

function signIn(userId: number) {
  cookieState.token = randomBytes(32).toString("base64url");
  db.prepare("UPDATE users SET must_change_password = 0 WHERE id = ?").run(userId);
  db.prepare("INSERT INTO sessions (user_id, token_hash, expires_at) VALUES (?, ?, ?)")
    .run(userId, createHash("sha256").update(cookieState.token).digest("hex"), "2099-01-01T00:00:00.000Z");
}

function confirmationForm(id = weekId, dayIndex = "0") {
  const form = new FormData();
  form.set("weekId", String(id));
  form.set("dayIndex", dayIndex);
  return form;
}

function expectNoConfirmation() {
  expect(db.prepare("SELECT COUNT(*) AS count FROM package_day_statuses WHERE week_id = ?").get(weekId)).toEqual({ count: 0 });
  expect(db.prepare("SELECT COUNT(*) AS count FROM package_assignments WHERE week_id = ?").get(weekId)).toEqual({ count: 0 });
  expect(db.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = '确认今日已发包'").get()).toEqual({ count: 0 });
  expect(revalidatePath).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-12T04:00:00.000Z"));
  vi.clearAllMocks();
  cookieState.token = undefined;
  db = getDb();
  db.exec("BEGIN IMMEDIATE");
  leaderId = (db.prepare("SELECT id FROM users WHERE note = '高层' LIMIT 1").get() as { id: number }).id;
  adminId = (db.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get() as { id: number }).id;
  memberId = (db.prepare("SELECT id FROM users WHERE role = 'member' AND note IS NULL LIMIT 1").get() as { id: number }).id;
  weekId = createWeek("2026-09-12");
});

afterEach(() => {
  if (db?.inTransaction) db.exec("ROLLBACK");
  cookieState.token = undefined;
  vi.useRealTimers();
});

describe("每日发包确认权限", () => {
  it.each(["published", "locked"])("高层可以确认 %s 周，冻结名单并记录本人审计", async (status) => {
    db.prepare("UPDATE weeks SET status = ? WHERE id = ?").run(status, weekId);
    signIn(leaderId);
    await markPackageSentAction(confirmationForm());
    expect(db.prepare("SELECT marked_by AS markedBy, confirmation_source AS source FROM package_day_statuses WHERE week_id = ?")
      .get(weekId)).toEqual({ markedBy: leaderId, source: "manual" });
    expect(db.prepare("SELECT COUNT(*) AS count FROM package_assignments WHERE week_id = ?").get(weekId)).toEqual({ count: 5 });
    expect(db.prepare("SELECT actor_user_id AS actorId, action FROM audit_logs WHERE action = '确认今日已发包'").get())
      .toEqual({ actorId: leaderId, action: "确认今日已发包" });
    expect(vi.mocked(revalidatePath).mock.calls.map(([route]) => route)).toEqual(["/packages", "/home", "/reports"]);
  });

  it.each(["published", "draft", "locked"])("保留首领对 %s 周的原有确认权限", async (status) => {
    db.prepare("UPDATE weeks SET status = ? WHERE id = ?").run(status, weekId);
    signIn(adminId);
    await markPackageSentAction(confirmationForm());
    expect(db.prepare("SELECT marked_by AS markedBy FROM package_day_statuses WHERE week_id = ?").get(weekId)).toEqual({ markedBy: adminId });
  });

  it.each([
    { name: "普通组员", accountType: "member", role: "member", note: null },
    { name: "备注含高层字样的组员", accountType: "member", role: "member", note: "非高层" },
    { name: "普通游客", accountType: "guest", role: "member", note: null },
    { name: "保留高层备注的游客", accountType: "guest", role: "member", note: "高层" },
    { name: "异常管理员游客账号", accountType: "guest", role: "admin", note: "高层" }
  ])("$name 即使伪造表单身份也无法确认", async ({ accountType, role, note }) => {
    db.prepare("UPDATE users SET account_type = ?, role = ?, note = ? WHERE id = ?").run(accountType, role, note, memberId);
    signIn(memberId);
    const form = confirmationForm();
    form.set("role", "admin");
    form.set("note", "高层");
    form.set("markedBy", String(adminId));
    await expect(markPackageSentAction(form)).rejects.toThrow("redirect:/packages");
    expectNoConfirmation();
  });

  it("高层无法通过直接提交确认草稿周", async () => {
    db.prepare("UPDATE weeks SET status = 'draft' WHERE id = ?").run(weekId);
    signIn(leaderId);
    await markPackageSentAction(confirmationForm());
    expectNoConfirmation();
  });

  it("高层权限不会扩展到管理后台", async () => {
    signIn(leaderId);
    await expect(requirePackageConfirmer()).resolves.toMatchObject({ id: leaderId });
    await expect(requireAdmin()).rejects.toThrow("redirect:/scores");
  });

  it("打开页面后被取消高层身份，提交时立即失去确认权限", async () => {
    signIn(leaderId);
    await expect(requirePackageConfirmer()).resolves.toMatchObject({ id: leaderId });
    db.prepare("UPDATE users SET note = NULL WHERE id = ?").run(leaderId);
    await expect(markPackageSentAction(confirmationForm())).rejects.toThrow("redirect:/packages");
    expectNoConfirmation();
  });

  it.each(["未登录", "停用", "删除", "会话过期"])("%s 状态无法确认", async (state) => {
    if (state !== "未登录") signIn(leaderId);
    if (state === "停用") db.prepare("UPDATE users SET is_active = 0 WHERE id = ?").run(leaderId);
    if (state === "删除") db.prepare("UPDATE users SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?").run(leaderId);
    if (state === "会话过期") db.prepare("UPDATE sessions SET expires_at = '2000-01-01' WHERE user_id = ?").run(leaderId);
    await expect(markPackageSentAction(confirmationForm())).rejects.toThrow("redirect:/login");
    expectNoConfirmation();
  });

  it("高层首次登录必须先完成改密", async () => {
    signIn(leaderId);
    db.prepare("UPDATE users SET must_change_password = 1 WHERE id = ?").run(leaderId);
    await expect(markPackageSentAction(confirmationForm())).rejects.toThrow("redirect:/profile?required=1");
    expectNoConfirmation();
  });

  it.each(["1", "7", "-1", "8", "0.5", "", "bad", null])("拒绝非当天或无效日期索引 %s", async (dayIndex) => {
    signIn(leaderId);
    const form = confirmationForm();
    if (dayIndex === null) form.delete("dayIndex");
    else form.set("dayIndex", dayIndex);
    await markPackageSentAction(form);
    expectNoConfirmation();
  });

  it.each(["0", "-1", "999999", "1.5", "9007199254740992", "bad", "", null])("拒绝无效或不存在的统计周 %s", async (id) => {
    signIn(leaderId);
    const form = confirmationForm();
    if (id === null) form.delete("weekId");
    else form.set("weekId", id);
    await markPackageSentAction(form);
    expectNoConfirmation();
  });

  it("按北京时间限制当天确认，不能补确认前一天", async () => {
    vi.setSystemTime(new Date("2026-09-11T16:00:00.000Z"));
    db.prepare("UPDATE weeks SET event_date = '2026-09-11' WHERE id = ?").run(weekId);
    signIn(leaderId);
    await markPackageSentAction(confirmationForm(weekId, "0"));
    expectNoConfirmation();
    await markPackageSentAction(confirmationForm(weekId, "1"));
    expect(db.prepare("SELECT day_index AS dayIndex FROM package_day_statuses WHERE week_id = ?").get(weekId)).toEqual({ dayIndex: 1 });
  });

  it("首领重复确认与系统自动确认不会覆盖高层的已发记录或冻结名单", async () => {
    signIn(leaderId);
    await markPackageSentAction(confirmationForm());
    const snapshot = db.prepare("SELECT * FROM package_assignments WHERE week_id = ? ORDER BY position").all(weekId);
    db.prepare("UPDATE weekly_scores SET score = 0 WHERE week_id = ?").run(weekId);
    signIn(adminId);
    await markPackageSentAction(confirmationForm());
    expect(vi.mocked(revalidatePath).mock.calls.filter(([route]) => route === "/packages")).toHaveLength(2);
    expect(autoConfirmDuePackageDays(db, new Date("2026-09-12T15:30:00.000Z"))).toBe(0);
    expect(db.prepare("SELECT marked_by AS markedBy FROM package_day_statuses WHERE week_id = ?").all(weekId)).toEqual([{ markedBy: leaderId }]);
    expect(db.prepare("SELECT * FROM package_assignments WHERE week_id = ? ORDER BY position").all(weekId)).toEqual(snapshot);
    expect(db.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = '确认今日已发包'").get()).toEqual({ count: 1 });
  });

  it("跨期周六，高层可分别确认旧周第八天和新周第一天", async () => {
    const oldWeekId = createWeek("2026-09-05");
    signIn(leaderId);
    await markPackageSentAction(confirmationForm(oldWeekId, "7"));
    await markPackageSentAction(confirmationForm());
    expect(db.prepare("SELECT week_id AS weekId, day_index AS dayIndex, marked_by AS markedBy FROM package_day_statuses WHERE week_id IN (?, ?) ORDER BY day_index")
      .all(weekId, oldWeekId)).toEqual([
        { weekId, dayIndex: 0, markedBy: leaderId },
        { weekId: oldWeekId, dayIndex: 7, markedBy: leaderId }
      ]);
  });
});
