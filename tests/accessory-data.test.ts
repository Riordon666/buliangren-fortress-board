import { describe, expect, it } from "vitest";
import { ACCESSORY_SERIES, findAccessorySeries } from "@/lib/accessory-data";

describe("饰品资料库", () => {
  it("包含14套饰品且 id 唯一", () => {
    expect(ACCESSORY_SERIES).toHaveLength(14);
    expect(new Set(ACCESSORY_SERIES.map((series) => series.id)).size).toBe(ACCESSORY_SERIES.length);
  });

  it("每套抗魔范围合法，只有最后一套允许没有上限", () => {
    for (const [index, series] of ACCESSORY_SERIES.entries()) {
      expect(Number.isFinite(series.antiMagicMin)).toBe(true);
      expect(series.antiMagicMin).toBeGreaterThanOrEqual(0);
      expect(series.maxEnhance).toBeGreaterThan(0);
      if (series.antiMagicMax === null) {
        expect(index).toBe(ACCESSORY_SERIES.length - 1);
      } else {
        expect(Number.isFinite(series.antiMagicMax)).toBe(true);
        expect(series.antiMagicMax).toBeGreaterThanOrEqual(series.antiMagicMin);
      }
    }
  });

  it("能在各套饰品的起止边界找到正确系列", () => {
    for (const series of ACCESSORY_SERIES) {
      expect(findAccessorySeries(series.antiMagicMin)?.id).toBe(series.id);
      if (series.antiMagicMax !== null) {
        expect(findAccessorySeries(series.antiMagicMax)?.id).toBe(series.id);
      }
    }

    expect(findAccessorySeries(5920)?.name).toBe("自由");
    expect(findAccessorySeries(5921)?.name).toBe("赤魂");
    expect(findAccessorySeries(29160)?.name).toBe("祝福");
    expect(findAccessorySeries(29161)?.name).toBe("祈愿");
    expect(findAccessorySeries(54350)?.name).toBe("苍穹");
    expect(findAccessorySeries(54351)?.name).toBe("云迹");
  });

  it("27001 至 27999 的资料空档不会误判为祝福", () => {
    for (const antiMagic of [27001, 27500, 27999]) {
      expect(findAccessorySeries(antiMagic)).toBeNull();
    }
  });

  it("云迹没有抗魔上限", () => {
    const cloudTrace = ACCESSORY_SERIES.find((series) => series.id === "cloud-trace");
    expect(cloudTrace).toMatchObject({ name: "云迹", antiMagicMin: 54351, antiMagicMax: null });
    expect(findAccessorySeries(54351)?.id).toBe("cloud-trace");
    expect(findAccessorySeries(Number.MAX_SAFE_INTEGER)?.id).toBe("cloud-trace");
  });
});
