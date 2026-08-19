import Database from "better-sqlite3";
import { hashSync } from "@node-rs/argon2";
import fs from "node:fs";
import path from "node:path";
import { ARGON_OPTIONS } from "@/lib/constants";
import { getSeedInitialPassword } from "@/lib/server-config";
import { rolloverExpiredPackageDeductions } from "@/lib/package-ledger";
import { databaseFilePath } from "@/lib/storage-paths";
import { backfillMissingPackageSnapshots } from "@/lib/package-snapshots";
import { autoConfirmDuePackageDays } from "@/lib/package-delivery";

type GlobalDatabase = typeof globalThis & {
  __fortressDatabase?: Database.Database;
  __fortressRolloverDate?: string;
  __fortressAutoConfirmMinute?: number;
};

const globalDatabase = globalThis as GlobalDatabase;

export const PERMANENT_DEDUCTION_MIGRATION = "permanent-package-deductions-v1";

export function migratePermanentPackageDeductions(database: Database.Database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  const findNextWeek = database.prepare(`
    SELECT id FROM weeks
    WHERE event_date > ?
    ORDER BY event_date ASC, id ASC
    LIMIT 1
  `);
  const addScheduled = database.prepare(`
    INSERT INTO weekly_scores (week_id, user_id, score, package_deductions)
    VALUES (?, ?, 0, ?)
    ON CONFLICT(week_id, user_id) DO UPDATE SET
      package_deductions = weekly_scores.package_deductions + excluded.package_deductions,
      updated_at = CURRENT_TIMESTAMP
  `);
  const addTotal = database.prepare(`
    UPDATE users SET package_deduction_total = package_deduction_total + ? WHERE id = ?
  `);
  const addPending = database.prepare(`
    UPDATE users SET package_deduction_pending = package_deduction_pending + ? WHERE id = ?
  `);

  database.transaction(() => {
    if (database.prepare("SELECT name FROM schema_migrations WHERE name = ?").get(PERMANENT_DEDUCTION_MIGRATION)) {
      return;
    }
    const legacyDeductions = database.prepare(`
      SELECT ws.user_id AS userId, ws.package_deductions AS amount, w.event_date AS sourceDate
      FROM weekly_scores ws
      JOIN weeks w ON w.id = ws.week_id
      WHERE ws.package_deductions > 0
      ORDER BY w.event_date ASC, w.id ASC, ws.user_id ASC
    `).all() as Array<{ userId: number; amount: number; sourceDate: string }>;
    database.prepare("UPDATE weekly_scores SET package_deductions = 0 WHERE package_deductions > 0").run();
    for (const deduction of legacyDeductions) {
      addTotal.run(deduction.amount, deduction.userId);
      const nextWeek = findNextWeek.get(deduction.sourceDate) as { id: number } | undefined;
      if (nextWeek) addScheduled.run(nextWeek.id, deduction.userId, deduction.amount);
      else addPending.run(deduction.amount, deduction.userId);
    }
    database.prepare("INSERT INTO schema_migrations (name) VALUES (?)").run(PERMANENT_DEDUCTION_MIGRATION);
  }).immediate();
}

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
  return databaseFilePath();
}

