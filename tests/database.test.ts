import { describe, expect, it } from "vitest";
import { INITIAL_PASSWORD } from "@/lib/constants";
import { getDb } from "@/lib/db";
import { getLatestWeek, getMembers, getScoreRows, getShanghaiDate, selectCurrentWeek } from "@/lib/data";
import { generatePackagePlan, getPackageRoundsByMember } from "@/lib/package-plan";
import { verifyPassword } from "@/lib/password";
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
    expect(await verifyPassword(rows[0].passwordHash, INITIAL_PASSWORD)).toBe(true);
  });

  it("SQLite运行时包含WAL并发修复版本", () => {
    const version = getDb().prepare("SELECT sqlite_version() AS version").get() as { version: string };
    const [major, minor, patch] = version.version.split(".").map(Number);
    expect(major > 3 || (major === 3 && (minor > 51 || (minor === 51 && patch >= 3)))).toBe(true);
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
      packageDeductions: row.displayName === "是溅诗啊" ? 1 : 0
    }));
    const plan = generatePackagePlan(rows, week.eventDate);

    expect(plan.assignments).toHaveLength(40);
    expect(plan.days.every((day) => day.assignments.length === 5)).toBe(true);
    expect(plan.assignments[0]).toMatchObject({ round: 1, member: { displayName: "是溅诗啊" } });
    expect(plan.assignments.some((item) => item.round >= 2 && item.member.displayName === "是溅诗啊")).toBe(false);
    expect(getPackageRoundsByMember(plan.assignments).get(rows[0].userId)).toEqual([1]);
    expect(plan.deductionRanking[0]).toMatchObject({ count: 1, applied: 1, member: { displayName: "是溅诗啊" } });
  });

  it("40至59分成员无视扣包记录正常获得第一轮包", () => {
    const week = getLatestWeek()!;
    const rows = getScoreRows(week.id).map((row) => ({
      ...row,
      packageDeductions: row.displayName === "无压力之人" ? 1 : 0
    }));
    const plan = generatePackagePlan(rows, week.eventDate);

    expect(plan.assignments.filter((item) => item.member.displayName === "无压力之人")).toEqual([
      expect.objectContaining({ round: 1 })
    ]);
    expect(plan.deductionRanking[0]).toMatchObject({ count: 1, applied: 0 });
  });

  it("多次扣包从第二轮开始跨轮次依次生效", () => {
    const rows: ScoreRow[] = [
      {
        userId: 998, username: "first", displayName: "第一名", avatarUrl: null, note: null,
        score: 100, packageRound: null, packageDeductions: 2, rank: 1
      },
      {
        userId: 999, username: "second", displayName: "第二名", avatarUrl: null, note: null,
        score: 90, packageRound: null, packageDeductions: 0, rank: 2
      }
    ];
    const plan = generatePackagePlan(rows, "2026-08-08");

    expect(plan.assignments.filter((item) => item.member.displayName === "第一名").slice(0, 2).map((item) => item.round)).toEqual([1, 4]);
    expect(plan.deductionRanking[0]).toMatchObject({ count: 2, applied: 2 });
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
      rank: 1
    }];
    const plan = generatePackagePlan(rows, "2026-08-08");

    expect(plan.assignments).toHaveLength(1);
    expect(plan.assignments[0]).toMatchObject({ round: 1, member: { displayName: "测试成员" } });
    expect(plan.unfilledSlots).toBe(39);
    expect(plan.deductionRanking[0]).toMatchObject({ applied: 0 });
  });
});
