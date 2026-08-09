"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, Check, ChevronDown } from "lucide-react";
import type { ScoreWeek } from "@/lib/types";

export function WeekPicker({ weeks, selectedId, basePath = "/scores" }: { weeks: ScoreWeek[]; selectedId: number; basePath?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const selectedWeek = weeks.find((week) => week.id === selectedId) || weeks[0];

  useEffect(() => {
    const closeOnOutside = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  return (
    <div className="week-picker-wrap" ref={wrapRef}>
      <button
        type="button"
        className="week-picker"
        aria-label="选择统计周"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="week-calendar"><CalendarDays size={17} /></span>
        <span className="week-button-copy">
          <strong>{selectedWeek?.title || "选择统计周"}</strong>
          {selectedWeek && <small>{selectedWeek.eventDate}</small>}
        </span>
        <ChevronDown className={open ? "open" : ""} size={15} />
      </button>
      {open && (
        <div className="week-menu" role="listbox" aria-label="统计周列表">
          <div className="week-menu-title"><span>战绩卷轴</span><small>选择要查看的统计周期</small></div>
          {weeks.map((week) => {
            const active = week.id === selectedId;
            return (
              <button
                key={week.id}
                type="button"
                role="option"
                aria-selected={active}
                className={active ? "active" : ""}
                onClick={() => {
                  setOpen(false);
                  if (!active) router.push(`${basePath}?week=${week.id}`);
                }}
              >
                <span><strong>{week.title}</strong><small>{week.eventDate}</small></span>
                {active && <Check size={16} />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
