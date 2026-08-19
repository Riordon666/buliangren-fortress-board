import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { getDb, migratePermanentPackageDeductions, PERMANENT_DEDUCTION_MIGRATION } from "@/lib/db";
import { getLatestWeek, getLeaderboardRows, getMembers, getPackageAssignmentSnapshots, getPackageDeductionRows, getPackagePlanRows, getScoreRows, getShanghaiDate, getWeeks, selectCurrentWeek } from "@/lib/data";
import { recordDeductionApplications, rolloverExpiredPackageDeductions } from "@/lib/package-ledger";
import { recordPackageDeduction, recordPackageDeductionCorrection } from "@/lib/package-deductions";
import { generatePackagePlan, getPackageRoundsByMember } from "@/lib/package-plan";
import { savePackageDaySnapshot } from "@/lib/package-snapshots";
import { verifyPassword } from "@/lib/password";
import { recordScoreChange } from "@/lib/score-changes";
import { buildWeeklyReportSvg } from "@/lib/report-image";
import type { ScoreRow, ScoreWeek } from "@/lib/types";

describe("初始组织数据", () => {
  it("导入30名组员，并将九天惊落设为唯一管理员", () => {
    const members = getMembers();
    expect(members).toHaveLength(30);
    expect(members.filter((member) => member.role === "admin").map((member) => member.displayName)).toEqual(["九天惊落"]);
  });

  it("按截图使用竞赛排名处理并列分数", () => {
    const week = getLatestWeek();
    expect(week).toBeTruthy();
    const scores = getScoreRows(week!.id);
    expect(scores[0]).toMatchObject({ displayName: "是溅诗啊", score: 192, rank: 1 });
    expect(scores.filter((row) => row.score === 91).map((row) => row.rank)).toEqual([11, 11]);
    expect(scores.filter((row) => row.score === 40).map((row) => row.rank)).toEqual([25, 25, 25]);
    expect(scores.filter((row) => row.score === 0).map((row) => row.rank)).toEqual([29, 29]);
    expect(scores.map((row) => row.displayName)).toEqual([
      "是溅诗啊", "抑郁的农村入", "通天道人", "神威在他眼中", "DTB", "Treasu",
      "浊杯赴宴", "单帅一个字", "九天惊落", "晨A", "柚猪崽崽", "不会U",
      "小南滑又暖", "不过些许风霜", "今天风浪大", "贫困且懒惰", "陷温",
      "无压力之人", "院长", ".Z12", "八代喜八郎", "南离旧梦", "家文",
      "疯狂的阅读者", "鲨芋辣鲛", "小a", "村子来个青年", "小米SU7", "张平安", "十香"
    ]);
  });

  it("密码以不同盐值的Argon2哈希保存", async () => {
    const rows = getDb().prepare("SELECT password_hash AS passwordHash FROM users ORDER BY id LIMIT 2").all() as { passwordHash: string }[];
    expect(rows[0].passwordHash).toMatch(/^\$argon2id\$/);
    expect(rows[0].passwordHash).not.toBe(rows[1].passwordHash);
    expect(await verifyPassword(rows[0].passwordHash, "test-only-password")).toBe(true);
  });

  it("SQLite运行时包含WAL并发修复版本", () => {
    const version = getDb().prepare("SELECT sqlite_version() AS version").get() as { version: string };
    const [major, minor, patch] = version.version.split(".").map(Number);
    expect(major > 3 || (major === 3 && (minor > 51 || (minor === 51 && patch >= 3)))).toBe(true);
  });

  it("把旧扣包记录迁移为永久累计并只投递到下一统计周，且迁移可重复运行", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY,
        package_deduction_total INTEGER NOT NULL DEFAULT 0,
        package_deduction_pending INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE weeks (
        id INTEGER PRIMARY KEY,
        event_date TEXT NOT NULL UNIQUE
      );
      CREATE TABLE weekly_scores (
        id INTEGER PRIMARY KEY,
        week_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        score INTEGER NOT NULL DEFAULT 0,
        package_deductions INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (week_id, user_id)
      );
      INSERT INTO users (id) VALUES (1), (2);
      INSERT INTO weeks (id, event_date) VALUES (10, '2026-08-08'), (11, '2026-08-15');
      INSERT INTO weekly_scores (week_id, user_id, package_deductions) VALUES
        (10, 1, 2), (11, 1, 0), (11, 2, 3);
    `);

    migratePermanentPackageDeductions(db);
    migratePermanentPackageDeductions(db);

    expect(db.prepare("SELECT package_deduction_total AS total, package_deduction_pending AS pending FROM users WHERE id = 1").get())
      .toEqual({ total: 2, pending: 0 });
    expect(db.prepare("SELECT package_deduction_total AS total, package_deduction_pending AS pending FROM users WHERE id = 2").get())
      .toEqual({ total: 3, pending: 3 });
    expect(db.prepare("SELECT package_deductions AS amount FROM weekly_scores WHERE week_id = 10 AND user_id = 1").get())
      .toEqual({ amount: 0 });
    expect(db.prepare("SELECT package_deductions AS amount FROM weekly_scores WHERE week_id = 11 AND user_id = 1").get())
      .toEqual({ amount: 2 });
    expect(db.prepare("SELECT COUNT(*) AS count FROM schema_migrations WHERE name = ?").get(PERMANENT_DEDUCTION_MIGRATION))
      .toEqual({ count: 1 });
    db.close();
  });

  it("同一次扣包提交即使重试也只累计并投递一次", () => {
    const db = getDb();
    const sourceWeek = db.prepare("SELECT id FROM weeks ORDER BY event_date ASC, id ASC LIMIT 1").get() as { id: number };
    const member = db.prepare("SELECT id, package_deduction_total AS total FROM users ORDER BY id LIMIT 1")
      .get() as { id: number; total: number };
    db.exec("BEGIN IMMEDIATE");
    try {
      const targetWeekId = Number(db.prepare("INSERT INTO weeks (title, event_date) VALUES (?, ?)")
        .run("扣包幂等测试周", "2199-12-07").lastInsertRowid);
      const event = {
        requestId: "11111111-1111-4111-8111-111111111111",
        sourceWeekId: sourceWeek.id,
        effectiveWeekId: targetWeekId,
        userId: member.id,
        amount: 2,
        createdBy: member.id
      };

      expect(recordPackageDeduction(db, event)).toBe(true);
      expect(recordPackageDeduction(db, event)).toBe(false);
      expect(db.prepare("SELECT package_deduction_total AS total FROM users WHERE id = ?").get(member.id))
        .toEqual({ total: member.total + 2 });
      expect(db.prepare("SELECT package_deductions AS amount FROM weekly_scores WHERE week_id = ? AND user_id = ?")
        .get(targetWeekId, member.id)).toEqual({ amount: 2 });
      expect(db.prepare("SELECT COUNT(*) AS count FROM package_deduction_events WHERE request_id = ?")
        .get(event.requestId)).toEqual({ count: 1 });
    } finally {
      db.exec("ROLLBACK");
    }
  });

  it("输入负数会幂等地减少累计与下一周待执行扣包", () => {
    const db = getDb();
    const sourceWeek = getLatestWeek()!;
    const member = db.prepare("SELECT id FROM users WHERE account_type = 'member' ORDER BY id LIMIT 1")
      .get() as { id: number };
    db.exec("BEGIN IMMEDIATE");
    try {
      const targetWeekId = Number(db.prepare("INSERT INTO weeks (title, event_date) VALUES (?, ?)")
        .run("扣包撤销测试周", "2199-12-14").lastInsertRowid);
      db.prepare("UPDATE users SET package_deduction_total = 2, package_deduction_pending = 0 WHERE id = ?")
        .run(member.id);
      db.prepare(`
        INSERT INTO weekly_scores (week_id, user_id, score, package_deductions)
        VALUES (?, ?, 0, 2)
      `).run(targetWeekId, member.id);
      const correction = {
        requestId: "22222222-2222-4222-8222-222222222222",
        sourceWeekId: sourceWeek.id,
        preferredWeekId: targetWeekId,
        userId: member.id,
        amount: 1,
        createdBy: member.id
      };

      expect(recordPackageDeductionCorrection(db, correction)).toBe(1);
      expect(recordPackageDeductionCorrection(db, correction)).toBe(0);
      expect(db.prepare("SELECT package_deduction_total AS total FROM users WHERE id = ?").get(member.id))
        .toEqual({ total: 1 });
      expect(db.prepare("SELECT package_deductions AS amount FROM weekly_scores WHERE week_id = ? AND user_id = ?")
        .get(targetWeekId, member.id)).toEqual({ amount: 1 });
      expect(db.prepare("SELECT COUNT(*) AS count FROM package_deduction_corrections WHERE request_id = ?")
        .get(correction.requestId)).toEqual({ count: 1 });
    } finally {
      db.exec("ROLLBACK");
    }
  });

  it("游客保留登录档案但不会进入积分榜与发包算法", () => {
    const db = getDb();
    const week = getLatestWeek()!;
    const member = db.prepare("SELECT id FROM users WHERE account_type = 'member' ORDER BY id DESC LIMIT 1")
      .get() as { id: number };
    db.exec("BEGIN");
    try {
      db.prepare("UPDATE users SET account_type = 'guest' WHERE id = ?").run(member.id);
      const rows = getScoreRows(week.id);
      expect(rows.some((row) => row.userId === member.id)).toBe(false);
      expect(generatePackagePlan(getPackagePlanRows(week.id), week.eventDate).assignments
        .some((assignment) => assignment.member.userId === member.id)).toBe(false);
      expect(getMembers().find((row) => row.id === member.id)?.accountType).toBe("guest");
    } finally {
      db.exec("ROLLBACK");
    }
  });

  it("永久扣包总榜不因成员缺少所选周积分记录而消失", () => {
    const db = getDb();
    const week = getLatestWeek()!;
    const member = db.prepare("SELECT id FROM users ORDER BY id DESC LIMIT 1").get() as { id: number };
    db.exec("BEGIN");
    try {
      db.prepare("UPDATE users SET package_deduction_total = 7 WHERE id = ?").run(member.id);
      db.prepare("DELETE FROM weekly_scores WHERE week_id = ? AND user_id = ?").run(week.id, member.id);
      expect(getPackageDeductionRows(week.id).find((row) => row.userId === member.id))
        .toMatchObject({ packageDeductionTotal: 7, packageDeductions: 0, score: 0 });
    } finally {
      db.exec("ROLLBACK");
    }
  });

  it("按北京时间选择已经开始的当前统计周，不会提前跳到未来周", () => {
    const weeks: ScoreWeek[] = [
      { id: 2, title: "8月15日统计周", eventDate: "2026-08-15", status: "published" },
      { id: 1, title: "8月8日统计周", eventDate: "2026-08-08", status: "published" }
    ];

    expect(selectCurrentWeek(weeks, "2026-08-09")?.id).toBe(1);
    expect(selectCurrentWeek(weeks, "2026-08-15")?.id).toBe(2);
    expect(getShanghaiDate(new Date("2026-08-14T16:30:00.000Z"))).toBe("2026-08-15");
  });

  it("删除统计周会级联删除该周积分但保留成员账号", () => {
    const db = getDb();
    const member = db.prepare("SELECT id FROM users ORDER BY id LIMIT 1").get() as { id: number };
    db.exec("BEGIN");
    try {
      const result = db.prepare("INSERT INTO weeks (title, event_date) VALUES (?, ?)")
        .run("删除测试周", "2099-12-19");
      const weekId = Number(result.lastInsertRowid);
      db.prepare("INSERT INTO weekly_scores (week_id, user_id, score) VALUES (?, ?, ?)")
        .run(weekId, member.id, 88);
      db.prepare("DELETE FROM weeks WHERE id = ?").run(weekId);

      expect(db.prepare("SELECT id FROM weekly_scores WHERE week_id = ?").get(weekId)).toBeUndefined();
      expect(db.prepare("SELECT id FROM users WHERE id = ?").get(member.id)).toBeTruthy();
    } finally {
      db.exec("ROLLBACK");
    }
  });

  it("统计周可以重命名且不会改变发包起始日", () => {
    const db = getDb();
    db.exec("BEGIN");
    try {
      const result = db.prepare("INSERT INTO weeks (title, event_date) VALUES (?, ?)")
        .run("重命名前", "2099-12-26");
      const weekId = Number(result.lastInsertRowid);
      db.prepare("UPDATE weeks SET title = ? WHERE id = ?").run("重命名后", weekId);

      expect(db.prepare("SELECT title, event_date AS eventDate FROM weeks WHERE id = ?").get(weekId))
        .toEqual({ title: "重命名后", eventDate: "2099-12-26" });
    } finally {
      db.exec("ROLLBACK");
    }
  });

  it("按40分首轮、60分后续轮次生成连续8天发包安排", () => {
    const week = getLatestWeek()!;
    const plan = generatePackagePlan(getScoreRows(week.id), week.eventDate);
    expect(plan.days).toHaveLength(8);
    expect(plan.assignments).toHaveLength(40);
    expect(plan.days.every((day) => day.assignments.length === 5)).toBe(true);
    expect(plan.firstRoundEligible).toBe(27);
    expect(plan.laterRoundEligible).toBe(14);
    expect(plan.assignments[0]).toMatchObject({ round: 1, member: { displayName: "是溅诗啊" } });
    expect(plan.assignments[26]).toMatchObject({ round: 1, member: { displayName: "村子来个青年", score: 40 } });
    expect(plan.assignments[27]).toMatchObject({ round: 2, member: { displayName: "是溅诗啊" } });
    expect(plan.assignments.some((item) => item.round > 1 && item.member.score < 60)).toBe(false);
    expect(plan.assignments.every((item) => item.member.score >= (item.round === 1 ? 40 : 60))).toBe(true);
    const rounds = getPackageRoundsByMember(plan.assignments);
    expect(rounds.get(plan.assignments[0].member.userId)).toEqual([1, 2]);
    expect(rounds.get(plan.assignments[26].member.userId)).toEqual([1]);
    expect(plan.days[0]).toMatchObject({ date: "2026-08-08", weekday: "星期六" });
    expect(plan.days[7]).toMatchObject({ date: "2026-08-15", weekday: "星期六" });
  });

  it("第一轮不执行扣包，第二轮起跳过对应资格", () => {
    const week = getLatestWeek()!;
    const rows = getScoreRows(week.id).map((row) => ({
      ...row,
      packageDeductions: row.displayName === "是溅诗啊" ? 1 : 0,
      packageDeductionTotal: row.displayName === "是溅诗啊" ? 1 : 0
    }));
    const plan = generatePackagePlan(rows, week.eventDate);

    expect(plan.assignments).toHaveLength(40);
    expect(plan.days.every((day) => day.assignments.length === 5)).toBe(true);
    expect(plan.assignments[0]).toMatchObject({ round: 1, member: { displayName: "是溅诗啊" } });
    expect(plan.assignments.some((item) => item.round >= 2 && item.member.displayName === "是溅诗啊")).toBe(false);
    expect(getPackageRoundsByMember(plan.assignments).get(rows[0].userId)).toEqual([1]);
    expect(plan.deductionRanking[0]).toMatchObject({ count: 1, scheduled: 1, applied: 1, member: { displayName: "是溅诗啊" } });
  });

  it("40至59分成员无视扣包记录正常获得第一轮包", () => {
    const week = getLatestWeek()!;
    const rows = getScoreRows(week.id).map((row) => ({
      ...row,
      packageDeductions: row.displayName === "无压力之人" ? 1 : 0,
      packageDeductionTotal: row.displayName === "无压力之人" ? 1 : 0
    }));
    const plan = generatePackagePlan(rows, week.eventDate);

    expect(plan.assignments.filter((item) => item.member.displayName === "无压力之人")).toEqual([
      expect.objectContaining({ round: 1 })
    ]);
    expect(plan.deductionRanking[0]).toMatchObject({ count: 1, scheduled: 1, applied: 0 });
  });

  it("多次扣包从第二轮开始跨轮次依次生效", () => {
    const rows: ScoreRow[] = [
      {
        userId: 998, username: "first", displayName: "第一名", avatarUrl: null, note: null,
        score: 100, packageRound: null, packageDeductions: 2,
        packageDeductionTotal: 5, packageDeductionPending: 0, rank: 1
      },
      {
        userId: 999, username: "second", displayName: "第二名", avatarUrl: null, note: null,
        score: 90, packageRound: null, packageDeductions: 0,
        packageDeductionTotal: 1, packageDeductionPending: 1, rank: 2
      }
    ];
    const plan = generatePackagePlan(rows, "2026-08-08");

    expect(plan.assignments.filter((item) => item.member.displayName === "第一名").slice(0, 2).map((item) => item.round)).toEqual([1, 4]);
    expect(plan.deductionRanking[0]).toMatchObject({ count: 5, scheduled: 2, applied: 2 });
  });

  it("没有后续轮次资格时第一轮照常发放且扣包保持未应用", () => {
    const rows: ScoreRow[] = [{
      userId: 999,
      username: "test",
      displayName: "测试成员",
      avatarUrl: null,
      note: null,
      score: 50,
      packageRound: null,
      packageDeductions: 1,
      packageDeductionTotal: 4,
      packageDeductionPending: 0,
      rank: 1
    }];
    const plan = generatePackagePlan(rows, "2026-08-08");

    expect(plan.assignments).toHaveLength(1);
    expect(plan.assignments[0]).toMatchObject({ round: 1, member: { displayName: "测试成员" } });
    expect(plan.unfilledSlots).toBe(39);
    expect(plan.deductionRanking[0]).toMatchObject({ count: 4, scheduled: 1, applied: 0 });
  });

  it("分数变化会保存前后值，并对同一次提交保持幂等", () => {
    const db = getDb();
    const week = getLatestWeek()!;
    const row = getScoreRows(week.id)[0];
    db.exec("BEGIN");
    try {
      const input = {
        requestId: "22222222-2222-4222-8222-222222222222",
        weekId: week.id,
        userId: row.userId,
        previousScore: row.score,
        newScore: row.score + 8,
        source: "manual" as const,
        actorUserId: row.userId
      };
      expect(recordScoreChange(db, input)).toBe(true);
      expect(recordScoreChange(db, input)).toBe(false);
      expect(db.prepare(`
        SELECT previous_score AS previousScore, new_score AS newScore, delta
        FROM score_change_events WHERE request_id = ?
      `).get(input.requestId)).toEqual({ previousScore: row.score, newScore: row.score + 8, delta: 8 });
    } finally {
      db.exec("ROLLBACK");
    }
  });

  it("同一天只能确认一次已发包，状态会永久保存在SQLite", () => {
    const db = getDb();
    const week = getLatestWeek()!;
    const admin = getMembers().find((member) => member.role === "admin")!;
    db.exec("BEGIN");
    try {
      expect(db.prepare("INSERT OR IGNORE INTO package_day_statuses (week_id, day_index, marked_by) VALUES (?, 0, ?)")
        .run(week.id, admin.id).changes).toBe(1);
      expect(db.prepare("INSERT OR IGNORE INTO package_day_statuses (week_id, day_index, marked_by) VALUES (?, 0, ?)")
        .run(week.id, admin.id).changes).toBe(0);
      expect(db.prepare("SELECT week_id AS weekId, day_index AS dayIndex FROM package_day_statuses WHERE week_id = ?")
        .get(week.id)).toEqual({ weekId: week.id, dayIndex: 0 });
    } finally {
      db.exec("ROLLBACK");
    }
  });

  it("周报分享图包含本周汇总和前五名", () => {
    const week = getLatestWeek()!;
    const svg = buildWeeklyReportSvg({ week, rows: getScoreRows(week.id), sentDays: 3 });
    expect(svg).toContain("不良人 · 每周要塞战报");
    expect(svg).toContain("是溅诗啊");
    expect(svg).toContain("3/8");
    expect(svg).toContain("1200");
  });

  it("已发包当天的名单在后续改分后仍保持冻结", () => {
    const db = getDb();
    const week = getLatestWeek()!;
    const plan = generatePackagePlan(getScoreRows(week.id, true), week.eventDate);
    const first = plan.days[0].assignments[0];
    db.exec("BEGIN");
    try {
      db.prepare("DELETE FROM package_assignments WHERE week_id = ? AND day_index = 0").run(week.id);
      savePackageDaySnapshot(db, week.id, 0, plan.days[0].assignments);
      db.prepare("UPDATE weekly_scores SET score = 0 WHERE week_id = ? AND user_id = ?")
        .run(week.id, first.member.userId);

      const frozen = getPackageAssignmentSnapshots(week.id).filter((item) => item.dayIndex === 0);
      expect(frozen[0]).toMatchObject({
        userId: first.member.userId,
        score: first.member.score,
        round: first.round,
        position: 1
      });
      expect(getScoreRows(week.id, true).find((row) => row.userId === first.member.userId)?.score).toBe(0);
    } finally {
      db.exec("ROLLBACK");
    }
  });

  it("只把未实际执行的扣包顺延到下一期，且重复运行不会重复顺延", () => {
    const db = new Database(":memory:");
    db.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE users (
        id INTEGER PRIMARY KEY,
        package_deduction_pending INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE weeks (id INTEGER PRIMARY KEY, event_date TEXT NOT NULL UNIQUE);
      CREATE TABLE weekly_scores (
        week_id INTEGER NOT NULL REFERENCES weeks(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        score INTEGER NOT NULL DEFAULT 0,
        package_deductions INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (week_id, user_id)
      );
      CREATE TABLE package_deduction_applications (
        week_id INTEGER NOT NULL REFERENCES weeks(id) ON DELETE CASCADE,
        day_index INTEGER NOT NULL,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        amount INTEGER NOT NULL,
        UNIQUE (week_id, day_index, user_id)
      );
      CREATE TABLE package_deduction_rollovers (
        source_week_id INTEGER NOT NULL REFERENCES weeks(id) ON DELETE CASCADE,
        target_week_id INTEGER REFERENCES weeks(id) ON DELETE SET NULL,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        amount INTEGER NOT NULL,
        UNIQUE (source_week_id, user_id)
      );
      INSERT INTO users (id) VALUES (1);
      INSERT INTO weeks (id, event_date) VALUES (1, '2098-01-01'), (2, '2098-01-08');
      INSERT INTO weekly_scores (week_id, user_id, package_deductions) VALUES (1, 1, 3), (2, 1, 0);
    `);
    const skips = [
      { userId: 1, dayIndex: 3, round: 2 },
      { userId: 1, dayIndex: 4, round: 3 }
    ];
    recordDeductionApplications(db, 1, 3, skips);
    recordDeductionApplications(db, 1, 4, skips);

    rolloverExpiredPackageDeductions(db, "2098-01-09");
    rolloverExpiredPackageDeductions(db, "2098-01-09");

    expect(db.prepare("SELECT package_deductions AS amount FROM weekly_scores WHERE week_id = 2 AND user_id = 1").get())
      .toEqual({ amount: 1 });
    expect(db.prepare("SELECT amount FROM package_deduction_rollovers WHERE source_week_id = 1 AND user_id = 1").get())
      .toEqual({ amount: 1 });
    db.close();
  });

  it("已实际扣过的次数不会再次进入后续计划或超过本期登记数", () => {
    const db = getDb();
    const week = getLatestWeek()!;
    const member = getScoreRows(week.id, true)[0];
    db.exec("BEGIN");
    try {
      db.prepare("DELETE FROM package_deduction_applications WHERE week_id = ? AND user_id = ?")
        .run(week.id, member.userId);
      db.prepare("UPDATE weekly_scores SET package_deductions = 1 WHERE week_id = ? AND user_id = ?")
        .run(week.id, member.userId);
      recordDeductionApplications(db, week.id, 0, [
        { userId: member.userId, dayIndex: 0, round: 2 },
        { userId: member.userId, dayIndex: 0, round: 3 }
      ]);
      recordDeductionApplications(db, week.id, 1, [
        { userId: member.userId, dayIndex: 1, round: 4 }
      ]);

      expect(db.prepare(`
        SELECT COALESCE(SUM(amount), 0) AS amount FROM package_deduction_applications
        WHERE week_id = ? AND user_id = ?
      `).get(week.id, member.userId)).toEqual({ amount: 1 });
      expect(getPackagePlanRows(week.id).find((row) => row.userId === member.userId)?.packageDeductions).toBe(0);
    } finally {
      db.exec("ROLLBACK");
    }
  });

  it("停用成员保留历史成绩，但不会进入实时发包名单", () => {
    const db = getDb();
    const week = getLatestWeek()!;
    const member = getScoreRows(week.id)[0];
    db.exec("BEGIN");
    try {
      db.prepare("UPDATE users SET is_active = 0 WHERE id = ?").run(member.userId);
      expect(getScoreRows(week.id).some((row) => row.userId === member.userId)).toBe(true);
      expect(getScoreRows(week.id, true).some((row) => row.userId === member.userId)).toBe(false);
      expect(getLeaderboardRows(week).some((row) => row.userId === member.userId)).toBe(false);
    } finally {
      db.exec("ROLLBACK");
    }
  });

  it("草稿统计周只对管理员查询可见", () => {
    const db = getDb();
    db.exec("BEGIN");
    try {
      const draftId = Number(db.prepare("INSERT INTO weeks (title, event_date, status) VALUES (?, ?, 'draft')")
        .run("草稿可见性测试", "2199-11-27").lastInsertRowid);
      expect(getWeeks(true).some((week) => week.id === draftId)).toBe(true);
      expect(getWeeks(false).some((week) => week.id === draftId)).toBe(false);
    } finally {
      db.exec("ROLLBACK");
    }
  });
});
