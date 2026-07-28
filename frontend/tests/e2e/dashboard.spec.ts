import { expect, test } from "@playwright/test";

test("核心大屏、时间范围和追溯抽屉可用", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /台区总有功功率与光伏功率分离/ })).toBeVisible();
  await expect(page.getByLabel("台区总功率与光伏功率分离核心曲线")).toBeVisible();
  await page.getByRole("button", { name: "7d" }).click();
  await expect(page.getByRole("button", { name: "7d" })).toHaveClass(/active/);
  await page.getByRole("button", { name: "24h" }).click();
  await expect(page.getByRole("button", { name: "24h" })).toHaveClass(/active/);
  await page.getByRole("button", { name: /记录与追溯/ }).click();
  await expect(page.getByRole("complementary")).toBeVisible();
  await expect(page.getByRole("button", { name: "分钟级结果" })).toBeVisible();
});
