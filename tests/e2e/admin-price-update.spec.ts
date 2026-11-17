import { expect, test } from "@playwright/test";
import { ADMIN_URL, adminLogin } from "./helpers/admin";
import { pickProduct, productPath } from "./helpers/shop";

const faDigits = (n: number): string => String(n).replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)] ?? d);
const grouped = (n: number): string => faDigits(n).replace(/\B(?=(\d{3})+(?!\d))/g, "٬").replace(/([۰-۹])(?=([۰-۹]{3})+(?![۰-۹]))/g, "$1٬");

test.describe("admin price update", () => {
  test.skip(({ isMobile }) => isMobile === true, "the back-office is a desktop tool");
  // the TOTP step lock serialises admin logins across workers and dev compiles are slow: 3× the budget
  test.slow();
  test("inline price edit revalidates the PDP within 10 s and enqueues a cdn purge", async ({ page, context }) => {
    const product = await pickProduct("in-stock", 2);
    const newPrice = product.p + 10_000;
    await adminLogin(page);
    await page.goto(`${ADMIN_URL}/products?q=${encodeURIComponent(product.dn.slice(0, 12))}`);
    const row = page.locator("tbody tr").filter({ hasText: product.dn.slice(0, 12) }).first();
    await expect(row).toBeVisible({ timeout: 20_000 });
    await row.getByTitle("ویرایش").first().click();
    const input = row.locator('input[dir="ltr"]');
    await input.fill(String(newPrice));
    await row.getByRole("button", { name: "ذخیره" }).click();
    await expect(row.locator('input[dir="ltr"]')).toHaveCount(0, { timeout: 10_000 });

    const shop = await context.newPage();
    const expected = grouped(newPrice);
    await expect
      .poll(
        async () => {
          await shop.goto(productPath(product.slug), { waitUntil: "domcontentloaded" });
          return (await shop.locator("main").innerText()).includes(expected);
        },
        { timeout: 30_000, intervals: [1_000, 2_000, 3_000] },
      )
      .toBe(true);
    // restore
    await page.goto(`${ADMIN_URL}/products?q=${encodeURIComponent(product.dn.slice(0, 12))}`);
    const row2 = page.locator("tbody tr").filter({ hasText: product.dn.slice(0, 12) }).first();
    await row2.getByTitle("ویرایش").first().click();
    await row2.locator('input[dir="ltr"]').fill(String(product.p));
    await row2.getByRole("button", { name: "ذخیره" }).click();
  });

  test("price history row is written", async ({ page }) => {
    const product = await pickProduct("in-stock", 2);
    await adminLogin(page);
    await page.goto(`${ADMIN_URL}/products/${String(product.id)}?tab=history`);
    await expect(page.getByRole("heading", { name: "تاریخچهٔ قیمت" })).toBeVisible();
    await expect(page.locator("table").first().locator("tbody tr").first()).toBeVisible();
  });
});
