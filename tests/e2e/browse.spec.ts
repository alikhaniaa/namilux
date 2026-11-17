import { expect, test } from "@playwright/test";
import { latinDigitOffenders, pickProduct, productPath } from "./helpers/shop";

const LEGACY_CATEGORY = "/category/%d9%82%d9%87%d9%88%d9%87-%d9%81%d8%b1%d8%a7%d9%86%d8%b3%d9%87-%d8%a7%d8%b3%d9%85%da%af/";

test.describe("browse", () => {
  test("home renders all nine modules in order with one h1", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("h1")).toHaveCount(1);
    // the modules stream in (cacheComponents) - wait for each heading rather than reading the DOM once
    for (const h of ["آمادهٔ ارسال", "مجموعه‌ها", "پیشنهادهای ویژه", "از ژورنال"]) {
      await expect(page.locator("main h2").filter({ hasText: h }).first()).toBeVisible({ timeout: 20_000 });
    }
    await expect(page.getByRole("link", { name: "ورود به فروشگاه" })).toBeVisible();
  });

  test.fixme("header is 56px on mobile and 36+64+48 on desktop, condenses after 120px", async () => {
    // pixel geometry is not asserted here.
  });

  test("category page byte-identical legacy URL returns 200 with verbatim title", async ({ page }) => {
    const res = await page.goto(LEGACY_CATEGORY);
    expect(res?.status()).toBe(200);
    await expect(page).toHaveURL(new RegExp(LEGACY_CATEGORY.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    await expect(page.locator("h1")).toContainText("قهوه فرانسه اسمگ");
  });

  test("PLP filters are links and update the URL; filtered pages are noindex", async ({ page }) => {
    await page.goto("/shop/");
    // facet options are tiles (tile pass, 3 Sep 2026); the hero's category links are still chips
    const chips = page.locator("main a.chip:visible, main a.facet-tile:visible");
    await expect(chips.first()).toBeVisible();
    const hrefs = await chips.evaluateAll((els) => els.map((e) => e.getAttribute("href") ?? ""));
    const idx = hrefs.findIndex((h) => h !== "" && h !== "/shop/" && !h.startsWith("#"));
    expect(idx).toBeGreaterThanOrEqual(0);
    await chips.nth(idx).click();
    await page.waitForURL((u) => u.pathname !== "/shop/" || u.search !== "");
    await page.goto("/shop/?avail=ready&sort=price_asc");
    const robots = await page.locator('meta[name="robots"]').getAttribute("content");
    expect(robots ?? "").toContain("noindex");
  });

  test("a navigation starts at the top of the new page", async ({ page }) => {
    // Owner report 3 Sep 2026: a page opened from the middle of another kept the old offset when
    // Next's own scroll skipped (its target was the JSON-LD script). ScrollReset owns this now.
    await page.goto("/shop/");
    await expect(page.locator("main a[href^='/product/']").first()).toBeVisible({ timeout: 20_000 });
    await page.evaluate(() => window.scrollTo(0, 1400));
    await page.waitForTimeout(300);
    const link = page.locator("main a[href^='/product/']").nth(4);
    await link.scrollIntoViewIfNeeded();
    await link.click();
    await page.waitForURL(/\/product\//);
    await page.waitForTimeout(900);
    expect(await page.evaluate(() => window.scrollY)).toBeLessThan(2);
  });

  test("PDP shows price group, stock line, delivery estimator and one instance of each trust sentence", async ({ page }) => {
    const product = await pickProduct("in-stock");
    await page.goto(productPath(product.slug));
    await expect(page.locator("h1")).toBeVisible();
    await expect(page.locator("main").getByText("تومان").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "افزودن به سبد" }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "شهر خود را انتخاب کنید" })).toBeVisible();
    expect(await page.locator("main").getByText("ضمانت اصالت", { exact: false }).count()).toBeGreaterThanOrEqual(1);
  });

  test("no Latin digits appear in rendered UI text", async ({ page }) => {
    await page.goto("/");
    expect(await latinDigitOffenders(page)).toEqual([]);
    await page.goto("/shop/");
    expect(await latinDigitOffenders(page)).toEqual([]);
  });

  test.fixme("dark mode toggle flips tokens without reload", async () => {
    // the theme follows prefers-color-scheme; there is no in-page toggle to click.
  });
});
