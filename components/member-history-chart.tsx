"use client";

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { TrendPoint } from "@/lib/types";

export function MemberHistoryChart({ trend }: { trend: TrendPoint[] }) {
  if (!trend.length) return <div className="compact-empty">还没有历史战绩，录入本周积分后这里会自动生成趋势。</div>;
  return (
    <div className="member-history-chart" aria-label="个人历史分数和排名趋势">
      <ResponsiveContainer width="100%" height={290}>
        <LineChart data={trend} margin={{ top: 14, right: 12, bottom: 4, left: -16 }}>
          <CartesianGrid strokeDasharray="3 5" stroke="rgba(86,76,58,.13)" />
          <XAxis dataKey="eventDate" minTickGap={24} tickFormatter={(value) => String(value).slice(5)} axisLine={false} tickLine={false} tick={{ fill: "#766c5c", fontSize: 14 }} />
          <YAxis yAxisId="score" axisLine={false} tickLine={false} tick={{ fill: "#766c5c", fontSize: 14 }} />
          <YAxis yAxisId="rank" orientation="right" reversed domain={[1, "dataMax + 2"]} allowDecimals={false} axisLine={false} tickLine={false} tick={{ fill: "#766c5c", fontSize: 14 }} />
          <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid rgba(80,66,44,.15)", background: "#fffaf0", fontSize: 14 }} />
          <Line yAxisId="score" type="monotone" dataKey="score" name="分数" stroke="#df642f" strokeWidth={3} dot={{ r: 4, fill: "#df642f" }} />
          <Line yAxisId="rank" type="monotone" dataKey="rank" name="排名" stroke="#315846" strokeWidth={2} strokeDasharray="5 4" dot={{ r: 3, fill: "#315846" }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
