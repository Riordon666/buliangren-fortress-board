import type Database from "better-sqlite3";

export function recordScoreChange(
  database: Database.Database,
  input: {
    requestId: string;
    weekId: number;
    userId: number;
    previousScore: number;
    newScore: number;
    source: "manual" | "import";
    actorUserId: number;
  }
) {
  if (input.previousScore === input.newScore) return false;
  const result = database.prepare(`
    INSERT OR IGNORE INTO score_change_events (
      request_id, week_id, user_id, previous_score, new_score, delta, source, actor_user_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.requestId,
    input.weekId,
    input.userId,
    input.previousScore,
    input.newScore,
    input.newScore - input.previousScore,
    input.source,
    input.actorUserId
  );
  return result.changes === 1;
}
