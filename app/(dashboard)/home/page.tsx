import Link from "next/link";
import { ArrowRight, Award, CalendarClock, CheckCircle2, Gauge, Gift, Sparkles, Target, TrendingUp } from "lucide-react";
import { requireReadyUser } from "@/lib/auth";
import { Avatar } from "@/components/avatar";
import { getActivePackageWeeks, getCurrentWeek, getMemberTrend, getPackageAssignmentSnapshots, getPackageDayStatuses, getPackageDeductionRows, getPackagePlanRows, getShanghaiDate } from "@/lib/data";
import { getAchievements } from "@/lib/insights";
import { generatePackagePlan, getPackageRoundsByMember } from "@/lib/package-plan";
import { mergePackagePlanDays, snapshotsToAssignments } from "@/lib/package-snapshots";

export const metadata = { title: "我的作战室" };

export default async function HomePage() {
  const user = await requireReadyUser();
  const isGuest = user.accountType === "guest";
  const week = getCurrentWeek();
  if (!week) return <div className="empty-state">还没有创建统计周。</div>;
  const rows = getPackagePlanRows(week.id);
  const current = rows.find((row) => row.userId === user.id);
  const plan = generatePackagePlan(rows, week.eventDate, getPackageDeductionRows(week.id));
  const currentStatuses = getPackageDayStatuses(week.id);
  const displayedPlanDays = mergePackagePlanDays(
    plan.days,
    getPackageAssignmentSnapshots(week.id),
    currentStatuses.map((status) => status.dayIndex)
  );
  const trend = getMemberTrend(user.id);
  const previous = trend.at(-2);
  const scoreDelta = current && previous ? current.score - previous.score : null;
  const rounds = getPackageRoundsByMember(displayedPlanDays.flatMap((day) => day.assignments)).get(user.id) || [];
  const achievements = getAchievements(current, trend, rounds);
  const today = getShanghaiDate();
  const todayCycles = getActivePackageWeeks(today).map((cycle) => {
    const cyclePlan = generatePackagePlan(getPackagePlanRows(cycle.id), cycle.eventDate, getPackageDeductionRows(cycle.id));
    const day = cyclePlan.days.find((item) => item.date === today)!;
    const status = getPackageDayStatuses(cycle.id).find((item) => item.dayIndex === day.dayIndex);
    const snapshots = status ? getPackageAssignmentSnapshots(cycle.id).filter((item) => item.dayIndex === day.dayIndex) : [];
    const assignments = status ? snapshotsToAssignments(snapshots) : day.assignments;
    return { cycle, day: { ...day, assignments }, status, assignment: assignments.find((item) => item.member.userId === user.id) };
  });
  const todayAssignment = todayCycles.find((cycle) => cycle.cycle.id === week.id)?.assignment;
  const nextAssignment = displayedPlanDays.flatMap((day) => day.assignments.map((assignment) => ({ day, assignment })))
    .find((item) => item.assignment.member.userId === user.id && item.day.date >= today);
  const target = isGuest ? null : !current || current.score < 40 ? 40 : current.score < 60 ? 60 : null;
  const progress = target && current ? Math.min(100, Math.round(current.score / target * 100)) : 100;

  return (
    <div className="page-stack home-page">
      <header className="page-hero home-hero">
        <div><span className="eyebrow"><Sparkles size={13} /> MY WAR ROOM</span><h1>{user.displayName}，今日作战简报</h1><p>{isGuest ? `${week.title} · 当前为游客浏览模式，不参与积分排名和发包。` : `${week.title} · 你的分数、排名和发包安排都在这里。`}</p></div>
        <Avatar name={user.displayName} src={user.avatarUrl} size={72} />
      </header>

      <section className="home-focus-grid">
        <article className="panel today-package-panel">
          <div className="panel-heading"><div><span className="eyebrow">TODAY PACKAGE</span><h2>今日发包提醒</h2></div>{todayCycles.length === 1 && <span className={`send-status ${todayCycles[0].status ? "sent" : "pending"}`}>{todayCycles[0].status ? "已发包" : "暂未发包"}</span>}</div>
          {todayCycles.length > 1 && <div className="home-overlap-list">{todayCycles.map((item) => <Link key={item.cycle.id} href={`/packages?week=${item.cycle.id}#today-package`}><strong>{item.cycle.title}</strong><span>{item.status ? "已发包" : "暂未发包"} · {item.assignment ? `你在第${item.assignment.position}位` : "今日名单无你"}</span></Link>)}</div>}
          {!todayCycles.length ? <div className="compact-empty">今天不在已发布统计周的8天发包周期内。</div> : todayCycles.length === 1 && todayAssignment ? (
            <div className="today-personal-assignment"><CheckCircle2 size={32} /><div><strong>今天有你的包</strong><span>第 {todayAssignment.round} 轮 · 今日第 {todayAssignment.position} 位</span></div></div>
          ) : todayCycles.length === 1 ? <div className="compact-empty">{isGuest ? "游客账号不参与发包，可进入发包安排查看今日完整名单。" : <>今天的名单里没有你。{nextAssignment ? `下次安排在 ${nextAssignment.day.date}（第 ${nextAssignment.assignment.round} 轮）。` : "本期暂无后续安排。"}</>}</div> : null}
          <Link className="text-link" href="/packages#today-package">查看今天完整名单 <ArrowRight size={15} /></Link>
        </article>

        <article className="panel target-panel">
          <div className="panel-heading"><div><span className="eyebrow">NEXT TARGET</span><h2>下一目标</h2></div><Target size={25} /></div>
          {isGuest ? <div className="guest-mode-note"><strong>游客浏览模式</strong><span>你可以查看全组积分、战报和发包状态，但不会出现在排名与发包名单中。</span></div> : target ? <><strong className="target-copy">距离 {target} 分线还差 <b>{Math.max(0, target - (current?.score || 0))}</b> 分</strong><div className="target-progress"><i style={{ width: `${progress}%` }} /></div><small>{target === 40 ? "达到第一轮发包资格" : "达到第二轮起发包资格"}</small></> : <><strong className="target-copy">已达到后续轮次资格线</strong><div className="target-progress"><i style={{ width: "100%" }} /></div><small>保持活跃，继续冲击更高排名。</small></>}
        </article>
      </section>

      <section className="stat-grid home-stats">
        <article className="stat-card orange"><span className="stat-icon"><Gauge size={20} /></span><div><small>{isGuest ? "账号身份" : "本周分数"}</small><strong>{isGuest ? "游客" : current?.score ?? 0}</strong><span>{isGuest ? "不计入组织积分" : scoreDelta == null ? "等待更多周次对比" : `${scoreDelta >= 0 ? "+" : ""}${scoreDelta} 较上周`}</span></div></article>
        <article className="stat-card green"><span className="stat-icon"><TrendingUp size={20} /></span><div><small>当前排名</small><strong>{current ? `#${current.rank}` : "—"}</strong><span>共 {rows.length} 名成员</span></div></article>
        <article className="stat-card gold"><span className="stat-icon"><Gift size={20} /></span><div><small>可获轮次</small><strong>{rounds.length}</strong><span>{rounds.length ? rounds.map((round) => `第${round}轮`).join(" · ") : "本期暂未排到"}</span></div></article>
        <article className="stat-card ink"><span className="stat-icon"><Award size={20} /></span><div><small>本期徽章</small><strong>{achievements.length}</strong><span>{achievements[0]?.label || "继续积累战绩"}</span></div></article>
      </section>

      <section className="panel achievement-panel">
        <div className="panel-heading"><div><span className="eyebrow">ACHIEVEMENTS</span><h2>本期成就</h2></div><Link className="text-link" href="/profile">查看历史 <ArrowRight size={15} /></Link></div>
        {achievements.length ? <div className="achievement-grid">{achievements.map((item) => <article key={item.id} className={`achievement ${item.tone}`}><Award size={22} /><div><strong>{item.label}</strong><span>{item.description}</span></div></article>)}</div> : <div className="compact-empty"><CalendarClock size={18} />{isGuest ? "游客账号不参与个人战绩与徽章统计。" : "本期继续积累战绩，达到 40 分即可解锁第一枚资格徽章。"}</div>}
      </section>
    </div>
  );
}
