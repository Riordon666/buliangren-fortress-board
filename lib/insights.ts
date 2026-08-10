import type { ScoreRow, TrendPoint } from "@/lib/types";

export type Achievement = {
  id: string;
  label: string;
  description: string;
  tone: "orange" | "green" | "gold" | "ink";
};

export function getAchievements(current: ScoreRow | undefined, trend: TrendPoint[], rounds: number[] = []): Achievement[] {
  if (!current) return [];
  const previous = trend.at(-2);
  const recent = trend.slice(-3);
  const achievements: Achievement[] = [];
  if (current.rank === 1) achievements.push({ id: "leader", label: "本周榜首", description: "本期要塞贡献排名第一", tone: "gold" });
  if (current.score >= 100) achievements.push({ id: "century", label: "百分忍者", description: "单周战绩突破 100 分", tone: "orange" });
  if (current.score >= 60) achievements.push({ id: "core", label: "要塞中坚", description: "达到后续轮次发包线", tone: "green" });
  if (previous && current.score - previous.score >= 20) achievements.push({ id: "rising", label: "进步之星", description: `较上周提升 ${current.score - previous.score} 分`, tone: "orange" });
  if (recent.length === 3 && recent.every((point) => point.score >= 60)) achievements.push({ id: "steady", label: "稳定发挥", description: "连续三周达到 60 分", tone: "ink" });
  if (trend.filter((point) => point.score > 0).length >= 4) achievements.push({ id: "veteran", label: "持续出战", description: "已有至少四周战绩记录", tone: "green" });
  if (rounds.some((round) => round >= 2)) achievements.push({ id: "rotation", label: "轮次达人", description: `本期最高排到第 ${Math.max(...rounds)} 轮`, tone: "gold" });
  return achievements.slice(0, 4);
}

export function getWeeklyHighlights(rows: ScoreRow[], previousRows: ScoreRow[]) {
  const previousByUser = new Map(previousRows.map((row) => [row.userId, row]));
  const changed = rows.map((row) => {
    const previous = previousByUser.get(row.userId);
    return {
      row,
      scoreDelta: previous ? row.score - previous.score : null,
      rankRise: previous ? previous.rank - row.rank : null
    };
  });
  const comparable = changed.filter((item): item is typeof item & { scoreDelta: number; rankRise: number } => item.scoreDelta !== null && item.rankRise !== null);
  const mostImproved = [...comparable].sort((a, b) => b.scoreDelta - a.scoreDelta || a.row.rank - b.row.rank)[0];
  const rankRiser = [...comparable].sort((a, b) => b.rankRise - a.rankRise || a.row.rank - b.row.rank)[0];
  return {
    leader: rows[0] || null,
    mostImproved: mostImproved?.scoreDelta > 0 ? mostImproved : null,
    rankRiser: rankRiser?.rankRise > 0 ? rankRiser : null,
    firstRoundCount: rows.filter((row) => row.score >= 40).length,
    laterRoundCount: rows.filter((row) => row.score >= 60).length
  };
}
