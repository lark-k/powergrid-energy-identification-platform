import gsap from "gsap";
import { Broadcast, CalendarDots, ClockCounterClockwise, SpinnerGap } from "@phosphor-icons/react";
import type { CSSProperties } from "react";
import type { StationDataRange, ViewMode } from "../../types/domain";

export interface HistorySelection {
  start: number;
  end: number;
}

interface HistoryWindowProps {
  dataRange: StationDataRange | null;
  selection: HistorySelection;
  cursor: number | null;
  viewMode: ViewMode;
  busy: boolean;
  onChange: (selection: HistorySelection) => void;
  onApply: () => Promise<void>;
  onGoLive: () => Promise<void>;
}

const minute = 60_000;
const snapMinute = gsap.utils.snap(minute);
const format = (value: number) => new Date(value).toLocaleString("zh-CN", {
  month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
});

export function HistoryWindow({ dataRange, selection, cursor, viewMode, busy, onChange, onApply, onGoLive }: HistoryWindowProps) {
  const minimum = dataRange?.first_event_time ? new Date(dataRange.first_event_time).getTime() : selection.start;
  const maximum = dataRange?.last_event_time ? new Date(dataRange.last_event_time).getTime() + minute : selection.end;
  const span = Math.max(minute, maximum - minimum);
  const startPercent = gsap.utils.mapRange(minimum, maximum, 0, 100, selection.start);
  const endPercent = gsap.utils.mapRange(minimum, maximum, 0, 100, selection.end);
  const cursorPercent = cursor == null ? startPercent : gsap.utils.clamp(startPercent, endPercent, gsap.utils.mapRange(minimum, maximum, 0, 100, cursor));
  const playbackPercent = endPercent === startPercent ? 0 : gsap.utils.mapRange(startPercent, endPercent, 0, 100, cursorPercent);

  const updateStart = (value: number) => onChange({ start: Math.min(snapMinute(value), selection.end - minute), end: selection.end });
  const updateEnd = (value: number) => onChange({ start: selection.start, end: Math.max(snapMinute(value), selection.start + minute) });
  const preset = (hours: number) => {
    const end = maximum;
    onChange({ start: Math.max(minimum, end - hours * 60 * minute), end });
  };

  return <details className="history-compact">
    <summary aria-label="打开历史时间窗口">
      <ClockCounterClockwise weight="duotone" />
      <span><b>{viewMode === "history" ? `历史回放 ${playbackPercent.toFixed(0)}%` : "历史窗口"}</b><small>{format(selection.start)}—{format(selection.end)}</small></span>
    </summary>
    <section className="history-popover" aria-label="历史数据时间窗口">
      <header>
        <div><ClockCounterClockwise weight="duotone" /><span><b>历史时间窗口</b><small>真实历史数据按分钟拟实时滚动</small></span></div>
        <div className="history-mode"><i className={viewMode} />{viewMode === "history" ? "历史演示" : "真实实时"}</div>
      </header>
      <div className="history-body">
      <div className="history-dates"><span><small>开始</small><b>{format(selection.start)}</b></span><Arrow /><span><small>结束</small><b>{format(selection.end)}</b></span></div>
      <div className="range-rail" style={{ "--range-start": `${startPercent}%`, "--range-end": `${endPercent}%`, "--cursor": `${cursorPercent}%` } as CSSProperties}>
        <div className="range-base" /><div className="range-selected" /><div className="range-cursor" />
        <input aria-label="历史窗口开始时间" type="range" min={minimum} max={maximum} step={minute} value={selection.start} onChange={(event) => updateStart(Number(event.target.value))} />
        <input aria-label="历史窗口结束时间" type="range" min={minimum} max={maximum} step={minute} value={selection.end} onChange={(event) => updateEnd(Number(event.target.value))} />
      </div>
      <div className="range-scale"><span>{format(minimum)}</span><b>{viewMode === "history" ? `已回放 ${playbackPercent.toFixed(0)}%` : "实时窗口持续向前"}</b><span>{format(maximum)}</span></div>
      </div>
      <div className="history-actions">
        <div className="history-presets" aria-label="快捷历史范围">
          <button onClick={() => preset(1)}>1h</button><button onClick={() => preset(6)}>6h</button><button onClick={() => preset(24)}>24h</button><button onClick={() => preset(24 * 7)}>7d</button>
        </div>
        <button className="history-apply" disabled={busy || span <= 0} onClick={() => void onApply()}>
          {busy ? <SpinnerGap className="spin" /> : <CalendarDots />}拟实时回放
        </button>
        <button className="live-reserved" disabled={busy} onClick={() => void onGoLive()}><Broadcast />切换实时</button>
      </div>
    </section>
  </details>;
}

function Arrow() { return <span className="date-arrow">→</span>; }
