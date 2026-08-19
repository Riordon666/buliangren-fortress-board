"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { createPortal, useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { CalendarDays, CalendarPlus, CheckCircle2, ChevronDown, Download, Eye, EyeOff, FileSpreadsheet, LoaderCircle, PencilLine, Plus, RotateCcw, Search, Trash2, Upload, UserMinus, UserRoundCheck } from "lucide-react";
import {
  addMemberAction,
  createWeekAction,
  deleteAccountAction,
  deleteWeekAction,
  importScoresAction,
  renameAccountAction,
  renameWeekAction,
  resetPasswordAction,
  setAccountTypeAction,
  setWeekStatusAction,
  toggleMemberAction,
  type AdminFormState
} from "@/app/admin/actions";
import { Avatar } from "@/components/avatar";
import { ONLINE_WINDOW_MS } from "@/lib/constants";
import type { MemberRow, ScoreWeek } from "@/lib/types";

const initialState: AdminFormState = {};

export function SaveScoresButton() {
  const { pending } = useFormStatus();
  return (
    <button className="primary-button" type="submit" disabled={pending}>
      {pending ? <><LoaderCircle className="spin" size={17} /> 保存中</> : "保存战绩与扣包调整"}
    </button>
  );
}

export function AddMemberForm() {
  const [state, action, pending] = useActionState(addMemberAction, initialState);
  const [showInitialPassword, setShowInitialPassword] = useState(false);
  return (
    <form action={action} className="compact-form">
      <div className="form-grid account-form-grid">
        <label><span>游戏昵称 / 登录账号</span><input name="displayName" placeholder="输入游戏中的名字" required /></label>
        <label>
          <span>初始密码</span>
          <span className="password-control">
            <input name="initialPassword" type={showInitialPassword ? "text" : "password"} minLength={8} maxLength={128} placeholder="设置至少8位临时密码" autoComplete="new-password" required />
            <button type="button" onClick={() => setShowInitialPassword((value) => !value)} aria-label="显示或隐藏初始密码">
              {showInitialPassword ? <EyeOff size={17} /> : <Eye size={17} />}
            </button>
          </span>
        </label>
        <label>
          <span>账号类型</span>
          <select name="accountType" defaultValue="member">
            <option value="member">正式组员（参与积分和发包）</option>
            <option value="guest">游客（仅浏览，不参与统计）</option>
          </select>
        </label>
        <label><span>备注</span><input name="note" placeholder="如：高层（可空）" /></label>
      </div>
      {state.error && <div className="form-message error">{state.error}</div>}
      {state.success && <div className="form-message success"><CheckCircle2 size={15} />{state.success}</div>}
      <button className="primary-button" type="submit" disabled={pending}>
        {pending ? <><LoaderCircle className="spin" size={17} /> 添加中</> : <><Plus size={17} /> 添加账号</>}
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

export function WeekManagementList({ weeks, currentWeekId, today }: { weeks: ScoreWeek[]; currentWeekId: number | null; today: string }) {
  return (
    <div className="week-management-list">
      {weeks.map((week) => (
        <article key={week.id} className={week.id === currentWeekId ? "current" : ""}>
          <span className="week-list-icon"><CalendarDays size={16} /></span>
          <form action={renameWeekAction} className="week-rename-form">
            <input type="hidden" name="weekId" value={week.id} />
            <input name="title" className="week-title-input" defaultValue={week.title} maxLength={50} aria-label={`${week.title}的统计周名称`} required />
            <span className="week-rename-meta">
              <small>{week.eventDate}{week.id === currentWeekId ? " · 当前默认周" : ""}</small>
              <button type="submit" className="text-button week-rename-button"><PencilLine size={13} />保存名称</button>
            </span>
          </form>
          <form action={setWeekStatusAction} className="week-status-form">
            <input type="hidden" name="weekId" value={week.id} />
            <input type="hidden" name="status" value={week.status === "draft" ? "published" : week.status === "published" ? "locked" : "published"} />
            <button type="submit" className={`text-button week-status-button status-${week.status}`}>
              {week.status === "draft" ? "发布" : week.status === "published" ? "锁定" : "解除锁定"}
            </button>
          </form>
          {week.eventDate > today && <form
            action={deleteWeekAction}
            onSubmit={(event) => {
              if (!confirm(`确定删除“${week.title}”吗？\n该周积分和发包安排会删除，永久累计扣包记录会保留；若该周尚未开始，待执行次数会自动顺延。`)) {
                event.preventDefault();
              }
            }}
          >
            <input type="hidden" name="weekId" value={week.id} />
            <button type="submit" className="text-button danger week-delete-button"><Trash2 size={14} />删除</button>
          </form>}
        </article>
      ))}
      {!weeks.length && <div className="empty-inline">还没有统计周。</div>}
    </div>
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

function AccountActionsMenu({ member, members, currentUserId, open, onToggle, onClose }: {
  member: MemberRow;
  members: MemberRow[];
  currentUserId: number;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    const updatePosition = () => {
      const button = buttonRef.current;
      if (!button) return;
      const rect = button.getBoundingClientRect();
      const width = Math.min(224, window.innerWidth - 16);
      const menuHeight = menuRef.current?.offsetHeight || 250;
      const openUpward = window.innerHeight - rect.bottom < menuHeight + 12;
      setPosition({
        top: openUpward ? Math.max(8, rect.top - menuHeight - 7) : rect.bottom + 7,
        left: Math.min(window.innerWidth - width - 8, Math.max(8, rect.right - width))
      });
    };
    const closeOnOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!buttonRef.current?.contains(target) && !menuRef.current?.contains(target)) onClose();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      onClose();
      window.requestAnimationFrame(() => buttonRef.current?.focus());
    };
    updatePosition();
    const frame = window.requestAnimationFrame(() => {
      updatePosition();
      menuRef.current?.querySelector<HTMLElement>("button")?.focus();
    });
    document.addEventListener("pointerdown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, onClose]);

  const menu = open && typeof document !== "undefined" ? createPortal(
    <div
      ref={menuRef}
      className="member-actions-popover"
      role="dialog"
      aria-label={`管理 ${member.displayName} 的账号`}
      style={position ? { top: position.top, left: position.left } : { top: -1000, left: -1000 }}
    >
      <strong className="member-actions-title">管理 {member.displayName}</strong>
      <form action={renameAccountAction} onSubmit={(event) => {
        const displayName = prompt("输入新的游戏昵称（也会作为登录账号）：", member.displayName)?.trim();
        if (!displayName || displayName === member.displayName) {
          event.preventDefault();
          return;
        }
        if (members.some((item) => item.id !== member.id && item.username.localeCompare(displayName, "zh-CN", { sensitivity: "accent" }) === 0)) {
          event.preventDefault();
          alert("这个登录账号已经存在，请换一个名字。");
          return;
        }
        (event.currentTarget.elements.namedItem("displayName") as HTMLInputElement).value = displayName;
      }}>
        <input type="hidden" name="userId" value={member.id} />
        <input type="hidden" name="displayName" value="" />
        <button type="submit" className="text-button"><PencilLine size={15} />修改名字</button>
      </form>
      {member.id !== currentUserId && member.role !== "admin" && <form action={setAccountTypeAction} onSubmit={(event) => {
        const nextLabel = member.accountType === "guest" ? "正式组员" : "游客";
        if (!confirm(`确定把 ${member.displayName} 设为${nextLabel}？${member.accountType === "member" ? "游客不会进入积分、排名和发包，也不能自行修改密码。" : "转为组员后会补入当前及未来统计周。"}`)) event.preventDefault();
      }}>
        <input type="hidden" name="userId" value={member.id} />
        <input type="hidden" name="accountType" value={member.accountType === "guest" ? "member" : "guest"} />
        <button type="submit" className="text-button"><UserRoundCheck size={15} />设为{member.accountType === "guest" ? "组员" : "游客"}</button>
      </form>}
      <form action={resetPasswordAction} onSubmit={(event) => {
        const temporaryPassword = prompt(`为 ${member.displayName} 设置至少8位的${member.accountType === "guest" ? "共享" : "临时"}密码：`);
        if (!temporaryPassword || temporaryPassword.length < 8) {
          event.preventDefault();
          if (temporaryPassword !== null) alert("密码至少需要8位。");
          return;
        }
        (event.currentTarget.elements.namedItem("temporaryPassword") as HTMLInputElement).value = temporaryPassword;
        if (!confirm(`确定重置 ${member.displayName} 的密码并注销其全部会话？`)) event.preventDefault();
      }}>
        <input type="hidden" name="userId" value={member.id} />
        <input type="hidden" name="temporaryPassword" value="" />
        <button type="submit" className="text-button"><RotateCcw size={15} />设置密码</button>
      </form>
      {member.id !== currentUserId && member.role !== "admin" && <form action={toggleMemberAction} onSubmit={(event) => {
        if (!confirm(member.isActive ? `确定停用 ${member.displayName}？历史分数会保留。` : `确定恢复 ${member.displayName}？`)) event.preventDefault();
      }}>
        <input type="hidden" name="userId" value={member.id} />
        <input type="hidden" name="activate" value={member.isActive ? "0" : "1"} />
        <button type="submit" className={member.isActive ? "text-button danger" : "text-button restore"}>
          {member.isActive ? <><UserMinus size={15} />停用账号</> : <><UserRoundCheck size={15} />恢复账号</>}
        </button>
      </form>}
      {member.id !== currentUserId && member.role !== "admin" && <form action={deleteAccountAction} onSubmit={(event) => {
        const typed = prompt(`永久删除账号“${member.displayName}”？\n历史积分和已发包记录会保留。\n请输入账号名称确认：`);
        if (typed !== member.displayName) {
          event.preventDefault();
          if (typed !== null) alert("输入的账号名称不一致，已取消删除。");
        }
      }}>
        <input type="hidden" name="userId" value={member.id} />
        <button type="submit" className="text-button danger delete-account-button"><Trash2 size={15} />删除账号</button>
      </form>}
    </div>,
    document.body
  ) : null;

  return (
    <div className="member-actions-menu">
      <button ref={buttonRef} type="button" className="text-button" aria-expanded={open} onClick={onToggle}>
        <PencilLine size={15} />管理账号<ChevronDown className={open ? "rotated" : ""} size={14} />
      </button>
      {menu}
    </div>
  );
}

export function AdminMemberList({ members, currentUserId }: { members: MemberRow[]; currentUserId: number }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "online" | "guest" | "inactive">("all");
  const [, setTick] = useState(0);
  const [openMemberId, setOpenMemberId] = useState<number | null>(null);
  const router = useRouter();

  useEffect(() => {
    const timer = window.setInterval(() => {
      setTick((value) => value + 1);
      router.refresh();
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [router]);

  const filtered = useMemo(() => members.filter((member) => {
    const matchesQuery = `${member.displayName}${member.username}${member.note || ""}`.toLowerCase().includes(query.toLowerCase());
    const matchesFilter = filter === "all"
      || (filter === "online" ? member.isActive && isOnline(member.lastSeenAt)
        : filter === "guest" ? member.accountType === "guest" : !member.isActive);
    return matchesQuery && matchesFilter;
  }), [members, query, filter]);

  return (
    <>
      <div className="member-toolbar">
        <label className="search-box"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索账号" /></label>
        <div className="filter-pills">
          {(["all", "online", "guest", "inactive"] as const).map((value) => (
            <button key={value} type="button" className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>
              {value === "all" ? "全部" : value === "online" ? "在线" : value === "guest" ? "游客" : "已停用"}
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
                <div><strong>{member.displayName} <i className={`account-type-badge ${member.accountType}`}>{member.accountType === "guest" ? "游客" : member.role === "admin" ? "管理员" : "组员"}</i></strong><span>@{member.username} {member.note && <em>{member.note}</em>}</span></div>
              </div>
              <div className="online-cell">
                <span className={online ? "online-text" : "offline-text"}><i />{online ? "在线" : member.isActive ? "离线" : "已停用"}</span>
                <small>{online ? "刚刚活跃" : formatLastSeen(member.lastSeenAt)}</small>
              </div>
              <AccountActionsMenu
                member={member}
                members={members}
                currentUserId={currentUserId}
                open={openMemberId === member.id}
                onToggle={() => setOpenMemberId((value) => value === member.id ? null : member.id)}
                onClose={() => setOpenMemberId(null)}
              />
            </article>
          );
        })}
        {!filtered.length && <div className="empty-inline">没有符合条件的账号。</div>}
      </div>
    </>
  );
}
