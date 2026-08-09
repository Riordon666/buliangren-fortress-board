"use client";

import { useMemo, useState } from "react";
import {
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { BarChart3, ChartNoAxesCombined, ChartPie, RadarIcon, Rows3 } from "lucide-react";
import type { ScoreRow } from "@/lib/types";

type View = "bar" | "line" | "pie" | "distribution" | "radar";

const colors = ["#e77732", "#f0a64c", "#d3b169", "#638667", "#416955", "#2f5144", "#8c6650", "#b77b47", "#6f7e5e"];

const tabs: Array<{ id: View; label: string; icon: typeof BarChart3 }> = [
  { id: "bar", label: "横向柱状", icon: BarChart3 },
  { id: "line", label: "排名折线", icon: ChartNoAxesCombined },
  { id: "pie", label: "贡献占比", icon: ChartPie },
  { id: "distribution", label: "分数分布", icon: Rows3 },
  { id: "radar", label: "组织雷达", icon: RadarIcon }
];

function ChartTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number; payload?: { name?: string } }>;
  label?: string | number;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      <strong>{payload[0]?.payload?.name || label}</strong>
      {payload.map((item, index) => (
        <span key={`${item.name}-${index}`}>{item.name || "分数"}：{item.value}</span>
      ))}
    </div>
  );
}

