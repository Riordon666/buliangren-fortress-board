"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, CheckCheck, CircleAlert, LoaderCircle, Mail, MailMinus } from "lucide-react";

type SubscriptionAction = "confirm" | "unsubscribe";

export function NewsSubscriptionAction({ action, token }: { action: SubscriptionAction; token: string }) {
  const [activeToken, setActiveToken] = useState(token);
  const [state, setState] = useState<"idle" | "pending" | "success" | "error">("idle");
  const [message, setMessage] = useState("");
  const confirming = action === "confirm";
  const pending = state === "pending";
  const succeeded = state === "success";

  async function submit() {
    if (!activeToken || pending || succeeded) return;
    setState("pending");
    setMessage(confirming ? "正在确认订阅…" : "正在办理退订…");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await fetch(`/api/news/subscriptions/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: activeToken }),
        cache: "no-store",
        referrerPolicy: "no-referrer",
        signal: controller.signal
      });
      const result: unknown = await response.json();
      const serverMessage = result && typeof result === "object" && "message" in result && typeof result.message === "string" ? result.message : null;
      if (response.ok) {
        setState("success");
        setMessage(serverMessage ?? (confirming ? "订阅已确认，下一期木叶快报更新时会通知你。" : "已退订，今后不再向你发送木叶快报。"));
        setActiveToken("");
        window.history.replaceState(window.history.state, "", window.location.pathname);
      } else {
        setState("error");
        setMessage(serverMessage ?? (response.status === 429 ? "操作有些频繁，请稍后再试。" : response.status === 503 ? "服务暂时不可用，请稍后再试。" : "链接无效或已经过期，请使用邮件中的最新链接。"));
      }
    } catch {
      setState("error");
      setMessage("暂时无法确认处理结果，请稍后再试。");
    } finally {
      clearTimeout(timeout);
    }
  }

  return <section className="news-subscription-action public-panel" aria-labelledby="news-subscription-action-title">
    <span className={`news-subscription-action-seal ${succeeded ? "is-complete" : ""}`}>{succeeded ? <CheckCheck size={38} aria-hidden="true" /> : confirming ? <Mail size={38} aria-hidden="true" /> : <MailMinus size={38} aria-hidden="true" />}</span>
    <span className="news-subscription-action-kicker">木叶快报 · 邮件订阅</span>
    <h1 id="news-subscription-action-title">{succeeded ? confirming ? "订阅已确认" : "已完成退订" : confirming ? "确认接收木叶来信" : "退订木叶快报"}</h1>
    <p className="news-subscription-action-intro">{succeeded ? confirming ? "下一期快报更新后，我们会把活动内容与长图寄给你。" : "之后的新一期快报将不再发送到这个邮箱。你仍可以随时来网站阅读。" : confirming ? "点击下方按钮完成订阅。确认后，仅在新一期快报收录时发送邮件，每封邮件都可退订。" : "点击下方按钮停止接收快报邮件。仅打开这个页面不会改变订阅状态。"}</p>
    {!activeToken && !succeeded ? <div className="news-subscription-action-message is-error" role="status"><CircleAlert size={20} aria-hidden="true" /><span>链接缺少有效信息，请从邮件中重新打开完整链接。</span></div> : <div className={`news-subscription-action-message ${state === "error" ? "is-error" : succeeded ? "is-success" : ""}`} role="status" aria-live="polite" aria-atomic="true">{message && <>{succeeded ? <CheckCheck size={20} aria-hidden="true" /> : state === "error" ? <CircleAlert size={20} aria-hidden="true" /> : null}<span>{message}</span></>}</div>}
    {!succeeded && <button type="button" className="news-subscription-action-button" onClick={() => void submit()} disabled={!activeToken || pending}>{pending && <LoaderCircle size={19} className="news-subscription-spinner" aria-hidden="true" />}{pending ? "正在处理…" : confirming ? "确认订阅" : "确认退订"}</button>}
    <Link href="/news" className="news-subscription-return" referrerPolicy="no-referrer"><ArrowLeft size={17} aria-hidden="true" />{succeeded || !activeToken ? "返回木叶快报" : confirming ? "暂不确认，先看快报" : "保留订阅，返回快报"}</Link>
    <p className="news-subscription-action-footer">邮件发自 naruto@riordon.xyz</p>
  </section>;
}
