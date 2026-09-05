import Link from "next/link";
import { Flame, LogOut, MapPin, Sparkles } from "lucide-react";
import { logoutAction } from "@/app/actions";
import type { SessionUser } from "@/lib/types";
import { Avatar } from "@/components/avatar";
import { Heartbeat } from "@/components/heartbeat";
import { SidebarNav } from "@/components/sidebar-nav";
import { MobileNavigation } from "@/components/mobile-navigation";
import { ShinobiMark } from "@/components/shinobi-mark";

export function DashboardShell({ user, packageAlert, children }: { user: SessionUser; packageAlert: boolean; children: React.ReactNode }) {
  return (
    <div className="app-shell">
      <Heartbeat />
      <aside className="sidebar">
        <Link href="/home" className="brand-lockup" aria-label="不良人要塞战报 · 我的作战室">
          <div className="brand-seal" aria-hidden="true"><ShinobiMark size={32} /></div>
          <div><strong>不良人要塞战报</strong><small>木叶隐村 · 要塞作战档案</small></div>
        </Link>
        <div className="squad-plaque">
          <ShinobiMark className="squad-watermark" size={96} />
          <span><MapPin size={14} /> 3767区 · 2组</span>
          <strong>不良人</strong>
          <small><Sparkles size={14} /> 同伴集结，守护荣耀</small>
        </div>
        <div className="nav-caption"><span>组织事务</span><span>忍者档案</span></div>
        <SidebarNav isAdmin={user.role === "admin"} packageAlert={packageAlert} />
        <div className="sidebar-nindo"><Flame size={18} /><p>木叶飞舞之处<br /><strong>火亦生生不息</strong></p><span aria-hidden="true">忍</span></div>
        <div className="sidebar-user">
          <Avatar name={user.displayName} src={user.avatarUrl} size={42} />
          <div><strong>{user.displayName}</strong><small>{user.note || (user.accountType === "guest" ? "游客账号" : user.role === "admin" ? "管理员" : "组织成员")}</small></div>
          <form action={logoutAction}><button type="submit" className="icon-button" title="退出登录" aria-label="退出登录"><LogOut size={17} /></button></form>
        </div>
      </aside>
      <div className="mobile-bar">
        <Link href="/home" className="brand-lockup compact"><div className="brand-seal"><ShinobiMark size={28} /></div><strong>不良人要塞战报</strong></Link>
        <Link href="/profile" aria-label="查看个人信息"><Avatar name={user.displayName} src={user.avatarUrl} size={36} /></Link>
      </div>
      <main className="main-content">
        <div className="workspace-topline"><span><ShinobiMark size={19} /> 木叶隐村 <i>/</i> 不良人作战中心</span><span><Flame size={15} /> 3767 区 · 2 组</span></div>
        {children}
        <footer className="workspace-footer"><span>不良人 · 并肩作战，不负热爱</span><span>每一份贡献，都值得被记住。</span></footer>
      </main>
      <div className="mobile-nav"><MobileNavigation isAdmin={user.role === "admin"} packageAlert={packageAlert} /></div>
    </div>
  );
}
