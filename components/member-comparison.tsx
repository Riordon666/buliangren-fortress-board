"use client";

import { useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

type Trend = { userId: number; displayName: string; eventDate: string; weekTitle: string; score: number; rank: number };
type Member = { id: number; displayName: string };
const colors = ["#df662d", "#3f6c55", "#c08b36"];

export function MemberComparison({ members, trends, initialIds }: { members: Member[]; trends: Trend[]; initialIds: number[] }) {
  const [metric, setMetric] = useState<"score" | "rank">("score");
  const [selected, setSelected] = useState<string[]>([
    String(initialIds[0] || members[0]?.id || ""),
    String(initialIds[1] || members[1]?.id || ""),
    String(initialIds[2] || members[2]?.id || "")
  ]);
  const selectedIds = selected.map(Number).filter(Boolean);
  const selectedMembers = members.filter((member) => selectedIds.includes(member.id));
  const data = useMemo(() => {
    const byDate = new Map<string, Record<string, string | number>>();
    for (const point of trends) {
      if (!selectedIds.includes(point.userId)) continue;
      const item = byDate.get(point.eventDate) || { eventDate: point.eventDate, weekTitle: point.weekTitle };
      item[`u${point.userId}`] = point[metric];
      byDate.set(point.eventDate, item);
    }
    return [...byDate.values()].sort((left, right) => String(left.eventDate).localeCompare(String(right.eventDate)));
  }, [metric, selectedIds.join(","), trends]);

  return (
    <section className="panel comparison-panel">
      <div className="comparison-controls">
        <div className="comparison-selects">
          {selected.map((value, index) => (
            <label key={index}><span>对比成员 {index + 1}</span>
              <select value={value} onChange={(event) => setSelected((current) => current.map((item, itemIndex) => itemIndex === index ? event.target.value : item))}>
                {members.map((member) => <option key={member.id} value={member.id} disabled={selected.some((item, itemIndex) => itemIndex !== index && item === String(member.id))}>{member.displayName}</option>)}
              </select>
            </label>
          ))}
        </div>
        <div className="metric-switch" aria-label="对比指标">
          <button type="button" className={metric === "score" ? "active" : ""} onClick={() => setMetric("score")}>分数趋势</button>
          <button type="button" className={metric === "rank" ? "active" : ""} onClick={() => setMetric("rank")}>排名趋势</button>
        </div>
      </div>
      <div className="compare-legend">
        {selectedMembers.map((member, index) => <span key={member.id}><i style={{ background: colors[index] }} />{member.displayName}</span>)}
      </div>
      <div className="compare-chart">
        <ResponsiveContainer width="100%" height={390}>
          <LineChart data={data} margin={{ top: 15, right: 20, bottom: 5, left: -10 }}>
            <CartesianGrid strokeDasharray="3 5" stroke="rgba(86,76,58,.13)" />
            <XAxis dataKey="eventDate" axisLine={false} tickLine={false} tick={{ fill: "#766c5c", fontSize: 11 }} />
            <YAxis reversed={metric === "rank"} allowDecimals={false} domain={metric === "rank" ? [1, "dataMax + 2"] : [0, "auto"]} axisLine={false} tickLine={false} tick={{ fill: "#766c5c", fontSize: 11 }} />
            <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid rgba(80,66,44,.15)", background: "#fffaf0" }} />
            {selectedMembers.map((member, index) => (
              <Line key={member.id} type="monotone" dataKey={`u${member.id}`} name={member.displayName} connectNulls stroke={colors[index]} strokeWidth={3} dot={{ r: 4, fill: colors[index] }} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
