import { test, expect } from "@playwright/test";

test("loads topbar and speeds", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("World Balance")).toBeVisible();
  await expect(page.getByText("2026-01-01")).toBeVisible();
});
