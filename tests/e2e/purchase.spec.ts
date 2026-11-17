import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { payOnMockGateway } from "./helpers/gateway";
import { enterOtp, readOtp, requestOtp } from "./helpers/otp";
import { addToCartFromPdp, fillCheckoutAddress, pickProduct, testPhone } from "./helpers/shop";

async function checkoutToGateway(page: Page, nth = 0): Promise<void> {
  const product = await pickProduct("in-stock", nth);
  await addToCartFromPdp(page, product.slug);
  await page.goto("/cart/");
  // Scoped to the cart rows: the cross-sell rail under them may show the same brand.
  await expect(page.getByTestId("cart-line").filter({ hasText: product.dn.split(" ")[0] ?? product.dn }).first()).toBeVisible({ timeout: 20_000 });
  await page.getByRole("link", { name: "ادامه و پرداخت" }).click();
  await page.waitForURL(/\/billing\//);
  const phone = testPhone();
  const at = await requestOtp(page, phone);
  await enterOtp(page, await readOtp(phone, at));
  // first-time customer: name step
  const first = page.getByLabel("نام", { exact: true });
  const address = page.getByRole("heading", { name: "نشانی تحویل" });
  await first.or(address).first().waitFor({ state: "visible", timeout: 20_000 });
  if (await first.isVisible().catch(() => false)) {
    await first.fill("علی");
    await page.getByLabel("نام خانوادگی").fill("رضایی");
    await page.getByRole("button", { name: "ذخیره" }).click();
  }
  await expect(page.getByRole("heading", { name: "نشانی تحویل" })).toBeVisible({ timeout: 15_000 });
  await fillCheckoutAddress(page);
  const pay = page.getByRole("button", { name: /^پرداخت / });
  await expect(pay).toBeEnabled({ timeout: 15_000 });
  await pay.click();
}

test.describe("purchase", () => {
  test("add to cart → checkout → OTP → address → pay on mock gateway → result ok with order code", async ({ page }) => {
    await checkoutToGateway(page);
    await payOnMockGateway(page, "ok");
    await expect(page.getByRole("heading", { name: "سفارش شما ثبت شد" })).toBeVisible();
    await expect(page.getByText(/NL-[A-Z0-9]{5}/)).toBeVisible();
    // the paid lines leave the local cart
    await page.goto("/cart/");
    await expect(page.getByRole("link", { name: "ادامه و پرداخت" })).toHaveCount(0);
  });

  test("mock gateway fail → result fail with retry → retry succeeds", async ({ page }) => {
    // a different product than the happy path: a paid order consumes that product's stock
    await checkoutToGateway(page, 3);
    await payOnMockGateway(page, "fail");
    await expect(page).toHaveURL(/s=fail/);
    const retry = page.getByRole("link", { name: /پرداخت دوباره|تلاش دوباره/ }).or(page.getByRole("button", { name: /پرداخت دوباره|تلاش دوباره/ }));
    await expect(retry.first()).toBeVisible();
    await retry.first().click();
    // the retry lands on the order's own pay page - pay from there
    await page.waitForURL(/\/pay\/NL-[A-Z0-9]{5}\//, { timeout: 30_000 });
    await page.getByRole("button", { name: /پرداخت/ }).first().click();
    await payOnMockGateway(page, "ok");
    await expect(page).toHaveURL(/s=ok/);
  });

  test.fixme("price tampering via devtools is rejected with PRICE_CHANGED", async () => {
    // needs a request-interception harness that rewrites the signed quote; covered by core checkout unit tests (quoteSig HMAC).
  });

  test.fixme("expired pending order can be paid again within grace", async () => {
    // needs the worker's order.expire clock to be advanced; covered by core orders/expire unit tests.
  });
});
