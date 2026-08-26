"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, ExternalLink, Search, ShieldQuestion, Sparkles } from "lucide-react";
import {
  ACCESSORY_ANTI_MAGIC_GAPS,
  ACCESSORY_DATA_REVIEWED_AT,
  ACCESSORY_DATA_SOURCES,
  ACCESSORY_SERIES,
  ACCESSORY_SLOTS,
  POWER_RATIOS,
  findAccessoryAntiMagicGap,
  findAccessorySeries,
  formatAntiMagicRange
} from "@/lib/accessory-data";

type TierFilter = "all" | "early" | "middle" | "late";

const TIER_LABELS: Record<TierFilter, string> = {
  all: "全部系列",
  early: "前期饰品",
  middle: "中期饰品",
  late: "高阶饰品"
};

export function AccessoryDatabase() {
  const [antiMagic, setAntiMagic] = useState("");
  const [keyword, setKeyword] = useState("");
  const [tier, setTier] = useState<TierFilter>("all");
  const numericAntiMagic = antiMagic.trim() === "" ? null : Number(antiMagic);
  const queried = numericAntiMagic !== null;
  const validAntiMagic = numericAntiMagic !== null && Number.isFinite(numericAntiMagic) && numericAntiMagic >= 0;
  const matchedSeries = validAntiMagic ? findAccessorySeries(numericAntiMagic) : null;
  const matchedGap = validAntiMagic ? findAccessoryAntiMagicGap(numericAntiMagic) : null;

  const filteredSeries = useMemo(() => {
    const normalizedKeyword = keyword.trim().toLocaleLowerCase("zh-CN");
    return ACCESSORY_SERIES.filter((series) => {
      const tierMatches = tier === "all" || series.tier === tier;
      const keywordMatches = !normalizedKeyword
        || series.name.toLocaleLowerCase("zh-CN").includes(normalizedKeyword)
        || String(series.equipLevel).includes(normalizedKeyword);
      return tierMatches && keywordMatches;
    });
  }, [keyword, tier]);

  return (
    <div className="accessory-database">
      <section className="accessory-finder public-panel" aria-labelledby="anti-magic-title">
        <div className="accessory-finder-copy">
          <span className="eyebrow"><Sparkles size={15} /> QUICK FINDER</span>
          <h2 id="anti-magic-title">输入抗魔值，快速定位饰品</h2>
          <p>按社区整理的抗魔区间匹配系列，并明确标出资料中尚未核实的空档。</p>
          <div className="slot-list" aria-label="饰品六个部位">
            {ACCESSORY_SLOTS.map((slot) => <span key={slot}>{slot}</span>)}
          </div>
        </div>

        <div className="anti-magic-control">
          <label htmlFor="anti-magic-search">输入抗魔值</label>
          <div className="public-search-input">
            <Search size={20} aria-hidden="true" />
            <input
              id="anti-magic-search"
              aria-label="输入抗魔值"
              type="number"
              min="0"
              step="1"
              inputMode="numeric"
              placeholder="例如：40841"
              value={antiMagic}
              onChange={(event) => setAntiMagic(event.target.value)}
            />
          </div>
          <small>结果随输入即时更新，不会保存你的查询。</small>
        </div>

        <section className="accessory-result" aria-label="抗魔值查询结果" aria-live="polite">
          {!queried ? (
            <div className="accessory-result-empty"><ShieldQuestion size={28} /><span><strong>等待输入抗魔值</strong><small>输入后会显示对应系列、穿戴等级与强化上限。</small></span></div>
          ) : !validAntiMagic ? (
            <div className="accessory-result-warning"><AlertTriangle size={26} /><span><strong>请输入有效的非负数值</strong><small>抗魔值不能小于 0。</small></span></div>
          ) : matchedSeries ? (
            <div className="accessory-result-match">
              <CheckCircle2 size={29} />
              <span><small>对应饰品系列</small><strong>{matchedSeries.name}</strong></span>
              <dl>
                <div><dt>穿戴等级</dt><dd>{matchedSeries.equipLevel} 级</dd></div>
                <div><dt>抗魔区间</dt><dd>{formatAntiMagicRange(matchedSeries)}</dd></div>
                <div><dt>强化上限</dt><dd>+{matchedSeries.maxEnhance}</dd></div>
              </dl>
            </div>
          ) : matchedGap ? (
            <div className="accessory-result-warning"><AlertTriangle size={28} /><span><strong>{matchedGap.min.toLocaleString("zh-CN")}–{matchedGap.max.toLocaleString("zh-CN")} 为待核实空档</strong><small>{matchedGap.note}</small></span></div>
          ) : (
            <div className="accessory-result-warning"><AlertTriangle size={26} /><span><strong>当前资料未覆盖这个数值</strong><small>请参考下方完整数据；本站不会用推测结果代替缺失资料。</small></span></div>
          )}
        </section>
      </section>

      <section className="public-section accessory-catalog" aria-labelledby="accessory-catalog-title">
        <div className="public-section-heading">
          <div><span className="eyebrow">SERIES ARCHIVE</span><h2 id="accessory-catalog-title">饰品系列完整数据</h2><p>共 {ACCESSORY_SERIES.length} 个系列，等级从 60 级延伸至 165 级。</p></div>
          <div className="accessory-catalog-summary"><strong>{filteredSeries.length}</strong><span>当前显示</span></div>
        </div>

        <div className="accessory-toolbar">
          <label className="public-keyword-search">
            <span>搜索系列或等级</span>
            <span><Search size={18} /><input aria-label="搜索饰品名称或等级" value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="例如：晨曦 / 145" /></span>
          </label>
          <div className="accessory-filter-pills" aria-label="饰品阶段筛选">
            {(Object.keys(TIER_LABELS) as TierFilter[]).map((key) => (
              <button key={key} type="button" className={tier === key ? "active" : ""} aria-pressed={tier === key} onClick={() => setTier(key)}>{TIER_LABELS[key]}</button>
            ))}
          </div>
        </div>

        <p className="accessory-table-hint" aria-hidden="true">← 左右滑动表格，查看全部字段 →</p>
        <div className="accessory-table-wrap">
          <table className="accessory-table">
            <caption>饰品系列完整数据</caption>
            <thead><tr><th>系列</th><th>穿戴等级</th><th>抗魔区间</th><th>强化上限</th><th>抗魔增加</th><th>分解保护符</th></tr></thead>
            <tbody>
              {filteredSeries.map((series) => (
                <tr key={series.id}>
                  <td><strong>{series.name}</strong><small>{TIER_LABELS[series.tier]}</small></td>
                  <td>{series.equipLevel} 级</td>
                  <td>{formatAntiMagicRange(series)}</td>
                  <td><span className="enhance-badge">+{series.maxEnhance}</span></td>
                  <td>{series.antiMagicGain === null ? "—" : series.antiMagicGain.toLocaleString("zh-CN")}</td>
                  <td>{series.dismantleProtection}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!filteredSeries.length && <div className="public-empty-state">没有符合当前筛选条件的饰品系列。</div>}
        </div>
      </section>

      <section className="public-reference-grid">
        <article className="public-panel power-reference">
          <div className="public-section-heading compact"><div><span className="eyebrow">POWER REFERENCE</span><h2>属性战力参考</h2><p>社区常用近似系数，仅用于快速估算。</p></div></div>
          <div>{POWER_RATIOS.map((ratio) => <span key={ratio.attribute}><strong>{ratio.attribute}</strong><b>× {ratio.value}</b><small>{ratio.label}</small></span>)}</div>
          <p>生命、攻击、防御的实际战力还会受到收集加成等因素影响。</p>
        </article>

        <article className="public-panel data-notice">
          <div className="public-section-heading compact"><div><span className="eyebrow">DATA NOTES</span><h2>资料说明与来源</h2><p>最近人工核对：{ACCESSORY_DATA_REVIEWED_AT}</p></div></div>
          <div className="data-gap-notice"><AlertTriangle size={21} /><p><strong>保留一个已知空档</strong><span>{ACCESSORY_ANTI_MAGIC_GAPS[0].note}</span></p></div>
          <div className="source-list">
            {ACCESSORY_DATA_SOURCES.map((source) => (
              <a key={source.id} href={source.url} target="_blank" rel="noreferrer">
                <span><strong>{source.title}</strong><small>{source.author} · {source.kind === "community-article" ? "社区文章" : "社区工具"}{source.license ? ` · ${source.license}` : ""}</small></span>
                <ExternalLink size={18} />
                <em>{source.note}</em>
              </a>
            ))}
          </div>
        </article>
      </section>
    </div>
  );
}
