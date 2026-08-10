import { GitCompareArrows } from "lucide-react";
import { MemberComparison } from "@/components/member-comparison";
import { requireReadyUser } from "@/lib/auth";
import { getAllMemberTrends, getCurrentWeek, getLeaderboardRows, getMembers } from "@/lib/data";

export const metadata = { title: "成员对比" };

export default async function ComparePage() {
  const user = await requireReadyUser();
  const members = getMembers(false).map((member) => ({ id: member.id, displayName: member.displayName }));
  const currentWeek = getCurrentWeek();
  const leaders = currentWeek ? getLeaderboardRows(currentWeek).slice(0, 3).map((row) => row.userId) : [];
  const initialIds = [user.id, ...leaders.filter((id) => id !== user.id)].slice(0, 3);
  const trends = getAllMemberTrends().map(({ userId, displayName, eventDate, weekTitle, score, rank }) => ({ userId, displayName, eventDate, weekTitle, score, rank }));
  return (
    <div className="page-stack compare-page">
      <header className="page-hero"><div><span className="eyebrow"><GitCompareArrows size={13} /> MEMBER COMPARISON</span><h1>成员战绩对比</h1><p>最多选择三名成员，对比分数和排名随统计周的变化。</p></div></header>
      <MemberComparison members={members} trends={trends} initialIds={initialIds} />
    </div>
  );
}
