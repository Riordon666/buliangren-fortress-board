"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, Sparkles } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { PACKAGES_PER_DAY, type PackageDay } from "@/lib/package-plan";

export function PackageDayBrowser({ days, sentDayIndexes, today }: {
  days: PackageDay[];
  sentDayIndexes: number[];
  today: string;
}) {
  const defaultIndex = Math.max(0, days.findIndex((day) => day.date === today));
  const [selectedIndex, setSelectedIndex] = useState(defaultIndex);
  const sent = useMemo(() => new Set(sentDayIndexes), [sentDayIndexes]);
  const day = days[selectedIndex] || days[0];
  if (!day) return null;

  return (
    <section className="package-browser" id="package-days">
      <div className="package-day-tabs" role="tablist" aria-label="选择发包日期">
        {days.map((item) => (
          <button key={item.date} type="button" role="tab" aria-selected={item.dayIndex === day.dayIndex}
            className={`package-day-tab ${item.dayIndex === day.dayIndex ? "active" : ""} ${item.date === today ? "today" : ""}`}
            onClick={() => setSelectedIndex(item.dayIndex)}>
            <small>第{item.dayIndex + 1}天</small><strong>{item.weekday.replace("星期", "周")}</strong><span>{item.date.slice(5)}</span>
            <i className={sent.has(item.dayIndex) ? "sent" : "pending"}>{sent.has(item.dayIndex) ? "已发" : "未发"}</i>
          </button>
        ))}
      </div>
      <article className={`panel package-day-card selected ${day.date === today ? "today" : ""}`}>
        <header>
          <div><span>第 {day.dayIndex + 1} 天</span><h2>{day.weekday}</h2><small>{day.date}</small></div>
          <div className="package-day-meta">{day.date === today ? <b><Sparkles size={13} /> 今天</b> : <b>{day.assignments.length}/{PACKAGES_PER_DAY}</b>}<span className={`send-status mini ${sent.has(day.dayIndex) ? "sent" : "pending"}`}>{sent.has(day.dayIndex) ? "已发包" : "暂未发包"}</span></div>
        </header>
        <div className="package-member-list">
          {Array.from({ length: PACKAGES_PER_DAY }, (_, index) => {
            const assignment = day.assignments[index];
            return assignment ? (
              <div key={`${assignment.member.userId}-${assignment.round}-${assignment.position}`} className="package-member">
                <span className="package-position">{assignment.position}</span>
                <Avatar name={assignment.member.displayName} src={assignment.member.avatarUrl} size={38} />
                <div><strong>{assignment.member.displayName}</strong><small>排名 #{assignment.member.rank} · {assignment.member.score} 分</small></div>
                <span className={`round-chip round-${assignment.round}`}><CheckCircle2 size={12} />第 {assignment.round} 轮</span>
              </div>
            ) : <div key={`empty-${index}`} className="package-member empty-slot"><span className="package-position">{index + 1}</span><span>本位置暂无符合条件的成员</span></div>;
          })}
        </div>
      </article>
    </section>
  );
}
