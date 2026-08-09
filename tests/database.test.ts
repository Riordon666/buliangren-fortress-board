import { describe, expect, it } from "vitest";
import { INITIAL_PASSWORD } from "@/lib/constants";
import { getDb } from "@/lib/db";
import { getLatestWeek, getMembers, getScoreRows } from "@/lib/data";
import { verifyPassword } from "@/lib/password";

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
});
