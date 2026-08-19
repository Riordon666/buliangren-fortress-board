import Link from "next/link";
import { CalendarDays, CheckCircle2, CircleMinus, Gift, Layers3, ListOrdered, ShieldCheck, UsersRound } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { PackageDayBrowser } from "@/components/package-day-browser";
import { WeekPicker } from "@/components/week-picker";
import { MarkPackageSentForm } from "@/components/mark-package-sent-form";
import { requireReadyUser } from "@/lib/auth";
import { getActivePackageWeeks, getCurrentWeek, getPackageAssignmentSnapshots, getPackageDayStatuses, getPackageDeductionApplications, getPackageDeductionRows, getPackagePlanRows, getShanghaiDate, getWeekById, getWeeks } from "@/lib/data";
import {
  FIRST_ROUND_MIN_SCORE,
  LATER_ROUND_MIN_SCORE,
  PACKAGES_PER_DAY,
  generatePackagePlan
} from "@/lib/package-plan";
import { mergePackagePlanDays } from "@/lib/package-snapshots";

export const metadata = { title: "发包安排" };

export default async function PackagesPage({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  const user = await requireReadyUser();
  const params = await searchParams;
  const weeks = getWeeks(user.role === "admin");
  const requestedId = Number(params.week);
  const requestedWeek = Number.isInteger(requestedId) ? getWeekById(requestedId) : undefined;
  const selectedWeek = requestedWeek && (user.role === "admin" || requestedWeek.status !== "draft") ? requestedWeek : getCurrentWeek();
  if (!selectedWeek) return <div className="empty-state">还没有可以生成发包安排的统计周。</div>;

  const rows = getPackagePlanRows(selectedWeek.id);
  const deductionRows = getPackageDeductionRows(selectedWeek.id);
  const plan = generatePackagePlan(rows, selectedWeek.eventDate, deductionRows);
  const appliedDeductions = new Map(getPackageDeductionApplications(selectedWeek.id).map((item) => [item.userId, item.amount]));
  const actualAppliedDeductionCount = [...appliedDeductions.values()].reduce((sum, amount) => sum + amount, 0);
  const today = getShanghaiDate();
  const statuses = new Map(getPackageDayStatuses(selectedWeek.id).map((status) => [status.dayIndex, status]));
  const snapshots = getPackageAssignmentSnapshots(selectedWeek.id);
  const displayDays = mergePackagePlanDays(plan.days, snapshots, statuses.keys());
  const todayPlan = plan.days.find((day) => day.date === today);
  const todayDisplayDay = displayDays.find((day) => day.date === today);
  const todayStatus = todayPlan ? statuses.get(todayPlan.dayIndex) : undefined;
  const overlappingWeeks = getActivePackageWeeks(today, user.role === "admin").filter((week) => week.id !== selectedWeek.id);

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

      <section id="today-package" className={`panel package-today ${todayStatus ? "sent" : "pending"}`}>
        <div className="package-today-heading">
          <span className="eyebrow">TODAY DELIVERY</span>
          <h2>今日发包状态</h2>
          {!todayPlan ? <p>今天不在当前所选统计周的发包周期内。</p> : <p>{todayStatus
            ? todayStatus.confirmationSource === "automatic"
              ? "管理员未手动确认，系统已在 23:30 后自动确认今天的包已发放。"
              : `${todayStatus.markedByName || "管理员"}已确认今天的包已发放。`
            : "今天暂未发包；若 23:30 前仍未手动确认，系统会自动确认。"}</p>}
        </div>
        <div className="package-today-action">
          <span className={`send-status ${todayStatus ? "sent" : "pending"}`}>{todayStatus ? <><CheckCircle2 size={15} />已发包</> : "暂未发包"}</span>
          {todayPlan && !todayStatus && user.role === "admin" && <MarkPackageSentForm weekId={selectedWeek.id} dayIndex={todayPlan.dayIndex} memberCount={todayPlan.assignments.length} />}
        </div>
        {todayDisplayDay && <div className="today-package-lineup" aria-label="今日发包五人名单">
          {Array.from({ length: PACKAGES_PER_DAY }, (_, index) => {
            const assignment = todayDisplayDay.assignments[index];
            return assignment ? (
              <article key={`${assignment.member.userId}-${assignment.position}`} className="today-package-seat">
                <span className="today-seat-number">{assignment.position}</span>
                <Avatar name={assignment.member.displayName} src={assignment.member.avatarUrl} size={48} />
                <strong>{assignment.member.displayName}</strong>
                <small>第 {assignment.round} 轮 · {assignment.member.score} 分</small>
              </article>
            ) : (
              <article key={`empty-${index}`} className="today-package-seat empty">
                <span className="today-seat-number">{index + 1}</span>
                <strong>暂无人选</strong>
                <small>未达到发包条件</small>
              </article>
            );
          })}
        </div>}
      </section>

      {overlappingWeeks.length > 0 && <aside className="overlap-notice"><strong>今天是跨期周六</strong><span>同一天还有另一统计周期的发包安排，请分别确认。</span>{overlappingWeeks.map((week) => <Link key={week.id} href={`/packages?week=${week.id}`}>查看“{week.title}”今日名单</Link>)}</aside>}

      <PackageDayBrowser days={displayDays} sentDayIndexes={[...statuses.keys()]} today={today} />

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
          <span><i>06</i>每日 23:30 未手动确认时由系统自动确认</span>
        </div>
      </section>

      <section className="panel deduction-board">
        <header className="deduction-board-heading">
          <div className="package-rule-title">
            <span className="section-icon deduction-icon"><CircleMinus size={19} /></span>
            <div><span className="eyebrow">PACKAGE DEDUCTIONS</span><h2>累计扣包次数排行</h2><p className="deduction-note">这里仅记录扣包次数，不代表成员已经获得发包名额。</p></div>
          </div>
          <span className="deduction-summary"><ListOrdered size={15} />累计 {plan.totalDeductions} 次 · 本期承接 {plan.scheduledDeductionCount} 次 · 已实际扣 {actualAppliedDeductionCount} 次</span>
        </header>
        {plan.deductionRanking.length ? (
          <div className="deduction-ranking">
            {plan.deductionRanking.map((item) => {
              const actuallyApplied = appliedDeductions.get(item.member.userId) || 0;
              const outstanding = Math.max(0, item.scheduled - actuallyApplied);
              return (
              <article key={item.member.userId} className="deduction-rank-item">
                <span className="deduction-rank">#{String(item.rank).padStart(2, "0")}</span>
                <Avatar name={item.member.displayName} src={item.member.avatarUrl} size={40} />
                <div>
                  <strong>{item.member.displayName}</strong>
                  <small>{item.member.score} 分 · {item.member.score < FIRST_ROUND_MIN_SCORE ? "当前无发包资格" : item.member.score < LATER_ROUND_MIN_SCORE ? "仅有第一轮资格" : `本期承接 ${item.scheduled} 次 · 已实际扣 ${actuallyApplied} 次 · 当前安排预计跳过 ${item.applied} 次`}{outstanding > 0 ? ` · 待执行 ${outstanding} 次` : ""}</small>
                </div>
                <b>累计扣 {item.count} 次</b>
              </article>
              );
            })}
          </div>
        ) : (
          <div className="deduction-empty"><ShieldCheck size={18} />暂无累计扣包记录，所有符合条件的成员按正常顺序轮转。</div>
        )}
      </section>

      {plan.unfilledSlots > 0 && <div className="form-message error">本期有 {plan.unfilledSlots} 个位置因没有符合条件的成员而留空。</div>}
    </div>
  );
}
