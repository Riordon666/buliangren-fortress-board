import type Database from "better-sqlite3";

function addDays(date: string, offset: number) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + offset)).toISOString().slice(0, 10);
}

export type DeductionSkip = { userId: number; dayIndex: number; round: number };

export function recordDeductionApplications(
  database: Database.Database,
  weekId: number,
  dayIndex: number,
  skips: DeductionSkip[]
) {
  const amounts = new Map<number, number>();
  for (const skip of skips) {
    if (skip.dayIndex === dayIndex) amounts.set(skip.userId, (amounts.get(skip.userId) || 0) + 1);
  }
  const insert = database.prepare(`
    INSERT OR IGNORE INTO package_deduction_applications (week_id, day_index, user_id, amount)
    VALUES (?, ?, ?, ?)
  `);
  const scheduled = database.prepare(`
    SELECT package_deductions AS amount FROM weekly_scores
    WHERE week_id = ? AND user_id = ?
  `);
  const applied = database.prepare(`
    SELECT COALESCE(SUM(amount), 0) AS amount FROM package_deduction_applications
    WHERE week_id = ? AND user_id = ?
  `);
  for (const [userId, amount] of amounts) {
    const scheduledAmount = (scheduled.get(weekId, userId) as { amount: number } | undefined)?.amount || 0;
    const appliedAmount = (applied.get(weekId, userId) as { amount: number }).amount;
    const remaining = Math.max(0, scheduledAmount - appliedAmount);
    if (remaining > 0) insert.run(weekId, dayIndex, userId, Math.min(amount, remaining));
  }
}

export function rolloverExpiredPackageDeductions(database: Database.Database, today: string) {
  const expiredWeeks = database.prepare(`
    SELECT id, event_date AS eventDate FROM weeks
    WHERE event_date < ?
    ORDER BY event_date ASC, id ASC
  `).all(today) as Array<{ id: number; eventDate: string }>;
  const findNextWeek = database.prepare(`
    SELECT id FROM weeks WHERE event_date > ? ORDER BY event_date ASC, id ASC LIMIT 1
  `);
  const outstandingRows = database.prepare(`
    SELECT ws.user_id AS userId,
      MAX(0, ws.package_deductions - COALESCE((
        SELECT SUM(a.amount) FROM package_deduction_applications a
        WHERE a.week_id = ws.week_id AND a.user_id = ws.user_id
      ), 0)) AS amount
    FROM weekly_scores ws
    JOIN users u ON u.id = ws.user_id
    WHERE ws.week_id = ? AND ws.package_deductions > 0
      AND u.deleted_at IS NULL AND u.is_active = 1 AND u.account_type = 'member'
      AND NOT EXISTS (
        SELECT 1 FROM package_deduction_rollovers r
        WHERE r.source_week_id = ws.week_id AND r.user_id = ws.user_id
      )
  `);
  const insertRollover = database.prepare(`
    INSERT OR IGNORE INTO package_deduction_rollovers (source_week_id, target_week_id, user_id, amount)
    VALUES (?, ?, ?, ?)
  `);
  const addScheduled = database.prepare(`
    INSERT INTO weekly_scores (week_id, user_id, score, package_deductions)
    VALUES (?, ?, 0, ?)
    ON CONFLICT(week_id, user_id) DO UPDATE SET
      package_deductions = weekly_scores.package_deductions + excluded.package_deductions,
      updated_at = CURRENT_TIMESTAMP
  `);
  const addPending = database.prepare(`
    UPDATE users SET package_deduction_pending = package_deduction_pending + ?,
      updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `);

  database.transaction(() => {
    for (const week of expiredWeeks) {
      if (addDays(week.eventDate, 7) >= today) continue;
      const target = findNextWeek.get(week.eventDate) as { id: number } | undefined;
      const rows = outstandingRows.all(week.id) as Array<{ userId: number; amount: number }>;
      for (const row of rows) {
        if (row.amount <= 0) continue;
        const inserted = insertRollover.run(week.id, target?.id || null, row.userId, row.amount);
        if (!inserted.changes) continue;
        if (target) addScheduled.run(target.id, row.userId, row.amount);
        else addPending.run(row.amount, row.userId);
      }
    }
  }).immediate();
}
