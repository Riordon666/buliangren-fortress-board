"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarPlus, CheckCircle2, Download, FileSpreadsheet, LoaderCircle, Plus, RotateCcw, Search, Upload, UserMinus, UserRoundCheck } from "lucide-react";
import {
  addMemberAction,
  createWeekAction,
  importScoresAction,
  resetPasswordAction,
  toggleMemberAction,
  type AdminFormState
} from "@/app/admin/actions";
import { Avatar } from "@/components/avatar";
import { ONLINE_WINDOW_MS } from "@/lib/constants";
import type { MemberRow } from "@/lib/types";

const initialState: AdminFormState = {};

export function AddMemberForm() {
  const [state, action, pending] = useActionState(addMemberAction, initialState);
  return (
    <form action={action} className="compact-form">
      <div className="form-grid three">
        <label><span>登录账号</span><input name="username" placeholder="可直接使用游戏昵称" required /></label>
        <label><span>游戏昵称</span><input name="displayName" placeholder="组员在游戏中的名字" required /></label>
        <label><span>备注</span><input name="note" placeholder="如：高层（可空）" /></label>
      </div>
      {state.error && <div className="form-message error">{state.error}</div>}
      {state.success && <div className="form-message success"><CheckCircle2 size={15} />{state.success}</div>}
      <button className="primary-button" type="submit" disabled={pending}>
        {pending ? <><LoaderCircle className="spin" size={17} /> 添加中</> : <><Plus size={17} /> 添加组员</>}
      </button>
    </form>
  );
}

export function CreateWeekForm() {
  const [state, action, pending] = useActionState(createWeekAction, initialState);
  return (
    <form action={action} className="compact-form week-form">
      <div className="form-grid">
        <label><span>统计周名称</span><input name="title" placeholder="例如：第2期 · 风之要塞" required /></label>
        <label><span>发包起始日（周六）</span><input name="eventDate" type="date" required /></label>
      </div>
      {state.error && <div className="form-message error">{state.error}</div>}
      {state.success && <div className="form-message success"><CheckCircle2 size={15} />{state.success}</div>}
      <button className="secondary-button" type="submit" disabled={pending}>
        {pending ? <LoaderCircle className="spin" size={17} /> : <CalendarPlus size={17} />} 创建新一周
      </button>
    </form>
  );
}

export function ScoreImportForm({ weekId, weekTitle }: { weekId: number; weekTitle: string }) {
  const [state, action, pending] = useActionState(importScoresAction, initialState);
  const [fileName, setFileName] = useState("");
  return (
    <form action={action} className="score-import-form">
      <input type="hidden" name="weekId" value={weekId} />
      <div className="import-guide">
        <span className="import-icon"><FileSpreadsheet size={23} /></span>
        <div><strong>导入到：{weekTitle}</strong><span>成员名称必须与网站完全一致，分数填写非负整数。</span></div>
      </div>
      <label className="spreadsheet-picker">
        <Upload size={18} />
        <span><strong>{fileName || "选择积分表"}</strong><small>仅支持标准 .xlsx 文件，最大 1MB</small></span>
        <input
          name="scoreFile"
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={(event) => setFileName(event.currentTarget.files?.[0]?.name || "")}
          required
        />
      </label>
      {state.error && <div className="form-message error">{state.error}</div>}
      {state.success && <div className="form-message success"><CheckCircle2 size={15} />{state.success}</div>}
      <div className="import-actions">
        <a className="secondary-button" href="/assets/buliangren-score-import-template.xlsx" download><Download size={16} />下载标准模板</a>
        <button className="primary-button" type="submit" disabled={pending}>
          {pending ? <><LoaderCircle className="spin" size={17} />校验并导入</> : <><Upload size={17} />导入本期积分</>}
        </button>
      </div>
    </form>
  );
}

function isOnline(lastSeenAt: string | null) {
  if (!lastSeenAt) return false;
  const normalized = lastSeenAt.includes("T") ? lastSeenAt : `${lastSeenAt.replace(" ", "T")}Z`;
  return Date.now() - new Date(normalized).getTime() <= ONLINE_WINDOW_MS;
}

function formatLastSeen(value: string | null) {
  if (!value) return "从未登录";
  const normalized = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(normalized));
}

export function AdminMemberList({ members, currentUserId }: { members: MemberRow[]; currentUserId: number }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "online" | "inactive">("all");
  const [, setTick] = useState(0);
  const router = useRouter();

  useEffect(() => {
    const timer = window.setInterval(() => {
      setTick((value) => value + 1);
      router.refresh();
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [router]);

  const filtered = useMemo(() => members.filter((member) => {
    const matchesQuery = `${member.displayName}${member.username}${member.note || ""}`.toLowerCase().includes(query.toLowerCase());
    const matchesFilter = filter === "all" || (filter === "online" ? member.isActive && isOnline(member.lastSeenAt) : !member.isActive);
    return matchesQuery && matchesFilter;
  }), [members, query, filter]);

  return (
    <>
      <div className="member-toolbar">
        <label className="search-box"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索组员" /></label>
        <div className="filter-pills">
          {(["all", "online", "inactive"] as const).map((value) => (
            <button key={value} type="button" className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>
              {value === "all" ? "全部" : value === "online" ? "在线" : "已停用"}
            </button>
          ))}
        </div>
      </div>
      <div className="admin-member-list">
        {filtered.map((member) => {
          const online = member.isActive && isOnline(member.lastSeenAt);
          return (
            <article key={member.id} className={`admin-member ${member.isActive ? "" : "inactive"}`}>
              <div className="member-profile">
                <span className="status-avatar"><Avatar name={member.displayName} src={member.avatarUrl} size={46} /><i className={online ? "online" : ""} /></span>
                <div><strong>{member.displayName}</strong><span>@{member.username} {member.note && <em>{member.note}</em>}</span></div>
              </div>
              <div className="online-cell">
                <span className={online ? "online-text" : "offline-text"}><i />{online ? "在线" : member.isActive ? "离线" : "已停用"}</span>
                <small>{online ? "刚刚活跃" : formatLastSeen(member.lastSeenAt)}</small>
              </div>
              <div className="member-actions">
                <form action={resetPasswordAction} onSubmit={(event) => { if (!confirm(`确定将 ${member.displayName} 的密码重置为 7891666？`)) event.preventDefault(); }}>
                  <input type="hidden" name="userId" value={member.id} />
                  <button type="submit" className="text-button"><RotateCcw size={15} />重置密码</button>
                </form>
                {member.id !== currentUserId && (
                  <form action={toggleMemberAction} onSubmit={(event) => { if (!confirm(member.isActive ? `确定停用 ${member.displayName}？历史分数会保留。` : `确定恢复 ${member.displayName}？`)) event.preventDefault(); }}>
                    <input type="hidden" name="userId" value={member.id} />
                    <input type="hidden" name="activate" value={member.isActive ? "0" : "1"} />
                    <button type="submit" className={member.isActive ? "text-button danger" : "text-button restore"}>
                      {member.isActive ? <><UserMinus size={15} />停用</> : <><UserRoundCheck size={15} />恢复</>}
                    </button>
                  </form>
                )}
              </div>
            </article>
          );
        })}
        {!filtered.length && <div className="empty-inline">没有符合条件的组员。</div>}
      </div>
    </>
  );
}
