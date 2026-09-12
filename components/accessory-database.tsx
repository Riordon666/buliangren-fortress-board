"use client";

import { useState } from "react";
import { AlertTriangle, BookOpenText, CheckCircle2, ChevronDown, ExternalLink, Search } from "lucide-react";
import { ACCESSORY_ANTI_MAGIC_GAPS, ACCESSORY_DATA_SOURCES, ACCESSORY_SERIES, findAccessoryAntiMagicGap, findAccessorySeries, formatAntiMagicRange } from "@/lib/accessory-data";
import { AccessorySimulator } from "@/components/accessory-simulator";

export function AccessoryDatabase() {
  const [antiMagic, setAntiMagic] = useState("");
  const numeric = antiMagic.trim() === "" ? null : Number(antiMagic);
  const valid = numeric !== null && Number.isFinite(numeric) && numeric >= 0;
  const match = valid ? findAccessorySeries(numeric) : null;
  const gap = valid ? findAccessoryAntiMagicGap(numeric) : null;

  return <div className="accessory-database">
    <AccessorySimulator />
    <details className="enhancement-basic-reference public-panel">
      <summary><BookOpenText size={22} /><span><strong>系列基础资料与抗魔查询</strong><small>穿戴等级、抗魔区间和强化上限，按需展开</small></span><ChevronDown size={20} /></summary>
      <div className="enhancement-basic-content">
        <div className="enhancement-antimagic"><label htmlFor="anti-magic-search">按抗魔值查找系列</label><div className="public-search-input"><Search size={19} /><input id="anti-magic-search" type="number" min="0" step="1" inputMode="numeric" aria-label="输入抗魔值" placeholder="例如：40841" value={antiMagic} onChange={(event) => setAntiMagic(event.target.value)} /></div><div className="enhancement-antimagic-result" aria-live="polite">{numeric === null ? <span>输入抗魔值后显示对应系列。</span> : !valid ? <span><AlertTriangle size={18} />请输入有效的非负数值。</span> : match ? <span><CheckCircle2 size={19} /><strong>{match.name}</strong> · {match.equipLevel} 级 · 最高 +{match.maxEnhance}</span> : gap ? <span><AlertTriangle size={18} />{gap.min}–{gap.max} 为资料空档，暂不判断系列。</span> : <span>现有资料未覆盖这个数值。</span>}</div></div>
        <div className="accessory-table-wrap"><table className="accessory-table enhancement-basic-table"><caption>饰品系列基础资料</caption><thead><tr><th scope="col">系列</th><th scope="col">穿戴等级</th><th scope="col">抗魔区间</th><th scope="col">强化上限</th></tr></thead><tbody>{ACCESSORY_SERIES.map((series) => <tr key={series.id}><td><strong>{series.name}</strong></td><td>{series.equipLevel} 级</td><td>{formatAntiMagicRange(series)}</td><td>+{series.maxEnhance}</td></tr>)}</tbody></table></div>
        <p className="enhancement-basic-note">{ACCESSORY_ANTI_MAGIC_GAPS[0].note}</p>
        <div className="enhancement-basic-sources"><span>系列基础资料来源：</span>{ACCESSORY_DATA_SOURCES.map((source) => <a key={source.id} href={source.url} target="_blank" rel="noreferrer">{source.title} · {source.author}{source.license ? `（${source.license}）` : ""}<ExternalLink size={14} /></a>)}</div>
      </div>
    </details>
  </div>;
}
