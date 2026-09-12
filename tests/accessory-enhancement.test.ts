import { describe, expect, it } from "vitest";
import { ACCESSORY_SERIES } from "@/lib/accessory-data";
import { ENHANCEMENT_SOURCES, ENHANCEMENT_TABLES, summarizeEnhancementRange } from "@/lib/accessory-enhancement";

const table = (id: string) => ENHANCEMENT_TABLES.find((entry) => entry.seriesId === id)!;
const level = (id: string, value: number) => table(id).rows.find((row) => row.level === value)!;

describe("饰品逐级材料资料", () => {
  it("14个系列的强化等级连续且所有数值均为非负整数或明确未知", () => {
    expect(ENHANCEMENT_TABLES.map((entry) => entry.seriesId)).toEqual(ACCESSORY_SERIES.map((series) => series.id));
    const sources = new Set(ENHANCEMENT_SOURCES.map((source) => source.id));
    for (const entry of ENHANCEMENT_TABLES) {
      expect(entry.rows.map((row) => row.level)).toEqual(Array.from({ length: entry.maxLevel + 1 }, (_, index) => index));
      for (const source of entry.sourceIds) expect(sources.has(source)).toBe(true);
      for (const row of entry.rows) for (const value of [...Object.values(row.upgrade), ...Object.values(row.dismantle)]) {
        expect(value === null || (Number.isSafeInteger(value) && value >= 0)).toBe(true);
      }
    }
  });

  it("使用实际已核对的历史官方模拟器数值", () => {
    expect(level("seal", 14).dismantle).toEqual({ dust: 75734, stars: 1087, protection: 13 });
    expect(level("seal", 30).dismantle).toEqual({ dust: 278886, stars: 4023, protection: 497 });
    expect(level("blessing", 30).dismantle).toEqual({ dust: 311237, stars: 4490, protection: 497 });
  });

  it("当前等级不重复计费，目标等级包含在本次升级区间", () => {
    expect(summarizeEnhancementRange(table("blessing"), 28, 30)).toEqual({ dust: 37230, stars: 806, protection: 84 });
    expect(summarizeEnhancementRange(table("blessing"), 12, 13)).toEqual({ dust: 11885, stars: 134, protection: 17 });
    expect(summarizeEnhancementRange(table("blessing"), 30, 30)).toEqual({ dust: 0, stars: 0, protection: 0 });
  });

  it("每种材料独立传播空缺，未收录与确实为0不同", () => {
    expect(level("seal", 13).upgrade).toMatchObject({ dust: 10650, stars: 120 });
    const partial = { ...table("seal"), rows: [{ level: 1, upgrade: { dust: 123, stars: null, protection: 0 }, dismantle: { dust: null, stars: null, protection: null } }] };
    expect(summarizeEnhancementRange(partial, 0, 1)).toEqual({ dust: 123, stars: null, protection: 0 });
    expect(summarizeEnhancementRange(partial, 0, 2)).toEqual({ dust: null, stars: null, protection: null });
    expect(level("freedom", 1).upgrade.dust).toBeNull();
    expect(level("freedom", 0).upgrade.dust).toBe(0);
  });

  it.each([[-1, 2], [3, 2], [0, 36], [1.5, 3], [0, Infinity], [NaN, 1]])("拒绝非法等级范围 %s → %s", (from, to) => {
    expect(() => summarizeEnhancementRange(table("cloud-trace"), from, to)).toThrow(RangeError);
  });

  it("云迹采用原作者整数表，不混用小数投影或精炼等级", () => {
    expect(table("cloud-trace").maxLevel).toBe(35);
    expect(level("cloud-trace", 1).upgrade).toEqual({ dust: 1191, stars: 0, protection: 0 });
    expect(level("cloud-trace", 30).dismantle).toEqual({ dust: 952472, stars: 14774, protection: 1145 });
    expect(level("cloud-trace", 35).dismantle).toEqual({ dust: 1259938, stars: 20898, protection: 1610 });
  });

  it("赤魂耳环独立使用实机消耗，不能与普通部位45符混算", () => {
    const base = table("red-soul");
    const variant = base.variants!.find((entry) => entry.id === "earring")!;
    const earring = { ...base, ...variant };
    expect(earring.rows).toHaveLength(21);
    expect(summarizeEnhancementRange(earring, 0, 20)).toEqual({ dust: 41700, stars: 520, protection: 162 });
    expect(earring.rows.find((row) => row.level === 20)!.dismantle).toEqual({ dust: 41900, stars: null, protection: 61 });
    expect(level("red-soul", 20).dismantle.protection).toBe(45);
  });

  it("曙光材料按稳定游戏画面对应等级，不能使用动画滞后标签", () => {
    expect(level("daybreak", 27).upgrade.stars).toBe(828);
    expect(level("daybreak", 28).upgrade.stars).toBe(882);
    expect(level("daybreak", 29).upgrade.stars).toBe(937);
    expect(level("daybreak", 30).upgrade.stars).toBeNull();
  });

  it("关键系列整段合计与来源逐列总和相符", () => {
    expect(summarizeEnhancementRange(table("dawn"), 0, 35)).toEqual({ dust: 782507, stars: 13066, protection: 1226 });
    expect(summarizeEnhancementRange(table("morning-light"), 0, 35)).toEqual({ dust: 946820, stars: 15795, protection: 1465 });
    expect(summarizeEnhancementRange(table("sunrise"), 0, 35)).toEqual({ dust: 1246001, stars: 20764, protection: 1896 });
  });

  it("保护符完整梯度及已知矛盾保留正确边界", () => {
    expect(level("red-soul", 20).dismantle.protection).toBe(45);
    expect(level("loyalty", 13).dismantle.protection).toBe(5);
    expect(level("rockfall", 30).dismantle.protection).toBe(408);
    expect(level("prayer", 31).dismantle.protection).toBe(532);
    expect(level("prayer", 34).dismantle.protection).toBeNull();
    expect(level("rockfall", 24).dismantle.dust).toBeNull();
  });
});
