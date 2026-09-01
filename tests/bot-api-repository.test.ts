import { createHash } from "node:crypto";
import fs from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { closeDbForTests, getDb } from "@/lib/db";
import {
  BotRepositoryInvariantError,
  withBotFactsRepository
} from "@/lib/bot-api/repository";
import {
  closeBotReadDbForTests,
  withBotReadTransaction
} from "@/lib/bot-api/readonly-db";
import type { ScoreRow } from "@/lib/types";

type Fixture = {
  oldWeekId: number;
  currentWeekId: number;
  draftWeekId: number;
  emptySnapshotWeekId: number;
  brokenSnapshotWeekId: number;
  frozenMemberId: number;
  frozenScore: number;
};

let fixture: Fixture;

function fileBundleDigest(databasePath: string) {
  return [databasePath, `${databasePath}-wal`, `${databasePath}-shm`].map((filename) => ({
    suffix: filename.slice(databasePath.length),
    exists: fs.existsSync(filename),
    digest: fs.existsSync(filename)
      ? createHash("sha256").update(fs.readFileSync(filename)).digest("hex")
      : null
  }));
}

function logicalDatabaseDigest() {
  return withBotReadTransaction((database) => {
    const hash = createHash("sha256");
    const schema = database.prepare(`
      SELECT type, name, tbl_name AS tableName, sql
      FROM sqlite_schema
      ORDER BY type, name
    `).all();
    hash.update(JSON.stringify(schema));
    const tables = database.prepare(`
      SELECT name FROM sqlite_schema
      WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
      ORDER BY name
    `).pluck().all() as string[];
    for (const table of tables) {
      const quotedTable = `"${table.replaceAll('"', '""')}"`;
      const rows = (database.prepare(`SELECT * FROM ${quotedTable}`).all() as Array<Record<string, unknown>>)
        .map((row) => JSON.stringify(row))
        .sort();
      hash.update(table);
      hash.update(JSON.stringify(rows));
    }
    return hash.digest("hex");
  });
}

