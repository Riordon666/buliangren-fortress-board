import Database from "better-sqlite3";
import { hashSync } from "@node-rs/argon2";
import fs from "node:fs";
import path from "node:path";
import { ARGON_OPTIONS, INITIAL_PASSWORD } from "@/lib/constants";

type GlobalDatabase = typeof globalThis & {
  __fortressDatabase?: Database.Database;
};

const globalDatabase = globalThis as GlobalDatabase;

const seedMembers = [
  { name: "是溅诗啊", score: 192 },
  { name: "抑郁的农村入", score: 153, note: "高层" },
  { name: "通天道人", score: 139 },
  { name: "神威在他眼中", score: 134 },
  { name: "DTB", score: 125, note: "高层" },
  { name: "Treasu", score: 122 },
  { name: "浊杯赴宴", score: 120 },
  { name: "单帅一个字", score: 115 },
  { name: "九天惊落", score: 114, note: "首领", role: "admin" },
  { name: "晨A", score: 100 },
  { name: "柚猪崽崽", score: 91 },
  { name: "不会U", score: 91 },
  { name: "小南滑又暖", score: 78 },
  { name: "不过些许风霜", score: 75 },
  { name: "今天风浪大", score: 59 },
  { name: "贫困且懒惰", score: 54 },
  { name: "陷温", score: 53 },
  { name: "无压力之人", score: 50 },
  { name: "院长", score: 48 },
  { name: ".Z12", score: 47 },
  { name: "八代喜八郎", score: 46 },
  { name: "南离旧梦", score: 42 },
  { name: "家文", score: 41 },
  { name: "疯狂的阅读者", score: 41 },
  { name: "鲨芋辣鲛", score: 40 },
  { name: "小a", score: 40 },
  { name: "村子来个青年", score: 40 },
  { name: "小米SU7", score: 37 },
  { name: "张平安", score: 0 },
  { name: "十香", score: 0 }
] as const;

const memberNameCorrections = [
  ["是波诗呀", "是溅诗啊"],
  ["拥郁的农村人", "抑郁的农村入"],
  ["Treason", "Treasu"],
  ["泣林赴宴", "浊杯赴宴"],
  ["柚搭串串", "柚猪崽崽"],
  ["不念U", "不会U"],
  ["徐用日销情", "贫困且懒惰"],
  ["鲨手辣鲛", "鲨芋辣鲛"]
] as const;

function databasePath() {
  return path.join(process.cwd(), "data", "naruto-fortress.db");
}

function createDatabase() {
  const filename = databasePath();
  fs.mkdirSync(path.dirname(filename), { recursive: true });

  const database = new Database(filename);
  database.pragma("foreign_keys = ON");
  database.pragma("journal_mode = WAL");
  database.pragma("busy_timeout = 5000");

  database.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      avatar_url TEXT,
      role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
      note TEXT,
      roster_order INTEGER,
      is_active INTEGER NOT NULL DEFAULT 1,
      must_change_password INTEGER NOT NULL DEFAULT 1,
      last_seen_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS weeks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      event_date TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'published', 'locked')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS weekly_scores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      week_id INTEGER NOT NULL REFERENCES weeks(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      score INTEGER NOT NULL DEFAULT 0 CHECK (score >= 0),
      package_round INTEGER CHECK (package_round IS NULL OR package_round >= 0),
      package_deductions INTEGER NOT NULL DEFAULT 0 CHECK (package_deductions >= 0),
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (week_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      target_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      details TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS login_attempts (
      username TEXT PRIMARY KEY,
      failed_count INTEGER NOT NULL DEFAULT 0,
      last_failed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      locked_until TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_scores_week ON weekly_scores(week_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token_hash);
    CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);
    CREATE INDEX IF NOT EXISTS idx_users_active ON users(is_active);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_nocase ON users(username COLLATE NOCASE);
  `);

  const userColumns = database.pragma("table_info(users)") as Array<{ name: string }>;
  if (!userColumns.some((column) => column.name === "roster_order")) {
    database.exec("ALTER TABLE users ADD COLUMN roster_order INTEGER");
  }

  const scoreColumns = database.pragma("table_info(weekly_scores)") as Array<{ name: string }>;
  if (!scoreColumns.some((column) => column.name === "package_deductions")) {
    database.exec(`
      ALTER TABLE weekly_scores
      ADD COLUMN package_deductions INTEGER NOT NULL DEFAULT 0 CHECK (package_deductions >= 0)
    `);
  }

  const existingUsers = database.prepare("SELECT COUNT(*) AS count FROM users").get() as { count: number };
  if (existingUsers.count === 0) {
    const createUser = database.prepare(`
      INSERT INTO users (username, display_name, password_hash, role, note, roster_order)
      VALUES (@username, @displayName, @passwordHash, @role, @note, @rosterOrder)
    `);
    const createWeek = database.prepare(`
      INSERT INTO weeks (title, event_date, status)
      VALUES ('初始积分 · 第1期', '2026-08-08', 'published')
    `);
    const createScore = database.prepare(`
      INSERT INTO weekly_scores (week_id, user_id, score, package_round)
      VALUES (?, ?, ?, NULL)
    `);

    database.transaction(() => {
      for (const [index, member] of seedMembers.entries()) {
        const passwordHash = hashSync(INITIAL_PASSWORD, {
          ...ARGON_OPTIONS
        });
        const result = createUser.run({
          username: member.name,
          displayName: member.name,
          passwordHash,
          role: "role" in member ? member.role : "member",
          note: "note" in member ? member.note : null,
          rosterOrder: index + 1
        });
        memberIds.set(member.name, Number(result.lastInsertRowid));
      }

      const weekResult = createWeek.run();
      const weekId = Number(weekResult.lastInsertRowid);
      for (const member of seedMembers) {
        createScore.run(weekId, memberIds.get(member.name), member.score);
      }
    })();
  }

  const correctMemberName = database.prepare(`
    UPDATE users
    SET username = ?, display_name = ?, updated_at = CURRENT_TIMESTAMP
    WHERE username = ?
      AND NOT EXISTS (SELECT 1 FROM users AS existing WHERE existing.username = ? COLLATE NOCASE)
  `);
  database.transaction(() => {
    for (const [oldName, correctName] of memberNameCorrections) {
      correctMemberName.run(correctName, correctName, oldName, correctName);
    }
  })();

  const updateRosterOrder = database.prepare("UPDATE users SET roster_order = ? WHERE username = ? COLLATE NOCASE");
  database.transaction(() => {
    for (const [index, member] of seedMembers.entries()) {
      updateRosterOrder.run(index + 1, member.name);
    }
  })();

  return database;
}

const memberIds = new Map<string, number>();

export function getDb() {
  if (!globalDatabase.__fortressDatabase) {
    globalDatabase.__fortressDatabase = createDatabase();
  }
  return globalDatabase.__fortressDatabase;
}
