import { expect, test } from "@playwright/test";
import { hydrated } from "./helpers/hydration";
import type { Page } from "@playwright/test";

async function openSearch(page: Page) {
  await page.goto("/");
  await (await hydrated(page.getByRole("button", { name: "باز کردن جستجو" }))).click();
  const box = page.getByRole("searchbox").or(page.getByRole("combobox")).or(page.locator('input[type="search"]')).first();
  await expect(box).toBeVisible();
  return box;
}

test.describe("search", () => {
  test("overlay idle state shows frequent, brands, collections", async ({ page }) => {
    await openSearch(page);
    const overlay = page.getByRole("dialog");
    await expect(overlay.getByText("برندها").first()).toBeVisible();
    await expect(overlay.getByText(/دسته‌های پرطرفدار|مجموعه‌ها|پرجستجو/).first()).toBeVisible();
  });

  test("typing کتری shows grouped results with prices and units", async ({ page }) => {
    const box = await openSearch(page);
    await box.fill("کتری");
    await expect(page.getByText("محصولات").first()).toBeVisible({ timeout: 10_000 });
    const links = page.locator('a[href*="/product/"]');
    await expect(links.first()).toBeVisible();
    await expect(page.getByText("تومان").first()).toBeVisible();
  });

  test("Arabic yeh input matches Persian names", async ({ page }) => {
    const box = await openSearch(page);
    await box.fill("كتري"); // Arabic kaf + Arabic yeh
    await expect(page.locator('a[href*="/product/"]').first()).toBeVisible({ timeout: 10_000 });
  });

  test("keyboard navigation ↑↓ Enter Esc", async ({ page }) => {
    const box = await openSearch(page);
    await box.fill("کتری");
    await expect(page.locator('a[href*="/product/"]').first()).toBeVisible({ timeout: 10_000 });
    await box.press("ArrowDown");
    await box.press("Enter");
    await page.waitForURL(/\/(product|brand|collection|search)\//, { timeout: 15_000 });
    await page.goto("/");
    await (await hydrated(page.getByRole("button", { name: "باز کردن جستجو" }))).click();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "باز کردن جستجو" })).toBeVisible();
  });
});
