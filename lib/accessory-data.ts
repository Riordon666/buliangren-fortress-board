export type AccessorySeries = {
  id: string;
  name: string;
  equipLevel: number;
  antiMagicMin: number;
  antiMagicMax: number | null;
  maxEnhance: number;
  antiMagicGain: number | null;
  dismantleProtection: string;
  tier: "early" | "middle" | "late";
};

export type AccessoryDataSource = {
  id: string;
  title: string;
  author: string;
  url: string;
  kind: "community-article" | "community-tool";
  note: string;
  license?: string;
};

export type AntiMagicGap = {
  min: number;
  max: number;
  note: string;
};

export const ACCESSORY_SLOTS = ["耳环", "项链", "手镯", "戒指", "徽章", "腰带"] as const;

export const ACCESSORY_DATA_SOURCES: AccessoryDataSource[] = [
  {
    id: "gou-hailong-accessory-guide",
    title: "火影忍者手游饰品数据整理",
    author: "Gou_Hailong",
    url: "https://blog.csdn.net/Gou_Hailong/article/details/108184369",
    kind: "community-article",
    note: "饰品系列、抗魔区间、强化上限与保护符数据的主要整理来源。内容为玩家社区资料，并非游戏官方接口。",
    license: "CC BY-SA 4.0"
  },
  {
    id: "nangong-nuoqi-accessory-tool",
    title: "南宫诺奇饰品模拟器",
    author: "南宫诺奇",
    url: "https://vip.nevercannot.com/naruto/sp.php",
    kind: "community-tool",
    note: "用于交叉参考饰品计算方式；本站采用独立数据结构与界面实现。"
  }
];

export const ACCESSORY_DATA_REVIEWED_AT = "2026-08-25";

export const ACCESSORY_ANTI_MAGIC_GAPS: AntiMagicGap[] = [
  {
    min: 27001,
    max: 27999,
    note: "主要社区资料将封印写至 27000、祝福从 28000 开始，因此 27001–27999 暂无可核实的系列归属。本站保留空档，不擅自补值。"
  }
];

export const ACCESSORY_SERIES: AccessorySeries[] = [
  { id: "freedom", name: "自由", equipLevel: 60, antiMagicMin: 2781, antiMagicMax: 5920, maxEnhance: 15, antiMagicGain: null, dismantleProtection: "5", tier: "early" },
  { id: "red-soul", name: "赤魂", equipLevel: 70, antiMagicMin: 5921, antiMagicMax: 8060, maxEnhance: 20, antiMagicGain: 3140, dismantleProtection: "61 / 45", tier: "early" },
  { id: "loyalty", name: "忠诚", equipLevel: 80, antiMagicMin: 8061, antiMagicMax: 11530, maxEnhance: 20, antiMagicGain: 2140, dismantleProtection: "79", tier: "early" },
  { id: "nightmare", name: "梦魇", equipLevel: 90, antiMagicMin: 11531, antiMagicMax: 17800, maxEnhance: 20, antiMagicGain: 3470, dismantleProtection: "87", tier: "early" },
  { id: "rockfall", name: "落岩", equipLevel: 100, antiMagicMin: 17801, antiMagicMax: 22400, maxEnhance: 30, antiMagicGain: 6270, dismantleProtection: "408", tier: "middle" },
  { id: "seal", name: "封印", equipLevel: 110, antiMagicMin: 22401, antiMagicMax: 27000, maxEnhance: 30, antiMagicGain: 4600, dismantleProtection: "497", tier: "middle" },
  { id: "blessing", name: "祝福", equipLevel: 120, antiMagicMin: 28000, antiMagicMax: 29160, maxEnhance: 30, antiMagicGain: 6760, dismantleProtection: "497", tier: "middle" },
  { id: "prayer", name: "祈愿", equipLevel: 130, antiMagicMin: 29161, antiMagicMax: 32253, maxEnhance: 35, antiMagicGain: 3093, dismantleProtection: "693", tier: "middle" },
  { id: "dawn", name: "破晓", equipLevel: 140, antiMagicMin: 32254, antiMagicMax: 36160, maxEnhance: 35, antiMagicGain: 3907, dismantleProtection: "614（+30）/ 858（+35）", tier: "late" },
  { id: "morning-light", name: "晨曦", equipLevel: 145, antiMagicMin: 36161, antiMagicMax: 40840, maxEnhance: 35, antiMagicGain: 4680, dismantleProtection: "727（+30）/ 1030（+35）", tier: "late" },
  { id: "daybreak", name: "曙光", equipLevel: 150, antiMagicMin: 40841, antiMagicMax: 44920, maxEnhance: 35, antiMagicGain: 4080, dismantleProtection: "851（+30）/ 1192（+35）", tier: "late" },
  { id: "sunrise", name: "旭日", equipLevel: 155, antiMagicMin: 44921, antiMagicMax: 49420, maxEnhance: 35, antiMagicGain: 4500, dismantleProtection: "941（+30）/ 1323（+35）", tier: "late" },
  { id: "sky", name: "苍穹", equipLevel: 160, antiMagicMin: 49421, antiMagicMax: 54350, maxEnhance: 35, antiMagicGain: 4930, dismantleProtection: "1032（+30）/ 1450（+35）", tier: "late" },
  { id: "cloud-trace", name: "云迹", equipLevel: 165, antiMagicMin: 54351, antiMagicMax: null, maxEnhance: 35, antiMagicGain: null, dismantleProtection: "1135（+30）/ 1595（+35）", tier: "late" }
];

export const POWER_RATIOS = [
  { attribute: "生命", value: 1, label: "1 点 ≈ 1 战力" },
  { attribute: "抗暴", value: 10, label: "1 点 ≈ 10 战力" },
  { attribute: "暴击", value: 6, label: "1 点 ≈ 6 战力" },
  { attribute: "攻击", value: 3.5, label: "1 点 ≈ 3.5 战力" },
  { attribute: "防御", value: 12, label: "1 点 ≈ 12 战力" }
] as const;

export function findAccessorySeries(antiMagic: number) {
  if (!Number.isFinite(antiMagic) || antiMagic < 0) return null;
  return ACCESSORY_SERIES.find((series) =>
    antiMagic >= series.antiMagicMin && (series.antiMagicMax === null || antiMagic <= series.antiMagicMax)
  ) || null;
}

export function findAccessoryAntiMagicGap(antiMagic: number) {
  if (!Number.isFinite(antiMagic) || antiMagic < 0) return null;
  return ACCESSORY_ANTI_MAGIC_GAPS.find((gap) => antiMagic >= gap.min && antiMagic <= gap.max) || null;
}

export function formatAntiMagicRange(series: AccessorySeries) {
  return series.antiMagicMax === null
    ? `${series.antiMagicMin.toLocaleString("zh-CN")} 以上`
    : `${series.antiMagicMin.toLocaleString("zh-CN")} – ${series.antiMagicMax.toLocaleString("zh-CN")}`;
}
