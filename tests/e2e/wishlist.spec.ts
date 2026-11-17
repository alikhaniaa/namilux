import { expect, test } from "@playwright/test";
import { hydrated } from "./helpers/hydration";
import { loginWithOtp } from "./helpers/otp";
import { pickProduct, productPath, testPhone } from "./helpers/shop";

test.describe("wishlist", () => {
  test("heart toggles and count updates", async ({ page }) => {
    const product = await pickProduct("in-stock");
    await page.goto(productPath(product.slug));
    const heart = page.getByRole("button", { name: /علاقه‌مندی/ }).first();
    await (await hydrated(heart)).click();
    await expect(heart).toHaveAttribute("aria-pressed", "true");
    await page.goto("/wishlist/");
    // the island adopts the stored ids into ?ids=… and the saved card (not just the rail) is on the page
    await expect(page.locator(`main a[href*="${productPath(product.slug)}"]:not([aria-hidden="true"])`).first()).toBeVisible({ timeout: 20_000 });
    await expect(page).toHaveURL(/\/wishlist\/\?ids=/);
    await page.goto(productPath(product.slug));
    await (await hydrated(page.getByRole("button", { name: /علاقه‌مندی/ }))).click();
    await page.goto("/wishlist/");
    // the empty state keeps a «شاید بپسندید» rail, so count nothing - assert the empty heading instead
    await expect(page.getByRole("heading", { name: "فهرست علاقه‌مندی‌ها خالی است" })).toBeVisible();
  });

  test("guest wishlist survives reload and merges on login", async ({ page }) => {
    const product = await pickProduct("in-stock");
    await page.goto(productPath(product.slug));
    await (await hydrated(page.getByRole("button", { name: /علاقه‌مندی/ }))).click();
    await page.reload();
    await expect(page.getByRole("button", { name: /علاقه‌مندی/ }).first()).toHaveAttribute("aria-pressed", "true");
    await loginWithOtp(page, testPhone());
    await page.goto("/account/wishlist/");
    await expect(page.locator('main a[href*="/product/"]:not([aria-hidden="true"])').first()).toBeVisible({ timeout: 15_000 });
  });
});
