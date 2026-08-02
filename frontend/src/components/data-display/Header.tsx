import { useEffect, useRef, useState } from "react";
import { ArrowLineDown, ArrowLineUp, ArrowsOut, CaretDown, GearSix, MapPin, Pulse, Question, WaveSine } from "@phosphor-icons/react";
import type { ConnectionState, StationDataRange, StationSummary, TimeRange, ViewMode } from "../../types/domain";
import { useDemoStore } from "../../stores/useDemoStore";
import { SYSTEM_CONFIG } from "../../config/system";
import { dateText, timeText } from "../../utils/format";

const localInputValue = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};
const afterLastMinute = (value: string) => new Date(new Date(value).getTime() + 60_000).toISOString();

export function Header({ stationName, stations, stationId, connection, now, range, viewMode, historyAt, dataRange, setStation, setRange, setHistoryAt, goLive }: {
  stationName: string; stations: StationSummary[]; stationId: string; connection: ConnectionState; now: string; range: TimeRange;
  viewMode: ViewMode; historyAt: string | null; dataRange: StationDataRange | null;
  setStation: (stationId: string) => Promise<void>; setRange: (range: TimeRange) => Promise<void>;
  setHistoryAt: (at: string) => Promise<void>; goLive: () => Promise<void>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const defaultHistoryValue = localInputValue(historyAt ?? (dataRange?.last_event_time ? afterLastMinute(dataRange.last_event_time) : now));
  const [historyDraft, setHistoryDraft] = useState(defaultHistoryValue);
  useEffect(() => setHistoryDraft(defaultHistoryValue), [defaultHistoryValue]);
  const { importFile, exportData, setSettingsOpen, setGuideOpen, busy } = useDemoStore();
  const fullscreen = () => document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
  return <>
    <header className="header">
      <div className="brand"><WaveSine weight="duotone" /><div><b>Aurora Signal Lab</b><span>极光信号实验舱</span></div></div>
      <div className="system-name">台区光伏、能源站、充电桩辨识与光伏功率分离系统</div>
      <nav className="header-status" aria-label="系统工具栏">
        <label className="station-select"><MapPin weight="fill" /><span className="sr-only">选择台区</span><select value={stationId} aria-label="选择台区" onChange={(event) => void setStation(event.target.value)}>{stations.length ? stations.map((station) => <option key={station.station_id} value={station.station_id}>{station.station_name}</option>) : <option value={stationId}>{stationName}</option>}</select><CaretDown /></label>
        <span className="source"><Pulse weight="fill" />{SYSTEM_CONFIG.sourceMode === "api" ? "业务后台 · 真实数据" : "演示模式 · Mock 数据"}</span>
        <span className={connection === "online" ? "healthy" : "warning"}><i />{connection === "online" ? "系统连接正常" : connection === "degraded" ? "系统降级" : connection === "connecting" ? "正在连接" : "后台离线"}</span>
        <span className="clock">{dateText(now)}<strong>{timeText(now, true)}</strong></span>
        <input ref={inputRef} type="file" accept=".csv,.json" hidden onChange={(event) => event.target.files?.[0] && importFile(event.target.files[0])} />
        <button aria-label="导入数据" title="导入数据" disabled={busy} onClick={() => inputRef.current?.click()}><ArrowLineDown /></button>
        <button aria-label="导出结果" title="导出结果" disabled={busy} onClick={exportData}><ArrowLineUp /></button>
        <button aria-label="看图说明" title="看图说明" onClick={() => setGuideOpen(true)}><Question /></button>
        <button aria-label="系统设置" title="系统设置" onClick={() => setSettingsOpen(true)}><GearSix /></button>
        <button aria-label="全屏" title="全屏" onClick={fullscreen}><ArrowsOut /></button>
      </nav>
    </header>
    <div className="subnav">
      <span className="active">台区总览</span>
      <div className="history-switch">
        <button className={viewMode === "live" ? "active" : ""} onClick={() => void goLive()}>实时</button>
        <label className={viewMode === "history" ? "active" : ""}>
          <span>历史截止</span>
          <input type="datetime-local" aria-label="历史查询时刻"
            value={historyDraft}
            min={dataRange?.first_event_time ? localInputValue(dataRange.first_event_time) : undefined}
            max={dataRange?.last_event_time ? localInputValue(afterLastMinute(dataRange.last_event_time)) : undefined}
            onChange={(event) => setHistoryDraft(event.target.value)} />
        </label>
        <button disabled={!historyDraft || busy} onClick={() => void setHistoryAt(historyDraft)}>查询</button>
        {dataRange && <small title="原始分钟 / 光伏分离结果">{dataRange.minute_count.toLocaleString()} / {dataRange.separation_result_count.toLocaleString()}</small>}
      </div>
      <div className="range-switch" aria-label="时间范围">{(["1h", "6h", "24h", "7d"] as TimeRange[]).map((item) =>
        <button key={item} className={item === range ? "active" : ""} onClick={() => setRange(item)}>{item}</button>)}</div>
    </div>
  </>;
}
