import { createHash, randomBytes } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as healthRoute from "@/app/api/bot/v1/health/route";
import * as lookupRoute from "@/app/api/bot/v1/members/lookup/route";
import * as packagesRoute from "@/app/api/bot/v1/packages/route";
import * as weeksRoute from "@/app/api/bot/v1/weeks/route";
import * as leaderboardRoute from "@/app/api/bot/v1/weeks/[weekRef]/leaderboard/route";
import * as summaryRoute from "@/app/api/bot/v1/weeks/[weekRef]/summary/route";
import { BOT_API_MAX_RESPONSE_BYTES } from "@/lib/bot-api/http";
import { closeBotReadDbForTests, withBotReadTransaction } from "@/lib/bot-api/readonly-db";
import { resetBotRateLimitsForTests } from "@/lib/bot-api/rate-limit";
import { closeDbForTests, getDb } from "@/lib/db";

type Fixture = {
  oldWeekId: number;
  currentWeekId: number;
  nextWeekId: number;
  draftWeekId: number;
  uniqueMemberId: number;
  frozenMemberId: number;
};

type Json = Record<string, any>;

const previousTokenHash = process.env.BOT_API_TOKEN_SHA256;
const apiToken = randomBytes(48).toString("base64url");
const apiTokenDigest = createHash("sha256").update(apiToken, "utf8").digest("hex");
const baseUrl = "https://naruto.riordon.xyz/api/bot/v1";
let fixture: Fixture;

function apiRequest(path: string, init: RequestInit = {}, token: string | null = apiToken) {
  const headers = new Headers(init.headers);
  if (token !== null) headers.set("Authorization", `Bearer ${token}`);
  return new Request(`${baseUrl}${path}`, { ...init, headers });
}

function lookupRequest(body: string, options: {
  token?: string | null;
  stream?: boolean;
  contentType?: string;
} = {}) {
  const headers = new Headers({ "Content-Type": options.contentType ?? "application/json" });
  const token = options.token === undefined ? apiToken : options.token;
  if (token !== null) headers.set("Authorization", `Bearer ${token}`);
  if (!options.stream) {
    return new Request(`${baseUrl}/members/lookup`, { method: "POST", headers, body });
  }
  const bytes = new TextEncoder().encode(body);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    }
  });
  return new Request(`${baseUrl}/members/lookup`, {
    method: "POST",
    headers,
    body: stream,
    duplex: "half"
  } as RequestInit & { duplex: "half" });
}

function routeContext(weekRef: string) {
  return { params: Promise.resolve({ weekRef }) };
}

async function json(response: Response) {
  return await response.json() as Json;
}

async function fresh<T>(operation: () => Promise<T> | T) {
  resetBotRateLimitsForTests();
  return await operation();
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
      const quoted = `"${table.replaceAll('"', '""')}"`;
      const rows = (database.prepare(`SELECT * FROM ${quoted}`).all() as Array<Record<string, unknown>>)
        .map((row) => JSON.stringify(row))
        .sort();
      hash.update(table);
      hash.update(JSON.stringify(rows));
    }
    return hash.digest("hex");
  });
}

function collectKeys(value: unknown, keys = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    value.forEach((item) => collectKeys(item, keys));
  } else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      keys.add(key.toLowerCase());
      collectKeys(item, keys);
    }
  }
  return keys;
}

