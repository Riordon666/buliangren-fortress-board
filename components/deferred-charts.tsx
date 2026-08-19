"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { BarChart3, LoaderCircle } from "lucide-react";
import type { ScoreRow, TrendPoint } from "@/lib/types";

type ComparisonMember = { id: number; displayName: string };
type ComparisonTrend = {
  userId: number;
  displayName: string;
  eventDate: string;
  weekTitle: string;
  score: number;
  rank: number;
};

const ScoreCharts = dynamic(
  () => import("@/components/score-visualizations").then((module) => module.ScoreVisualizations),
  { ssr: false, loading: () => <ChartLoading /> }
);
const HistoryChart = dynamic(
  () => import("@/components/member-history-chart").then((module) => module.MemberHistoryChart),
  { ssr: false, loading: () => <ChartLoading /> }
);
const ComparisonChart = dynamic(
  () => import("@/components/member-comparison").then((module) => module.MemberComparison),
  { ssr: false, loading: () => <ChartLoading /> }
);

function ChartLoading() {
  return <div className="deferred-chart-loading"><LoaderCircle className="spin" size={19} /> 正在载入图表</div>;
}

function DeferredViewport({ children, minHeight }: { children: React.ReactNode; minHeight: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element || !("IntersectionObserver" in window)) {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setVisible(true);
        observer.disconnect();
      }
    }, { rootMargin: "500px 0px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} className="deferred-chart" style={{ minHeight }}>
      {visible ? children : <div className="deferred-chart-placeholder"><BarChart3 size={22} /><span>图表将在接近可视区域时载入</span></div>}
    </div>
  );
}

export function DeferredScoreVisualizations({
  rows,
  packageRoundsByUser
}: {
  rows: ScoreRow[];
  packageRoundsByUser: Record<number, number[]>;
}) {
  return <DeferredViewport minHeight={520}><ScoreCharts rows={rows} packageRoundsByUser={packageRoundsByUser} /></DeferredViewport>;
}

export function DeferredMemberHistoryChart({ trend }: { trend: TrendPoint[] }) {
  return <DeferredViewport minHeight={290}><HistoryChart trend={trend} /></DeferredViewport>;
}

export function DeferredMemberComparison({
  members,
  trends,
  initialIds
}: {
  members: ComparisonMember[];
  trends: ComparisonTrend[];
  initialIds: number[];
}) {
  return <DeferredViewport minHeight={430}><ComparisonChart members={members} trends={trends} initialIds={initialIds} /></DeferredViewport>;
}
