import { AlertTriangle, Award, CalendarRange, Fingerprint, ShieldCheck, Sparkles, UserRound } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { AvatarForm, PasswordForm } from "@/components/profile-forms";
import { requireUser } from "@/lib/auth";
import { getMemberTrend } from "@/lib/data";

export const metadata = { title: "个人信息" };

export default async function ProfilePage({ searchParams }: { searchParams: Promise<{ required?: string }> }) {
  const user = await requireUser();
  const params = await searchParams;
  const required = user.mustChangePassword || params.required === "1";
  const trend = getMemberTrend(user.id);
  const total = trend.reduce((sum, point) => sum + point.score, 0);
  const peak = trend.reduce((max, point) => Math.max(max, point.score), 0);
  const bestRank = trend.length ? Math.min(...trend.map((point) => point.rank)) : 0;

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
            <span className="role-badge leader">{user.note || (user.role === "admin" ? "管理员" : "组织成员")}</span>
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
          <PasswordForm required={required} />
        </div>
      </section>
    </div>
  );
}

