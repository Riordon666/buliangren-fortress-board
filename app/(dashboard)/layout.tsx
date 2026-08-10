import { DashboardShell } from "@/components/dashboard-shell";
import { requireUser } from "@/lib/auth";
import { getActivePackageWeeks, getPackageDayStatuses, getPackagePlanRows, getShanghaiDate } from "@/lib/data";
import { generatePackagePlan } from "@/lib/package-plan";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  let packageAlert = false;
  for (const week of getActivePackageWeeks(getShanghaiDate())) {
    const plan = generatePackagePlan(getPackagePlanRows(week.id), week.eventDate);
    const todayPlan = plan.days.find((day) => day.date === getShanghaiDate());
    const sent = todayPlan && getPackageDayStatuses(week.id).some((status) => status.dayIndex === todayPlan.dayIndex);
    if (todayPlan?.assignments.some((assignment) => assignment.member.userId === user.id) && !sent) packageAlert = true;
  }
  return <DashboardShell user={user} packageAlert={packageAlert}>{children}</DashboardShell>;
}
