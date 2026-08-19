import { AlertTriangle, Award, CalendarRange, Fingerprint, History, ShieldCheck, Sparkles, TrendingUp, UserRound } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { DeferredMemberHistoryChart } from "@/components/deferred-charts";
import { AvatarForm, PasswordForm } from "@/components/profile-forms";
import { requireUser } from "@/lib/auth";
import { getAchievements } from "@/lib/insights";
import { getCurrentWeek, getMemberTrend, getPackageAssignmentSnapshots, getPackageDayStatuses, getPackagePlanRows, getScoreChangeEvents } from "@/lib/data";
import { generatePackagePlan, getPackageRoundsByMember } from "@/lib/package-plan";
import { mergePackagePlanDays } from "@/lib/package-snapshots";

export const metadata = { title: "个人信息" };

export default async function ProfilePage({ searchParams }: { searchParams: Promise<{ required?: string }> }) {
  const user = await requireUser();
  const params = await searchParams;
  const required = user.accountType !== "guest" && (user.mustChangePassword || params.required === "1");
  const trend = getMemberTrend(user.id);
  const total = trend.reduce((sum, point) => sum + point.score, 0);
  const peak = trend.reduce((max, point) => Math.max(max, point.score), 0);
  const bestRank = trend.length ? Math.min(...trend.map((point) => point.rank)) : 0;
  const currentWeek = getCurrentWeek();
  const currentRows = currentWeek ? getPackagePlanRows(currentWeek.id) : [];
  const current = currentRows.find((row) => row.userId === user.id);
  const plan = currentWeek ? generatePackagePlan(currentRows, currentWeek.eventDate) : null;
  const planAssignments = plan && currentWeek ? mergePackagePlanDays(
    plan.days,
    getPackageAssignmentSnapshots(currentWeek.id),
    getPackageDayStatuses(currentWeek.id).map((status) => status.dayIndex)
  ).flatMap((day) => day.assignments) : [];
  const rounds = getPackageRoundsByMember(planAssignments).get(user.id) || [];
  const achievements = getAchievements(current, trend, rounds);
  const changes = getScoreChangeEvents(user.id, 6);

  return (
    <div className="page-stack profile-page">
      <header className="page-hero">
        <div>
          <span className="eyebrow"><UserRound size={13} /> NINJA PROFILE</span>
          <h1>个人信息</h1>
          <p>维护你的头像与安全口令，回顾属于自己的要塞足迹。</p>
        </div>
      </header>

      {required && (
        <div className="security-banner">
          <AlertTriangle size={21} />
          <div><strong>需要先修改初始密码</strong><span>为了保护账号安全，完成修改后才能进入分数和管理员页面。</span></div>
        </div>
      )}

      <section className="profile-identity panel">
        <div className="identity-main">
          <div className="identity-avatar"><Avatar name={user.displayName} src={user.avatarUrl} size={104} /><i /></div>
          <div>
            <span className={`role-badge ${user.accountType === "guest" ? "guest" : "leader"}`}>{user.note || (user.accountType === "guest" ? "游客账号" : user.role === "admin" ? "管理员" : "组织成员")}</span>
            <h2>{user.displayName}</h2>
            <p><Fingerprint size={15} /> 登录账号：{user.username}</p>
          </div>
        </div>
        <div className="identity-stats">
          <span><i><CalendarRange size={17} /></i><b>{trend.length}</b><small>记录周数</small></span>
          <span><i><Sparkles size={17} /></i><b>{total}</b><small>累计分数</small></span>
          <span><i><Award size={17} /></i><b>{peak}</b><small>单周最高</small></span>
          <span><i><ShieldCheck size={17} /></i><b>{bestRank ? `#${bestRank}` : "—"}</b><small>最佳排名</small></span>
        </div>
      </section>

      <section className="profile-settings-grid">
        <div className="panel settings-panel">
          <div className="panel-heading"><div><span className="eyebrow">PORTRAIT</span><h2>头像设置</h2></div></div>
          <AvatarForm name={user.displayName} avatarUrl={user.avatarUrl} />
        </div>
        <div className={`panel settings-panel ${required ? "required-panel" : ""}`}>
          <div className="panel-heading"><div><span className="eyebrow">SECURITY</span><h2>账号安全</h2></div></div>
          {user.accountType === "guest" ? (
            <div className="guest-mode-note"><strong>共享游客账号</strong><span>游客只能浏览公开战绩和发包状态，不能修改共享密码。如需更换密码，请联系管理员统一设置。</span></div>
          ) : <PasswordForm required={required} />}
        </div>
      </section>

      <section className="profile-history-grid">
        <article className="panel profile-trend-panel">
          <div className="panel-heading"><div><span className="eyebrow"><TrendingUp size={13} /> PERFORMANCE</span><h2>我的战绩轨迹</h2><p>橙色为分数，绿色虚线为排名。</p></div></div>
          <DeferredMemberHistoryChart trend={trend} />
        </article>
        <div className="profile-side-stack">
          <article className="panel mini-achievements">
            <div className="panel-heading"><div><span className="eyebrow"><Award size={13} /> BADGES</span><h2>我的徽章</h2></div></div>
            {achievements.length ? <div>{achievements.map((item) => <span key={item.id} className={`achievement-tag ${item.tone}`}><Award size={15} /><b>{item.label}</b><small>{item.description}</small></span>)}</div> : <div className="compact-empty">本期暂无徽章，达到 40 分即可解锁。</div>}
          </article>
          <article className="panel score-change-panel">
            <div className="panel-heading"><div><span className="eyebrow"><History size={13} /> SCORE LOG</span><h2>最近分数变动</h2></div></div>
            {changes.length ? <div className="score-change-list">{changes.map((event) => <div key={event.id}><span className={event.delta >= 0 ? "positive" : "negative"}>{event.delta >= 0 ? "+" : ""}{event.delta}</span><div><strong>{event.previousScore} → {event.newScore}</strong><small>{event.weekTitle} · {event.source === "import" ? "表格导入" : "管理员更新"}</small></div></div>)}</div> : <div className="compact-empty">以后每次分数变化都会记录在这里。</div>}
          </article>
        </div>
      </section>

    </div>
  );
}
