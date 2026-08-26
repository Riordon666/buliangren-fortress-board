import Link from "next/link";
import { BookOpenText, Database, Home, LogIn } from "lucide-react";

export function PublicShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="public-shell">
      <header className="public-header">
        <div className="public-header-inner">
          <Link href="/" className="public-brand" aria-label="木叶资料卷轴首页">
            <span className="brand-seal" aria-hidden="true"><span className="seal-leaf" /></span>
            <span><strong>木叶资料卷轴</strong><small>NINJA ARCHIVES</small></span>
          </Link>

          <nav className="public-nav" aria-label="公开导航">
            <Link href="/"><Home size={18} />首页</Link>
            <Link href="/accessories"><Database size={18} />饰品资料</Link>
          </nav>

          <Link href="/login" className="public-login-button">
            <LogIn size={18} />
            <span>组织登录</span>
          </Link>
        </div>
      </header>

      <main className="public-main">{children}</main>

      <footer className="public-footer">
        <div>
          <span className="footer-mark"><BookOpenText size={19} /></span>
          <p><strong>木叶资料卷轴</strong><small>玩家整理的火影忍者手游固定资料查询站</small></p>
        </div>
        <p className="public-disclaimer">本站为玩家社区工具，资料仅供参考，与游戏官方无隶属关系。</p>
        <nav aria-label="页脚导航"><Link href="/accessories">饰品资料</Link><Link href="/login">不良人组织入口</Link></nav>
      </footer>
    </div>
  );
}
