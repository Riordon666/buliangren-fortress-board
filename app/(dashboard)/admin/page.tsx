import { randomUUID } from "node:crypto";
import { Activity, Clock3, FileSpreadsheet, KeyRound, ListChecks, ShieldCheck, UserPlus, UsersRound } from "lucide-react";
import { saveScoresAction } from "@/app/admin/actions";
import { AddMemberForm, AdminMemberList, CreateWeekForm, SaveScoresButton, ScoreImportForm, WeekManagementList } from "@/components/admin-forms";
import { Avatar } from "@/components/avatar";
import { WeekPicker } from "@/components/week-picker";
import { ONLINE_WINDOW_MS } from "@/lib/constants";
import { requireAdmin } from "@/lib/auth";
import { getAuditLogs, getCurrentWeek, getLeaderboardRows, getMembers, getPackageAssignmentSnapshots, getPackageDayStatuses, getPackagePlanRows, getScoreRows, getShanghaiDate, getWeekById, getWeeks } from "@/lib/data";
import { generatePackagePlan, getPackageRoundsByMember } from "@/lib/package-plan";
import { mergePackagePlanDays } from "@/lib/package-snapshots";

export const metadata = { title: "管理员页面" };

const actionLabels: Record<string, string> = {
  "添加组员": "新增了一名组员",
  "添加游客": "新增了一个游客账号",
  "修改账号名称": "修改了账号名称",
  "设为游客": "将账号设为了游客",
  "转为组员": "将游客转为了组员",
  "重置组员密码": "重置了组员密码",
  "停用组员": "停用了一名组员",
  "恢复组员": "恢复了一名组员",
  "批量更新要塞分数": "更新了本周战绩",
  "新增扣包记录": "新增了扣包记录",
  "调整扣包记录": "调整了扣包记录",
  "导入要塞积分": "导入了本周战绩",
  "创建统计周": "创建了新的统计周",
  "重命名统计周": "修改了统计周名称",
  "删除统计周": "删除了一个统计周",
  "修改本人密码": "修改了自己的密码",
  "更新头像": "更新了个人头像",
  "修改统计周状态": "修改了统计周状态"
};

