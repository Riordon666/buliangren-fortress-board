import rawTables from "./accessory-enhancement-data.json";
import { ACCESSORY_SERIES } from "./accessory-data";

export type EnhancementMaterials = { dust: number | null; stars: number | null; protection: number | null };
export type EnhancementRow = { level: number; upgrade: EnhancementMaterials; dismantle: EnhancementMaterials };
export type EnhancementVariant = { id: string; label: string; scope: string; note: string; rows: EnhancementRow[] };
export type EnhancementTable = { variants?: EnhancementVariant[]; seriesId: string; maxLevel: number; scope: string; note: string; sourceIds: string[]; rows: EnhancementRow[] };
export type EnhancementSource = { id: string; title: string; author: string; url: string; note: string; license?: string };

export const ENHANCEMENT_REVIEWED_AT = "2026-09-12";
export const ENHANCEMENT_SOURCES: EnhancementSource[] = [
  { id: "gou-hailong", title: "火影手游攻略之饰品篇", author: "Gou_Hailong", url: "https://blog.csdn.net/Gou_Hailong/article/details/108184369", license: "CC BY-SA 4.0", note: "整理了多个系列的表格。本页面转录并重排数据；小数推算和存在矛盾的返还值未直接当作游戏实测值。由此文改编的数据表同以 CC BY-SA 4.0 提供。" },
  { id: "benben-charms", title: "饰品分解返还与强化所需要的保护符攻略", author: "火影本本", url: "https://www.bilibili.com/video/BV1dA41157fb/", note: "2021 年逐级保护符参考表；赤魂普通部位与耳环需区分。" },
  { id: "official-simulator-2019", title: "官方饰品分解模拟器截图记录", author: "App小胖子", url: "https://www.sohu.com/a/303039212_100270673", note: "2019 年文章所附游戏内官方工具截图，核对封印、祝福 +30 的材料返还；属于历史记录。" },
  { id: "official-simulator-seal14", title: "封印 +14 的官方工具截图", author: "App小胖子", url: "https://www.sohu.com/a/325318190_100270673", note: "游戏内官方模拟器截图：传说封印腰带 +14 的三项返还。" },
  { id: "xiaomi-early", title: "分析饰品系统，前中期饰品玩法", author: "坂柳有希", url: "https://game.xiaomi.com/viewpoint/1379971063_1647235701258_13", note: "2022 年攻略所附游戏面板，核对落岩 +17→+18 与封印 +12→+13 的材料消耗。" },
  { id: "nangong-daybreak", title: "曙光饰品数据与强化实录", author: "南宫诺奇", url: "https://www.bilibili.com/video/BV1yv4y177FY/", note: "原作者游戏录屏，包含曙光与赤魂耳环强化；只提取可核对的数值，不转载视频。" },
  { id: "nangong-sunrise", title: "旭日饰品强化数据一览", author: "南宫诺奇", url: "https://www.bilibili.com/video/BV1EF4m1L7Yo/", note: "原作者发布的逐级整数消耗表。累计强化与分解材料分开处理，精炼数据不并入强化等级。" },
  { id: "nangong-sky", title: "160 苍穹饰品强化数据与对比", author: "南宫诺奇", url: "https://www.bilibili.com/video/BV1oKXKYmEwW/", note: "2025 年原作者数据表及模拟器对比；强化到 +35，之后为精炼。" },
  { id: "nangong-cloud", title: "165 云迹饰品强化数据与更换建议", author: "南宫诺奇", url: "https://www.bilibili.com/video/BV1xLw1zoEN3/", note: "2026 年原作者逐级整数表。少数值与游戏画面存在取整差异；来源未确认未强化饰品本体的基础返还。不使用网上流传的等比例小数推算表。" }
];

function missingMaterials(): EnhancementMaterials { return { dust: null, stars: null, protection: null }; }

export const ENHANCEMENT_TABLES: EnhancementTable[] = ACCESSORY_SERIES.map((series) => {
  const raw = (rawTables as Omit<EnhancementTable, "maxLevel">[]).find((table) => table.seriesId === series.id);
  if (!raw) throw new Error(`Missing accessory enhancement table: ${series.id}`);
  return {
    ...raw,
    maxLevel: series.maxEnhance,
    rows: Array.from({ length: series.maxEnhance + 1 }, (_, level) => {
      const row = raw.rows.find((entry) => entry.level === level);
      return {
        level,
        upgrade: level === 0 ? { dust: 0, stars: 0, protection: 0 } : row?.upgrade ?? missingMaterials(),
        dismantle: row?.dismantle ?? missingMaterials()
      };
    })
  };
});

/** Sum one attempt per transition. Missing material values never silently become zero. */
export function summarizeEnhancementRange(table: EnhancementTable, from: number, to: number): EnhancementMaterials {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from || to > table.maxLevel) {
    throw new RangeError("Invalid enhancement level range");
  }
  const result: EnhancementMaterials = { dust: 0, stars: 0, protection: 0 };
  for (let level = from + 1; level <= to; level++) {
    const row = table.rows.find((entry) => entry.level === level);
    for (const material of ["dust", "stars", "protection"] as const) {
      const value = row?.upgrade[material];
      result[material] = result[material] === null || value == null ? null : result[material] + value;
    }
  }
  return result;
}
