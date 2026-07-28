import { useRef } from "react";
import { ArrowLineDown, ArrowLineUp, ArrowsOut, CaretDown, GearSix, MapPin, Pulse, Question, WaveSine } from "@phosphor-icons/react";
import type { TimeRange } from "../../types/domain";
import { useDemoStore } from "../../stores/useDemoStore";
import { dateText, timeText } from "../../utils/format";

export function Header({ stationName, now, range, setRange }: { stationName: string; now: string; range: TimeRange; setRange: (range: TimeRange) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { importFile, exportData, setSettingsOpen, setGuideOpen, busy } = useDemoStore();
  const fullscreen = () => document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
  return <>
    <header className="header">
      <div className="brand"><WaveSine weight="duotone" /><div><b>Aurora Signal Lab</b><span>极光信号实验舱</span></div></div>
      <div className="system-name">台区光储充辨识与光伏功率分离系统</div>
      <nav className="header-status" aria-label="系统工具栏">
        <span><MapPin weight="fill" />{stationName}<CaretDown /></span>
        <span className="source"><Pulse weight="fill" />模拟数据 · 持续接入</span>
        <span className="healthy"><i />系统连接正常</span>
        <span className="clock">{dateText(now)}<strong>{timeText(now, true)}</strong></span>
        <input ref={inputRef} type="file" accept=".csv,.xlsx,.json" hidden onChange={(event) => event.target.files?.[0] && importFile(event.target.files[0])} />
        <button aria-label="导入数据" title="导入数据" disabled={busy} onClick={() => inputRef.current?.click()}><ArrowLineDown /></button>
        <button aria-label="导出结果" title="导出结果" disabled={busy} onClick={exportData}><ArrowLineUp /></button>
        <button aria-label="看图说明" title="看图说明" onClick={() => setGuideOpen(true)}><Question /></button>
        <button aria-label="系统设置" title="系统设置" onClick={() => setSettingsOpen(true)}><GearSix /></button>
        <button aria-label="全屏" title="全屏" onClick={fullscreen}><ArrowsOut /></button>
      </nav>
    </header>
    <div className="subnav">
      <span className="active">台区总览</span>
      <div className="range-switch" aria-label="时间范围">{(["1h", "6h", "24h", "7d"] as TimeRange[]).map((item) =>
        <button key={item} className={item === range ? "active" : ""} onClick={() => setRange(item)}>{item}</button>)}</div>
    </div>
  </>;
}
