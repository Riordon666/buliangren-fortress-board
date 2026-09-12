"use client";

import { useId, useState, type FormEvent } from "react";
import { CheckCheck, CircleAlert, LoaderCircle, Mail, Send } from "lucide-react";

type SubmissionState = "idle" | "pending" | "success" | "error";

export function NewsSubscriptionCard({ enabled = false }: { enabled?: boolean }) {
  const inputId = useId();
  const statusId = useId();
  const [email, setEmail] = useState("");
  const [state, setState] = useState<SubmissionState>("idle");
  const [message, setMessage] = useState("");
  const pending = state === "pending";

  async function subscribe(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!enabled || pending) return;
    setState("pending");
    setMessage("正在发送确认邮件…");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await fetch("/api/news/subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
        signal: controller.signal,
        cache: "no-store"
      });
      const result: unknown = await response.json();
      const serverMessage = result && typeof result === "object" && "message" in result && typeof result.message === "string" ? result.message : null;
      setState(response.ok ? "success" : "error");
      setMessage(serverMessage ?? (response.ok ? "请前往邮箱，点击确认链接完成订阅。" : response.status === 429 ? "操作有些频繁，请稍后再试。" : response.status === 503 ? "邮件订阅暂时不可用，请稍后再试。" : "暂时未能提交订阅，请检查邮箱地址后重试。"));
    } catch {
      setState("error");
      setMessage("暂时未收到发送结果，请先检查收件箱，稍后可重新提交。");
    } finally {
      clearTimeout(timeout);
    }
  }

  return <section className="news-side-card news-subscription-card" aria-labelledby={`${inputId}-title`}>
    <div className="news-subscription-heading"><span className="news-subscription-seal"><Mail size={23} aria-hidden="true" /></span><div><span>木叶来信</span><h2 id={`${inputId}-title`}>快报更新，寄给你</h2></div></div>
    <p className="news-subscription-intro">订阅后，新一期快报连同活动长图，一起送到你的邮箱。</p>
    <form className="news-subscription-form" onSubmit={(event) => void subscribe(event)} aria-busy={pending}>
      <label htmlFor={inputId}>接收邮箱</label>
      <input id={inputId} type="email" name="email" inputMode="email" autoComplete="email" autoCapitalize="none" spellCheck={false} maxLength={254} placeholder="填写你的邮箱地址" value={email} onChange={(event) => { setEmail(event.target.value); if (state !== "idle") { setState("idle"); setMessage(""); } }} disabled={!enabled || pending} required aria-describedby={statusId} />
      <button type="submit" disabled={!enabled || pending || !email.trim()}>{pending ? <LoaderCircle size={18} className="news-subscription-spinner" aria-hidden="true" /> : <Send size={18} aria-hidden="true" />}{!enabled ? "邮件订阅暂未开放" : pending ? "正在发送…" : "发送订阅确认邮件"}</button>
    </form>
    <div id={statusId} className={`news-subscription-status ${state === "success" ? "is-success" : state === "error" ? "is-error" : ""}`} role="status" aria-live="polite" aria-atomic="true">{message ? <>{state === "success" ? <CheckCheck size={18} aria-hidden="true" /> : state === "error" ? <CircleAlert size={18} aria-hidden="true" /> : null}<span>{message}</span></> : !enabled ? <span>订阅服务准备中，开通后即可接收快报邮件。</span> : <span>先收确认邮件，确认后才开始接收新一期通知。</span>}</div>
    <p className="news-subscription-note">每封快报邮件都可退订。<br />发件地址：<span>naruto@riordon.xyz</span></p>
  </section>;
}
