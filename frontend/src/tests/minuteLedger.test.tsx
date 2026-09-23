import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MinuteLedger } from "../features/executive/MinuteLedger";
import type { SeparationResult, StationSnapshot } from "../types/domain";

afterEach(cleanup);

const result: SeparationResult = {
  event_time: "2026-09-04T18:35:00+08:00",
  separation_time: "2026-09-04T18:35:18+08:00",
  result_status: "实时初始",
  total_power_kw: -0.81,
  initial_pv_kw: 2.158,
  pv_activity_probability: 0.993,
  interpolated_minutes: 0,
  corrected_pv_kw: null,
  station_feedback_value: null,
  feedback_status: "等待回传",
  correction_kw: null,
  correction_ratio: null,
  confidence: 0.993,
  model_version: "test-model",
  batch_id: null,
  participating_nodes: [],
  model_window_start: "2026-09-04T14:36:00+08:00",
  model_window_end: "2026-09-04T18:35:00+08:00",
  remaining_load_kw: 1.348,
  quality_status: "good",
};

const snapshot = (stationId = "A01"): StationSnapshot => ({
  now: "2026-09-04T18:39:00+08:00",
  station_id: stationId,
  station_name: stationId,
  minute_points: [{
    station_id: stationId,
    event_time: result.event_time,
    active_power_kw: result.total_power_kw,
    phase_a_power_kw: -0.237,
    phase_b_power_kw: -0.291,
    phase_c_power_kw: -0.282,
    reactive_power_kvar: -0.88,
    voltage: 230,
    current: 1,
    pf: 0.99,
    quality_flag: "good",
  }],
  separation_results: [result],
  substation_points: [],
  feedback_batches: [],
  recognition: null,
  corrections: [],
  training: null,
  model_health: {
    recognition_status: "running",
    separation_status: "running",
    recognition_version: "recognition",
    separation_version: "separation",
    last_inference_ms: 1,
    last_inference_time: result.separation_time,
  },
  node_statuses: [],
  quality: {
    completeness_ratio: 1,
    duplicate_count: 0,
    missing_count: 0,
    out_of_order_count: 0,
    warning_count: 0,
    last_checked_at: result.separation_time,
  },
});

describe("MinuteLedger detail lock", () => {
  it("survives automatic realtime window movement and resets only when the station changes", () => {
    const onSelect = vi.fn();
    const firstSelection = {
      start: new Date("2026-09-04T18:30:00+08:00").getTime(),
      end: new Date("2026-09-04T18:39:00+08:00").getTime(),
    };
    const { rerender } = render(<MinuteLedger
      snapshot={snapshot()}
      selection={firstSelection}
      selected={result}
      onSelect={onSelect}
    />);

    fireEvent.click(screen.getByRole("button", { name: /18:35/ }));
    expect(screen.getByRole("button", { name: /详情已锁定/ })).toBeInTheDocument();

    rerender(<MinuteLedger
      snapshot={{ ...snapshot(), now: "2026-09-04T18:40:00+08:00" }}
      selection={{ start: firstSelection.start + 60_000, end: firstSelection.end + 60_000 }}
      selected={result}
      onSelect={onSelect}
    />);
    expect(screen.getByRole("button", { name: /详情已锁定/ })).toBeInTheDocument();

    rerender(<MinuteLedger
      snapshot={snapshot("B01")}
      selection={{ start: firstSelection.start + 60_000, end: firstSelection.end + 60_000 }}
      selected={result}
      onSelect={onSelect}
    />);
    expect(screen.queryByRole("button", { name: /详情已锁定/ })).not.toBeInTheDocument();
  });

  it("shows measured and feedback-only minutes without inventing a model result", () => {
    const onSelect = vi.fn();
    const raw = snapshot();
    raw.separation_results = [];
    raw.minute_points = [{
      ...raw.minute_points[0], event_time: "2026-09-04T18:36:00+08:00",
      active_power_kw: 1.181, measurement_time: "2026-09-04T18:36:30+08:00",
    }];
    raw.substation_points = [{
      node_id: "pv", period_start: "2026-09-04T18:37:00+08:00",
      period_end: "2026-09-04T18:38:00+08:00", arrival_time: "2026-09-04T18:37:50+08:00",
      batch_id: "feedback", pv_value: 0.0013, value_type: "average_power", capacity_kw: 0,
      quality_flag: "good", measurement_time: "2026-09-04T18:37:35+08:00",
    }];
    render(<MinuteLedger snapshot={raw} selection={{
      start: new Date("2026-09-04T18:30:00+08:00").getTime(),
      end: new Date("2026-09-04T18:39:00+08:00").getTime(),
    }} selected={null} onSelect={onSelect} />);

    const mainRow = screen.getByRole("button", { name: /18:36/ });
    expect(mainRow).toHaveTextContent("1.181 kW");
    expect(mainRow).toHaveTextContent("未生成模型结果");
    const feedbackRow = screen.getByRole("button", { name: /18:37/ });
    expect(feedbackRow).toHaveTextContent("缺测");
    expect(feedbackRow).toHaveTextContent("0.0013 kW");
    fireEvent.click(feedbackRow);
    expect(screen.getByText("仅反馈 · 缺总开 · 告警", { selector: ".minute-detail .status" })).toBeInTheDocument();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("marks a minute with no source measurement as missing", () => {
    const raw = snapshot();
    raw.separation_results = [];
    raw.minute_points = [
      { ...raw.minute_points[0], event_time: "2026-09-04T18:36:00+08:00" },
      { ...raw.minute_points[0], event_time: "2026-09-04T18:38:00+08:00" },
    ];
    render(<MinuteLedger snapshot={raw} selection={{
      start: new Date("2026-09-04T18:30:00+08:00").getTime(),
      end: new Date("2026-09-04T18:39:00+08:00").getTime(),
    }} selected={null} onSelect={vi.fn()} />);
    expect(screen.getByRole("button", { name: /18:37/ })).toHaveTextContent("全部缺测");
  });
});
