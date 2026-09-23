import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { LifecycleOverlay } from "../features/executive/LifecycleOverlay";
import { modelAdapter } from "../services/modelAdapter";
import { processAdapter } from "../services/processAdapter";
import type { StationSnapshot, TrainingProcessRun } from "../types/domain";

vi.mock("../config/system", () => ({ SYSTEM_CONFIG: { sourceMode: "api" } }));
vi.mock("../services/modelAdapter", () => ({ modelAdapter: { list: vi.fn() } }));
vi.mock("../services/processAdapter", () => ({ processAdapter: { getTrainingRuns: vi.fn(), getCollectionProcess: vi.fn() } }));
vi.mock("@gsap/react", () => ({ useGSAP: vi.fn() }));
vi.mock("gsap", () => ({ default: { registerPlugin: vi.fn() } }));
vi.mock("../components/charts/EChart", () => ({ EChart: ({ option }: { option: unknown }) => <pre data-testid="curve">{JSON.stringify(option)}</pre> }));
afterEach(cleanup);
const archive = (version: string, formal: boolean): TrainingProcessRun => ({
  source: "rest-api", run_id: version, station_id: "A01", model_task: "pv_separation", model_version: version,
  status: "completed", window_size_minutes: 240, sample_count: formal ? 24824 : 11466, dataset_window_days: 22,
  completed_at: "2026-09-22T00:00:00+08:00", started_at: "", metric_name: "activity_f1", metric_value: .9634,
  validation_score: .9634, validation_series_name: formal ? "验证发电时段 MAE（kW）" : "旧验证序列",
  source_record: JSON.stringify({ input_channels: formal ? 114 : 7, evaluation_scope: formal ? "全部构造数据评估" : "旧数据",
    completion_time_source: "user_assigned_date", completion_date: "2026-09-22" }),
  steps: [], release_checks: [], epochs: [{ epoch: 1, training_loss: formal ? .58 : .99, validation_loss: null, validation_score: formal ? 5.66 : 3.33 }],
});
it("training and validation follow exact active versions and never borrow another archive", async () => {
  vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  vi.mocked(processAdapter.getTrainingRuns).mockResolvedValue([archive("pv-old", false), archive("pv-new", true)]);
  vi.mocked(processAdapter.getCollectionProcess).mockResolvedValue({} as never);
  const active = { pv_separation: "pv-old", resource_identification: "no-archive" };
  vi.mocked(modelAdapter.list).mockResolvedValue({ active } as never);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const props = { snapshot: { station_id: "A01" } as StationSnapshot, reducedMotion: true, onStageChange: vi.fn(), onClose: vi.fn() };
  const view = render(<QueryClientProvider client={client}><LifecycleOverlay {...props} stage="training" /></QueryClientProvider>);
  expect(await screen.findByText("240 × 7")).toBeInTheDocument();
  client.setQueryData(["model-versions"], { active: { ...active, pv_separation: "pv-new" } });
  await waitFor(() => expect(screen.getByText("240 × 114")).toBeInTheDocument());
  expect(screen.queryByText("240 × 7")).not.toBeInTheDocument();
  expect(screen.getByTestId("curve")).toHaveTextContent("5.66");
  expect(screen.getByText(/2026-09-22（手动指定）/)).toBeInTheDocument();
  view.rerender(<QueryClientProvider client={client}><LifecycleOverlay {...props} stage="validation" /></QueryClientProvider>);
  expect(screen.getByText("全部构造数据评估")).toBeInTheDocument();
  expect(screen.queryByText("旧数据")).not.toBeInTheDocument();
  client.setQueryData(["model-versions"], { active: { ...active, pv_separation: "pv-without-archive" } });
  await waitFor(() => expect(screen.queryByTestId("curve")).not.toBeInTheDocument());
  expect(screen.getByText(/光伏功率分离：pv-without-archive · 该版本暂无训练归档/)).toBeInTheDocument();
});
