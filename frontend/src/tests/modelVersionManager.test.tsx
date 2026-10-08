import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ModelVersionManager } from "../features/executive/ModelVersionManager";
import { modelAdapter, type ModelCatalog } from "../services/modelAdapter";
import type { StationSnapshot, TrainingProcessRun } from "../types/domain";

vi.mock("../config/system", () => ({ SYSTEM_CONFIG: { sourceMode: "api" } }));
vi.mock("../services/modelAdapter", () => ({ modelAdapter: { list: vi.fn(), approve: vi.fn(), activate: vi.fn(), rollback: vi.fn() } }));
let catalog: ModelCatalog;
beforeEach(() => {
  vi.clearAllMocks();
  catalog = { active: { resource_identification: "resource-old", pv_separation: "pv-old" },
    previous: { resource_identification: null, pv_separation: null }, can_manage: true,
    models: [
      { task: "resource_identification", model_version: "resource-old", lifecycle_status: "approved" },
      { task: "resource_identification", model_version: "resource-new", lifecycle_status: "approved" },
      { task: "pv_separation", model_version: "pv-old", lifecycle_status: "approved" },
    ].map(item => ({ ...item, status: "ready", artifact_sha256: "digest", artifact_name: "checkpoint.pt", reason: null,
      manifest: { model_type: "tcn_lstm", required_history_minutes: 120, input_fields: [] } })) as ModelCatalog["models"] };
  vi.mocked(modelAdapter.list).mockImplementation(async () => structuredClone(catalog));
});
afterEach(cleanup);
function open() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const runs = [
    { run_id: "resource-old-run", model_task: "resource_identification", model_version: "resource-old" },
    { run_id: "resource-new-run", model_task: "resource_identification", model_version: "resource-new" },
    { run_id: "pv-old-run", model_task: "pv_separation", model_version: "pv-old" },
  ] as TrainingProcessRun[];
  return render(<QueryClientProvider client={client}><ModelVersionManager runs={runs} snapshot={{ model_health: {} } as StationSnapshot} /></QueryClientProvider>);
}
async function selectNew() {
  const panel = screen.getByRole("article", { name: "资源辨识版本管理" });
  await waitFor(() => expect(within(panel).getByRole("combobox")).not.toBeDisabled());
  fireEvent.change(within(panel).getByRole("combobox"), { target: { value: "resource-new" } });
  return panel;
}
describe("model version management", () => {
  it("changes only the selected task after server confirmation and supports rollback", async () => {
    vi.mocked(modelAdapter.activate).mockImplementation(async () => {
      catalog.active.resource_identification = "resource-new";
      catalog.previous.resource_identification = "resource-old";
      return {};
    });
    vi.mocked(modelAdapter.rollback).mockImplementation(async () => {
      catalog.active.resource_identification = "resource-old"; return {};
    });
    open(); const panel = await selectNew();
    expect(modelAdapter.activate).not.toHaveBeenCalled();
    fireEvent.click(within(panel).getByRole("button", { name: "切换到此版本" }));
    await waitFor(() => expect(within(panel).getByText("当前生效：resource-new")).toBeInTheDocument());
    expect(modelAdapter.activate).toHaveBeenCalledWith("resource-new", "resource-old");
    expect(screen.getByText("当前生效：pv-old")).toBeInTheDocument();
    fireEvent.click(within(panel).getByRole("button", { name: "回退上一版本" }));
    await waitFor(() => expect(within(panel).getByText("当前生效：resource-old")).toBeInTheDocument());
    expect(modelAdapter.rollback).toHaveBeenCalledWith("resource_identification", "resource-new");
  });
  it("preserves actual active version on rejection", async () => {
    vi.mocked(modelAdapter.activate).mockRejectedValue(new Error("模型不兼容"));
    open(); const panel = await selectNew();
    fireEvent.click(within(panel).getByRole("button", { name: "切换到此版本" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("模型不兼容");
    expect(within(panel).getByText("当前生效：resource-old")).toBeInTheDocument();
  });
  it("requires approval before switching and disables read-only users", async () => {
    catalog.models[1].lifecycle_status = "unregistered";
    vi.mocked(modelAdapter.approve).mockImplementation(async () => { catalog.models[1].lifecycle_status = "approved"; return {}; });
    open(); const panel = await selectNew();
    expect(within(panel).getByRole("button", { name: "切换到此版本" })).toBeDisabled();
    fireEvent.click(within(panel).getByRole("button", { name: "批准此版本" }));
    await waitFor(() => expect(within(panel).getByRole("button", { name: "切换到此版本" })).not.toBeDisabled());
    cleanup(); catalog.can_manage = false;
    open(); const readOnly = await selectNew();
    expect(within(readOnly).getByRole("button", { name: "切换到此版本" })).toBeDisabled();
  });
});
