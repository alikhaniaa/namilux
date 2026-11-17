import { expect, test } from "@playwright/test";
import { hydrated } from "./helpers/hydration";
import { ADMIN_URL, adminLogin } from "./helpers/admin";
import { enterOtp, readOtp, requestOtp } from "./helpers/otp";
import { pickProduct, productPath, testPhone } from "./helpers/shop";

test.describe("concierge", () => {
  test("on-request PDP shows the concierge CTA instead of a price", async ({ page }) => {
    const product = await pickProduct("on-request");
    await page.goto(productPath(product.slug));
    await expect(page.getByText("قیمت این کالا را استعلام بگیرید")).toBeVisible();
    await expect(page.getByRole("button", { name: /مشاورهٔ خرید/ }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "افزودن به سبد" })).toHaveCount(0);
  });

  test("request form with OTP lands in the admin inbox", async ({ page, context }) => {
    const product = await pickProduct("on-request");
    const phone = testPhone();
    await page.goto(productPath(product.slug));
    await (await hydrated(page.getByRole("button", { name: /مشاورهٔ خرید/ }))).click();
    const sheet = page.getByRole("dialog");
    await expect(sheet).toBeVisible();
    const at = await requestOtp(page, phone, sheet);
    await enterOtp(page, await readOtp(phone, at), sheet);
    const send = sheet.getByRole("button", { name: /استعلام قیمت|ارسال|ثبت/ }).first();
    await send.waitFor({ state: "visible", timeout: 10_000 });
    await send.click();
    await expect(page.getByText(/ثبت شد|دریافت شد|تماس می‌گیریم|با شما تماس/).first()).toBeVisible({ timeout: 15_000 });

    const admin = await context.newPage();
    await adminLogin(admin);
    await admin.goto(`${ADMIN_URL}/inbox?tab=concierge`);
    await expect(admin.locator("main").getByText(product.dn.slice(0, 12)).first()).toBeVisible({ timeout: 15_000 });
  });
});
