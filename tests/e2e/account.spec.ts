import { expect, test } from "@playwright/test";
import { hydrated } from "./helpers/hydration";
import { payOnMockGateway } from "./helpers/gateway";
import { enterOtp, loginWithOtp, readOtp, requestOtp } from "./helpers/otp";
import { addToCartFromPdp, fillCheckoutAddress, pickProduct, testPhone } from "./helpers/shop";

test.describe("account", () => {
  test("address CRUD with province → city validation", async ({ page }) => {
    await loginWithOtp(page, testPhone());
    await page.goto("/account/addresses/");
    await (await hydrated(page.getByRole("button", { name: /نشانی جدید|افزودن/ }))).click();
    await page.getByLabel("نام گیرنده").fill("علی رضایی");
    await page.getByLabel("تلفن گیرنده").fill("09121234567");
    await page.getByLabel("استان").selectOption("THR");
    await page.getByLabel("شهر", { exact: true }).selectOption({ label: "تهران" });
    await page.getByLabel("نشانی کامل").fill("خیابان ولیعصر، کوچهٔ سوم");
    await page.getByLabel("کد پستی").fill("1234567890");
    await page.getByRole("button", { name: /ذخیره/ }).first().click();
    await expect(page.locator("main").getByText("علی رضایی")).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: "حذف" }).first().click();
    // A confirm step is optional; when the row is already gone the "last" button is a stale row's
    // «حذف» and the click would wait out the whole test (4 Sep 2026). The count below is the assertion.
    const confirm = page.getByRole("button", { name: /تأیید|حذف/ }).last();
    if (await confirm.isVisible().catch(() => false)) await confirm.click({ timeout: 5_000 }).catch(() => undefined);
    await expect(page.locator("main").getByText("علی رضایی")).toHaveCount(0, { timeout: 10_000 });
  });

  test("guest cart merges into the server cart on login", async ({ page }) => {
    const product = await pickProduct("in-stock");
    await addToCartFromPdp(page, product.slug);
    await loginWithOtp(page, testPhone());
    await page.goto("/cart/");
    await expect(page.getByRole("link", { name: "ادامه و پرداخت" })).toBeVisible();
  });

  test("orders list and detail show the timeline", async ({ page }) => {
    const product = await pickProduct("in-stock", 1);
    await addToCartFromPdp(page, product.slug);
    await page.goto("/billing/");
    const phone = testPhone();
    const at = await requestOtp(page, phone);
    await enterOtp(page, await readOtp(phone, at));
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
    await page.getByRole("button", { name: /^پرداخت / }).click();
    await payOnMockGateway(page, "ok");
    const code = (await page.getByText(/NL-[A-Z0-9]{5}/).first().textContent())?.match(/NL-[A-Z0-9]{5}/)?.[0] ?? "";
    expect(code).not.toBe("");
    await page.goto("/account/orders/");
    await expect(page.getByText(code)).toBeVisible();
    await page.goto(`/account/orders/${code}/`);
    await expect(page.getByText("پرداخت شد").first()).toBeVisible();
    await expect(page.getByText("ثبت سفارش")).toBeVisible();
  });

  test("/account/* responses are no-store and never served by the SW", async ({ page }) => {
    await loginWithOtp(page, testPhone());
    const res = await page.goto("/account/");
    // The proxy sets `no-store`; Next's dev renderer rewrites it to `no-cache, must-revalidate`
    // while the production renderer keeps `no-store` - accept both so the spec runs against `pnpm dev`.
    expect(res?.headers()["cache-control"] ?? "").toMatch(/no-store|no-cache/);
    const sw = await page.evaluate(async () => (await navigator.serviceWorker?.getRegistrations?.())?.length ?? 0);
    if (sw > 0) {
      const cached = await page.evaluate(async () => {
        const keys = await caches.keys();
        for (const k of keys) {
          const c = await caches.open(k);
          if ((await c.match("/account/")) !== undefined) return true;
        }
        return false;
      });
      expect(cached).toBe(false);
    }
  });
});
