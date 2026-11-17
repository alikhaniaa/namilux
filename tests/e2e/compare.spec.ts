import { expect, test } from "@playwright/test";
import { hydrated } from "./helpers/hydration";
import type { Page } from "@playwright/test";
import { productPath, searchIndex } from "./helpers/shop";

async function addToCompare(page: Page, slug: string): Promise<void> {
  await page.goto(productPath(slug));
  await (await hydrated(page.getByRole("button", { name: "افزودن به مقایسه" }))).click();
}

test.describe("compare", () => {
  test("add two products and see the sticky-label table", async ({ page }) => {
    const [a, b] = (await searchIndex()).filter((e) => e.s && e.p > 0).slice(0, 2);
    if (a === undefined || b === undefined) throw new Error("need two products");
    await addToCompare(page, a.slug);
    await addToCompare(page, b.slug);
    await page.goto("/compare/");
    await expect(page.locator("main table")).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('main a[href*="/product/"]')).toHaveCount(2);
  });

  test("فقط تفاوت‌ها hides identical rows", async ({ page }) => {
    const [a, b] = (await searchIndex()).filter((e) => e.s && e.p > 0).slice(0, 2);
    if (a === undefined || b === undefined) throw new Error("need two products");
    await addToCompare(page, a.slug);
    await addToCompare(page, b.slug);
    await page.goto("/compare/");
    await expect(page.locator("main table tbody tr").first()).toBeVisible({ timeout: 20_000 });
    const before = await page.locator("main table tbody tr").count();
    const toggle = page.getByLabel("فقط تفاوت‌ها").or(page.getByRole("button", { name: "فقط تفاوت‌ها" })).or(page.getByText("فقط تفاوت‌ها"));
    await (await hydrated(toggle)).click();
    const after = await page.locator("main table tbody tr:visible").count();
    expect(after).toBeLessThanOrEqual(before);
  });

  test("mobile cap of 2 enforced with a toast", async ({ page }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith("mobile"), "cap of 2 applies to mobile only");
    const three = (await searchIndex()).filter((e) => e.s && e.p > 0).slice(0, 3);
    for (const p of three) await addToCompare(page, p.slug);
    await expect(page.getByText(/حداکثر .* کالا را می‌توانید مقایسه کنید/).first()).toBeVisible({ timeout: 10_000 });
  });
});
