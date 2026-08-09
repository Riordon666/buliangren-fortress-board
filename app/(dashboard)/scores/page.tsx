import { Award, Flame, Gauge, ScrollText, Target, Trophy } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { ScoreVisualizations } from "@/components/score-visualizations";
import { WeekPicker } from "@/components/week-picker";
import { getLatestWeek, getScoreOverview, getScoreRows, getWeekById, getWeeks } from "@/lib/data";
import { generatePackagePlan, getPackageRoundsByMember } from "@/lib/package-plan";

export const metadata = { title: "要塞分数统计" };

export default async function ScoresPage({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  const params = await searchParams;
  const weeks = getWeeks();
  const requestedId = Number(params.week);
  const selectedWeek = Number.isInteger(requestedId) ? getWeekById(requestedId) : getLatestWeek();
  if (!selectedWeek) {
    return <div className="empty-state">还没有创建统计周。</div>;
  }
  const rows = getScoreRows(selectedWeek.id);
  const packagePlan = generatePackagePlan(rows, selectedWeek.eventDate);
  const packageRounds = getPackageRoundsByMember(packagePlan.assignments);
  const packageRoundsByUser = Object.fromEntries(packageRounds);
  const overview = getScoreOverview(rows);
  const topThree = rows.slice(0, 3);

  return (
    <div className="page-stack scores-page">
      <header className="page-hero">
        <div>
          <span className="eyebrow"><Flame size={13} /> FORTRESS SCOREBOARD</span>
          <h1>要塞分数统计</h1>
          <p>每一次出战都算数。追踪本周贡献，见证不良人共同攀升。</p>
        </div>
        <WeekPicker weeks={weeks} selectedId={selectedWeek.id} />
      </header>

      <section className="stat-grid">
        <article className="stat-card orange">
          <span className="stat-icon"><Flame size={20} /></span>
          <div><small>本期总分</small><strong>{overview.totalScore.toLocaleString()}</strong><span>组织累计贡献</span></div>
        </article>
        <article className="stat-card green">
          <span className="stat-icon"><Target size={20} /></span>
          <div><small>参战成员</small><strong>{overview.participants}<em> / {rows.length}</em></strong><span>得分大于 0</span></div>
        </article>
        <article className="stat-card gold">
          <span className="stat-icon"><Gauge size={20} /></span>
          <div><small>参战均分</small><strong>{overview.average}</strong><span>不计 0 分成员</span></div>
        </article>
        <article className="stat-card ink">
          <span className="stat-icon"><Trophy size={20} /></span>
          <div><small>最高战绩</small><strong>{overview.topScore}</strong><span>{rows[0]?.displayName || "暂无"}</span></div>
        </article>
      </section>

      <section className="score-leaders">
        <div className="leaders-copy">
          <span className="eyebrow"><Award size={13} /> 本期锋芒</span>
          <h2>要塞三杰</h2>
          <p>本期分数前三名，以行动点燃组织士气。</p>
        </div>
        <div className="podium-list">
          {topThree.map((row, index) => (
            <article key={row.userId} className={`podium-item place-${index + 1}`}>
              <span className="podium-rank">0{index + 1}</span>
              <Avatar name={row.displayName} src={row.avatarUrl} size={52} />
              <div><strong>{row.displayName}</strong><span>{row.note || "组织成员"}</span></div>
              <b>{row.score}<small> 分</small></b>
            </article>
          ))}
        </div>
      </section>

      <ScoreVisualizations rows={rows} packageRoundsByUser={packageRoundsByUser} />

      <section className="panel score-table-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow"><ScrollText size={13} /> WEEKLY RECORD</span>
            <h2>本期完整战绩</h2>
            <p>{selectedWeek.title} · {selectedWeek.eventDate}</p>
          </div>
          <span className="record-count">共 {rows.length} 名组员</span>
        </div>
        <div className="table-scroll">
          <table className="score-table">
            <thead>
              <tr><th>排名</th><th>组员</th><th>分数</th><th>发包轮次</th><th>备注</th></tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const rounds = packageRounds.get(row.userId) || [];
                return (
                <tr key={row.userId} className={row.rank <= 3 ? `top-row rank-${row.rank}` : ""}>
                  <td><span className="rank-cell">{row.rank <= 3 && <Trophy size={15} />}#{String(row.rank).padStart(2, "0")}</span></td>
                  <td><span className="member-cell"><Avatar name={row.displayName} src={row.avatarUrl} size={34} /><strong>{row.displayName}</strong></span></td>
                  <td><strong className="score-value">{row.score}</strong></td>
                  <td>{rounds.length ? <span className="round-badge-list">{rounds.map((round) => <span key={round} className={`round-badge round-badge-${round}`}>第 {round} 轮</span>)}</span> : <span className="muted">本期未排到</span>}</td>
                  <td>{row.note ? <span className={`role-badge ${row.note === "首领" ? "leader" : ""}`}>{row.note}</span> : <span className="muted">—</span>}</td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