beforeAll(() => {
  process.env.BOT_API_TOKEN_SHA256 = apiTokenDigest;
  closeBotReadDbForTests();
  const database = getDb();
  const passwordHash = (database.prepare(
    "SELECT password_hash AS passwordHash FROM users ORDER BY id LIMIT 1"
  ).get() as { passwordHash: string }).passwordHash;
  const insertMember = database.prepare(`
    INSERT INTO users (
      username, display_name, password_hash, role, account_type,
      roster_order, is_active, must_change_password
    ) VALUES (?, ?, ?, 'member', 'member', ?, 1, 0)
  `);
  const rankingNames = ["Route甲", "Route乙", "Route丙", "Route丁", "Route戊", "Route己"];
  const rankingMemberIds = rankingNames.map((name, index) => Number(insertMember.run(
    `__bot_route_rank_${index}`, name, passwordHash, 2000 + index
  ).lastInsertRowid));
  const uniqueMemberId = Number(insertMember.run(
    "__bot_route_nfkc_unique", "Ｒｏｕｔｅ唯一", passwordHash, 2100
  ).lastInsertRowid);
  for (let index = 0; index < 6; index += 1) {
    insertMember.run(`__bot_route_duplicate_${index}`, "重名Route", passwordHash, 2200 + index);
  }

  const insertWeek = database.prepare("INSERT INTO weeks (title, event_date, status) VALUES (?, ?, ?)");
  const oldWeekId = Number(insertWeek.run("Route旧周期", "2097-06-15", "published").lastInsertRowid);
  const currentWeekId = Number(insertWeek.run("Route当前周期", "2097-06-22", "locked").lastInsertRowid);
  const nextWeekId = Number(insertWeek.run("Route下一周期", "2097-06-29", "published").lastInsertRowid);
  const draftWeekId = Number(insertWeek.run("Route草稿周期", "2097-07-06", "draft").lastInsertRowid);
  const insertScore = database.prepare(`
    INSERT INTO weekly_scores (week_id, user_id, score, package_deductions)
    VALUES (?, ?, ?, 0)
  `);
  const scoreSets = new Map<number, number[]>([
    [oldWeekId, [100, 100, 60, 59, 40, 39]],
    [currentWeekId, [180, 100, 60, 59, 40, 39]],
    [nextWeekId, [100, 100, 60, 59, 40, 39]],
    [draftWeekId, [9999, 9999, 9999, 9999, 9999, 9999]]
  ]);
  for (const [weekId, scores] of scoreSets) {
    rankingMemberIds.forEach((memberId, index) => insertScore.run(weekId, memberId, scores[index]));
    insertScore.run(weekId, uniqueMemberId, weekId === draftWeekId ? 9999 : 15);
  }

  database.prepare(`
    INSERT INTO package_day_statuses (week_id, day_index, confirmation_source)
    VALUES (?, 7, 'manual')
  `).run(oldWeekId);
  const snapshotScores = [100, 100, 60, 59, 40];
  const snapshotRanks = [1, 1, 3, 4, 5];
  const insertSnapshot = database.prepare(`
    INSERT INTO package_assignments (
      week_id, day_index, position, user_id, round, score_snapshot, rank_snapshot
    ) VALUES (?, 7, ?, ?, 1, ?, ?)
  `);
  for (let index = 0; index < 5; index += 1) {
    insertSnapshot.run(
      oldWeekId, index + 1, rankingMemberIds[index], snapshotScores[index], snapshotRanks[index]
    );
  }
  database.prepare("UPDATE weekly_scores SET score = 0 WHERE week_id = ? AND user_id = ?")
    .run(oldWeekId, rankingMemberIds[0]);

  fixture = {
    oldWeekId,
    currentWeekId,
    nextWeekId,
    draftWeekId,
    uniqueMemberId,
    frozenMemberId: rankingMemberIds[0]
  };
  database.pragma("wal_checkpoint(TRUNCATE)");
  closeDbForTests();
});

beforeEach(() => {
  process.env.BOT_API_TOKEN_SHA256 = apiTokenDigest;
  resetBotRateLimitsForTests();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2097-06-22T04:00:00.000Z"));
});

