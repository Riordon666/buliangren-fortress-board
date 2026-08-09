import { describe, expect, it } from "vitest";
import { INITIAL_PASSWORD } from "@/lib/constants";
import { getDb } from "@/lib/db";
import { getLatestWeek, getMembers, getScoreRows } from "@/lib/data";
import { generatePackagePlan } from "@/lib/package-plan";
import { verifyPassword } from "@/lib/password";
import type { ScoreRow } from "@/lib/types";

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
    expect(plan.days[0]).toMatchObject({ date: "2026-08-08", weekday: "星期六" });
    expect(plan.days[7]).toMatchObject({ date: "2026-08-15", weekday: "星期六" });
  });

  it("扣包会跳过对应资格且由后续成员补齐每日名额", () => {
    const week = getLatestWeek()!;
    const rows = getScoreRows(week.id).map((row) => ({
      ...row,
      packageDeductions: row.displayName === "是溅诗啊" ? 1 : 0
    }));
    const plan = generatePackagePlan(rows, week.eventDate);

    expect(plan.assignments).toHaveLength(40);
    expect(plan.days.every((day) => day.assignments.length === 5)).toBe(true);
    expect(plan.assignments[0].member.displayName).toBe("抑郁的农村入");
    expect(plan.assignments.find((item) => item.member.displayName === "是溅诗啊")?.round).toBe(2);
    expect(plan.deductionRanking[0]).toMatchObject({ count: 1, applied: 1, member: { displayName: "是溅诗啊" } });
  });

  it("40至59分成员被扣一次后本期不再进入后续轮次", () => {
    const week = getLatestWeek()!;
    const rows = getScoreRows(week.id).map((row) => ({
      ...row,
      packageDeductions: row.displayName === "无压力之人" ? 1 : 0
    }));
    const plan = generatePackagePlan(rows, week.eventDate);

    expect(plan.assignments.some((item) => item.member.displayName === "无压力之人")).toBe(false);
    expect(plan.deductionRanking[0]).toMatchObject({ applied: 1 });
  });

  it("多次扣包会跨轮次依次生效", () => {
    const week = getLatestWeek()!;
    const rows = getScoreRows(week.id).map((row) => ({
      ...row,
      packageDeductions: row.displayName === "是溅诗啊" ? 2 : 0
    }));
    const plan = generatePackagePlan(rows, week.eventDate);

    expect(plan.assignments.find((item) => item.member.displayName === "是溅诗啊")?.round).toBe(3);
    expect(plan.deductionRanking[0]).toMatchObject({ count: 2, applied: 2 });
  });

  it("没有后续轮次资格时会安全留空", () => {
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

    expect(plan.assignments).toHaveLength(0);
    expect(plan.unfilledSlots).toBe(40);
    expect(plan.deductionRanking[0]).toMatchObject({ applied: 1 });
  });
});
