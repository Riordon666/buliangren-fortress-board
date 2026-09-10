"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowRight, ArrowUp, BookOpenText, CalendarDays, Check, CheckCheck, CircleAlert, Clock3, Database, ExternalLink, Flame, Maximize2, Minimize2, Newspaper, RefreshCw, ShieldCheck, X } from "lucide-react";
import { ShinobiMark } from "@/components/shinobi-mark";
import { NEWS_SOURCE_URL, type NewsState } from "@/lib/news/types";

function timeLabel(value: string | null) {
  if (!value) return "等待首次核对";
  return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
}

export function NewsReader({ initial }: { initial: NewsState }) {
  const [state, setState] = useState(initial);
  const [checking, setChecking] = useState(false);
  const [refreshMessage, setRefreshMessage] = useState("");
  const [connectionFailed, setConnectionFailed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [progress, setProgress] = useState(0);
  const [updateNotice, setUpdateNotice] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const [imageAttempt, setImageAttempt] = useState(0);
  const activeRequest = useRef<AbortController | null>(null);
  const reader = useRef<HTMLDivElement>(null);
  const currentVersion = useRef(initial.edition ? initial.edition.pages.map(page => page.key).join() : undefined);
  const edition = state.edition;
  const stale = state.status !== "ready" || connectionFailed;
  const schedule = state.schedule;
  const scheduleLabel = schedule.phase === "complete" ? "本周已更新 · 自动检查已暂停" : schedule.phase === "active" ? "等待本周新一期" : "等待下次检查时段";

  const check = useCallback(async (force = false) => {
    if (activeRequest.current) return;
    const controller = new AbortController();
    activeRequest.current = controller;
    setChecking(true);
    if (force) setRefreshMessage("正在向源站重新读取快报…");
    const timeout = setTimeout(() => controller.abort(), 70_000);
    try {
      const response = await fetch("/api/news", { method: force ? "POST" : "GET", cache: "no-store", signal: controller.signal });
      if (response.status === 429) { setRefreshMessage(`刚刚已检查过快报，请在 ${Number(response.headers.get("retry-after")) || 60} 秒后再试。`); return; }
      if (response.status === 403) { setRefreshMessage("刷新请求被网站拒绝，请更新网站版本后重试。"); return; }
      if (!response.ok && response.status !== 503) throw new Error("unavailable");
      const next = await response.json() as NewsState;
      if (!["ready", "stale", "unavailable"].includes(next.status) || typeof next.refreshSeconds !== "number" || !next.schedule) throw new Error("invalid-state");
      const nextVersion = next.edition ? next.edition.pages.map(page => page.key).join() : undefined;
      const changed = next.edition && currentVersion.current !== nextVersion;
      if (changed && currentVersion.current) setUpdateNotice(true);
      if (changed || (force && next.status === "ready")) {
        setImageFailed(false);
        setImageAttempt(attempt => attempt + 1);
      }
      currentVersion.current = nextVersion;
      if (force) setRefreshMessage(next.status !== "ready" ? "源站暂时无法读取，已保留上次内容，将按计划重试。" : changed ? "已从源站获取并显示最新快报。" : "已核对源站，没有发现新的快报内容。");
      // Keep a readable edition if a restarted server temporarily has no cached content.
      setState((previous) => !next.edition && previous.edition ? { ...next, status: "stale", edition: previous.edition } : next);
      setConnectionFailed(false);
    } catch {
      if (force && activeRequest.current === controller) setRefreshMessage("刷新暂未成功，请稍后重试或查看腾讯原文。");
      if (!controller.signal.aborted) setConnectionFailed(true);
      else if (activeRequest.current === controller) setConnectionFailed(true);
    } finally {
      clearTimeout(timeout);
      if (activeRequest.current === controller) { activeRequest.current = null; setChecking(false); }
    }
  }, []);

  useEffect(() => {
    const wake = () => { if (document.visibilityState === "visible") void check(); };
    let stopped = false;
    const delay = () => Math.min(2_147_483_647, Math.max(5_000, Date.parse(state.schedule.nextCheckAt) - Date.now() + 3_000));
    const poll = async () => {
      if (document.visibilityState === "visible") await check();
      if (!stopped) timer = setTimeout(poll, Math.max(60_000, delay()));
    };
    let timer = setTimeout(poll, delay());
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("focus", wake);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("focus", wake);
      const request = activeRequest.current;
      activeRequest.current = null;
      request?.abort();
    };
  }, [check, state]);

  useEffect(() => {
    if (!edition || !reader.current) return;
    const update = () => {
      const rect = reader.current!.getBoundingClientRect();
      const ratio = (window.innerHeight - rect.top) / Math.max(rect.height, 1);
      setProgress(Math.max(0, Math.min(100, Math.round(ratio * 100))));
    };
    const observer = new ResizeObserver(update);
    observer.observe(reader.current);
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => { observer.disconnect(); window.removeEventListener("scroll", update); window.removeEventListener("resize", update); };
  }, [edition]);

  const jump = (fraction: number) => {
    if (!reader.current) return;
    const top = reader.current.getBoundingClientRect().top + window.scrollY;
    window.scrollTo({ top: top + reader.current.offsetHeight * fraction - 100, behavior: "smooth" });
  };

  return <div className="news-page">
    <header className="news-masthead">
      <div className="news-masthead-symbol" aria-hidden="true"><ShinobiMark size={60} /></div>
      <div className="news-masthead-copy"><span className="eyebrow"><Newspaper size={15} /> KONOHA WEEKLY</span><h1>木叶快报</h1><p>村里消息早知道，每周活动一卷掌握。</p></div>
      <div className="news-masthead-note"><span>忍者情报站</span><strong>本周，先看再出发。</strong><small>活动前瞻 · 公开阅读 · 自动更新</small></div>
    </header>

    <div className="news-mobile-status" aria-live="polite"><span className={stale ? "is-stale" : "is-ready"}>{stale ? <CircleAlert size={15} /> : <CheckCheck size={15} />}{!edition ? "等待快报" : stale ? "保留上次内容" : "已收录快报"}</span><span>{state.checkedAt ? `核对 ${timeLabel(state.checkedAt)}` : "尚未核对源站"}</span><small>{scheduleLabel} · 下次 {timeLabel(schedule.nextCheckAt)}</small></div>

    <div className="news-layout">
      <aside className="news-left-rail" aria-label="快报阅读导航">
        <section className="news-side-card news-directory"><span className="eyebrow">READING GUIDE</span><h2><BookOpenText size={20} />阅读导航</h2><p>一张长报，收好本周情报。</p><div className="news-jump-list"><button onClick={() => jump(0)}><b>01</b><span>卷首 · 开始阅读</span><ArrowRight size={15} /></button><button onClick={() => jump(.32)}><b>02</b><span>继续 · 快报中段</span><ArrowDown size={15} /></button><button onClick={() => jump(.65)}><b>03</b><span>往下 · 更多情报</span><ArrowDown size={15} /></button><button onClick={() => jump(1)}><b>04</b><span>卷尾 · 阅读完毕</span><Check size={15} /></button></div><div className="news-progress"><span>阅读进度<strong>{progress}%</strong></span><progress max={100} value={progress} aria-label="快报阅读进度" /></div></section>
        <section className="news-side-card news-scroll-note"><Flame size={27} /><blockquote>情报在手，<br />修行有数。</blockquote><p>先看活动安排，再规划这周的忍者之路。</p></section>
      </aside>

      <section className="news-reader-column" aria-label="本期木叶快报">
        <div className="news-reader-toolbar"><div><span className="news-volume">本期快报</span><span className="news-original">源站原图</span></div><div className="news-reader-tools"><button onClick={() => setExpanded(!expanded)} aria-pressed={expanded} disabled={!edition}>{expanded ? <Minimize2 size={17} /> : <Maximize2 size={17} />}{expanded ? "适合屏幕" : "放大阅读"}</button><button onClick={() => void check(true)} disabled={checking} aria-label="检查快报更新"><RefreshCw size={17} className={checking ? "spin" : ""} /><span>{checking ? "检查中" : "检查更新"}</span></button></div></div>
        {updateNotice && <div className="news-update-notice" role="status"><CheckCheck size={19} /><span>源站快报已更新，当前已切换为新内容。</span><button onClick={() => { jump(0); setUpdateNotice(false); }}>从头阅读</button><button aria-label="关闭更新提示" onClick={() => setUpdateNotice(false)}><X size={16} /></button></div>}
        {edition && stale && <div className="news-stale-notice" role="status"><CircleAlert size={18} /><span>上次核对未成功，正在展示已保存的快报。下次计划时间会重试，也可手动刷新。</span></div>}
        {expanded && edition && <p className="news-zoom-hint"><Maximize2 size={15} />已放大到原始尺寸，可在图片区域左右滑动查看。</p>}
        {edition ? <div ref={reader} className={`news-poster-reader ${expanded ? "is-expanded" : ""}`}>
          {edition.pages.map((page, index) => <figure key={page.key + imageAttempt} className="news-poster"><img src={`/api/news/images/${page.key}`} alt={`火影忍者手游木叶快报活动长图，第 ${index + 1} 页。可放大阅读，或通过页面底部链接查看腾讯原文。`} width={page.width} height={page.height} loading={index === 0 ? "eager" : "lazy"} fetchPriority={index === 0 ? "high" : "auto"} onError={() => setImageFailed(true)} /></figure>)}
        </div> : <div className="news-empty"><Newspaper size={44} /><h2>快报暂时还未送达</h2><p>暂时没有可展示的活动内容。到达计划时段后会自动检查，也可以立即手动检查或打开腾讯原文。</p><button className="primary-button" onClick={() => void check(true)} disabled={checking}><RefreshCw size={17} className={checking ? "spin" : ""} />{checking ? "正在检查" : "重新检查"}</button><a href={NEWS_SOURCE_URL} target="_blank" rel="noopener noreferrer">前往腾讯原文 <ExternalLink size={15} /></a></div>}
        {imageFailed && <div className="news-stale-notice" role="alert"><CircleAlert size={18} /><span>长图加载失败，请刷新页面重试，或打开腾讯原文查看。</span></div>}
        <footer className="news-source-credit"><div><ShieldCheck size={19} /><span><strong>内容来自腾讯木叶快报页面</strong><small>保留源站原图及署名，活动详情以游戏内正式公告为准。</small></span></div><a href={NEWS_SOURCE_URL} target="_blank" rel="noopener noreferrer">查看腾讯原文 <ExternalLink size={16} /></a></footer>
      </section>

      <aside className="news-right-rail" aria-label="快报更新与资料入口">
        <section className="news-side-card news-sync-card"><span className="eyebrow">INTELLIGENCE DESK</span><h2>情报同步台</h2><div className={`news-sync-badge ${stale ? "is-stale" : "is-ready"}`}>{stale ? <CircleAlert size={18} /> : <CheckCheck size={18} />}{!edition ? "等待快报" : stale ? "上次同步内容" : "已收录快报"}</div><dl><div><dt>最近核对</dt><dd>{timeLabel(state.checkedAt)}</dd></div><div><dt>本期收录</dt><dd>{edition ? timeLabel(edition.syncedAt) : "尚未收录"}</dd></div><div><dt>下次自动检查</dt><dd>{timeLabel(schedule.nextCheckAt)}</dd></div></dl><p className="news-schedule-status"><strong>{scheduleLabel}</strong><span>北京时间 · 周二 15:00–20:00 每 5 分钟，周三同一时段每 1 分钟。识别到本周新内容后暂停到下周。</span></p><div className="news-manual-update"><p>快报更新了，但这里还是旧的？</p><button onClick={() => void check(true)} disabled={checking}><RefreshCw size={17} className={checking ? "spin" : ""} />{checking ? "刷新中…" : "立即刷新"}</button><small role="status" aria-live="polite">{refreshMessage || "时段外也可手动检查，全站共用 1 分钟冷却。"}</small></div></section>
        <section className="news-side-card news-cadence"><span className="news-side-icon"><CalendarDays size={23} /></span><h2>每周情报日</h2><strong>周二 / 周三</strong><p>北京时间 15:00–20:00。其他时段不自动请求腾讯，阅读页面只读取本站缓存。</p><span><Clock3 size={15} />本周新一期收录后自动暂停</span></section>
        <Link href="/accessories" className="news-side-card news-related"><Database size={25} /><h2>饰品资料库</h2><p>看完本周活动，顺手查查抗魔值与饰品系列。</p><span>打开资料卷轴 <ArrowRight size={17} /></span></Link>
        <button className="news-back-top" onClick={() => window.scrollTo({top: 0, behavior: "smooth"})}><ArrowUp size={17} />回到顶部</button>
      </aside>
    </div>
  </div>;
}
