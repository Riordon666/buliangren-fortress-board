import Link from "next/link";
import { ArrowRight, BookOpenText, Database, LockKeyhole, Search, ShieldCheck, Sparkles } from "lucide-react";
import { ACCESSORY_SERIES, ACCESSORY_SLOTS } from "@/lib/accessory-data";

export const metadata = { title: "火影手游资料库" };

export default function PublicHomePage() {
  const latestSeries = ACCESSORY_SERIES.slice(-4).reverse();

  return (
    <div className="public-home">
      <section className="public-hero">
        <div className="public-hero-copy">
          <span className="public-kicker"><Sparkles size={17} /> 火影忍者手游 · 玩家资料卷轴</span>
          <h1>火影手游资料库</h1>
          <p>无需登录，直接查询饰品系列、抗魔区间、穿戴等级与强化上限。公开资料与“不良人”组织内部数据完全分开。</p>
          <div className="public-hero-actions">
            <Link href="/accessories" className="primary-button"><Search size={19} />查询饰品数据</Link>
            <Link href="/login" className="secondary-button"><ShieldCheck size={19} />进入组织内部</Link>
          </div>
          <div className="public-trust-row">
            <span><BookOpenText size={18} /><b>来源可追溯</b><small>资料页标明出处与待核实项</small></span>
            <span><LockKeyhole size={18} /><b>内外数据隔离</b><small>未登录者看不到组织战绩</small></span>
          </div>
        </div>

        <aside className="public-hero-card" aria-label="饰品资料概览">
          <header><span className="eyebrow"><Database size={15} /> ACCESSORY ARCHIVE</span><strong>饰品卷轴已开放</strong><small>输入抗魔值即可快速定位</small></header>
          <div className="hero-series-list">
            {latestSeries.map((series) => <span key={series.id}><b>{series.name}</b><small>{series.equipLevel} 级</small><em>最高 +{series.maxEnhance}</em></span>)}
          </div>
          <Link href="/accessories">展开全部 {ACCESSORY_SERIES.length} 个系列 <ArrowRight size={17} /></Link>
        </aside>
      </section>

      <section className="public-metric-grid" aria-label="公开资料概览">
        <article><span>系列</span><strong>{ACCESSORY_SERIES.length}</strong><small>自由至云迹</small></article>
        <article><span>饰品部位</span><strong>{ACCESSORY_SLOTS.length}</strong><small>{ACCESSORY_SLOTS.slice(0, 3).join("、")}等</small></article>
        <article><span>覆盖等级</span><strong>60–165</strong><small>按穿戴等级整理</small></article>
        <article><span>查询权限</span><strong>公开</strong><small>无需注册或登录</small></article>
      </section>

      <section className="public-feature-grid">
        <article className="public-panel featured-archive">
          <div className="feature-icon"><Database size={28} /></div>
          <div><span className="eyebrow">PUBLIC DATABASE</span><h2>饰品资料库</h2><p>按名称、等级和阶段筛选全部系列，也可以输入抗魔值直接判断对应饰品。遇到社区原始资料的空档时，页面会明确提示，不用猜。</p></div>
          <div className="feature-tags">{ACCESSORY_SLOTS.map((slot) => <span key={slot}>{slot}</span>)}</div>
          <Link href="/accessories" className="primary-button">立即查询 <ArrowRight size={18} /></Link>
        </article>

        <article className="public-panel access-boundary-card">
          <span className="eyebrow"><LockKeyhole size={15} /> PRIVATE SQUAD</span>
          <h2>不良人组织内部</h2>
          <p>要塞分数、发包安排、成员状态和管理功能只对已授权账号开放。共享游客账号仍可按原权限登录查看内部只读信息。</p>
          <ul><li>匿名访客：仅访问公开资料</li><li>游客账号：登录后查看内部只读信息</li><li>组员与管理员：按账号角色使用功能</li></ul>
          <Link href="/login" className="secondary-button">组织账号登录 <ArrowRight size={18} /></Link>
        </article>
      </section>
    </div>
  );
}
