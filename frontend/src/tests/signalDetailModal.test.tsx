import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SignalDetailModal } from "../features/executive/SignalDetailModal";

vi.mock("../components/charts/EChart", () => ({
  EChart: ({ ariaLabel, preserveTooltipOnUpdate, freezeUpdatesOnHover }: { ariaLabel: string; preserveTooltipOnUpdate?: boolean; freezeUpdatesOnHover?: boolean }) => <div
    role="img"
    aria-label={ariaLabel}
    data-preserve-tooltip={String(Boolean(preserveTooltipOnUpdate))}
    data-freeze-updates={String(Boolean(freezeUpdatesOnHover))}
  />,
}));

afterEach(cleanup);

describe("SignalDetailModal", () => {
  it("preserves the hovered tooltip while live data rerenders the chart", () => {
    render(<SignalDetailModal
      spec={{
        title: "总开有功",
        tone: "cyan",
        data: [{ at: "2026-09-04T14:30:00+08:00", value: -0.814 }],
        conclusion: "分钟数据完整率 100%",
      }}
      onSelect={vi.fn()}
      onClose={vi.fn()}
    />);

    expect(screen.getByRole("img", { name: "总开有功完整时间曲线" })).toHaveAttribute("data-preserve-tooltip", "true");
    expect(screen.getByRole("img", { name: "总开有功完整时间曲线" })).toHaveAttribute("data-freeze-updates", "true");
  });
});
