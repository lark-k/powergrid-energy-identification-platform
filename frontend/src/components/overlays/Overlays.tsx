import { X } from "@phosphor-icons/react";
import { useEffect } from "react";
import { useDemoStore } from "../../stores/useDemoStore";

export function Overlays() {
  const { settingsOpen, guideOpen, setSettingsOpen, setGuideOpen, settings, updateSettings, toast, clearToast } = useDemoStore();
  useEffect(() => { if (!toast) return; const timer = window.setTimeout(clearToast, 2400); return () => window.clearTimeout(timer); }, [toast, clearToast]);
  return <>
    {settingsOpen && <div className="modal-backdrop" onMouseDown={() => setSettingsOpen(false)}><section className="modal" role="dialog" aria-modal="true" aria-label="系统设置" onMouseDown={(event) => event.stopPropagation()}><header><b>系统设置</b><button aria-label="关闭系统设置" onClick={() => setSettingsOpen(false)}><X /></button></header>
      <label>存在阈值 <strong>{settings.existsThreshold.toFixed(2)}</strong><input type="range" min="0.6" max="0.95" step="0.01" value={settings.existsThreshold} onChange={(event) => updateSettings({ existsThreshold: Number(event.target.value) })} /></label>
      <label>疑似存在阈值 <strong>{settings.suspectedThreshold.toFixed(2)}</strong><input type="range" min="0.3" max="0.75" step="0.01" value={settings.suspectedThreshold} onChange={(event) => updateSettings({ suspectedThreshold: Number(event.target.value) })} /></label>
      <label className="switch-row">降低背景动效<input type="checkbox" checked={settings.reducedEffects} onChange={(event) => updateSettings({ reducedEffects: event.target.checked })} /></label>
      <p>分站数量、回传间隔、模型版本、时间范围和阈值均由配置或真实接口提供，未写死在组件中。</p></section></div>}
    {guideOpen && <div className="modal-backdrop" onMouseDown={() => setGuideOpen(false)}><section className="modal guide" role="dialog" aria-modal="true" aria-label="看图说明" onMouseDown={(event) => event.stopPropagation()}><header><b>看图说明</b><button aria-label="关闭看图说明" onClick={() => setGuideOpen(false)}><X /></button></header>
      <ol><li><i className="white" /><span><b>白线</b>是总开1分钟有功功率。</span></li><li><i className="blue" /><span><b>蓝线</b>是每个新分钟立即产生的初始光伏结果。</span></li>
        <li><i className="amber" /><span><b>琥珀点</b>是已经到达的15分钟分站参考。</span></li><li><i className="green" /><span><b>绿线</b>只出现在已经反馈并校正的历史区间。</span></li>
        <li><i className="timeline" /><span>上轨是 <b>event_time</b>：青色横线表示历史覆盖区间；琥珀虚线连接到下轨的 <b>arrival_time</b> 菱形点，水平距离就是反馈延迟。</span></li><li><i className="now" /><span><b>NOW</b> 是当前边界，右侧永远不会绘制未来数据。</span></li></ol></section></div>}
    {toast && <div className="toast" role="status">{toast}</div>}
  </>;
}
