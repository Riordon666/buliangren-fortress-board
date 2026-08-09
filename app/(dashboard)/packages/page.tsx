import { CalendarDays, CheckCircle2, CircleMinus, Gift, Layers3, ListOrdered, ShieldCheck, Sparkles, UsersRound } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { WeekPicker } from "@/components/week-picker";
import { getLatestWeek, getScoreRows, getWeekById, getWeeks } from "@/lib/data";
import {
  FIRST_ROUND_MIN_SCORE,
  LATER_ROUND_MIN_SCORE,
  PACKAGES_PER_DAY,
  generatePackagePlan
} from "@/lib/package-plan";

export const metadata = { title: "发包安排" };

export default async function PackagesPage({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  const params = await searchParams;
  const weeks = getWeeks();
  const requestedId = Number(params.week);
  const selectedWeek = Number.isInteger(requestedId) ? getWeekById(requestedId) : getLatestWeek();
  if (!selectedWeek) return <div className="empty-state">还没有可以生成发包安排的统计周。</div>;

  const rows = getScoreRows(selectedWeek.id);
  const plan = generatePackagePlan(rows, selectedWeek.eventDate);
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());

  return (
    <div className="page-stack packages-page">
      <header className="page-hero">
        <div>
          <span className="eyebrow"><Gift size={13} /> PACKAGE ROTATION</span>
          <h1>发包安排</h1>
          <p>按本期分数自动排出从周六到下周六的8天发包名单。</p>
        </div>
        <WeekPicker weeks={weeks} selectedId={selectedWeek.id} basePath="/packages" />
      </header>

      <section className="stat-grid package-stats">
        <article className="stat-card orange"><span className="stat-icon"><CalendarDays size={20} /></span><div><small>发包周期</small><strong>8<em> 天</em></strong><span>周六至下周六</span></div></article>
        <article className="stat-card green"><span className="stat-icon"><Gift size={20} /></span><div><small>每日名额</small><strong>{PACKAGES_PER_DAY}<em> 人</em></strong><span>共 {plan.totalSlots} 个位置</span></div></article>
        <article className="stat-card gold"><span className="stat-icon"><UsersRound size={20} /></span><div><small>第一轮资格</small><strong>{plan.firstRoundEligible}</strong><span>分数 ≥ {FIRST_ROUND_MIN_SCORE}</span></div></article>
        <article className="stat-card ink"><span className="stat-icon"><Layers3 size={20} /></span><div><small>第二轮资格</small><strong>{plan.laterRoundEligible}</strong><span>分数 ≥ {LATER_ROUND_MIN_SCORE}</span></div></article>
      </section>

      <section className="panel package-rules">
        <div className="package-rule-title"><span className="section-icon"><ShieldCheck size={19} /></span><div><span className="eyebrow">ROTATION RULES</span><h2>本期排包规则</h2></div></div>
        <div className="package-rule-list">
          <span><i>01</i>按分数从高到低依次发放</span>
          <span><i>02</i>第一轮仅限 40 分及以上</span>
          <span><i>03</i>第二轮起仅限 60 分及以上</span>
          <span><i>04</i>每轮结束后从榜首重新开始</span>
          <span><i>05</i>第一轮不扣包，第二轮起按记录逐次跳过</span>
        </div>
      </section>

      <section className="panel deduction-board">
        <header className="deduction-board-heading">
          <div className="package-rule-title">
            <span className="section-icon deduction-icon"><CircleMinus size={19} /></span>
            <div><span className="eyebrow">PACKAGE DEDUCTIONS</span><h2>本期扣包次数排行</h2></div>
          </div>
          <span className="deduction-summary"><ListOrdered size={15} />共设置 {plan.totalDeductions} 次 · 安排已应用 {plan.appliedDeductionCount} 次</span>
        </header>
        {plan.deductionRanking.length ? (
          <div className="deduction-ranking">
            {plan.deductionRanking.map((item) => (
              <article key={item.member.userId} className="deduction-rank-item">
                <span className="deduction-rank">#{String(item.rank).padStart(2, "0")}</span>
                <Avatar name={item.member.displayName} src={item.member.avatarUrl} size={40} />
                <div>
                  <strong>{item.member.displayName}</strong>
                  <small>{item.member.score} 分 · 安排已跳过 {item.applied} 次{item.applied < item.count ? ` · 尚余 ${item.count - item.applied} 次` : ""}</small>
                </div>
                <b>扣 {item.count} 次</b>
              </article>
            ))}
          </div>
        ) : (
          <div className="deduction-empty"><ShieldCheck size={18} />本期暂无扣包记录，所有符合条件的成员按正常顺序轮转。</div>
        )}
      </section>

      <section className="package-days-grid">
        {plan.days.map((day) => (
          <article key={day.date} className={`panel package-day-card ${day.date === today ? "today" : ""}`}>
            <header>
              <div><span>第 {day.dayIndex + 1} 天</span><h2>{day.weekday}</h2><small>{day.date}</small></div>
              {day.date === today ? <b><Sparkles size={13} /> 今天</b> : <b>{day.assignments.length}/{PACKAGES_PER_DAY}</b>}
            </header>
            <div className="package-member-list">
              {Array.from({ length: PACKAGES_PER_DAY }, (_, index) => {
                const assignment = day.assignments[index];
                return assignment ? (
                  <div key={`${assignment.member.userId}-${assignment.round}`} className="package-member">
                    <span className="package-position">{assignment.position}</span>
                    <Avatar name={assignment.member.displayName} src={assignment.member.avatarUrl} size={38} />
                    <div><strong>{assignment.member.displayName}</strong><small>排名 #{assignment.member.rank} · {assignment.member.score} 分</small></div>
                    <span className={`round-chip round-${assignment.round}`}><CheckCircle2 size={12} />第 {assignment.round} 轮</span>
                  </div>
                ) : (
                  <div key={`empty-${index}`} className="package-member empty-slot"><span className="package-position">{index + 1}</span><span>本位置暂无符合条件的成员</span></div>
                );
              })}
            </div>
          </article>
        ))}
      </section>

      {plan.unfilledSlots > 0 && <div className="form-message error">本期有 {plan.unfilledSlots} 个位置因没有符合条件的成员而留空。</div>}
    </div>
  );
}
