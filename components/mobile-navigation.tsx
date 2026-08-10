"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, FileText, Gift, GitCompareArrows, House, LogOut, Menu, ShieldCheck, UserRound, X } from "lucide-react";
import { logoutAction } from "@/app/actions";

const primary = [
  { href: "/home", label: "作战室", icon: House },
  { href: "/scores", label: "分数", icon: BarChart3 },
  { href: "/packages", label: "发包", icon: Gift }
];

export function MobileNavigation({ isAdmin, packageAlert }: { isAdmin: boolean; packageAlert: boolean }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const more = [
    { href: "/reports", label: "每周战报", icon: FileText },
    { href: "/compare", label: "成员对比", icon: GitCompareArrows },
    { href: "/profile", label: "个人信息", icon: UserRound },
    ...(isAdmin ? [{ href: "/admin", label: "管理员页面", icon: ShieldCheck }] : [])
  ];
  const moreActive = more.some((item) => pathname.startsWith(item.href));
  return (
    <>
      <nav className="mobile-primary-nav" aria-label="手机主导航">
        {primary.map((item) => { const Icon = item.icon; const active = pathname.startsWith(item.href); return <Link key={item.href} href={item.href} className={active ? "active" : ""}><span><Icon size={20} />{item.href === "/packages" && packageAlert && <i />}</span><small>{item.label}</small></Link>; })}
        <button type="button" className={moreActive || open ? "active" : ""} onClick={() => setOpen(true)}><Menu size={20} /><small>更多</small></button>
      </nav>
      {open && <div className="mobile-more-backdrop" onClick={() => setOpen(false)}>
        <section className="mobile-more-sheet" onClick={(event) => event.stopPropagation()}>
          <header><strong>更多功能</strong><button type="button" onClick={() => setOpen(false)} aria-label="关闭更多菜单"><X size={20} /></button></header>
          <div>{more.map((item) => { const Icon = item.icon; return <Link key={item.href} href={item.href} className={pathname.startsWith(item.href) ? "active" : ""} onClick={() => setOpen(false)}><Icon size={19} /><span>{item.label}</span></Link>; })}</div>
          <form action={logoutAction}><button type="submit" className="mobile-logout"><LogOut size={18} />退出登录</button></form>
        </section>
      </div>}
    </>
  );
}
