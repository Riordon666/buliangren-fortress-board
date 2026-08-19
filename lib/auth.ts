import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { FORCE_PASSWORD_COOKIE, SESSION_TTL_DAYS } from "@/lib/constants";
import { getDb } from "@/lib/db";
import { verifyPassword } from "@/lib/password";
import type { AccountType, SessionUser } from "@/lib/types";

const isProduction = process.env.NODE_ENV === "production";
export const SESSION_COOKIE = isProduction ? "__Host-fortress_session" : "fortress_session";

type UserRecord = {
  id: number;
  username: string;
  displayName: string;
  passwordHash: string;
  avatarUrl: string | null;
  role: "admin" | "member";
  accountType: AccountType;
  note: string | null;
  isActive: number;
  mustChangePassword: number;
  lastSeenAt: string | null;
};

function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function toSessionUser(record: Omit<UserRecord, "passwordHash" | "isActive">): SessionUser {
  return {
    id: record.id,
    username: record.username,
    displayName: record.displayName,
    avatarUrl: record.avatarUrl,
    role: record.role,
    accountType: record.accountType,
    note: record.note,
    mustChangePassword: record.accountType !== "guest" && Boolean(record.mustChangePassword),
    lastSeenAt: record.lastSeenAt
  };
}

export async function authenticate(username: string, password: string, clientKey = "unknown") {
  const db = getDb();
  const normalizedUsername = username.trim();
  const attemptKey = `${normalizedUsername.normalize("NFKC").toLocaleLowerCase("zh-CN")}|${clientKey}`;
  db.prepare("DELETE FROM sessions WHERE datetime(expires_at) <= CURRENT_TIMESTAMP").run();
  db.prepare("DELETE FROM login_attempts WHERE datetime(last_failed_at) < datetime('now', '-30 days')").run();
  const attempts = db.prepare(`
    SELECT failed_count AS failedCount, locked_until AS lockedUntil
    FROM login_attempts WHERE username = ?
  `).get(attemptKey) as { failedCount: number; lockedUntil: string | null } | undefined;

  if (attempts?.lockedUntil && new Date(attempts.lockedUntil).getTime() > Date.now()) {
    return { ok: false as const, reason: "尝试次数过多，请15分钟后再试。" };
  }

  const user = db.prepare(`
    SELECT id, username, display_name AS displayName, password_hash AS passwordHash,
      avatar_url AS avatarUrl, role, account_type AS accountType, note, is_active AS isActive,
      must_change_password AS mustChangePassword, last_seen_at AS lastSeenAt
    FROM users WHERE username = ? COLLATE NOCASE AND deleted_at IS NULL
  `).get(normalizedUsername) as UserRecord | undefined;

  const valid = user && user.isActive ? await verifyPassword(user.passwordHash, password) : false;
  if (!user || !valid) {
    const nextFailedCount = (attempts?.failedCount || 0) + 1;
    const lockedUntil = nextFailedCount >= 5
      ? new Date(Date.now() + 15 * 60_000).toISOString()
      : null;
    db.prepare(`
      INSERT INTO login_attempts (username, failed_count, last_failed_at, locked_until)
      VALUES (?, ?, CURRENT_TIMESTAMP, ?)
      ON CONFLICT(username) DO UPDATE SET
        failed_count = excluded.failed_count,
        last_failed_at = CURRENT_TIMESTAMP,
        locked_until = excluded.locked_until
    `).run(attemptKey, nextFailedCount, lockedUntil);
    return { ok: false as const, reason: "账号或密码不正确。" };
  }

  db.prepare("DELETE FROM login_attempts WHERE username = ?").run(attemptKey);
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 86_400_000);
  db.prepare(`
    INSERT INTO sessions (user_id, token_hash, expires_at, last_seen_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
  `).run(user.id, tokenHash(token), expiresAt.toISOString());
  db.prepare("UPDATE users SET last_seen_at = CURRENT_TIMESTAMP WHERE id = ?").run(user.id);

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: "strict",
    path: "/",
    expires: expiresAt
  });
  if (user.accountType !== "guest" && user.mustChangePassword) {
    cookieStore.set(FORCE_PASSWORD_COOKIE, "1", {
      httpOnly: true,
      secure: isProduction,
      sameSite: "strict",
      path: "/",
      expires: expiresAt
    });
  } else {
    cookieStore.delete(FORCE_PASSWORD_COOKIE);
  }

  return { ok: true as const, user: toSessionUser(user) };
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const db = getDb();
  const user = db.prepare(`
    SELECT u.id, u.username, u.display_name AS displayName,
      u.avatar_url AS avatarUrl, u.role, u.account_type AS accountType, u.note,
      u.must_change_password AS mustChangePassword,
      u.last_seen_at AS lastSeenAt
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ?
      AND datetime(s.expires_at) > CURRENT_TIMESTAMP
      AND u.is_active = 1
      AND u.deleted_at IS NULL
  `).get(tokenHash(token)) as Omit<UserRecord, "passwordHash" | "isActive"> | undefined;

  return user ? toSessionUser(user) : null;
}

export async function requireUser() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireReadyUser() {
  const user = await requireUser();
  if (user.accountType !== "guest" && user.mustChangePassword) redirect("/profile?required=1");
  return user;
}

export async function requireAdmin() {
  const user = await requireUser();
  if (user.accountType !== "guest" && user.mustChangePassword) redirect("/profile?required=1");
  if (user.role !== "admin") redirect("/scores");
  return user;
}

export async function destroyCurrentSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (token) {
    getDb().prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash(token));
  }
  cookieStore.delete(SESSION_COOKIE);
  cookieStore.delete(FORCE_PASSWORD_COOKIE);
}

export async function touchCurrentSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return false;

  const db = getDb();
  const session = db.prepare(`
    SELECT user_id AS userId FROM sessions
    WHERE token_hash = ? AND datetime(expires_at) > CURRENT_TIMESTAMP
  `).get(tokenHash(token)) as { userId: number } | undefined;
  if (!session) return false;

  const updated = db.prepare(`
    UPDATE sessions SET last_seen_at = CURRENT_TIMESTAMP
    WHERE token_hash = ? AND datetime(last_seen_at) < datetime('now', '-45 seconds')
  `).run(tokenHash(token));
  if (updated.changes) {
    db.prepare("UPDATE users SET last_seen_at = CURRENT_TIMESTAMP WHERE id = ?").run(session.userId);
  }
  return true;
}

export function revokeUserSessions(userId: number) {
  getDb().prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
}

export function writeAuditLog(actorUserId: number, action: string, targetUserId?: number, details?: unknown) {
  getDb().prepare(`
    INSERT INTO audit_logs (actor_user_id, action, target_user_id, details)
    VALUES (?, ?, ?, ?)
  `).run(actorUserId, action, targetUserId || null, details ? JSON.stringify(details) : null);
}
