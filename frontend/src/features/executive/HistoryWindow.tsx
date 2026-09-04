import gsap from "gsap";
import {
  Broadcast,
  CalendarDots,
  CaretLeft,
  CaretRight,
  ClockCounterClockwise,
  SpinnerGap,
} from "@phosphor-icons/react";
import { useMemo, useState, type CSSProperties } from "react";
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
  liveFollowing: boolean;
  busy: boolean;
  onChange: (selection: HistorySelection) => void;
  onApply: () => Promise<void>;
  onGoLive: () => Promise<void>;
}

type Boundary = "start" | "end";

const minute = 60_000;
const snapMinute = gsap.utils.snap(minute);
const pad = (value: number) => String(value).padStart(2, "0");
const dateKey = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const format = (value: number) => new Date(value).toLocaleString("zh-CN", {
  year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
});
const formatTime = (value: number) => {
  const date = new Date(value);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

export function HistoryWindow({ dataRange, selection, cursor, viewMode, liveFollowing, busy, onChange, onApply, onGoLive }: HistoryWindowProps) {
  const dataMinimum = dataRange?.first_event_time ? new Date(dataRange.first_event_time).getTime() : selection.start;
  const dataMaximum = dataRange?.last_event_time ? new Date(dataRange.last_event_time).getTime() + minute : selection.end;
  const minimum = Math.min(dataMinimum, selection.start);
  const maximum = viewMode === "live" ? Math.max(dataMaximum, selection.end) : dataMaximum;
  const span = Math.max(minute, maximum - minimum);
  const startPercent = gsap.utils.clamp(0, 100, gsap.utils.mapRange(minimum, maximum, 0, 100, selection.start));
  const endPercent = gsap.utils.clamp(0, 100, gsap.utils.mapRange(minimum, maximum, 0, 100, selection.end));
  const cursorPercent = cursor == null ? startPercent : gsap.utils.clamp(startPercent, endPercent, gsap.utils.mapRange(minimum, maximum, 0, 100, cursor));
  const playbackPercent = endPercent === startPercent ? 0 : gsap.utils.mapRange(startPercent, endPercent, 0, 100, cursorPercent);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [boundary, setBoundary] = useState<Boundary>("end");
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const date = new Date(selection.end);
    return new Date(date.getFullYear(), date.getMonth(), 1);
  });
  const availableDates = useMemo(() => new Set(dataRange?.available_dates ?? []), [dataRange?.available_dates]);
  const calendarDays = useMemo(() => {
    const first = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), 1);
    const mondayOffset = (first.getDay() + 6) % 7;
    return Array.from({ length: 42 }, (_, index) => {
      const day = new Date(first.getFullYear(), first.getMonth(), index - mondayOffset + 1);
      return { day, key: dateKey(day), inMonth: day.getMonth() === calendarMonth.getMonth() };
    });
  }, [calendarMonth]);
  const firstMonth = new Date(new Date(minimum).getFullYear(), new Date(minimum).getMonth(), 1).getTime();
  const lastMonth = new Date(new Date(maximum).getFullYear(), new Date(maximum).getMonth(), 1).getTime();

  const updateStart = (value: number) => onChange({ start: Math.max(minimum, Math.min(snapMinute(value), selection.end - minute)), end: selection.end });
  const updateEnd = (value: number) => onChange({ start: selection.start, end: Math.min(maximum, Math.max(snapMinute(value), selection.start + minute)) });
  const preset = (hours: number) => {
    const end = maximum;
    onChange({ start: Math.max(minimum, end - hours * 60 * minute), end });
  };
  const openCalendar = (nextBoundary: Boundary) => {
    const date = new Date(selection[nextBoundary]);
    setBoundary(nextBoundary);
    setCalendarMonth(new Date(date.getFullYear(), date.getMonth(), 1));
    setCalendarOpen(true);
  };
  const selectDate = (day: Date) => {
    const current = new Date(selection[boundary]);
    const next = new Date(day.getFullYear(), day.getMonth(), day.getDate(), current.getHours(), current.getMinutes());
    if (boundary === "start") updateStart(next.getTime());
    else updateEnd(next.getTime());
  };
  const updateTime = (nextBoundary: Boundary, value: string) => {
    const [hours, minutes] = value.split(":").map(Number);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return;
    const next = new Date(selection[nextBoundary]);
    next.setHours(hours, minutes, 0, 0);
    if (nextBoundary === "start") updateStart(next.getTime());
    else updateEnd(next.getTime());
  };

  return <details className="history-compact">
    <summary aria-label="打开时间窗口">
      <ClockCounterClockwise weight="duotone" />
      <span><b>{viewMode === "history" ? `历史回放 ${playbackPercent.toFixed(0)}%` : liveFollowing ? "实时窗口" : "待回放窗口"}</b><small>{format(selection.start)}—{format(selection.end)}</small></span>
    </summary>
    <section className="history-popover" aria-label="数据时间窗口">
      <header>
        <div><ClockCounterClockwise weight="duotone" /><span><b>{viewMode === "history" ? "历史时间窗口" : liveFollowing ? "实时时间窗口" : "已选历史窗口"}</b><small>{viewMode === "history" ? "真实历史数据按分钟拟实时滚动" : liveFollowing ? "窗口随最新数据持续向前" : "时间已定格，点击拟实时回放后开始"}</small></span></div>
        <div className="history-mode"><i className={viewMode === "live" && !liveFollowing ? "history" : viewMode} />{viewMode === "history" ? "历史演示" : liveFollowing ? "真实实时" : "待回放"}</div>
      </header>
      <div className="history-body">
        <div className="history-dates">
          <button type="button" className={calendarOpen && boundary === "start" ? "active" : ""} onClick={() => openCalendar("start")}><small>开始</small><b>{format(selection.start)}</b><CalendarDots /></button>
          <Arrow />
          <button type="button" className={calendarOpen && boundary === "end" ? "active" : ""} onClick={() => openCalendar("end")}><small>结束</small><b>{format(selection.end)}</b><CalendarDots /></button>
        </div>
        <div className="range-rail" style={{ "--range-start": `${startPercent}%`, "--range-end": `${endPercent}%`, "--cursor": `${cursorPercent}%` } as CSSProperties}>
          <div className="range-base" /><div className="range-selected" /><div className="range-cursor" />
          <input aria-label="历史窗口开始时间" type="range" min={minimum} max={maximum} step={minute} value={selection.start} onChange={(event) => updateStart(Number(event.target.value))} />
          <input aria-label="历史窗口结束时间" type="range" min={minimum} max={maximum} step={minute} value={selection.end} onChange={(event) => updateEnd(Number(event.target.value))} />
        </div>
        <div className="range-scale"><span>{format(minimum)}</span><b>{viewMode === "history" ? `已回放 ${playbackPercent.toFixed(0)}%` : liveFollowing ? "实时窗口持续向前" : "窗口已定格，等待回放"}</b><span>{format(maximum)}</span></div>
        {calendarOpen && <div className="history-calendar" aria-label="历史数据日期选择">
          <div className="calendar-toolbar">
            <button type="button" aria-label="上个月" disabled={calendarMonth.getTime() <= firstMonth} onClick={() => setCalendarMonth((month) => new Date(month.getFullYear(), month.getMonth() - 1, 1))}><CaretLeft /></button>
            <b>{calendarMonth.getFullYear()} 年 {calendarMonth.getMonth() + 1} 月</b>
            <button type="button" aria-label="下个月" disabled={calendarMonth.getTime() >= lastMonth} onClick={() => setCalendarMonth((month) => new Date(month.getFullYear(), month.getMonth() + 1, 1))}><CaretRight /></button>
            <span>正在选择{boundary === "start" ? "开始" : "结束"}时间</span>
          </div>
          <div className="calendar-weekdays" aria-hidden="true">{["一", "二", "三", "四", "五", "六", "日"].map((day) => <span key={day}>{day}</span>)}</div>
          <div className="calendar-grid">
            {calendarDays.map(({ day, key, inMonth }) => {
              const available = availableDates.has(key);
              const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
              const dayEnd = dayStart + 24 * 60 * minute;
              const inRange = dayStart < selection.end && dayEnd > selection.start;
              const selected = dateKey(new Date(selection[boundary])) === key;
              const label = `${day.getFullYear()}年${day.getMonth() + 1}月${day.getDate()}日，${available ? "有数据" : "无数据"}`;
              return <button type="button" key={key} aria-label={label} className={`${inMonth ? "" : "outside"} ${inRange ? "in-range" : ""} ${selected ? "selected" : ""}`} disabled={!available} onClick={() => selectDate(day)}>{day.getDate()}</button>;
            })}
          </div>
          <div className="history-time-editors">
            <label><span>开始时刻</span><input aria-label="开始时刻" type="time" step="60" value={formatTime(selection.start)} onChange={(event) => updateTime("start", event.target.value)} /></label>
            <label><span>结束时刻</span><input aria-label="结束时刻" type="time" step="60" value={formatTime(selection.end)} onChange={(event) => updateTime("end", event.target.value)} /></label>
            <small>灰色日期表示当天没有分钟数据</small>
          </div>
        </div>}
      </div>
      <div className="history-actions">
        <div className="history-presets" aria-label="快捷历史范围">
          <button onClick={() => preset(1)}>1h</button><button onClick={() => preset(6)}>6h</button><button onClick={() => preset(24)}>24h</button><button onClick={() => preset(24 * 7)}>7d</button>
        </div>
        <button type="button" className="calendar-toggle" aria-expanded={calendarOpen} onClick={() => setCalendarOpen((open) => !open)}><CalendarDots />日历选择</button>
        <button className="history-apply" disabled={busy || span <= 0} onClick={() => void onApply()}>
          {busy ? <SpinnerGap className="spin" /> : <ClockCounterClockwise />}拟实时回放
        </button>
        {viewMode === "history" && <button className="live-reserved" disabled={busy} onClick={() => void onGoLive()}><Broadcast />切换实时</button>}
      </div>
    </section>
  </details>;
}

function Arrow() { return <span className="date-arrow">→</span>; }
