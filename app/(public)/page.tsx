import Link from "next/link";
import { ArrowRight, BookOpenText, Database, Flame, LockKeyhole, Search, ShieldCheck, Sparkles } from "lucide-react";
import { ACCESSORY_SERIES, ACCESSORY_SLOTS } from "@/lib/accessory-data";

export const metadata = { title: "火影手游资料库" };

export default function PublicHomePage() {
  const latestSeries = ACCESSORY_SERIES.slice(-4).reverse();
  return (
    <div className="public-home">
      <section className="public-hero">
        <div className="public-hero-copy">
          <span className="public-kicker"><Flame size={17} /> 木叶隐村 · 忍者情报站</span>
          <h1>火影手游资料库</h1>
          <div className="public-nindo">你的忍道，从这里出发。</div>
          <p>查饰品、看战绩、与同伴并肩作战。<br />不良人为每一位忍者，整理好下一程的情报。</p>
          <div className="public-hero-actions">
            <Link href="/accessories" className="primary-button"><Search size={19} />查询饰品数据</Link>
            <Link href="/login" className="secondary-button"><ShieldCheck size={19} />进入组织内部</Link>
          </div>
          <div className="public-trust-row">
            <span><BookOpenText size={18} /><b>公开资料，随时查阅</b><small>无需登录 · 标明资料来源</small></span>
            <span><Sparkles size={18} /><b>3767 区 · 2 组</b><small>不良人 · 每一分贡献都算数</small></span>
          </div>
        </div>
        <aside className="public-hero-card" aria-label="饰品资料概览">
          <header><span className="eyebrow"><Database size={15} /> 饰品情报速览</span><strong>修行有方向，战力再进阶</strong></header>
          <div className="hero-series-list">
            {latestSeries.map((series) => <span key={series.id}><b>{series.name}</b><small>{series.equipLevel} 级</small><em>最高 +{series.maxEnhance}</em></span>)}
          </div>
          <Link href="/accessories">展开全部 {ACCESSORY_SERIES.length} 个系列 <ArrowRight size={17} /></Link>
        </aside>
      </section>
      <section className="public-metric-grid" aria-label="公开资料概览">
        <article><span>收录系列</span><strong>{ACCESSORY_SERIES.length}</strong><small>自由至云迹</small></article>
        <article><span>饰品部位</span><strong>{ACCESSORY_SLOTS.length}</strong><small>{ACCESSORY_SLOTS.slice(0, 3).join("、")}等</small></article>
        <article><span>覆盖等级</span><strong>60–165</strong><small>按穿戴等级整理</small></article>
        <article><span>资料查询</span><strong>公开</strong><small>无需注册或登录</small></article>
      </section>
      <section className="public-feature-grid">
        <article className="public-panel featured-archive">
          <div className="feature-icon"><Database size={28} /></div>
          <div><span className="eyebrow">情报卷轴 · 随时查阅</span><h2>饰品资料库</h2><p>输入抗魔值，快速找到对应系列。穿戴等级、强化上限与各部位资料，一页查清。</p></div>
          <div className="feature-tags">{ACCESSORY_SLOTS.map((slot) => <span key={slot}>{slot}</span>)}</div>
          <Link href="/accessories" className="primary-button">立即查询 <ArrowRight size={18} /></Link>
        </article>
        <article className="public-panel access-boundary-card">
          <span className="eyebrow"><LockKeyhole size={15} /> 组织作战中心</span>
          <h2>不良人，集结！</h2>
          <p>每周要塞战绩、今日发包名单、同伴的成长轨迹，都记录在组织的作战卷轴里。</p>
          <div className="squad-entry-tags"><span>要塞积分</span><span>发包安排</span><span>每周战报</span></div>
          <Link href="/login" className="secondary-button">组织账号登录 <ArrowRight size={18} /></Link>
          <small>组织资料需登录查看，游客账号可按权限浏览。</small>
        </article>
      </section>
    </div>
  );
}