beforeAll(() => {
  closeBotReadDbForTests();
  const database = getDb();
  const passwordHash = (database.prepare("SELECT password_hash AS passwordHash FROM users ORDER BY id LIMIT 1")
    .get() as { passwordHash: string }).passwordHash;
  const insertMember = database.prepare(`
    INSERT INTO users (username, display_name, password_hash, role, account_type, roster_order, is_active, must_change_password)
    VALUES (?, ?, ?, 'member', 'member', ?, ?, 0)
  `);
  const fullwidthMemberId = Number(insertMember.run("__bot_nfkc_fullwidth", "Ａlpha", passwordHash, 1001, 1).lastInsertRowid);
  const asciiMemberId = Number(insertMember.run("__bot_nfkc_ascii", "Alpha", passwordHash, 1002, 1).lastInsertRowid);
  const inactiveMemberId = Number(insertMember.run("__bot_inactive", "Inactive", passwordHash, 1003, 0).lastInsertRowid);
  expect(fullwidthMemberId).toBeGreaterThan(0);
  expect(asciiMemberId).toBeGreaterThan(0);

  const insertWeek = database.prepare("INSERT INTO weeks (title, event_date, status) VALUES (?, ?, ?)");
  const oldWeekId = Number(insertWeek.run("Bot旧周期", "2097-06-15", "published").lastInsertRowid);
  const currentWeekId = Number(insertWeek.run("Bot当前周期", "2097-06-22", "locked").lastInsertRowid);
  const draftWeekId = Number(insertWeek.run("Bot草稿周期", "2097-06-29", "draft").lastInsertRowid);
  const emptySnapshotWeekId = Number(insertWeek.run("Bot空冻结周期", "2097-07-06", "published").lastInsertRowid);
  const brokenSnapshotWeekId = Number(insertWeek.run("Bot损坏冻结周期", "2097-07-13", "published").lastInsertRowid);
  for (let index = 0; index < 9; index += 1) {
    const eventDate = new Date(Date.UTC(2097, 6, 20 + index * 7)).toISOString().slice(0, 10);
    insertWeek.run(`Bot历史空档${index + 1}`, eventDate, "published");
  }
  const insertScores = database.prepare(`
    INSERT INTO weekly_scores (week_id, user_id, score, package_deductions)
    SELECT ?, id, MAX(0, 200 - id), 0
    FROM users
    WHERE account_type = 'member' AND deleted_at IS NULL
  `);
  for (const weekId of [oldWeekId, currentWeekId, draftWeekId, emptySnapshotWeekId, brokenSnapshotWeekId]) {
    insertScores.run(weekId);
  }
  const tiedMembers = database.prepare(`
    SELECT id FROM users
    WHERE account_type = 'member' AND is_active = 1 AND deleted_at IS NULL
    ORDER BY COALESCE(roster_order, 999999), id
    LIMIT 2
  `).all() as Array<{ id: number }>;
  database.prepare(`
    UPDATE weekly_scores SET score = 100
    WHERE week_id = ? AND user_id != ?
  `).run(currentWeekId, inactiveMemberId);
  database.prepare("UPDATE weekly_scores SET score = 150 WHERE week_id = ? AND user_id IN (?, ?)")
    .run(currentWeekId, tiedMembers[0].id, tiedMembers[1].id);
  database.prepare("UPDATE weekly_scores SET score = 999 WHERE week_id = ? AND user_id = ?")
    .run(currentWeekId, inactiveMemberId);
  database.prepare("UPDATE weekly_scores SET score = 9999 WHERE week_id = ?")
    .run(draftWeekId);

  const frozenRows = database.prepare(`
    WITH ranked AS (
      SELECT u.id AS memberId, ws.score,
        RANK() OVER (ORDER BY ws.score DESC) AS rank,
        COALESCE(u.roster_order, 999999) AS rosterOrder,
        u.display_name AS displayName
      FROM weekly_scores ws
      JOIN users u ON u.id = ws.user_id
      WHERE ws.week_id = ? AND u.is_active = 1
        AND u.account_type = 'member' AND u.deleted_at IS NULL
    )
    SELECT memberId, score, rank
    FROM ranked
    ORDER BY score DESC, rosterOrder, displayName COLLATE NOCASE
    LIMIT 5
  `).all(oldWeekId) as Array<{ memberId: number; score: number; rank: number }>;
  database.prepare(`
    INSERT INTO package_day_statuses (week_id, day_index, confirmation_source)
    VALUES (?, 7, 'manual')
  `).run(oldWeekId);
  const insertSnapshot = database.prepare(`
    INSERT INTO package_assignments (
      week_id, day_index, position, user_id, round, score_snapshot, rank_snapshot
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  frozenRows.forEach((row, index) => {
    insertSnapshot.run(oldWeekId, 7, index + 1, row.memberId, 1, row.score, row.rank);
  });
  database.prepare("UPDATE weekly_scores SET score = 0 WHERE week_id = ? AND user_id = ?")
    .run(oldWeekId, frozenRows[0].memberId);

  database.prepare(`
    INSERT INTO package_day_statuses (week_id, day_index, confirmation_source)
    VALUES (?, 0, 'manual')
  `).run(emptySnapshotWeekId);
  database.prepare(`
    INSERT INTO package_day_statuses (week_id, day_index, confirmation_source)
    VALUES (?, 0, 'manual')
  `).run(brokenSnapshotWeekId);
  const brokenMember = database.prepare(`
    SELECT ws.user_id AS memberId, ws.score
    FROM weekly_scores ws JOIN users u ON u.id = ws.user_id
    WHERE ws.week_id = ? AND u.is_active = 1 AND u.account_type = 'member' AND u.deleted_at IS NULL
    ORDER BY ws.score DESC LIMIT 1
  `).get(brokenSnapshotWeekId) as { memberId: number; score: number };
  insertSnapshot.run(brokenSnapshotWeekId, 0, 2, brokenMember.memberId, 1, brokenMember.score, 1);

  fixture = {
    oldWeekId,
    currentWeekId,
    draftWeekId,
    emptySnapshotWeekId,
    brokenSnapshotWeekId,
    frozenMemberId: frozenRows[0].memberId,
    frozenScore: frozenRows[0].score
  };
  database.pragma("wal_checkpoint(TRUNCATE)");
  closeDbForTests();
});

describe("Bot API 独立只读事实仓储", () => {
  it("使用SQLite只读与query_only双重保护，并拒绝任何写入", () => {
    withBotReadTransaction((database) => {
      expect(database.readonly).toBe(true);
      expect(Number(database.pragma("query_only", { simple: true }))).toBe(1);
    });
    expect(() => withBotReadTransaction((database) => {
      database.prepare("UPDATE weeks SET title = title WHERE id = ?").run(fixture.currentWeekId);
    })).toThrow();
  });

  it("只解析published/locked周，current不会命中draft", () => {
    withBotFactsRepository((repository) => {
      expect(repository.health().sqliteVersion).toMatch(/^\d+\.\d+/);
      const weeks = repository.listWeeks(12);
      expect(weeks.some((week) => week.id === fixture.draftWeekId)).toBe(false);
      expect(repository.resolveWeek(fixture.draftWeekId, "2097-06-29")).toBeNull();
      expect(repository.resolveWeek("current", "2097-06-29")?.id).toBe(fixture.currentWeekId);
    });
  });

  it("按竞赛排名处理并列，并在当前周排除停用成员", () => {
    withBotFactsRepository((repository) => {
      const result = repository.getLeaderboard(fixture.currentWeekId, 30, "2097-06-22");
      expect(result).not.toBeNull();
      expect(result!.entries.slice(0, 3).map((row) => row.rank)).toEqual([1, 1, 3]);
      expect(result!.entries.some((row) => row.displayName === "Inactive")).toBe(false);
      expect(result!.entries[0]).toMatchObject({
        score: 150,
        firstRoundEligible: true,
        laterRoundEligible: true
      });
      const summary = repository.getWeekSummary(fixture.currentWeekId, "2097-06-22");
      expect(summary).toMatchObject({ week: { status: "locked" }, topScore: 150 });
    });
  });

  it("只做NFKC后的精确昵称匹配，并把重名候选限制为安全字段", () => {
    withBotFactsRepository((repository) => {
      const ambiguous = repository.findMemberCandidates("Alpha");
      expect(ambiguous.matchCount).toBe(2);
      expect(ambiguous.candidates).toHaveLength(2);
      expect(ambiguous.candidates.every((candidate) =>
        Object.keys(candidate).sort().join(",") === "displayName,memberId"
      )).toBe(true);
      expect(repository.findMemberCandidates("alpha")).toEqual({ matchCount: 0, candidates: [] });
      const history = repository.getMemberHistory(ambiguous.candidates[0].memberId, 8);
      expect(history.length).toBeGreaterThan(0);
      expect(history.every((point) => point.status === "published" || point.status === "locked")).toBe(true);
      expect(history.some((point) => point.weekId === fixture.draftWeekId)).toBe(false);
    });
  });

  it("按历史记录数量回溯，最近十二周缺分时仍返回更早记录", () => {
    withBotFactsRepository((repository) => {
      const member = repository.findMemberCandidates("Alpha").candidates[0];
      const history = repository.getMemberHistory(member.memberId, 4);
      expect(history).toHaveLength(4);
      expect(history.at(-1)?.weekId).toBe(fixture.oldWeekId);
    });
  });

  it("跨期周六同时返回两个周期，已发日使用冻结快照，未发日使用当前算法", () => {
    withBotFactsRepository((repository) => {
      const scoreReader = repository as unknown as {
        getVisibleScoreRows: (weekId: number, activeOnly: boolean) => ScoreRow[];
      };
      const originalScoreReader = scoreReader.getVisibleScoreRows.bind(repository);
      const scoreQueries: number[] = [];
      scoreReader.getVisibleScoreRows = (weekId, activeOnly) => {
        scoreQueries.push(weekId);
        return originalScoreReader(weekId, activeOnly);
      };
      const cycles = repository.getPackagesForDate("2097-06-22");
      expect(cycles.map((cycle) => [cycle.week.id, cycle.dayIndex, cycle.sent])).toEqual([
        [fixture.oldWeekId, 7, true],
        [fixture.currentWeekId, 0, false]
      ]);
      expect(scoreQueries).toEqual([fixture.currentWeekId]);
      const frozen = cycles[0].assignments[0];
      expect(frozen).toMatchObject({
        memberId: fixture.frozenMemberId,
        score: fixture.frozenScore,
        position: 1
      });
      expect(cycles[1].assignments).toHaveLength(5);
    });
  });

  it("已发状态的零行快照保持空冻结，位置损坏的快照拒绝返回", () => {
    withBotFactsRepository((repository) => {
      const empty = repository.getPackagesForDate("2097-07-06");
      expect(empty).toHaveLength(1);
      expect(empty[0]).toMatchObject({
        week: { id: fixture.emptySnapshotWeekId },
        sent: true,
        assignments: []
      });
      expect(() => repository.getPackagesForDate("2097-07-13"))
        .toThrow(BotRepositoryInvariantError);
    });
  });

  it("限制仓储参数上界", () => {
    withBotFactsRepository((repository) => {
      expect(() => repository.listWeeks(13)).toThrow(RangeError);
      expect(() => repository.getLeaderboard(fixture.currentWeekId, 31)).toThrow(RangeError);
      expect(() => repository.getMemberHistory(fixture.frozenMemberId, 13)).toThrow(RangeError);
    });
  });

  it("所有事实查询前后数据库的逻辑内容和文件字节均不变化", () => {
    const databasePath = process.env.DATABASE_PATH!;
    closeBotReadDbForTests();
    const filesBefore = fileBundleDigest(databasePath);
    const logicalBefore = logicalDatabaseDigest();
    withBotFactsRepository((repository) => {
      repository.health();
      repository.listWeeks(12);
      repository.resolveWeek("current", "2097-06-22");
      repository.getWeekSummary(fixture.currentWeekId, "2097-06-22");
      repository.getLeaderboard(fixture.currentWeekId, 30, "2097-06-22");
      const member = repository.findMemberCandidates("Alpha").candidates[0];
      repository.getMemberHistory(member.memberId, 8);
      repository.getPackagesForDate("2097-06-22");
    });
    const logicalAfter = logicalDatabaseDigest();
    closeBotReadDbForTests();
    expect(logicalAfter).toBe(logicalBefore);
    expect(fileBundleDigest(databasePath)).toEqual(filesBefore);
  });
});
