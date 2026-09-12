import { Database, Search } from "lucide-react";
import { AccessoryDatabase } from "@/components/accessory-database";

export const metadata = {
  title: "饰品强化与分解材料表",
  description: "查询火影忍者手游各系列饰品逐级强化消耗、分解材料与保护符返还，选择等级区间计算材料合计，支持导出查阅。"
};

export default function AccessoriesPage() {
  return <div className="public-data-page enhancement-page">
    <header className="public-page-hero enhancement-page-hero">
      <div><span className="eyebrow"><Database size={15} /> ACCESSORY WORKSHOP</span><h1>饰品强化与分解</h1><p>升一级要多少，拆下来返多少。按系列、按等级，查清每一份材料。</p></div>
      <span className="public-page-badge"><Search size={18} /> 免费查表 · 无需登录</span>
    </header>
    <AccessoryDatabase />
  </div>;
}
