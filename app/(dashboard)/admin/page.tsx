import { Activity, Clock3, FileSpreadsheet, KeyRound, ListChecks, ShieldCheck, UserPlus, UsersRound } from "lucide-react";
import { saveScoresAction } from "@/app/admin/actions";
import { AddMemberForm, AdminMemberList, CreateWeekForm, ScoreImportForm } from "@/components/admin-forms";
import { Avatar } from "@/components/avatar";
import { ONLINE_WINDOW_MS } from "@/lib/constants";
import { requireAdmin } from "@/lib/auth";
import { getAuditLogs, getLatestWeek, getMembers, getScoreRows } from "@/lib/data";

export const metadata = { title: "管理员页面" };

const actionLabels: Record<string, string> = {
  "添加组员": "新增了一名组员",
  "重置组员密码": "重置了组员密码",
  "停用组员": "停用了一名组员",
  "恢复组员": "恢复了一名组员",
  "批量更新要塞分数": "更新了本周战绩",
  "导入要塞积分": "导入了本周战绩",
  "创建统计周": "创建了新的统计周",
  "修改本人密码": "修改了自己的密码",
  "更新头像": "更新了个人头像"
};

function parseSqliteDate(value: string | null) {
  if (!value) return null;
  return new Date(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
}

export default async function AdminPage() {
  const admin = await requireAdmin();
  const members = getMembers(true);
  const activeMembers = members.filter((member) => member.isActive);
  const onlineCount = activeMembers.filter((member) => {
    const date = parseSqliteDate(member.lastSeenAt);
    return date && Date.now() - date.getTime() <= ONLINE_WINDOW_MS;
  }).length;
  const week = getLatestWeek();
  const scores = week ? getScoreRows(week.id) : [];
  const audits = getAuditLogs();

  return (
    <div className="page-stack admin-page">
      <header className="page-hero">
        <div>
          <span className="eyebrow"><ShieldCheck size={13} /> COMMAND CENTER</span>
          <h1>管理员页面</h1>
          <p>维护不良人成员与周度战绩，掌握网站在线状态。</p>
        </div>
        <span className="admin-auth-badge"><ShieldCheck size={17} /> 首领权限已验证</span>
      </header>

      <section className="stat-grid admin-stats">
        <article className="stat-card green"><span className="stat-icon"><UsersRound size={20} /></span><div><small>有效组员</small><strong>{activeMembers.length}</strong><span>总档案 {members.length} 人</span></div></article>
        <article className="stat-card orange"><span className="stat-icon"><Activity size={20} /></span><div><small>当前在线</small><strong>{onlineCount}</strong><span>90 秒内有活动</span></div></article>
        <article className="stat-card gold"><span className="stat-icon"><ListChecks size={20} /></span><div><small>本期记录</small><strong>{scores.length}</strong><span>{week?.title || "尚未创建"}</span></div></article>
        <article className="stat-card ink"><span className="stat-icon"><KeyRound size={20} /></span><div><small>待改初始密码</small><strong>{members.filter((member) => member.isActive && member.mustChangePassword).length}</strong><span>首次登录强制更新</span></div></article>
      </section>

      <section className="admin-tools-grid">
        <div className="panel admin-tool-card add-member-card">
          <div className="panel-heading">
            <div><span className="eyebrow"><UserPlus size={13} /> NEW MEMBER</span><h2>添加组员</h2><p>新账号初始密码统一为 7891666。</p></div>
          </div>
          <AddMemberForm />
        </div>
        <div className="panel admin-tool-card">
          <div className="panel-heading">
            <div><span className="eyebrow"><Clock3 size={13} /> NEW CYCLE</span><h2>新建统计周</h2><p>为所有当前有效组员生成 0 分记录。</p></div>
          </div>
          <CreateWeekForm />
        </div>
      </section>

      {week && (
        <section className="panel score-import-panel">
          <div className="panel-heading">
            <div><span className="eyebrow"><FileSpreadsheet size={13} /> SCORE IMPORT</span><h2>表格导入积分</h2><p>先下载标准模板填写，整份校验通过后才会更新数据库。</p></div>
          </div>
          <ScoreImportForm weekId={week.id} weekTitle={week.title} />
        </section>
      )}

      <section className="panel member-management">
        <div className="panel-heading">
          <div><span className="eyebrow">MEMBER DIRECTORY</span><h2>组员与在线状态</h2><p>停用不会删除历史战绩；重置密码会强制注销该成员。</p></div>
          <span className="live-indicator"><i /> 实时监测</span>
        </div>
        <AdminMemberList members={members} currentUserId={admin.id} />
      </section>

      {week && (
        <section className="panel score-editor-panel">
          <div className="panel-heading">
            <div><span className="eyebrow">SCORE CONTROL</span><h2>本期分数与发包轮次</h2><p>{week.title} · 修改后排名会自动重新计算。</p></div>
          </div>
          <form action={saveScoresAction}>
            <input type="hidden" name="weekId" value={week.id} />
            <div className="table-scroll">
              <table className="score-table editable-table">
                <thead><tr><th>排名</th><th>组员</th><th>分数</th><th>发包轮次</th></tr></thead>
                <tbody>
                  {scores.map((row) => (
                    <tr key={row.userId}>
                      <td><span className="rank-cell">#{String(row.rank).padStart(2, "0")}</span></td>
                      <td><span className="member-cell"><Avatar name={row.displayName} src={row.avatarUrl} size={32} /><strong>{row.displayName}</strong></span></td>
                      <td><input className="table-input score-input" type="number" min="0" name={`score_${row.userId}`} defaultValue={row.score} aria-label={`${row.displayName}分数`} /></td>
                      <td><input className="table-input" type="number" min="0" name={`round_${row.userId}`} defaultValue={row.packageRound ?? ""} placeholder="未设置" aria-label={`${row.displayName}发包轮次`} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="editor-actions"><span>系统将按分数自动生成并列名次</span><button className="primary-button" type="submit">保存本期战绩</button></div>
          </form>
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
