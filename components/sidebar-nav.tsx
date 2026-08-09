"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, ShieldCheck, UserRound } from "lucide-react";

const baseItems = [
  { href: "/scores", label: "要塞分数统计", icon: BarChart3 },
  { href: "/profile", label: "个人信息", icon: UserRound }
];

export function SidebarNav({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();
  const items = isAdmin
    ? [...baseItems, { href: "/admin", label: "管理员页面", icon: ShieldCheck }]
    : baseItems;

  return (
    <nav className="sidebar-nav" aria-label="主导航">
      {items.map((item) => {
        const active = pathname.startsWith(item.href);
        const Icon = item.icon;
        return (
          <Link key={item.href} href={item.href} className={active ? "active" : ""}>
            <span className="nav-icon"><Icon size={19} strokeWidth={2.2} /></span>
            <span>{item.label}</span>
            {active && <i aria-hidden="true" />}
          </Link>
        );
      })}
    </nav>
  );
}

