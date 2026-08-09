import Database from "better-sqlite3";

type PackageDeductionEvent = {
  requestId: string;
  sourceWeekId: number;
  effectiveWeekId: number | null;
  userId: number;
  amount: number;
  createdBy: number;
};

export function recordPackageDeduction(database: Database.Database, event: PackageDeductionEvent) {
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
