import { expect, test } from "@playwright/test";

test("方案二全流程首页、历史窗口和分钟追溯可用", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("新型能源智能辨识与分离平台");
  await expect(page.getByRole("region", { name: /全流程/ })).toBeVisible();
  await expect(page.getByRole("img", { name: "总开有功历史趋势" })).toBeVisible();
  await expect(page.getByRole("img", { name: "初始光伏历史趋势" })).toBeVisible();

  await page.locator(".signal-card").filter({ hasText: "总开有功" }).click();
  const detailChart = page.getByRole("img", { name: "总开有功完整时间曲线" });
  await expect(detailChart).toBeVisible();
  await detailChart.hover({ position: { x: 620, y: 280 } });
  await page.mouse.wheel(0, -560);
  const zoomUnlock = page.getByRole("button", { name: "滑动窗口已锁定，点击解锁并恢复完整范围" });
  await expect(zoomUnlock).toBeVisible();
  await zoomUnlock.click();
  await expect(zoomUnlock).toBeHidden();
  await page.getByRole("button", { name: "关闭曲线详情" }).click();

  await page.locator("summary[aria-label='打开历史时间窗口']").click();
  await expect(page.getByRole("region", { name: "历史数据时间窗口" })).toBeVisible();
  await page.getByRole("button", { name: "7d" }).click();
  await page.getByRole("button", { name: "拟实时回放", exact: true }).click();
  await expect(page.getByText(/已回放/)).toBeVisible();
  await expect(page.getByRole("region", { name: "时刻详细数据列表" })).toBeVisible();
  await page.locator(".ledger-row").first().click();
  await expect(page.getByText("event_time 时刻追溯")).toBeVisible();
  const detailUnlock = page.getByRole("button", { name: "详情已锁定，点击解锁并恢复自动跟随" });
  await expect(detailUnlock).toBeVisible();
  await detailUnlock.click();
  await expect(detailUnlock).toBeHidden();
});
