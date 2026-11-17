import { expect, test } from "@playwright/test";
import { ADMIN_URL, adminLogin } from "./helpers/admin";
import { payOnMockGateway } from "./helpers/gateway";
import { loginWithOtp } from "./helpers/otp";
import { pickProduct, testPhone } from "./helpers/shop";

test.describe("manual order", () => {
  test.skip(({ isMobile }) => isMobile === true, "the back-office is a desktop tool");
  // the TOTP step lock serialises admin logins across workers and dev compiles are slow: 3× the budget
  test.slow();
  test("create draft → send payment link → customer pays on mock gateway → paid", async ({ page, context }) => {
    const product = await pickProduct("in-stock", 4);
    await adminLogin(page);
    // seeded stock is one unit per product and pending orders hold reservations: top the product up first
    await page.goto(`${ADMIN_URL}/products/${String(product.id)}?tab=price`);
    await page.getByPlaceholder("+5 / -2").fill("3");
    await page.getByRole("button", { name: "تغییر موجودی" }).click();
    await expect(page.getByText("ذخیره شد").first()).toBeVisible({ timeout: 20_000 });
    await page.goto(`${ADMIN_URL}/orders/new`);
    const phone = testPhone();
    await page.getByLabel("تلفن همراه").fill(phone);
    await page.getByRole("button", { name: "جستجو", exact: true }).last().click();
    await page.getByPlaceholder("افزودن کالا").fill(product.dn.slice(0, 10));
    // the exact display name: a prefix can match an on-request or sold-out sibling of the same model
    await page.locator("ul li button").filter({ hasText: product.dn }).first().click();
    await page.getByLabel("نام گیرنده").fill("علی رضایی");
    await page.getByLabel("تلفن گیرنده").fill("09121234567");
    await page.getByLabel("استان").selectOption({ label: "تهران" });
    await page.getByLabel("شهر", { exact: true }).fill("تهران");
    await page.getByLabel("نشانی", { exact: true }).fill("خیابان ولیعصر");
    await page.getByLabel("کد پستی").fill("1234567890");
    await page.getByRole("button", { name: "سفارش دستی" }).last().click();
    const link = page.locator("main").getByText(/\/pay\/NL-[A-Z0-9]{5}\//);
    await expect(link).toBeVisible({ timeout: 20_000 });
    const url = ((await link.textContent()) ?? "").match(/https?:\/\/\S+\/pay\/NL-[A-Z0-9]{5}\//)?.[0] ?? "";
    expect(url).not.toBe("");

    const shop = await context.newPage();
    // the pay link is bound to the order's customer: sign in with that phone first (OTP from the mock outbox)
    await loginWithOtp(shop, phone);
    await shop.goto(url);
    await shop.getByRole("button", { name: /پرداخت/ }).first().click();
    await payOnMockGateway(shop, "ok");
    await expect(shop).toHaveURL(/s=ok/);

    const code = url.match(/NL-[A-Z0-9]{5}/)?.[0] ?? "";
    await page.goto(`${ADMIN_URL}/orders/${code}`);
    await expect(page.getByText("پرداخت‌شده").first()).toBeVisible();
  });

  test.fixme("mark paid manually requires sudo and records a manual payment", async () => {
    // the sudo prompt inside the manual-order submit is exercised by admin-login.spec (bulk price); the manual-payment record by core orders/manual unit tests.
  });
});
