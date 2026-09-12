"use client";

import { useMemo, useState } from "react";
import { ArrowDownToLine, ArrowRight, BookOpenText, Check, ChevronRight, CircleHelp, Database, Layers3, Search, ShieldCheck, Sparkles, Star, ExternalLink } from "lucide-react";
import { ACCESSORY_SERIES } from "@/lib/accessory-data";
import { ENHANCEMENT_REVIEWED_AT, ENHANCEMENT_SOURCES, ENHANCEMENT_TABLES, summarizeEnhancementRange, type EnhancementRow } from "@/lib/accessory-enhancement";

type MaterialAmount = { dust: number | null; stars: number | null; protection: number | null };
type TableView = "step" | "cumulative";
type EnhancementVariant = { id: string; label: string; scope: string; note: string; rows: EnhancementRow[] };

const MATERIALS = [
  { key: "dust", label: "秘术之尘", icon: Sparkles },
  { key: "stars", label: "秘术之星", icon: Star },
  { key: "protection", label: "保护符", icon: ShieldCheck }
] as const;
const TIERS = [
  { id: "late", label: "高阶饰品", range: "140–165 级" },
  { id: "middle", label: "中期饰品", range: "100–130 级" },
  { id: "early", label: "前期饰品", range: "60–90 级" }
] as const;
const EMPTY_MATERIALS: MaterialAmount = { dust: null, stars: null, protection: null };

function Amount({ value }: { value: number | null }) {
  if (value === null) return <span className="enhancement-unknown">待核实</span>;
  const text = value.toLocaleString("zh-CN");
  return <span className={`enhancement-number${text.length > 7 ? " is-long" : ""}`}>{text}</span>;
}

function MaterialSummary({ value }: { value: MaterialAmount }) {
  return <dl className="enhancement-material-values">{MATERIALS.map(({ key, label, icon: Icon }) => <div key={key}><dt><Icon size={15} aria-hidden="true" />{label}</dt><dd><Amount value={value[key]} /></dd></div>)}</dl>;
}

function csvCell(value: string | number | null) {
  return `"${String(value === null ? "待核实" : value).replaceAll('"', '""')}"`;
}

