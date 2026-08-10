import { LogOut, MapPin, Sparkles } from "lucide-react";
import { logoutAction } from "@/app/actions";
import type { SessionUser } from "@/lib/types";
import { Avatar } from "@/components/avatar";
import { Heartbeat } from "@/components/heartbeat";
import { SidebarNav } from "@/components/sidebar-nav";
import { MobileNavigation } from "@/components/mobile-navigation";

export function DashboardShell({ user, packageAlert, children }: { user: SessionUser; packageAlert: boolean; children: React.ReactNode }) {
  return (
    <div className="app-shell">
      <Heartbeat />
      <aside className="sidebar">
        <div className="brand-lockup">
          <div className="brand-seal" aria-hidden="true">
            <span className="seal-leaf" />
          </div>
          <div>
            <strong>不良人要塞战报</strong>
            <small>FORTRESS ARCHIVES</small>
          </div>
        </div>

        <div className="squad-plaque">
          <span><MapPin size={14} /> 3767区 · 2组</span>
          <strong>不良人</strong>
          <small><Sparkles size={12} /> 每周战绩作战室</small>
        </div>

        <SidebarNav isAdmin={user.role === "admin"} packageAlert={packageAlert} />

        <div className="sidebar-user">
          <Avatar name={user.displayName} src={user.avatarUrl} size={42} />
          <div>
            <strong>{user.displayName}</strong>
            <small>{user.note || (user.role === "admin" ? "管理员" : "组织成员")}</small>
          </div>
          <form action={logoutAction}>
            <button type="submit" className="icon-button" title="退出登录" aria-label="退出登录">
              <LogOut size={17} />
            </button>
          </form>
        </div>
      </aside>

      <div className="mobile-bar">
        <div className="brand-lockup compact">
          <div className="brand-seal"><span className="seal-leaf" /></div>
          <strong>不良人要塞战报</strong>
        </div>
        <Avatar name={user.displayName} src={user.avatarUrl} size={36} />
      </div>

      <main className="main-content">
        {children}
      </main>

      <div className="mobile-nav">
        <MobileNavigation isAdmin={user.role === "admin"} packageAlert={packageAlert} />
      </div>
    </div>
  );
}