function parseSqliteDate(value: string | null) {
  if (!value) return null;
  return new Date(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
}

export default async function AdminPage({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  const admin = await requireAdmin();
  const params = await searchParams;
  const members = getMembers(true);
  const activeMembers = members.filter((member) => member.isActive && member.accountType === "member");
  const activeAccounts = members.filter((member) => member.isActive);
  const guestCount = activeAccounts.filter((member) => member.accountType === "guest").length;
  const onlineCount = activeAccounts.filter((member) => {
    const date = parseSqliteDate(member.lastSeenAt);
    return date && Date.now() - date.getTime() <= ONLINE_WINDOW_MS;
  }).length;
  const weeks = getWeeks(true);
  const requestedWeekId = Number(params.week);
  const week = (Number.isInteger(requestedWeekId) ? getWeekById(requestedWeekId) : undefined)
    || getCurrentWeek()
    || weeks[0]
    || null;
  const scores = week ? getLeaderboardRows(week) : [];
  const deductionRequestId = randomUUID();
  const nextWeek = week
    ? weeks.filter((item) => item.eventDate > week.eventDate)
      .sort((left, right) => left.eventDate.localeCompare(right.eventDate) || left.id - right.id)[0] || null
    : null;
  const nextWeekDeductions = new Map(
    nextWeek ? getScoreRows(nextWeek.id).map((row) => [row.userId, row.packageDeductions]) : []
  );
  const packageRounds = week
    ? getPackageRoundsByMember(mergePackagePlanDays(
      generatePackagePlan(getPackagePlanRows(week.id), week.eventDate).days,
      getPackageAssignmentSnapshots(week.id),
      getPackageDayStatuses(week.id).map((status) => status.dayIndex)
    ).flatMap((day) => day.assignments))
    : new Map<number, number[]>();
  const audits = getAuditLogs();

  return (
    <div className="page-stack admin-page">
      <header className="page-hero">
        <div>
          <span className="eyebrow"><ShieldCheck size={13} /> COMMAND CENTER</span>
          <h1>管理员页面</h1>
          <p>维护不良人成员与周度战绩，掌握网站在线状态。</p>
        </div>
        <div className="admin-hero-tools"><span className="admin-auth-badge"><ShieldCheck size={17} /> 首领权限已验证</span>{week && <WeekPicker weeks={weeks} selectedId={week.id} basePath="/admin" />}</div>
      </header>

      <section className="stat-grid admin-stats">
        <article className="stat-card green"><span className="stat-icon"><UsersRound size={20} /></span><div><small>有效组员</small><strong>{activeMembers.length}</strong><span>游客 {guestCount} · 总账号 {members.length}</span></div></article>
        <article className="stat-card orange"><span className="stat-icon"><Activity size={20} /></span><div><small>当前在线</small><strong>{onlineCount}</strong><span>90 秒内有活动</span></div></article>
        <article className="stat-card gold"><span className="stat-icon"><ListChecks size={20} /></span><div><small>本期记录</small><strong>{scores.length}</strong><span>{week?.title || "尚未创建"}</span></div></article>
        <article className="stat-card ink"><span className="stat-icon"><KeyRound size={20} /></span><div><small>待改初始密码</small><strong>{members.filter((member) => member.isActive && member.mustChangePassword).length}</strong><span>首次登录强制更新</span></div></article>
      </section>

      <section className="admin-tools-grid">
        <div className="admin-tools-column">
          <div className="panel admin-tool-card add-member-card">
            <div className="panel-heading">
              <div><span className="eyebrow"><UserPlus size={13} /> NEW ACCOUNT</span><h2>添加账号</h2><p>可添加正式组员或只读游客；游戏昵称同时作为登录账号。</p></div>
            </div>
            <AddMemberForm />
          </div>

          {week && week.status !== "locked" && (
            <section className="panel score-import-panel compact-score-import-panel">
              <div className="panel-heading">
                <div><span className="eyebrow"><FileSpreadsheet size={13} /> SCORE IMPORT</span><h2>表格导入积分</h2><p>先下载标准模板填写，整份校验通过后才会更新数据库。</p></div>
              </div>
              <ScoreImportForm weekId={week.id} weekTitle={week.title} />
            </section>
          )}
        </div>

        <div className="panel admin-tool-card week-admin-card">
          <div className="panel-heading">
            <div><span className="eyebrow"><Clock3 size={13} /> NEW CYCLE</span><h2>新建统计周</h2><p>按日期向后创建，并为有效组员承接待执行扣包。</p></div>
          </div>
          <CreateWeekForm />
          <div className="week-list-heading"><strong>已有统计周</strong><span>删除前会自动备份数据库</span></div>
          <WeekManagementList weeks={weeks} currentWeekId={week?.id || null} today={getShanghaiDate()} />
        </div>
      </section>

      <section className="panel member-management">
        <div className="panel-heading">
          <div><span className="eyebrow">ACCOUNT DIRECTORY</span><h2>账号与在线状态</h2><p>管理员可改名、切换游客身份、重置密码或停用账号。</p></div>
          <span className="live-indicator"><i /> 实时监测</span>
        </div>
        <AdminMemberList members={members} currentUserId={admin.id} />
      </section>

      {week && (
        <section className="panel score-editor-panel">
          <div className="panel-heading">
            <div><span className="eyebrow">SCORE CONTROL</span><h2>本期分数、自动轮次与扣包</h2><p>{week.title} · 输入正数增加扣包，输入 -1 可撤销一次；调整会同步到下一统计周。</p></div>
          </div>
          {week.status === "locked" ? <div className="compact-empty">这个统计周已经锁定。如需修正，请先在统计周管理中解除锁定。</div> : <form action={saveScoresAction}>
            <input type="hidden" name="weekId" value={week.id} />
            <input type="hidden" name="deductionRequestId" value={deductionRequestId} />
            <div className="table-scroll">
              <table className="score-table editable-table">
                <thead><tr><th>排名</th><th>组员</th><th>分数</th><th>自动发包轮次</th><th>累计 / 调整扣包</th></tr></thead>
                <tbody>
                  {scores.map((row) => {
                    const rounds = packageRounds.get(row.userId) || [];
                    return (
                    <tr key={row.userId}>
                      <td><span className="rank-cell">#{String(row.rank).padStart(2, "0")}</span></td>
                      <td><span className="member-cell"><Avatar name={row.displayName} src={row.avatarUrl} size={32} /><strong>{row.displayName}</strong></span></td>
                      <td><input className="table-input score-input" type="number" min="0" name={`score_${row.userId}`} defaultValue={row.score} aria-label={`${row.displayName}分数`} /></td>
                      <td>{rounds.length ? <span className="round-badge-list">{rounds.map((round) => <span key={round} className={`round-badge round-badge-${round}`}>第 {round} 轮</span>)}</span> : <span className="muted">本期未排到</span>}</td>
                      <td>
                        <div className="deduction-add-control">
                          <span><strong>累计 {row.packageDeductionTotal} 次</strong><small>{row.packageDeductions > 0 ? `本期执行 ${row.packageDeductions} 次 · ` : ""}{nextWeek ? `${nextWeek.title} 已登记 ${nextWeekDeductions.get(row.userId) || 0} 次` : `待创建下一周 ${row.packageDeductionPending} 次`}</small></span>
                          <label><small>调整</small><input key={`${row.userId}-${row.packageDeductionTotal}`} className="table-input deduction-input" type="number" min="-99" max="99" name={`deduction_add_${row.userId}`} defaultValue="0" aria-label={`${row.displayName}调整扣包次数，负数为减少`} /></label>
                        </div>
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="editor-actions"><span>输入 1 增加一次，输入 -1 减少一次；累计数不会低于 0，第一轮仍不受扣包影响。</span><SaveScoresButton /></div>
          </form>}
        </section>
      )}

      <section className="panel audit-panel">
        <div className="panel-heading"><div><span className="eyebrow">AUDIT TRAIL</span><h2>最近操作记录</h2><p>敏感管理动作均会留痕。</p></div></div>
        <div className="audit-list">
          {audits.length ? audits.map((audit) => (
            <article key={audit.id}>
              <span className="audit-mark"><ListChecks size={16} /></span>
              <div><strong>{audit.actorName || "系统"} {actionLabels[audit.action] || audit.action}</strong><span>{audit.targetName ? `对象：${audit.targetName}` : "组织数据"}</span></div>
              <time>{parseSqliteDate(audit.createdAt)?.toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</time>
            </article>
          )) : <div className="empty-inline">还没有管理员操作记录。</div>}
        </div>
      </section>
    </div>
  );
}
