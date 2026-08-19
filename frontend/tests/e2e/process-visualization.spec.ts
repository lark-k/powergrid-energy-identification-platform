import { expect, test } from "@playwright/test";

test("四个全生命周期业务页可打开、切换和关闭", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("新型能源智能辨识与分离平台");

  await page.getByRole("button", { name: "01 采得到 数据采集" }).click();
  const collectionDialog = page.getByRole("dialog", { name: "数据采集详情页面" });
  await expect(collectionDialog).toBeVisible();
  await expect(collectionDialog.getByText("输入数据源", { exact: true })).toBeVisible();
  await expect(collectionDialog.getByText("特征含义", { exact: true })).toBeVisible();
  await expect(collectionDialog.getByText("输出数据", { exact: true })).toBeVisible();
  await expect(collectionDialog.getByText("主站采集传输拓扑", { exact: true })).toBeVisible();
  await expect(collectionDialog.getByText("数据处理与训练样本生成", { exact: true })).toBeVisible();
  await expect(collectionDialog.getByLabel("主站从多个分站汇聚数据的动态拓扑")).toBeVisible();
  await expect(collectionDialog.getByLabel("从原始数据到训练样本的数据处理流程")).toBeVisible();

  await collectionDialog.getByRole("button", { name: "02模型训练", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "模型训练详情页面" })).toBeVisible();
  await expect(page.getByText("真实离线训练任务", { exact: true })).toBeVisible();
  await expect(page.getByLabel("样本准备到验证发布的动态训练流程")).toBeVisible();
  await page.getByRole("button", { name: "03模型验证", exact: true }).click();
  await expect(page.getByText("模型发布门禁", { exact: true })).toBeVisible();
  await expect(page.getByLabel("从独立验证集到人工审批发布的动态流程")).toBeVisible();
  await page.getByRole("button", { name: "04模型应用管理", exact: true }).click();
  await expect(page.getByText("模型版本选择与运行状态", { exact: true })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "选择资源辨识模型版本" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "选择光伏功率分离模型版本" })).toBeVisible();

  await page.getByRole("button", { name: "关闭详情页面" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
});
