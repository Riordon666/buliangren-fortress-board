"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { BarChart3, FileText, Gift, GitCompareArrows, House, ShieldCheck, UserRound } from "lucide-react";

const baseItems = [
  { href: "/home", label: "我的作战室", icon: House },
  { href: "/scores", label: "要塞分数统计", icon: BarChart3 },
  { href: "/packages", label: "发包安排", icon: Gift },
  { href: "/reports", label: "每周战报", icon: FileText },
  { href: "/compare", label: "成员对比", icon: GitCompareArrows },
  { href: "/profile", label: "个人信息", icon: UserRound }
];

export function SidebarNav({ isAdmin, packageAlert = false }: { isAdmin: boolean; packageAlert?: boolean }) {
  const pathname = usePathname();
  const activeRef = useRef<HTMLAnchorElement>(null);
  const items = isAdmin
    ? [...baseItems, { href: "/admin", label: "管理员页面", icon: ShieldCheck }]
    : baseItems;
  useEffect(() => {
    activeRef.current?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }, [pathname]);

  return (
    <nav className="sidebar-nav" aria-label="主导航">
      {items.map((item) => {
        const active = pathname.startsWith(item.href);
        const Icon = item.icon;
        return (
          <Link key={item.href} href={item.href} prefetch={false} className={active ? "active" : ""} ref={active ? activeRef : undefined}>
            <span className="nav-icon"><Icon size={19} strokeWidth={2.2} /></span>
            <span>{item.label}</span>
            {item.href === "/packages" && packageAlert && <span className="nav-notice" title="今天有你的发包安排" />}
            {active && <i aria-hidden="true" />}
          </Link>
        );
      })}
    </nav>
  );
}
