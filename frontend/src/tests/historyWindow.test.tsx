import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HistoryWindow } from "../features/executive/HistoryWindow";
import type { StationDataRange } from "../types/domain";

const start = new Date(2026, 8, 2, 8, 0).getTime();
const end = new Date(2026, 8, 4, 12, 0).getTime();
const dataRange: StationDataRange = {
  first_event_time: new Date(2026, 8, 1, 0, 0).toISOString(),
  last_event_time: new Date(2026, 8, 5, 23, 59).toISOString(),
  minute_count: 3_000,
  recognition_result_count: 2_800,
  separation_result_count: 2_700,
  available_dates: ["2026-09-02", "2026-09-04", "2026-09-05"],
};

const renderWindow = (viewMode: "live" | "history", onChange = vi.fn(), liveFollowing = true) => render(<HistoryWindow
  dataRange={dataRange}
  selection={{ start, end }}
  cursor={viewMode === "history" ? start + 60_000 : end}
  viewMode={viewMode}
  liveFollowing={liveFollowing}
  busy={false}
  onChange={onChange}
  onApply={vi.fn().mockResolvedValue(undefined)}
  onGoLive={vi.fn().mockResolvedValue(undefined)}
/>);

afterEach(cleanup);

describe("HistoryWindow", () => {
  it("labels a live view as a real-time window", () => {
    renderWindow("live");
    expect(screen.getByText("实时窗口")).toBeInTheDocument();
    expect(screen.getByText("2026/09/02 08:00")).toBeInTheDocument();
    expect(screen.getByText("2026/09/04 12:00")).toBeInTheDocument();
    expect(screen.queryByText(/^历史回放/)).not.toBeInTheDocument();
  });

  it("shows that a manually selected live window is frozen for replay", () => {
    renderWindow("live", vi.fn(), false);
    expect(screen.getByText("待回放窗口")).toBeInTheDocument();
    expect(screen.getByText("窗口已定格，等待回放")).toBeInTheDocument();
  });

  it("disables calendar days without minute data", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderWindow("history", onChange);

    await user.click(screen.getByRole("button", { name: "日历选择" }));
    expect(screen.getByRole("button", { name: "2026年9月3日，无数据" })).toBeDisabled();
    const availableDay = screen.getByRole("button", { name: "2026年9月5日，有数据" });
    expect(availableDay).toBeEnabled();
    await user.click(availableDay);
    expect(onChange).toHaveBeenCalled();
  });
});
