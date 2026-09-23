import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, Brain, Database, ShieldCheck, SolarPanel } from "@phosphor-icons/react";
import { SYSTEM_CONFIG } from "../../config/system";
import { modelAdapter, type ModelTask } from "../../services/modelAdapter";
import type { StationSnapshot, TrainingProcessRun } from "../../types/domain";
import { dateText, dateTimeText, percentText } from "../../utils/format";

const tasks: { task: ModelTask; name: string }[] = [
  { task: "resource_identification", name: "资源辨识" },
  { task: "pv_separation", name: "光伏功率分离" },
];

const completion = (run?: TrainingProcessRun) => {
  try {
    const source = JSON.parse(run?.source_record ?? "{}");
    if (source?.completion_time_source === "user_assigned_date" && /^\d{4}-\d{2}-\d{2}$/.test(source.completion_date)) {
      const time = Date.parse(`${source.completion_date}T00:00:00+08:00`);
      if (Number.isFinite(time)) return { time, date: source.completion_date as string, text: `${source.completion_date}（手动指定）` };
    }
  } catch { /* Older archives may contain plain text. */ }
  const time = run?.completed_at ? Date.parse(run.completed_at) : NaN;
  return Number.isFinite(time)
    ? { time, date: dateText(run!.completed_at!), text: dateTimeText(run!.completed_at!) }
    : { time: 0, date: "完成日期未记录", text: "未记录" };
};

