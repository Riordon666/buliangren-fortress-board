import { Database, Search } from "lucide-react";
import { AccessoryDatabase } from "@/components/accessory-database";

export const metadata = {
  title: "饰品资料库",
  description: "查询火影忍者手游饰品系列、抗魔区间、穿戴等级、强化上限与社区参考数据。"
};

export default function AccessoriesPage() {
  return (
    <div className="public-data-page">
      <header className="public-page-hero">
        <div><span className="eyebrow"><Database size={15} /> ACCESSORY DATABASE</span><h1>饰品资料库</h1><p>查系列、看区间、找等级。所有数值都标注社区来源与已知缺口。</p></div>
        <span className="public-page-badge"><Search size={18} /> 无需登录即可查询</span>
      </header>
      <AccessoryDatabase />
    </div>
  );
}
