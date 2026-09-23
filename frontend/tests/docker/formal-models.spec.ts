import { expect, test, type Page } from "@playwright/test";

const current = { resource_identification: "sgcc-identification-f291cfb7f4fc", pv_separation: "sgcc-pv-separation-646637f18f09" };
const old = { resource_identification: "sgcc-identification-8b2a09fd9b28", pv_separation: "sgcc-pv-separation-ed9cfd51f444" };
const name = { resource_identification: "资源辨识", pv_separation: "光伏功率分离" };

async function switchTo(page: Page, task: keyof typeof current, version: string) {
  await page.getByRole("button", { name: "04模型应用管理", exact: true }).click();
  const panel = page.getByRole("article", { name: `${name[task]}版本管理` });
  await panel.getByRole("combobox").selectOption(version);
  const approve = panel.getByRole("button", { name: "批准此版本", exact: true });
  if (await approve.isVisible()) await approve.click();
  const activate = panel.getByRole("button", { name: "切换到此版本", exact: true });
  if (await activate.isVisible()) { await expect(activate).toBeEnabled(); await activate.click(); }
  await expect(panel.getByText(`当前生效：${version}`, { exact: true })).toBeVisible();
}

test("Docker real switches synchronize both training and validation, finishing on formal-v1", async ({ page, request }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/");
  await page.getByRole("button", { name: "02 训得准 模型训练" }).click();
  try {
    for (const task of ["pv_separation", "resource_identification"] as const) {
      await switchTo(page, task, old[task]);
      await page.getByRole("button", { name: "02模型训练", exact: true }).click();
      await expect(page.locator(".run-cards").getByText(old[task], { exact: true })).toBeVisible();
      await expect(page.locator(".run-cards").getByText(current[task], { exact: true })).toHaveCount(0);
      await page.getByRole("button", { name: "03模型验证", exact: true }).click();
      await expect(page.locator(".validation-cards").getByText(old[task], { exact: true })).toBeVisible();
      await switchTo(page, task, current[task]);
      await page.getByRole("button", { name: "02模型训练", exact: true }).click();
      await expect(page.locator(".run-cards").getByText(current[task], { exact: true })).toBeVisible();
      await expect(page.locator(".run-cards").getByText(old[task], { exact: true })).toHaveCount(0);
    }
    await expect(page.getByText("240 × 114", { exact: true })).toBeVisible();
    await expect(page.getByText("120 × 114", { exact: true })).toBeVisible();
    await expect(page.getByText("42 个真实 Epoch", { exact: true })).toBeVisible();
    await expect(page.getByText("18 个真实 Epoch", { exact: true })).toBeVisible();
    await expect(page.locator(".training-curves")).toHaveCSS("opacity", "1");
    await page.screenshot({ path: testInfo.outputPath("formal-training.png"), fullPage: true });
    await page.getByRole("button", { name: "03模型验证", exact: true }).click();
    await expect(page.getByText("全部构造数据评估，不代表真实在线精度", { exact: true })).toBeVisible();
    await expect(page.locator(".evaluation-metrics table")).toHaveCount(2);
    await expect(page.locator(".validation-curves")).toHaveCSS("opacity", "1");
    await page.screenshot({ path: testInfo.outputPath("formal-validation.png"), fullPage: true });
    await page.reload();
    await page.getByRole("button", { name: "02 训得准 模型训练" }).click();
    await expect(page.getByText("240 × 114", { exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    // The review deployment always ends with both user-requested latest models selected.
    for (const task of ["resource_identification", "pv_separation"] as const) {
      const state = await (await request.get("/api/v1/models/available")).json();
      await request.post(`/api/v1/models/${current[task]}/approve`);
      const activated = await request.post(`/api/v1/models/${current[task]}/deploy`, {
        data: { role: "active", expected_version: state.active[task] },
      });
      expect(activated.ok()).toBeTruthy();
    }
  }
});