export function ScoreVisualizations({ rows }: { rows: ScoreRow[] }) {
  const [view, setView] = useState<View>("bar");

  const data = useMemo(() => {
    const barData = rows.map((row) => ({
      name: row.displayName,
      score: row.score,
      rank: row.rank
    }));
    const lineData = rows.map((row, index) => ({
      name: row.displayName,
      rank: row.rank,
      position: index + 1,
      score: row.score
    }));
    const leaders = rows.slice(0, 8).map((row) => ({ name: row.displayName, value: row.score }));
    const rest = rows.slice(8).reduce((sum, row) => sum + row.score, 0);
    const pieData = rest > 0 ? [...leaders, { name: "其他组员", value: rest }] : leaders;
    const ranges = [
      { name: "0分", count: rows.filter((row) => row.score === 0).length, fill: "#8b8272" },
      { name: "1–39", count: rows.filter((row) => row.score > 0 && row.score < 40).length, fill: "#799078" },
      { name: "40–79", count: rows.filter((row) => row.score >= 40 && row.score < 80).length, fill: "#4f7a60" },
      { name: "80–119", count: rows.filter((row) => row.score >= 80 && row.score < 120).length, fill: "#e09644" },
      { name: "120+", count: rows.filter((row) => row.score >= 120).length, fill: "#dd642a" }
    ];
    const total = Math.max(rows.length, 1);
    const active = rows.filter((row) => row.score > 0);
    const activeCount = Math.max(active.length, 1);
    const average = active.reduce((sum, row) => sum + row.score, 0) / activeCount;
    const radarData = [
      { metric: "参战率", value: Math.round(active.length / total * 100) },
      { metric: "40分达成", value: Math.round(rows.filter((row) => row.score >= 40).length / total * 100) },
      { metric: "80分达成", value: Math.round(rows.filter((row) => row.score >= 80).length / total * 100) },
      { metric: "100分达成", value: Math.round(rows.filter((row) => row.score >= 100).length / total * 100) },
      { metric: "中坚厚度", value: Math.round(active.filter((row) => row.score >= average).length / activeCount * 100) },
      { metric: "发包登记", value: Math.round(rows.filter((row) => row.packageRound !== null).length / total * 100) }
    ];
    return { barData, lineData, pieData, ranges, radarData };
  }, [rows]);

  return (
    <section className="panel visualization-panel">
      <div className="panel-heading chart-heading">
        <div>
          <span className="eyebrow">MULTI-VIEW ANALYSIS</span>
          <h2>战绩可视化</h2>
          <p>同一份真实数据，用不同视角观察组织战力。</p>
        </div>
        <div className="chart-tabs" role="tablist" aria-label="选择图表类型">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={view === tab.id}
                className={view === tab.id ? "active" : ""}
                onClick={() => setView(tab.id)}
              >
                <Icon size={16} /> {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className={`chart-stage chart-${view}`}>
        {view === "bar" && (
          <ResponsiveContainer width="100%" height={Math.max(560, rows.length * 31)}>
            <BarChart data={data.barData} layout="vertical" margin={{ top: 6, right: 38, bottom: 6, left: 18 }}>
              <CartesianGrid strokeDasharray="3 5" horizontal={false} stroke="rgba(86,76,58,.13)" />
              <XAxis type="number" axisLine={false} tickLine={false} tick={{ fill: "#766c5c", fontSize: 12 }} />
              <YAxis type="category" dataKey="name" width={92} axisLine={false} tickLine={false} tick={{ fill: "#332f29", fontSize: 12 }} />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(230,119,50,.06)" }} />
              <Bar dataKey="score" name="分数" radius={[0, 8, 8, 0]} maxBarSize={17}>
                {data.barData.map((entry, index) => <Cell key={entry.name} fill={index < 3 ? colors[index] : "#52735b"} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}

        {view === "line" && (
          <>
            <div className="chart-note"><strong>分数梯度</strong><span>观察头部与中坚成员之间的分差是否平滑</span></div>
            <ResponsiveContainer width="100%" height={390}>
              <AreaChart data={data.lineData} margin={{ top: 18, right: 24, bottom: 16, left: 4 }}>
                <defs>
                  <linearGradient id="scoreArea" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#e77732" stopOpacity={0.38} />
                    <stop offset="100%" stopColor="#e77732" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="4 5" stroke="rgba(86,76,58,.13)" />
                <XAxis dataKey="position" tickFormatter={(value) => `第${value}位`} tick={{ fill: "#766c5c", fontSize: 11 }} axisLine={false} tickLine={false} interval={4} />
                <YAxis tick={{ fill: "#766c5c", fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip content={<ChartTooltip />} />
                <Line type="monotone" dataKey="score" name="分数" stroke="#d85f29" strokeWidth={3} dot={{ r: 3, fill: "#fff7e8", strokeWidth: 2 }} activeDot={{ r: 6 }} />
              </AreaChart>
            </ResponsiveContainer>
          </>
        )}

        {view === "pie" && (
          <div className="pie-layout">
            <ResponsiveContainer width="100%" height={410}>
              <PieChart>
                <Pie data={data.pieData} dataKey="value" nameKey="name" innerRadius={92} outerRadius={145} paddingAngle={2} stroke="transparent">
                  {data.pieData.map((entry, index) => <Cell key={entry.name} fill={colors[index % colors.length]} />)}
                </Pie>
                <Tooltip content={<ChartTooltip />} />
              </PieChart>
            </ResponsiveContainer>
            <div className="pie-center"><strong>TOP 8</strong><span>贡献构成</span></div>
            <div className="chart-legend">
              {data.pieData.map((entry, index) => (
                <span key={entry.name}><i style={{ background: colors[index % colors.length] }} />{entry.name}<b>{entry.value}</b></span>
              ))}
            </div>
          </div>
        )}

        {view === "distribution" && (
          <>
            <div className="chart-note"><strong>成员分层</strong><span>快速定位未参战、成长层、中坚层与核心输出</span></div>
            <ResponsiveContainer width="100%" height={390}>
              <BarChart data={data.ranges} margin={{ top: 28, right: 24, bottom: 8, left: 4 }}>
                <CartesianGrid strokeDasharray="4 5" vertical={false} stroke="rgba(86,76,58,.13)" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: "#4b453d" }} />
                <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fill: "#766c5c" }} />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(230,119,50,.05)" }} />
                <Bar dataKey="count" name="人数" radius={[10, 10, 2, 2]} maxBarSize={72}>
                  {data.ranges.map((entry) => <Cell key={entry.name} fill={entry.fill} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </>
        )}

        {view === "radar" && (
          <div className="radar-layout">
            <ResponsiveContainer width="100%" height={430}>
              <RadarChart data={data.radarData} outerRadius="72%">
                <PolarGrid stroke="rgba(76,91,67,.22)" />
                <PolarAngleAxis dataKey="metric" tick={{ fill: "#3e493b", fontSize: 12, fontWeight: 600 }} />
                <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
                <Radar name="达成率" dataKey="value" stroke="#d9662f" fill="#e77732" fillOpacity={0.28} strokeWidth={2.5} />
                <Tooltip content={<ChartTooltip />} />
              </RadarChart>
            </ResponsiveContainer>
            <div className="radar-explain">
              <span className="eyebrow">GROUP PROFILE</span>
              <h3>组织战力画像</h3>
              <p>所有指标均由本期真实分数推导，满值为 100%。发包登记会随着管理员录入逐步点亮。</p>
              <div className="radar-metrics">
                {data.radarData.map((item) => <span key={item.metric}><b>{item.value}%</b>{item.metric}</span>)}
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
