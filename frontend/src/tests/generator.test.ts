import { describe, expect, it } from "vitest";
import { DEMO_DATASET, snapshotAt } from "../mocks/generator";

const localAt = (hour: number, minute: number, second = 0) => {
  const date = new Date(DEMO_DATASET.mainStation.at(-1)!.event_time);
  date.setHours(hour, minute, second, 0);
  return date;
};
const ninthBatchId = DEMO_DATASET.feedbackBatches.find((batch) => batch.arrival_time === localAt(14, 20, 35).toISOString())!.batch_id;

describe("台区演示数据的时间语义", () => {
  it("生成完整的近 7 天分钟级主站数据", () => {
    expect(DEMO_DATASET.mainStation).toHaveLength(7 * 1440);
    const first = new Date(DEMO_DATASET.mainStation[0].event_time);
    const last = new Date(DEMO_DATASET.mainStation.at(-1)!.event_time);
    expect([first.getHours(), first.getMinutes()]).toEqual([0, 0]);
    expect([last.getHours(), last.getMinutes()]).toEqual([23, 59]);
    expect((last.getTime() - first.getTime()) / 60_000).toBe(7 * 1440 - 1);
  });

  it("不会暴露演示时刻之后才到达的分站反馈", () => {
    const beforeArrival = snapshotAt(localAt(14, 20, 34));
    const afterArrival = snapshotAt(localAt(14, 20, 35));

    expect(beforeArrival.feedback_batches.some((batch) => batch.batch_id === ninthBatchId)).toBe(false);
    expect(afterArrival.feedback_batches.at(-1)?.batch_id).toBe(ninthBatchId);
    expect(afterArrival.substation_points.every((point) => new Date(point.arrival_time) <= new Date(afterArrival.now))).toBe(true);
  });

  it("反馈按 event_time 对应历史时段，而不是按 arrival_time 匹配", () => {
    const snapshot = snapshotAt(localAt(14, 21));
    const corrected = snapshot.separation_results.find((row) => row.event_time === localAt(14, 0).toISOString());
    const arrivalMinute = snapshot.separation_results.find((row) => row.event_time === localAt(14, 20).toISOString());

    expect(corrected?.result_status).toBe("已反馈校正");
    expect(corrected?.batch_id).toBe(ninthBatchId);
    expect(arrivalMinute?.result_status).toBe("实时初始");
    expect(arrivalMinute?.corrected_pv_kw).toBeNull();
  });

  it("缺失节点和批量历史回传均可追溯", () => {
    const snapshot = snapshotAt(localAt(14, 21));
    const batch = snapshot.feedback_batches.at(-1);

    expect(batch?.missing_nodes).toEqual(["PV-06"]);
    expect(batch?.point_count).toBe(10);
    expect(batch?.coverage_start).toBe(localAt(13, 45).toISOString());
    expect(batch?.coverage_end).toBe(localAt(14, 15).toISOString());
  });

  it("晚间最近一小时仍包含已校正、等待反馈和实时初始区间", () => {
    const now = localAt(20, 25);
    const snapshot = snapshotAt(now);
    const latestBatch = snapshot.feedback_batches.at(-1);
    const corrected = snapshot.separation_results.find((row) => row.event_time === localAt(19, 30).toISOString());
    const waiting = snapshot.separation_results.find((row) => row.event_time === localAt(20, 0).toISOString());

    expect(latestBatch?.arrival_time).toBe(localAt(20, 1).toISOString());
    expect(latestBatch?.coverage_end).toBe(localAt(20, 0).toISOString());
    expect((now.getTime() - new Date(latestBatch!.coverage_end).getTime()) / 60_000).toBeLessThanOrEqual(60);
    expect(corrected?.result_status).toBe("已反馈校正");
    expect(waiting?.result_status).toBe("等待反馈");
  });

  it("24h 视图从当天零点起具备已反馈校正数据", () => {
    const snapshot = snapshotAt(localAt(21, 30));
    const previousLate = localAt(0, 0);
    previousLate.setDate(previousLate.getDate() - 1);
    previousLate.setHours(23, 20, 0, 0);
    const midnight = snapshot.separation_results.find((row) => row.event_time === localAt(0, 0).toISOString());
    const morning = snapshot.separation_results.find((row) => row.event_time === localAt(8, 0).toISOString());
    const crossDay = snapshot.separation_results.find((row) => row.event_time === previousLate.toISOString());
    const correctedToday = snapshot.separation_results.filter((row) => {
      const event = new Date(row.event_time);
      return event >= localAt(0, 0) && row.corrected_pv_kw != null;
    });

    expect(midnight?.result_status).toBe("已反馈校正");
    expect(crossDay?.result_status).toBe("已反馈校正");
    expect(morning?.corrected_pv_kw).not.toBeNull();
    expect(correctedToday[0]?.event_time).toBe(localAt(0, 0).toISOString());
  });

  it("7d 主图与校正差值覆盖同一组近七日日期", () => {
    const snapshot = snapshotAt(localAt(21, 30));
    const dayKey = (value: string) => {
      const date = new Date(value);
      return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
    };
    const resultDays = new Set(snapshot.separation_results.map((row) => dayKey(row.event_time)));
    const correctionDays = new Set(snapshot.separation_results.filter((row) => row.correction_kw != null).map((row) => dayKey(row.event_time)));

    expect(resultDays.size).toBe(7);
    expect(correctionDays.size).toBe(7);
    expect([...correctionDays]).toEqual([...resultDays]);
  });
});
