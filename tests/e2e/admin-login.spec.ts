import { expect, test } from "@playwright/test";
import { ADMIN_URL, adminLogin, sudo } from "./helpers/admin";

test.describe("admin login", () => {
  test.skip(({ isMobile }) => isMobile === true, "the back-office is a desktop tool");
  // the TOTP step lock serialises admin logins across workers and dev compiles are slow: 3× the budget
  test.slow();
  test("password + TOTP login", async ({ page }) => {
    await adminLogin(page);
    // «سفارش‌ها» sits in a menu group that is open on arrival; «محصولات» is folded away until its group is opened
    await expect(page.getByRole("link", { name: "سفارش‌ها" }).first()).toBeVisible();
  });

  test.fixme("5 wrong passwords lock for 15 minutes", async () => {
    // locks the only seeded owner for the rest of the run; covered by core auth/staff unit tests (lockout counter).
  });

  test("sudo dialog appears for a bulk price apply", async ({ page }) => {
    await adminLogin(page);
    // the old address of the formula editor still opens it, inside the pricing section
    await page.goto(`${ADMIN_URL}/products/bulk-price`);
    await expect(page).toHaveURL(/\/products\/prices\/group$/);
    await page.getByLabel("برند").selectOption({ index: 1 });
    await page.getByLabel("چند درصد؟").fill("1");
    await expect(page.locator("tbody [data-product-id]").first()).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: /^اعمال روی/ }).click();
    await page.getByRole("button", { name: "بله، اعمال شود" }).click();
    await expect(page.getByRole("dialog", { name: "تأیید دوباره" })).toBeVisible({ timeout: 10_000 });
    await sudo(page);
    // the change is real: take it back, so the run leaves the catalogue as it found it
    await page.getByRole("button", { name: "برگرداندن این تغییر" }).click();
    await expect(page.getByRole("button", { name: "برگرداندن این تغییر" })).toHaveCount(0, { timeout: 30_000 });
  });
});