export function AccessorySimulator() {
  const [selectedId, setSelectedId] = useState("cloud-trace");
  const [keyword, setKeyword] = useState("");
  const [from, setFrom] = useState(0);
  const [to, setTo] = useState(20);
  const [view, setView] = useState<TableView>("step");
  const [variantId, setVariantId] = useState("");
  const series = ACCESSORY_SERIES.find((item) => item.id === selectedId) ?? ACCESSORY_SERIES[0];
  const baseTable: (typeof ENHANCEMENT_TABLES[number] & { variants?: EnhancementVariant[] }) | undefined = ENHANCEMENT_TABLES.find((item) => item.seriesId === series.id);
  const variant = baseTable?.variants?.find((item) => item.id === variantId);
  const table = baseTable && variant ? { ...baseTable, scope: variant.scope, note: variant.note, rows: variant.rows } : baseTable;
  const variantLabel = variant?.label ?? (baseTable?.variants?.length ? "其他部位" : "");
  const tableLabel = `${series.name}${variantLabel ? ` · ${variantLabel}` : ""}`;
  const maxLevel = table?.maxLevel ?? series.maxEnhance;
  const levels = Array.from({ length: maxLevel + 1 }, (_, index) => index);
  const upgrade = table ? summarizeEnhancementRange(table, from, to) : EMPTY_MATERIALS;
  const dismantle = table?.rows.find((row) => row.level === to)?.dismantle ?? EMPTY_MATERIALS;
  const sources = ENHANCEMENT_SOURCES.filter((source) => table?.sourceIds.includes(source.id));
  const filteredSeries = useMemo(() => {
    const term = keyword.trim();
    return ACCESSORY_SERIES.filter((item) => !term || item.name.includes(term) || String(item.equipLevel).includes(term));
  }, [keyword]);
  const upgradeCoverage = table?.rows.filter((row) => row.level > 0 && Object.values(row.upgrade).every((value) => value !== null)).length ?? 0;
  const dismantleCoverage = table?.rows.filter((row) => row.level > 0 && Object.values(row.dismantle).every((value) => value !== null)).length ?? 0;

  const protectionCoverage = table?.rows.filter((row) => row.level > 0 && row.dismantle.protection !== null).length ?? 0;

  function selectSeries(id: string) {
    const next = ENHANCEMENT_TABLES.find((item) => item.seriesId === id);
    const limit = next?.maxLevel ?? ACCESSORY_SERIES.find((item) => item.id === id)?.maxEnhance ?? 0;
    setSelectedId(id);
    setVariantId(next?.variants?.[0]?.id ?? "");
    setFrom((current) => Math.min(current, limit));
    setTo((current) => Math.min(current, limit));
  }

  function changeFrom(value: number) {
    setFrom(value);
    setTo((current) => Math.max(current, value));
  }

  function changeTo(value: number) {
    setTo(value);
    setFrom((current) => Math.min(current, value));
  }

  function exportTable() {
    if (!table) return;
    const records: (string | number | null)[][] = [
      [`${tableLabel}饰品强化与分解`, table.scope],
      ["资料核对日期", ENHANCEMENT_REVIEWED_AT],
      ["口径", "单级强化为上一级到本级；累计为各级强化一次的合计，裸强失败重试另计；分解返还为来源表所列当前等级返还"],
      ["强化等级", "单级秘术之尘", "单级秘术之星", "单级保护符", "累计秘术之尘", "累计秘术之星", "累计保护符", "分解秘术之尘", "分解秘术之星", "分解保护符"],
      ...table.rows.map((row) => {
        const cumulative = summarizeEnhancementRange(table, 0, row.level);
        return [`+${row.level}`, row.upgrade.dust, row.upgrade.stars, row.upgrade.protection, cumulative.dust, cumulative.stars, cumulative.protection, row.dismantle.dust, row.dismantle.stars, row.dismantle.protection];
      }),
      ["资料备注", table.note],
      ...sources.map((source) => ["来源", source.title, source.author, source.url, source.license ?? "", source.note])
    ];
    const blob = new Blob(["\uFEFF", records.map((row) => row.map(csvCell).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${series.name}${variantLabel ? `-${variantLabel}` : ""}饰品-强化与分解.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return <section className="enhancement-workbench" aria-label="饰品强化与分解查询">
    <aside className="enhancement-series public-panel">
      <div className="enhancement-sidebar-heading"><span className="eyebrow"><Layers3 size={15} /> SERIES ARCHIVE</span><h2>选择饰品系列 <span>{ACCESSORY_SERIES.length}</span></h2></div>
      <label className="enhancement-series-search"><Search size={17} aria-hidden="true" /><input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索名称 / 等级" aria-label="搜索饰品系列或穿戴等级" /></label>
      <div className="enhancement-series-groups">{TIERS.map((tier) => {
        const items = filteredSeries.filter((item) => item.tier === tier.id).reverse();
        return items.length ? <div className="enhancement-series-group" key={tier.id}><h3>{tier.label}<small>{tier.range}</small></h3><div>{items.map((item) => <button type="button" key={item.id} aria-pressed={item.id === series.id} className={item.id === series.id ? "active" : ""} onClick={() => selectSeries(item.id)}><span><b>{item.name}</b><small>{item.equipLevel} 级</small></span>{item.id === series.id ? <Check size={17} /> : <ChevronRight size={16} />}</button>)}</div></div> : null;
      })}{!filteredSeries.length && <p className="enhancement-no-match">没有找到这个系列，试试名称或穿戴等级。</p>}</div>
      <p className="enhancement-sidebar-note"><BookOpenText size={16} />选择系列后，即可查看每一级材料。</p>
    </aside>

    <div className="enhancement-main">
      <section className="enhancement-calculator public-panel" aria-labelledby="enhancement-series-title">
        <header className="enhancement-selected-heading"><div><span className="eyebrow">强化账本 · {series.equipLevel} 级饰品</span><h2 id="enhancement-series-title">{series.name}<span>强化与分解</span></h2><p>{table?.scope ?? "此系列的材料适用范围待核实。"}</p></div><span className="enhancement-level-seal"><small>强化上限</small><strong>+{maxLevel}</strong></span></header>
        {!!baseTable?.variants?.length && <div className="enhancement-variant-control"><span>饰品部位</span><div aria-label="选择饰品部位"><button type="button" className={!variant ? "active" : ""} aria-pressed={!variant} onClick={() => setVariantId("")}>其他部位</button>{baseTable.variants.map((item) => <button type="button" key={item.id} className={variant?.id === item.id ? "active" : ""} aria-pressed={variant?.id === item.id} onClick={() => setVariantId(item.id)}>{item.label}</button>)}</div><p>耳环与其他部位的数据不同，请按实际饰品选择。</p></div>}
        <div className="enhancement-range-controls"><div className="enhancement-range-title"><Layers3 size={19} /><span><strong>选择强化区间</strong><small>看看这段升级需要哪些材料</small></span></div><div className="enhancement-level-controls"><label><span>当前等级</span><select aria-label="当前强化等级" value={from} onChange={(event) => changeFrom(Number(event.target.value))}>{levels.map((level) => <option value={level} key={level}>+{level}</option>)}</select></label><ArrowRight size={21} aria-hidden="true" /><label><span>目标等级</span><select aria-label="目标强化等级" value={to} onChange={(event) => changeTo(Number(event.target.value))}>{levels.map((level) => <option value={level} key={level}>+{level}</option>)}</select></label><button className="enhancement-max-button" type="button" onClick={() => setTo(maxLevel)}>设为满级</button></div></div>
        <div className="enhancement-summary-grid" aria-live="polite"><article className="enhancement-summary upgrade"><h3><Sparkles size={18} />+{from} → +{to}<span>强化材料合计</span></h3><MaterialSummary value={upgrade} /><p>{from === to ? "当前等级与目标等级相同，无需强化。" : "各级强化一次的材料合计；裸强失败重试另计。"}</p></article><article className="enhancement-summary dismantle"><h3><ArrowDownToLine size={18} />+{to}<span>分解返还 · 来源表</span></h3><MaterialSummary value={dismantle} /><p>来源表所列本级返还，具体适用范围见资料说明。</p></article></div>
        <div className="enhancement-data-note"><CircleHelp size={19} /><div><p>强化消耗按资料表记录的保护符方案展示；若不使用保护符，裸强失败与重试消耗需另计。社区参考数据，实际以游戏为准。</p><p className="enhancement-current-scope">{table?.note}</p><p><strong>待核实</strong>表示缺少可靠数值，不能按 0 计算；区间内有缺失时，该项合计也显示待核实。</p></div></div>
      </section>

      <section className="enhancement-ledger public-panel" aria-labelledby="enhancement-table-title">
        <header className="enhancement-table-heading"><div><span className="eyebrow">LEVEL BY LEVEL</span><h2 id="enhancement-table-title">{tableLabel}逐级材料表</h2><p>+0 至 +{maxLevel}，强化消耗与分解返还对照查看。</p></div><button type="button" className="enhancement-export" onClick={exportTable} disabled={!table}><ArrowDownToLine size={17} />导出表格</button></header>
        <div className="enhancement-table-controls"><div className="enhancement-view-toggle" aria-label="强化消耗显示方式"><button type="button" aria-pressed={view === "step"} className={view === "step" ? "active" : ""} onClick={() => setView("step")}>单级消耗</button><button type="button" aria-pressed={view === "cumulative"} className={view === "cumulative" ? "active" : ""} onClick={() => setView("cumulative")}>从 +0 累计</button></div><span className="enhancement-coverage">{upgradeCoverage} / {maxLevel} 级强化数据已收录<br />完整三项返还 {dismantleCoverage} / {maxLevel} 级 · 保护符 {protectionCoverage} / {maxLevel} 级</span></div>
        <p className="enhancement-table-legend"><span><i />已选区间 +{from} → +{to}</span><span>{view === "step" ? "强化列：上一级 → 本级，强化一次" : "强化列：+0 → 本级，各强化一次"}</span><span className="enhancement-scroll-hint">表格可左右滑动 →</span></p>
        {table ? <div className="enhancement-table-scroll" role="region" tabIndex={0} aria-label={`${tableLabel}逐级材料表，可横向滚动`}><table className="enhancement-table"><caption>{tableLabel}饰品逐级强化消耗与分解返还；未知数值标记为待核实。</caption><thead><tr><th rowSpan={2} scope="col" className="enhancement-level-column">强化<br />等级</th><th colSpan={3} scope="colgroup" className="enhancement-upgrade-group">{view === "step" ? "升到本级 · 强化一次消耗" : "从 +0 升到本级 · 各强化一次累计"}</th><th colSpan={3} scope="colgroup" className="enhancement-dismantle-group">本级分解返还 · 来源表</th></tr><tr>{MATERIALS.map(({ key, label }) => <th key={`upgrade-${key}`} scope="col" className="enhancement-upgrade-group">{label}</th>)}{MATERIALS.map(({ key, label }) => <th key={`dismantle-${key}`} scope="col" className="enhancement-dismantle-group">{label}</th>)}</tr></thead><tbody>{table.rows.map((row) => {
          const cost = view === "cumulative" ? summarizeEnhancementRange(table, 0, row.level) : row.upgrade;
          const inRange = row.level > from && row.level <= to;
          return <tr key={row.level} className={`${inRange ? "in-range" : ""} ${row.level === to ? "target-level" : ""}`}><th scope="row" className="enhancement-level-column"><strong>+{row.level}</strong>{row.level === from && <small>当前</small>}{row.level === to && row.level !== from && <small>目标</small>}</th>{MATERIALS.map(({ key }) => <td key={`upgrade-${key}`}>{row.level === 0 ? <span className="enhancement-not-applicable" aria-label="未强化，无升级消耗">—</span> : <Amount value={cost[key]} />}</td>)}{MATERIALS.map(({ key }) => <td key={`dismantle-${key}`} className={key === "dust" ? "enhancement-group-divider" : undefined}><Amount value={row.dismantle[key]} /></td>)}</tr>;
        })}</tbody></table></div> : <p className="enhancement-no-match">这套饰品的逐级数据尚未核实，暂不能计算。</p>}
        <footer className="enhancement-table-footer"><span>数值 0 = 确认无消耗或无返还</span><span>待核实 = 资料缺失，无法计算</span><span>— = 未强化，不适用</span></footer>
      </section>

      <section className="enhancement-sources public-panel" aria-labelledby="enhancement-source-title"><div className="enhancement-source-heading"><Database size={21} /><div><h2 id="enhancement-source-title">这张表的资料来源</h2><p>最近核对：{ENHANCEMENT_REVIEWED_AT}</p></div></div><p className="enhancement-scope-note">{table?.note ?? "尚无可用于该系列的逐级材料资料。"}</p><div className="enhancement-source-links">{sources.map((source) => <a href={source.url} target="_blank" rel="noreferrer" key={source.id}><span><strong>{source.title}<ExternalLink size={15} /></strong><small>{source.author}{source.license ? ` · ${source.license}` : ""}</small><p>{source.note}</p></span></a>)}</div><p className="enhancement-source-footnote">{sources.some((source) => source.license) && <>相关改编数据依 <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noreferrer">CC BY-SA 4.0</a> 提供。 </>}社区整理数据。品质、部位及使用条件以本表适用范围为准；游戏更新后若有变化，以游戏内实际显示为准。</p></section>
    </div>
  </section>;
}
