import Database from "better-sqlite3";

type PackageDeductionEvent = {
  requestId: string;
  sourceWeekId: number;
  effectiveWeekId: number | null;
  userId: number;
  amount: number;
  createdBy: number;
};

type PackageDeductionCorrection = {
  requestId: string;
  sourceWeekId: number;
  preferredWeekId: number | null;
  userId: number;
  amount: number;
  createdBy: number;
};

export function recordPackageDeduction(database: Database.Database, event: PackageDeductionEvent) {
  const member = database.prepare("SELECT id FROM users WHERE id = ? AND account_type = 'member'")
    .get(event.userId);
  if (!member) return false;
  const inserted = database.prepare(`
    INSERT OR IGNORE INTO package_deduction_events
      (request_id, source_week_id, effective_week_id, user_id, amount, created_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    event.requestId,
    event.sourceWeekId,
    event.effectiveWeekId,
    event.userId,
    event.amount,
    event.createdBy
  );
  if (!inserted.changes) return false;

  database.prepare(`
    UPDATE users SET package_deduction_total = package_deduction_total + ?,
      updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `).run(event.amount, event.userId);

  if (event.effectiveWeekId) {
    database.prepare(`
      INSERT INTO weekly_scores (week_id, user_id, score, package_deductions)
      VALUES (?, ?, 0, ?)
      ON CONFLICT(week_id, user_id) DO UPDATE SET
        package_deductions = weekly_scores.package_deductions + excluded.package_deductions,
        updated_at = CURRENT_TIMESTAMP
    `).run(event.effectiveWeekId, event.userId, event.amount);
  } else {
    database.prepare(`
      UPDATE users SET package_deduction_pending = package_deduction_pending + ?,
        updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(event.amount, event.userId);
  }

  return true;
}

export function recordPackageDeductionCorrection(
  database: Database.Database,
  correction: PackageDeductionCorrection
) {
  const current = database.prepare(`
    SELECT package_deduction_total AS total, package_deduction_pending AS pending
    FROM users WHERE id = ? AND account_type = 'member'
  `).get(correction.userId) as { total: number; pending: number } | undefined;
  const amount = Math.min(correction.amount, current?.total || 0);
  if (amount <= 0) return 0;

  const existing = database.prepare(`
    SELECT amount FROM package_deduction_corrections
    WHERE request_id = ? AND user_id = ?
  `).get(correction.requestId, correction.userId);
  if (existing) return 0;

  let remaining = amount;
  let scheduledRemoved = 0;
  let pendingRemoved = 0;

  if (correction.preferredWeekId) {
    const scheduled = database.prepare(`
      SELECT ws.package_deductions AS amount,
        COALESCE((
          SELECT SUM(application.amount)
          FROM package_deduction_applications application
          WHERE application.week_id = ws.week_id AND application.user_id = ws.user_id
        ), 0) AS applied
      FROM weekly_scores ws
      WHERE ws.week_id = ? AND ws.user_id = ?
    `).get(correction.preferredWeekId, correction.userId) as { amount: number; applied: number } | undefined;
    scheduledRemoved = Math.min(remaining, Math.max(0, (scheduled?.amount || 0) - (scheduled?.applied || 0)));
    remaining -= scheduledRemoved;
  }

  pendingRemoved = Math.min(remaining, current?.pending || 0);

  const inserted = database.prepare(`
    INSERT OR IGNORE INTO package_deduction_corrections
      (request_id, source_week_id, preferred_week_id, user_id, amount,
       scheduled_removed, pending_removed, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    correction.requestId,
    correction.sourceWeekId,
    correction.preferredWeekId,
    correction.userId,
    amount,
    scheduledRemoved,
    pendingRemoved,
    correction.createdBy
  );
  if (!inserted.changes) return 0;

  if (scheduledRemoved > 0 && correction.preferredWeekId) {
    database.prepare(`
      UPDATE weekly_scores
      SET package_deductions = package_deductions - ?, updated_at = CURRENT_TIMESTAMP
      WHERE week_id = ? AND user_id = ?
    `).run(scheduledRemoved, correction.preferredWeekId, correction.userId);
  }
  if (pendingRemoved > 0) {
    database.prepare(`
      UPDATE users SET package_deduction_pending = package_deduction_pending - ?,
        updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(pendingRemoved, correction.userId);
  }
  database.prepare(`
    UPDATE users SET package_deduction_total = package_deduction_total - ?,
      updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `).run(amount, correction.userId);
  return amount;
}
