import { expect, test } from "@playwright/test";

test("数据采集与模型训练过程驾驶舱可打开、切换和关闭", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /台区总开有功功率与光伏功率分离/ })).toBeVisible();

  await page.getByRole("button", { name: /数据采集/ }).click();
  const collectionDialog = page.getByRole("dialog", { name: "数据采集过程驾驶舱" });
  await expect(collectionDialog).toBeVisible();
  await expect(collectionDialog.getByText("PROCESS API · MOCK API")).toBeVisible();
  await expect(collectionDialog.getByRole("img", { name: "最近四十二分钟总开原始功率信号" })).toBeVisible();

  await collectionDialog.getByRole("button", { name: "模型训练", exact: true }).click();
  const trainingDialog = page.getByRole("dialog", { name: "模型训练过程驾驶舱" });
  await expect(trainingDialog).toBeVisible();
  await expect(trainingDialog.getByRole("img", { name: "最近一次离线训练收敛轨迹" })).toBeVisible();
  await expect(trainingDialog.getByText("曲线直接读取训练过程接口返回的 epoch 指标。")).toBeVisible();

  await trainingDialog.getByRole("button", { name: "关闭过程可视化" }).click();
  await expect(trainingDialog).toBeHidden();
});
