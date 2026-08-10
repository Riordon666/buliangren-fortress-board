"use client";

import { Gift, LoaderCircle } from "lucide-react";
import { useFormStatus } from "react-dom";
import { markPackageSentAction } from "@/app/packages/actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return <button className="primary-button" type="submit" disabled={pending}>{pending ? <><LoaderCircle className="spin" size={16} />确认中</> : <><Gift size={16} />标记今日已发包</>}</button>;
}

export function MarkPackageSentForm({ weekId, dayIndex, memberCount }: { weekId: number; dayIndex: number; memberCount: number }) {
  return <form action={markPackageSentAction} onSubmit={(event) => {
    if (!confirm(`确定已向今天名单中的 ${memberCount} 名成员发包？\n确认后名单会永久冻结，不能撤回。`)) event.preventDefault();
  }}>
    <input type="hidden" name="weekId" value={weekId} />
    <input type="hidden" name="dayIndex" value={dayIndex} />
    <SubmitButton />
  </form>;
}