afterEach(() => {
  closeBotReadDbForTests();
  resetBotRateLimitsForTests();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

afterAll(() => {
  closeBotReadDbForTests();
  if (previousTokenHash === undefined) delete process.env.BOT_API_TOKEN_SHA256;
  else process.env.BOT_API_TOKEN_SHA256 = previousTokenHash;
});

describe("Bot API v1 Route Handlers", () => {
  it("在Route层接受正确Token，拒绝缺失和错误Token且不泄露认证材料", async () => {
    const valid = await healthRoute.GET(apiRequest("/health"));
    const missing = await healthRoute.GET(apiRequest("/health", {}, null));
    const wrongToken = randomBytes(48).toString("base64url");
    const wrong = await healthRoute.GET(apiRequest("/health", {}, wrongToken));
    expect(valid.status).toBe(200);
    expect(missing.status).toBe(401);
    expect(wrong.status).toBe(401);
    const responseText = `${await missing.text()}${await wrong.text()}`;
    expect(
      responseText.includes(apiToken)
      || responseText.includes(apiTokenDigest)
      || responseText.includes(wrongToken)
    ).toBe(false);
    expect(valid.headers.get("access-control-allow-origin")).toBeNull();
    expect(valid.headers.get("cache-control")).toBe("no-store");
  });

  it("仅列出published/locked，draft无论直接ID还是current都表现为404或不可见", async () => {
    const weeksResponse = await weeksRoute.GET(apiRequest("/weeks?limit=12"));
    const weeksBody = await json(weeksResponse);
    expect(weeksResponse.status).toBe(200);
    expect(weeksBody.data.weeks.some((week: Json) => week.weekId === fixture.draftWeekId)).toBe(false);

    expect((await fresh(() => summaryRoute.GET(
      apiRequest(`/weeks/${fixture.oldWeekId}/summary`),
      routeContext(String(fixture.oldWeekId))
    ))).status).toBe(200);
    expect((await fresh(() => summaryRoute.GET(
      apiRequest(`/weeks/${fixture.currentWeekId}/summary`),
      routeContext(String(fixture.currentWeekId))
    ))).status).toBe(200);
    expect((await fresh(() => summaryRoute.GET(
      apiRequest(`/weeks/${fixture.draftWeekId}/summary`),
      routeContext(String(fixture.draftWeekId))
    ))).status).toBe(404);
    expect((await fresh(() => leaderboardRoute.GET(
      apiRequest(`/weeks/${fixture.draftWeekId}/leaderboard`),
      routeContext(String(fixture.draftWeekId))
    ))).status).toBe(404);

    vi.setSystemTime(new Date("2097-07-05T16:00:00.000Z"));
    const current = await fresh(() => summaryRoute.GET(
      apiRequest("/weeks/current/summary"), routeContext("current")
    ));
    const currentBody = await json(current);
    expect(current.status).toBe(200);
    expect(currentBody.data.week.weekId).toBe(fixture.nextWeekId);
  });

  it("保持竞赛并列排名及39/40/59/60资格边界", async () => {
    const response = await leaderboardRoute.GET(
      apiRequest(`/weeks/${fixture.nextWeekId}/leaderboard?limit=30`),
      routeContext(String(fixture.nextWeekId))
    );
    const body = await json(response);
    expect(response.status).toBe(200);
    expect(body.data.entries.slice(0, 3).map((entry: Json) => entry.rank)).toEqual([1, 1, 3]);
    const byScore = new Map<number, Json>(
      body.data.entries.map((entry: Json) => [entry.score, entry])
    );
    expect(byScore.get(39)).toMatchObject({
      firstRoundEligible: false,
      laterRoundsEligible: false
    });
    expect(byScore.get(40)).toMatchObject({
      firstRoundEligible: true,
      laterRoundsEligible: false
    });
    expect(byScore.get(59)).toMatchObject({
      firstRoundEligible: true,
      laterRoundsEligible: false
    });
    expect(byScore.get(60)).toMatchObject({
      firstRoundEligible: true,
      laterRoundsEligible: true
    });
  });

  it("按Asia/Shanghai午夜边界解析current并跳过draft", async () => {
    vi.setSystemTime(new Date("2097-06-28T15:59:59.000Z"));
    let response = await summaryRoute.GET(
      apiRequest("/weeks/current/summary"), routeContext("current")
    );
    expect((await json(response)).data.week.weekId).toBe(fixture.currentWeekId);

    resetBotRateLimitsForTests();
    vi.setSystemTime(new Date("2097-06-28T16:00:00.000Z"));
    response = await summaryRoute.GET(
      apiRequest("/weeks/current/summary"), routeContext("current")
    );
    expect((await json(response)).data.week.weekId).toBe(fixture.nextWeekId);

    resetBotRateLimitsForTests();
    vi.setSystemTime(new Date("2097-07-05T16:00:00.000Z"));
    response = await summaryRoute.GET(
      apiRequest("/weeks/current/summary"), routeContext("current")
    );
    expect((await json(response)).data.week.weekId).toBe(fixture.nextWeekId);
  });

  it("跨期周六返回双周期：已发名单冻结，未发名单按实时算法", async () => {
    const response = await packagesRoute.GET(apiRequest("/packages?date=2097-06-22"));
    const body = await json(response);
    expect(response.status).toBe(200);
    expect(body.data.cycles).toHaveLength(2);
    expect(body.data.cycles.map((cycle: Json) => [cycle.week.weekId, cycle.isSent])).toEqual([
      [fixture.oldWeekId, true],
      [fixture.currentWeekId, false]
    ]);
    expect(body.data.cycles[0].assignments[0]).toMatchObject({
      memberId: fixture.frozenMemberId,
      score: 100,
      position: 1
    });
    expect(body.data.cycles[1].assignments[0]).toMatchObject({ score: 180, position: 1 });
  });

  it("昵称查询支持NFKC精确匹配、404和最多5个安全重名候选", async () => {
    const unique = await lookupRoute.POST(lookupRequest(JSON.stringify({
      query: "Route唯一",
      historyLimit: 8
    })));
    const uniqueBody = await json(unique);
    expect(unique.status).toBe(200);
    expect(uniqueBody.data.member).toEqual({
      memberId: fixture.uniqueMemberId,
      displayName: "Ｒｏｕｔｅ唯一"
    });

    const missing = await fresh(() => lookupRoute.POST(lookupRequest(JSON.stringify({
      query: "不存在的Route成员"
    }))));
    expect(missing.status).toBe(404);

    const ambiguous = await fresh(() => lookupRoute.POST(lookupRequest(JSON.stringify({
      query: "重名Route"
    }))));
    const ambiguousBody = await json(ambiguous);
    expect(ambiguous.status).toBe(409);
    expect(ambiguousBody.error.code).toBe("AMBIGUOUS_MEMBER");
    expect(ambiguousBody.error.details.candidates).toHaveLength(5);
    expect(ambiguousBody.error.details.candidates.every((candidate: Json) =>
      Object.keys(candidate).sort().join(",") === "displayName,memberId"
    )).toBe(true);
  });

  it("严格拒绝unknown、duplicate、bounds、非法日期和weekRef", async () => {
    const invalidCalls: Array<() => Promise<Response>> = [
      () => weeksRoute.GET(apiRequest("/weeks?unknown=1")),
      () => weeksRoute.GET(apiRequest("/weeks?limit=1&limit=2")),
      () => weeksRoute.GET(apiRequest("/weeks?limit=0")),
      () => weeksRoute.GET(apiRequest("/weeks?limit=13")),
      () => leaderboardRoute.GET(
        apiRequest("/weeks/current/leaderboard?limit=0"), routeContext("current")
      ),
      () => leaderboardRoute.GET(
        apiRequest("/weeks/current/leaderboard?limit=31"), routeContext("current")
      ),
      () => packagesRoute.GET(apiRequest("/packages")),
      () => packagesRoute.GET(apiRequest("/packages?date=2097-02-30")),
      () => packagesRoute.GET(apiRequest(
        "/packages?date=2097-06-22&date=2097-06-23"
      )),
      () => summaryRoute.GET(
        apiRequest("/weeks/current/summary?x=1"), routeContext("current")
      ),
      () => summaryRoute.GET(apiRequest("/weeks/0/summary"), routeContext("0")),
      () => summaryRoute.GET(apiRequest("/weeks/-1/summary"), routeContext("-1")),
      () => summaryRoute.GET(apiRequest("/weeks/1.5/summary"), routeContext("1.5")),
      () => summaryRoute.GET(apiRequest("/weeks/CURRENT/summary"), routeContext("CURRENT")),
      () => summaryRoute.GET(
        apiRequest("/weeks/9007199254740992/summary"),
        routeContext("9007199254740992")
      ),
      () => lookupRoute.POST(lookupRequest(JSON.stringify({
        query: "Route唯一",
        historyLimit: 0
      }))),
      () => lookupRoute.POST(lookupRequest(JSON.stringify({
        query: "Route唯一",
        historyLimit: 13
      }))),
      () => lookupRoute.POST(lookupRequest(JSON.stringify({
        query: " ",
        historyLimit: 8
      }))),
      () => lookupRoute.POST(lookupRequest(JSON.stringify({
        query: "甲".repeat(41),
        historyLimit: 8
      }))),
      () => lookupRoute.POST(lookupRequest(JSON.stringify({
        query: "Route唯一",
        extra: true
      }))),
      () => lookupRoute.POST(lookupRequest(
        JSON.stringify({ query: "Route唯一" }),
        { contentType: "text/plain" }
      ))
    ];
    for (const call of invalidCalls) {
      resetBotRateLimitsForTests();
      const response = await call();
      expect(response.status).toBe(400);
      expect((await json(response)).error.code).toBe("INVALID_ARGUMENT");
    }
  });

  it("在Route层验证无Content-Length流式正文的4KiB UTF-8边界", async () => {
    const base = JSON.stringify({ query: "Route唯一", historyLimit: 8 });
    const fourKiB = `${base}${" ".repeat(4096 - Buffer.byteLength(base, "utf8"))}`;
    const accepted = await lookupRoute.POST(lookupRequest(fourKiB, { stream: true }));
    expect(accepted.status).toBe(200);
    const rejected = await fresh(() => lookupRoute.POST(lookupRequest(
      `${fourKiB} `,
      { stream: true }
    )));
    expect(rejected.status).toBe(400);
  });

  it("所有成功接口只包含公开字段且最大实际响应小于128KiB", async () => {
    const responses = [
      await healthRoute.GET(apiRequest("/health")),
      await weeksRoute.GET(apiRequest("/weeks?limit=12")),
      await summaryRoute.GET(
        apiRequest(`/weeks/${fixture.currentWeekId}/summary`),
        routeContext(String(fixture.currentWeekId))
      ),
      await leaderboardRoute.GET(
        apiRequest(`/weeks/${fixture.currentWeekId}/leaderboard?limit=30`),
        routeContext(String(fixture.currentWeekId))
      ),
      await lookupRoute.POST(lookupRequest(JSON.stringify({
        query: "Route唯一",
        historyLimit: 12
      }))),
      await packagesRoute.GET(apiRequest("/packages?date=2097-06-22"))
    ];
    const forbidden = new Set([
      "username", "password", "passwordhash", "password_hash", "session", "token", "hash",
      "role", "accounttype", "account_type", "mustchangepassword", "lastseenat", "last_seen_at",
      "deletedat", "deleted_at", "isactive", "is_active", "note", "avatarurl", "avatar_url",
      "audit", "packagedeductions", "package_deductions", "packagedeductionpending"
    ]);
    for (const response of responses) {
      expect(response.status).toBe(200);
      const text = await response.text();
      expect(Buffer.byteLength(text, "utf8")).toBeLessThan(BOT_API_MAX_RESPONSE_BYTES);
      const keys = collectKeys(JSON.parse(text));
      expect([...keys].filter((key) => forbidden.has(key))).toEqual([]);
    }
  });

  it("Route层第11次突发请求返回429和Retry-After", async () => {
    for (let index = 0; index < 10; index += 1) {
      expect((await healthRoute.GET(apiRequest("/health"))).status).toBe(200);
    }
    const limited = await healthRoute.GET(apiRequest("/health"));
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("1");
    expect((await json(limited)).error.code).toBe("RATE_LIMITED");
  });

  it("不支持的方法返回405并声明Allow", async () => {
    const health = healthRoute.POST();
    const lookup = lookupRoute.GET();
    expect(health.status).toBe(405);
    expect(health.headers.get("allow")).toBe("GET");
    expect(lookup.status).toBe(405);
    expect(lookup.headers.get("allow")).toBe("POST");
  });

  it("数据库缺失时health返回安全503，不暴露SQL、路径、stack或Secret", async () => {
    const originalPath = process.env.DATABASE_PATH!;
    const missingPath = `${originalPath}.missing-${randomBytes(8).toString("hex")}`;
    const logs: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...items: unknown[]) => {
      logs.push(items.map(String).join(" "));
    });
    closeBotReadDbForTests();
    process.env.DATABASE_PATH = missingPath;
    try {
      const response = await healthRoute.GET(apiRequest("/health"));
      const text = await response.text();
      expect(response.status).toBe(503);
      const combined = `${text}\n${logs.join("\n")}`;
      const leaks = [
        missingPath,
        originalPath,
        apiToken,
        apiTokenDigest,
        "SELECT ",
        "sqlite_schema",
        "node_modules"
      ];
      expect(leaks.some((needle) => combined.includes(needle))).toBe(false);
      expect(JSON.parse(text).error.code).toBe("SERVICE_UNAVAILABLE");
    } finally {
      closeBotReadDbForTests();
      process.env.DATABASE_PATH = originalPath;
    }
  });

  it("错误响应不包含SQL、内部路径、stack或Secret", async () => {
    const wrongToken = randomBytes(48).toString("base64url");
    const unauthorized = await healthRoute.GET(apiRequest("/health", {}, wrongToken));
    const invalid = await fresh(() => packagesRoute.GET(
      apiRequest("/packages?date=not-a-date")
    ));
    const text = `${await unauthorized.text()}\n${await invalid.text()}`;
    const forbiddenFragments = [
      apiToken,
      apiTokenDigest,
      wrongToken,
      "SELECT ",
      "sqlite_schema",
      "node_modules",
      "D:\\naruto_web",
      "/www/wwwroot"
    ];
    expect(forbiddenFragments.some((fragment) => text.includes(fragment))).toBe(false);
    expect(text.toLowerCase().includes("stack")).toBe(false);
  });

  it("调用全部真实API前后数据库逻辑摘要不变", async () => {
    const before = logicalDatabaseDigest();
    await healthRoute.GET(apiRequest("/health"));
    await weeksRoute.GET(apiRequest("/weeks?limit=12"));
    await summaryRoute.GET(
      apiRequest("/weeks/current/summary"), routeContext("current")
    );
    await leaderboardRoute.GET(
      apiRequest("/weeks/current/leaderboard?limit=30"), routeContext("current")
    );
    await lookupRoute.POST(lookupRequest(JSON.stringify({
      query: "Route唯一",
      historyLimit: 8
    })));
    await packagesRoute.GET(apiRequest("/packages?date=2097-06-22"));
    closeBotReadDbForTests();
    expect(logicalDatabaseDigest()).toBe(before);
  });
});