function createDatabase() {
  const filename = databasePath();
  if (process.env.NODE_ENV === "production" && !fs.existsSync(filename) && process.env.ALLOW_DATABASE_INIT !== "1") {
    throw new Error(`生产数据库不存在：${filename}。为防止误建空库，程序已停止启动。`);
  }
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
      account_type TEXT NOT NULL DEFAULT 'member' CHECK (account_type IN ('member', 'guest')),
      note TEXT,
      roster_order INTEGER,
      is_active INTEGER NOT NULL DEFAULT 1,
      must_change_password INTEGER NOT NULL DEFAULT 1,
      package_deduction_total INTEGER NOT NULL DEFAULT 0 CHECK (package_deduction_total >= 0),
      package_deduction_pending INTEGER NOT NULL DEFAULT 0 CHECK (package_deduction_pending >= 0),
      last_seen_at TEXT,
      deleted_at TEXT,
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

    CREATE TABLE IF NOT EXISTS package_deduction_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_id TEXT NOT NULL,
      source_week_id INTEGER REFERENCES weeks(id) ON DELETE SET NULL,
      effective_week_id INTEGER REFERENCES weeks(id) ON DELETE SET NULL,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      amount INTEGER NOT NULL CHECK (amount > 0),
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (request_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS package_deduction_corrections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_id TEXT NOT NULL,
      source_week_id INTEGER REFERENCES weeks(id) ON DELETE SET NULL,
      preferred_week_id INTEGER REFERENCES weeks(id) ON DELETE SET NULL,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      amount INTEGER NOT NULL CHECK (amount > 0),
      scheduled_removed INTEGER NOT NULL DEFAULT 0 CHECK (scheduled_removed >= 0),
      pending_removed INTEGER NOT NULL DEFAULT 0 CHECK (pending_removed >= 0),
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (request_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS package_day_statuses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      week_id INTEGER NOT NULL REFERENCES weeks(id) ON DELETE CASCADE,
      day_index INTEGER NOT NULL CHECK (day_index BETWEEN 0 AND 7),
      marked_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      confirmation_source TEXT NOT NULL DEFAULT 'manual' CHECK (confirmation_source IN ('manual', 'automatic')),
      sent_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (week_id, day_index)
    );

    CREATE TABLE IF NOT EXISTS package_assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      week_id INTEGER NOT NULL REFERENCES weeks(id) ON DELETE CASCADE,
      day_index INTEGER NOT NULL CHECK (day_index BETWEEN 0 AND 7),
      position INTEGER NOT NULL CHECK (position BETWEEN 1 AND 5),
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      round INTEGER NOT NULL CHECK (round >= 1),
      score_snapshot INTEGER NOT NULL CHECK (score_snapshot >= 0),
      rank_snapshot INTEGER NOT NULL CHECK (rank_snapshot >= 1),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (week_id, day_index, position)
    );

    CREATE TABLE IF NOT EXISTS package_deduction_applications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      week_id INTEGER NOT NULL REFERENCES weeks(id) ON DELETE CASCADE,
      day_index INTEGER NOT NULL CHECK (day_index BETWEEN 0 AND 7),
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      amount INTEGER NOT NULL CHECK (amount > 0),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (week_id, day_index, user_id)
    );

    CREATE TABLE IF NOT EXISTS package_deduction_rollovers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_week_id INTEGER NOT NULL REFERENCES weeks(id) ON DELETE CASCADE,
      target_week_id INTEGER REFERENCES weeks(id) ON DELETE SET NULL,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      amount INTEGER NOT NULL CHECK (amount > 0),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (source_week_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS score_change_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_id TEXT NOT NULL,
      week_id INTEGER NOT NULL REFERENCES weeks(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      previous_score INTEGER NOT NULL CHECK (previous_score >= 0),
      new_score INTEGER NOT NULL CHECK (new_score >= 0),
      delta INTEGER NOT NULL,
      source TEXT NOT NULL CHECK (source IN ('manual', 'import')),
      actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (request_id, user_id, source)
    );

    CREATE TABLE IF NOT EXISTS login_attempts (
      username TEXT PRIMARY KEY,
      failed_count INTEGER NOT NULL DEFAULT 0,
      last_failed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      locked_until TEXT
    );

    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_scores_week ON weekly_scores(week_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token_hash);
    CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);
    CREATE INDEX IF NOT EXISTS idx_deduction_events_user ON package_deduction_events(user_id);
    CREATE INDEX IF NOT EXISTS idx_deduction_corrections_user ON package_deduction_corrections(user_id);
    CREATE INDEX IF NOT EXISTS idx_package_day_status_week ON package_day_statuses(week_id, day_index);
    CREATE INDEX IF NOT EXISTS idx_package_assignments_week ON package_assignments(week_id, day_index);
    CREATE INDEX IF NOT EXISTS idx_deduction_applications_week ON package_deduction_applications(week_id, day_index);
    CREATE INDEX IF NOT EXISTS idx_deduction_rollovers_target ON package_deduction_rollovers(target_week_id);
    CREATE INDEX IF NOT EXISTS idx_score_change_user ON score_change_events(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_score_change_week ON score_change_events(week_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_users_active ON users(is_active);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_nocase ON users(username COLLATE NOCASE);
  `);

  database.transaction(() => {
    const userColumns = database.pragma("table_info(users)") as Array<{ name: string }>;
    if (!userColumns.some((column) => column.name === "roster_order")) {
      database.exec("ALTER TABLE users ADD COLUMN roster_order INTEGER");
    }
    if (!userColumns.some((column) => column.name === "package_deduction_total")) {
      database.exec(`
        ALTER TABLE users
        ADD COLUMN package_deduction_total INTEGER NOT NULL DEFAULT 0 CHECK (package_deduction_total >= 0)
      `);
    }
    if (!userColumns.some((column) => column.name === "package_deduction_pending")) {
      database.exec(`
        ALTER TABLE users
        ADD COLUMN package_deduction_pending INTEGER NOT NULL DEFAULT 0 CHECK (package_deduction_pending >= 0)
      `);
    }
    if (!userColumns.some((column) => column.name === "account_type")) {
      database.exec(`
        ALTER TABLE users
        ADD COLUMN account_type TEXT NOT NULL DEFAULT 'member' CHECK (account_type IN ('member', 'guest'))
      `);
    }
    if (!userColumns.some((column) => column.name === "deleted_at")) {
      database.exec("ALTER TABLE users ADD COLUMN deleted_at TEXT");
    }

    const scoreColumns = database.pragma("table_info(weekly_scores)") as Array<{ name: string }>;
    if (!scoreColumns.some((column) => column.name === "package_deductions")) {
      database.exec(`
        ALTER TABLE weekly_scores
        ADD COLUMN package_deductions INTEGER NOT NULL DEFAULT 0 CHECK (package_deductions >= 0)
      `);
    }

    const packageStatusColumns = database.pragma("table_info(package_day_statuses)") as Array<{ name: string }>;
    if (!packageStatusColumns.some((column) => column.name === "confirmation_source")) {
      database.exec(`
        ALTER TABLE package_day_statuses
        ADD COLUMN confirmation_source TEXT NOT NULL DEFAULT 'manual'
          CHECK (confirmation_source IN ('manual', 'automatic'))
      `);
    }

    database.prepare(`
      DELETE FROM sessions
      WHERE user_id IN (
        SELECT id FROM users WHERE account_type = 'guest' AND must_change_password != 0
      )
    `).run();
    database.prepare(`
      UPDATE users SET must_change_password = 0, updated_at = CURRENT_TIMESTAMP
      WHERE account_type = 'guest' AND must_change_password != 0
    `).run();
  }).immediate();

  database.exec("CREATE INDEX IF NOT EXISTS idx_users_account_active ON users(account_type, is_active)");
  database.exec("CREATE INDEX IF NOT EXISTS idx_users_deleted ON users(deleted_at)");

  migratePermanentPackageDeductions(database);

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
        const passwordHash = hashSync(getSeedInitialPassword(), {
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

  backfillMissingPackageSnapshots(database);

  return database;
}

const memberIds = new Map<string, number>();

export function getDb() {
  if (!globalDatabase.__fortressDatabase) {
    globalDatabase.__fortressDatabase = createDatabase();
  }
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit"
  }).format(new Date());
  const currentMinute = Math.floor(Date.now() / 60_000);
  let autoConfirmReady = true;
  if (globalDatabase.__fortressAutoConfirmMinute !== currentMinute) {
    try {
      autoConfirmDuePackageDays(globalDatabase.__fortressDatabase, new Date());
      globalDatabase.__fortressAutoConfirmMinute = currentMinute;
    } catch (error) {
      autoConfirmReady = false;
      console.error("Package auto-confirm check failed", error);
    }
  }
  if (autoConfirmReady && globalDatabase.__fortressRolloverDate !== today) {
    rolloverExpiredPackageDeductions(globalDatabase.__fortressDatabase, today);
    globalDatabase.__fortressRolloverDate = today;
  }
  return globalDatabase.__fortressDatabase;
}

export function closeDbForTests() {
  globalDatabase.__fortressDatabase?.close();
  delete globalDatabase.__fortressDatabase;
  delete globalDatabase.__fortressRolloverDate;
  delete globalDatabase.__fortressAutoConfirmMinute;
}