export function ModelVersionManager({ runs, snapshot }: { runs: TrainingProcessRun[]; snapshot: StationSnapshot }) {
  const live = SYSTEM_CONFIG.sourceMode === "api";
  const queryClient = useQueryClient();
  const [selection, setSelection] = useState<Partial<Record<ModelTask, string>>>({});
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ error: boolean; text: string } | null>(null);
  const catalog = useQuery({ queryKey: ["model-versions"], queryFn: modelAdapter.list,
    enabled: live, refetchInterval: pending ? false : 5_000, retry: false });
  const data = catalog.data;
  const sortedRuns = [...runs].sort((a, b) => completion(b).time - completion(a).time || a.model_version.localeCompare(b.model_version));
  const runFor = (task: ModelTask, version: string) => sortedRuns.find(run => run.model_task === task && run.model_version === version);

  const operate = async (label: string, action: () => Promise<unknown>, success: string) => {
    if (pending) return;
    setPending(label); setNotice(null);
    try {
      await action();
      setNotice({ error: false, text: success });
    } catch (error) {
      setNotice({ error: true, text: error instanceof Error ? error.message : "操作失败，请刷新实际运行状态" });
    } finally {
      await catalog.refetch();
      await queryClient.invalidateQueries({ queryKey: ["training-runs"] });
      window.dispatchEvent(new Event("model-runtime-changed"));
      setPending(null);
    }
  };

  return <div className="management-page lifecycle-page">
    <section className="lifecycle-panel active-models">
      <header className="model-manager-heading"><Database /><h2>模型版本选择与运行状态</h2><button disabled={!!pending || catalog.isFetching || !live} onClick={() => void catalog.refetch()}>刷新版本</button></header>
      <p className="management-boundary"><ShieldCheck />切换作用于所有使用此模型服务的台区，仅影响后续推理；历史结果保留原模型版本。</p>
      {!live && <p className="model-operation-message">演示模式仅展示版本，实际切换需连接业务后台。</p>}
      {catalog.isLoading && <p className="model-operation-message" role="status">正在读取推理服务的实际版本…</p>}
      {catalog.isError && <p className="model-operation-message error" role="alert">无法确认当前生效版本：{catalog.error.message}。切换操作已停用，请刷新。</p>}
      {notice && <p className={`model-operation-message ${notice.error ? "error" : "success"}`} role={notice.error ? "alert" : "status"}>{notice.text}</p>}
      {live && data && !data.can_manage && <p className="model-operation-message">当前账号可以查看版本，批准和切换需要管理员权限。</p>}
      <div className="active-model-grid">{tasks.map(({ task, name }) => {
        const active = data?.active[task] ?? (live ? "" : task === "pv_separation" ? snapshot.model_health.separation_version : snapshot.model_health.recognition_version) ?? "";
        const available = (data?.models.filter(model => model.task === task) ?? []).sort((a, b) =>
          completion(runFor(task, b.model_version)).time - completion(runFor(task, a.model_version)).time || a.model_version.localeCompare(b.model_version));
        const selected = available.some(model => model.model_version === selection[task]) ? selection[task]! : active;
        const model = available.find(item => item.model_version === selected);
        const run = runs.find(item => item.model_task === task && item.model_version === selected);
        const inUse = !!active && active === selected;
        const blocked = !live || !data?.can_manage || catalog.isError || !!pending || !model || model.status !== "ready";
        const previous = data?.previous[task];
        return <article key={task} aria-label={`${name}版本管理`}>
          <header>{task === "pv_separation" ? <SolarPanel /> : <Brain />}<span><b>{name}</b><small>{model?.manifest?.model_type ?? task}</small></span><em className={inUse ? "running" : "archived"}>{inUse ? "当前生效" : model?.status === "incompatible" ? "不兼容" : "可选版本"}</em></header>
          <label className="model-version-picker"><span>选择{name}版本</span><select aria-label={`选择${name}模型版本`} value={selected} disabled={!!pending || !available.length} onChange={event => setSelection(current => ({ ...current, [task]: event.target.value }))}>
            {available.length ? available.map(item => <option value={item.model_version} key={item.model_version}>{completion(runFor(task, item.model_version)).date} · {item.model_version}{item.model_version === active ? "（当前生效）" : item.status !== "ready" ? "（不兼容）" : item.lifecycle_status !== "approved" ? "（待批准）" : "（可切换）"}</option>) : <option value={active}>{active || "暂无可用版本"}</option>}
          </select></label>
          <div className="selected-version-summary"><strong>{selected || "等待服务返回版本"}</strong><span className={inUse ? "active" : "archived"}>{inUse ? "当前在用" : model?.lifecycle_status === "approved" ? "已批准" : "未启用"}</span></div>
          {model && <p className="archive-scope">模型文件：{model.artifact_name}</p>}
          <div className="selected-version-kpis"><span><small>历史窗口</small><b>{model?.manifest ? `${model.manifest.required_history_minutes} 分钟` : "—"}</b></span><span><small>验证指标</small><b>{run?.metric_value == null ? "未提供" : `${run.metric_name} ${percentText(run.metric_value)}`}</b></span><span><small>制品校验</small><b>{model?.status === "ready" ? "已通过" : model ? "未通过" : "—"}</b></span></div>
          {model?.reason && <p className="model-operation-message error">该版本不可切换：{model.reason}</p>}
          <div className="model-switch-actions">
            {!inUse && model?.lifecycle_status !== "approved" && <button disabled={blocked} onClick={() => void operate(`${task}:approve`, () => modelAdapter.approve(selected), `${name}所选版本已批准，可以切换。`)}>{pending === `${task}:approve` ? "批准中…" : "批准此版本"}</button>}
            <button className="primary" disabled={blocked || inUse || model?.lifecycle_status !== "approved"} onClick={() => void operate(`${task}:switch`, () => modelAdapter.activate(selected, active), `${name}已切换，后续推理使用新版本。`)}>{pending === `${task}:switch` ? "正在切换…" : inUse ? "当前已启用" : "切换到此版本"}</button>
            <button disabled={!live || !data?.can_manage || catalog.isError || !!pending || !previous} onClick={() => void operate(`${task}:rollback`, () => modelAdapter.rollback(task, active), `${name}已回退到上一版本。`)}>{pending === `${task}:rollback` ? "回退中…" : "回退上一版本"}</button>
          </div>
          <footer><span title={active}>当前生效：{active || "未知"}</span><span title={previous ?? undefined}>上一版本：{previous ?? "暂无"}</span></footer>
        </article>;
      })}</div>
    </section>
    <section className="lifecycle-panel version-archive">
      <header className="model-manager-heading"><Archive /><h2>真实训练版本归档</h2></header>
      <div className="version-table"><div className="version-head"><span>模型类别</span><span>版本</span><span>运行状态</span><span>验证指标</span><span>完成时间</span></div>
        {sortedRuns.map(run => {
          const isActive = !catalog.isError && data?.active[run.model_task] === run.model_version;
          return <div className={`version-row${isActive ? " is-active" : ""}`} key={run.run_id}><span>{tasks.find(item => item.task === run.model_task)?.name}</span><span className="archive-model-version" title={run.model_version}>{run.model_version}</span><span>{isActive ? <b className="archive-active-badge"><ShieldCheck aria-hidden="true" />当前生效</b> : "训练归档"}</span><span>{run.metric_value == null ? "—" : `${run.metric_name} ${percentText(run.metric_value)}`}</span><span>{completion(run).text}</span></div>;
        })}
        {!runs.length && <p className="model-operation-message">后台没有训练版本归档</p>}
      </div>
      <p className="management-boundary">只有推理服务中已提供制品、通过兼容性检查并获批准的版本可以切换。</p>
    </section>
  </div>;
}
