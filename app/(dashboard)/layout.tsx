import { DashboardShell } from "@/components/dashboard-shell";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return <DashboardShell user={user}>{children}</DashboardShell>;
}

