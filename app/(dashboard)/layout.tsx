import { DashboardShell } from "@/components/dashboard-shell";
import { requireUser } from "@/lib/auth";
import { getCurrentWeek, getPackageDayStatuses, getScoreRows, getShanghaiDate } from "@/lib/data";
import { generatePackagePlan } from "@/lib/package-plan";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const week = getCurrentWeek();
  let packageAlert = false;
  if (week) {
    const plan = generatePackagePlan(getScoreRows(week.id), week.eventDate);
    const todayPlan = plan.days.find((day) => day.date === getShanghaiDate());
    const sent = todayPlan && getPackageDayStatuses(week.id).some((status) => status.dayIndex === todayPlan.dayIndex);
    packageAlert = Boolean(todayPlan?.assignments.some((assignment) => assignment.member.userId === user.id) && !sent);
  }
  return <DashboardShell user={user} packageAlert={packageAlert}>{children}</DashboardShell>;
}
