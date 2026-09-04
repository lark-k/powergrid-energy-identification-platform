import { describe, expect, it } from "vitest";
import type { EChartsOption } from "echarts";
import { findTooltipTarget, shouldFreezeOptionUpdate, tooltipRestoreAction } from "../components/charts/EChart";

describe("EChart tooltip restoration", () => {
  it("restores the same data point at the pointer coordinates", () => {
    expect(tooltipRestoreAction([412, 186], { seriesIndex: 0, dataIndex: 7 })).toEqual({
      type: "showTip",
      seriesIndex: 0,
      dataIndex: 7,
      x: 412,
      y: 186,
    });
  });

  it("keeps the hovered timestamp bound to its original data index as points append", () => {
    const option = {
      series: [{ data: [[100, 1], [200, 2], [300, 3], [400, 4]] }],
    } as EChartsOption;

    expect(findTooltipTarget(option, 200)).toEqual({ seriesIndex: 0, dataIndex: 1 });
    expect(findTooltipTarget(option, 999)).toBeNull();
  });

  it("defers chart updates only while a real data point is hovered", () => {
    expect(shouldFreezeOptionUpdate(true, true, 200)).toBe(true);
    expect(shouldFreezeOptionUpdate(true, true, null)).toBe(false);
    expect(shouldFreezeOptionUpdate(true, false, 200)).toBe(false);
    expect(shouldFreezeOptionUpdate(false, true, 200)).toBe(false);
  });
});
