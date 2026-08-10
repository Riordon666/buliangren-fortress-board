import { ArrowUpRight, CalendarCheck2, Download, Medal, ScrollText, Target, TrendingUp, Trophy, UsersRound } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { WeekPicker } from "@/components/week-picker";
import { getCurrentWeek, getPackageDayStatuses, getScoreOverview, getScoreRows, getWeekById, getWeeks } from "@/lib/data";
import { getWeeklyHighlights } from "@/lib/insights";

export const metadata = { title: "每周战报" };

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  const params = await searchParams;
  const weeks = getWeeks();
  const requestedId = Number(params.week);
  const week = Number.isInteger(requestedId) ? getWeekById(requestedId) : getCurrentWeek();
  if (!week) return <div className="empty-state">还没有可生成的战报。</div>;
  const rows = getScoreRows(week.id);
  const previousWeek = [...weeks].filter((item) => item.eventDate < week.eventDate).sort((a, b) => b.eventDate.localeCompare(a.eventDate))[0];
  const previousRows = previousWeek ? getScoreRows(previousWeek.id) : [];
  const overview = getScoreOverview(rows);
  const highlights = getWeeklyHighlights(rows, previousRows);
  const sentDays = getPackageDayStatuses(week.id).length;
  return (
    <div className="page-stack reports-page">
      <header className="page-hero"><div><span className="eyebrow"><ScrollText size={13} /> WEEKLY REPORT</span><h1>每周战报</h1><p>提炼本周关键表现，生成可以直接分享到组织群的战报图。</p></div><WeekPicker weeks={weeks} selectedId={week.id} basePath="/reports" /></header>
      <section className="stat-grid">
        <article className="stat-card orange"><span className="stat-icon"><Trophy size={20} /></span><div><small>组织总分</small><strong>{overview.totalScore}</strong><span>{week.title}</span></div></article>
        <article className="stat-card green"><span className="stat-icon"><UsersRound size={20} /></span><div><small>参战成员</small><strong>{overview.participants}</strong><span>全员 {rows.length} 人</span></div></article>
        <article className="stat-card gold"><span className="stat-icon"><Target size={20} /></span><div><small>60分达标</small><strong>{highlights.laterRoundCount}</strong><span>40分达标 {highlights.firstRoundCount} 人</span></div></article>
        <article className="stat-card ink"><span className="stat-icon"><CalendarCheck2 size={20} /></span><div><small>已发包天数</small><strong>{sentDays}<em> / 8</em></strong><span>状态由管理员确认</span></div></article>
      </section>
      <section className="report-main-grid">
        <article className="panel report-highlights"><div className="panel-heading"><div><span className="eyebrow">HIGHLIGHTS</span><h2>本周亮点</h2></div></div>
          <div className="highlight-list">
            {highlights.leader && <div><Medal size={20} /><span><small>本周榜首</small><strong>{highlights.leader.displayName}</strong></span><b>{highlights.leader.score} 分</b></div>}
            {highlights.mostImproved && <div><TrendingUp size={20} /><span><small>进步最多</small><strong>{highlights.mostImproved.row.displayName}</strong></span><b>+{highlights.mostImproved.scoreDelta} 分</b></div>}
            {highlights.rankRiser && <div><ArrowUpRight size={20} /><span><small>排名跃升</small><strong>{highlights.rankRiser.row.displayName}</strong></span><b>上升 {highlights.rankRiser.rankRise} 位</b></div>}
            {!highlights.mostImproved && <div><Target size={20} /><span><small>发包资格</small><strong>第一轮 {highlights.firstRoundCount} 人</strong></span><b>后续 {highlights.laterRoundCount} 人</b></div>}
            {!highlights.rankRiser && <div><UsersRound size={20} /><span><small>本周参战</small><strong>{overview.participants} 名成员有分数</strong></span><b>{rows.length ? Math.round(overview.participants / rows.length * 100) : 0}%</b></div>}
          </div>
        </article>
        <article className="panel report-top"><div className="panel-heading"><div><span className="eyebrow">TOP FIVE</span><h2>本周前五</h2></div></div>
          <div className="report-top-list">{rows.slice(0, 5).map((row) => <div key={row.userId}><span>#{row.rank}</span><Avatar name={row.displayName} src={row.avatarUrl} size={36} /><strong>{row.displayName}</strong><b>{row.score}</b></div>)}</div>
        </article>
      </section>
      <section className="panel share-report"><div><span className="eyebrow">SHARE CARD</span><h2>生成组织群战报图</h2><p>自动排版本周总分、达标人数、榜首和前五名，下载后即可分享。</p></div><a className="primary-button" href={`/api/reports/${week.id}/image`} download><Download size={17} /> 下载本周战报图</a></section>
    </div>
  );
}
