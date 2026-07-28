import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StartupTransition } from "./StartupTransition";

describe("StartupTransition", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn().mockImplementation(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });
  });

  afterEach(() => vi.useRealTimers());

  it("等待快照就绪后才展开主界面", () => {
    const onComplete = vi.fn();
    const view = render(<StartupTransition ready={false} onComplete={onComplete} />);

    expect(screen.getByRole("status", { name: "系统数据正在接入" })).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(5_000));
    expect(onComplete).not.toHaveBeenCalled();

    view.rerender(<StartupTransition ready onComplete={onComplete} />);
    act(() => vi.advanceTimersByTime(760));
    expect(onComplete).toHaveBeenCalledOnce();
  });

  it("低动效模式快速完成过渡", () => {
    const onComplete = vi.fn();
    render(<StartupTransition ready reducedEffects onComplete={onComplete} />);

    act(() => vi.advanceTimersByTime(120));
    expect(onComplete).toHaveBeenCalledOnce();
  });
});
