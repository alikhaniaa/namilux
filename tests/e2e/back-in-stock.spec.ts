import { expect, test } from "@playwright/test";
import { hydrated } from "./helpers/hydration";
import type { Page } from "@playwright/test";
import { ADMIN_URL, adminLogin } from "./helpers/admin";
import { readLastMockSms } from "@namilux/integrations";
import { OUTBOX_PATH, enterOtp, readOtp, requestOtp } from "./helpers/otp";
import { productPath, searchIndex, testPhone } from "./helpers/shop";
import type { Entry } from "./helpers/shop";

/** The index's stock flag can lag a stock change by one revalidation: pick the first candidate whose PDP really shows «اطلاع از موجودی». */
async function outOfStockProduct(page: Page): Promise<Entry> {
  const all = (await searchIndex()).filter((e) => !e.s && e.p > 0).slice(0, 6);
  for (const candidate of all) {
    await page.goto(productPath(candidate.slug));
    if ((await page.getByRole("button", { name: "اطلاع از موجودی" }).count()) > 0) return candidate;
  }
  throw new Error("no out-of-stock product renders the notify button");
}

async function subscribe(page: Page, slug: string, phone: string): Promise<void> {
  await page.goto(productPath(slug));
  await expect(page.getByRole("button", { name: "افزودن به سبد" })).toHaveCount(0);
  await (await hydrated(page.getByRole("button", { name: "اطلاع از موجودی" }))).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet).toBeVisible();
  const at = await requestOtp(page, phone, sheet);
  await enterOtp(page, await readOtp(phone, at), sheet);
  // a verified guest is subscribed right away; a returning customer submits the prefilled form
  const sent = sheet.getByText(/ثبت شد؛ به محض موجود شدن|قبلاً برای این کالا ثبت شده/);
  const submit = sheet.getByRole("button", { name: "اطلاع از موجودی" }).and(page.locator(":enabled"));
  await sent.or(submit).first().waitFor({ state: "visible", timeout: 15_000 });
  if (!(await sent.isVisible().catch(() => false))) await submit.click();
  await expect(sent).toBeVisible({ timeout: 15_000 });
}

test.describe("back in stock", () => {
  test("subscribe on an out-of-stock PDP", async ({ page }) => {
    const product = await outOfStockProduct(page);
    await subscribe(page, product.slug, testPhone());
  });

  test("admin stock adjust 0→1 enqueues the notify job and the mock outbox receives the SMS", async ({ page, context }, testInfo) => {
    test.skip(testInfo.project.name.startsWith("mobile"), "the admin half runs on the desktop project");
    const product = await outOfStockProduct(page);
    const phone = testPhone();
    await subscribe(page, product.slug, phone);

    const admin = await context.newPage();
    await adminLogin(admin);
    await admin.goto(`${ADMIN_URL}/products/${String(product.id)}?tab=price`);
    await admin.getByPlaceholder("+5 / -2").fill("1");
    await admin.getByRole("button", { name: "تغییر موجودی" }).click();
    await expect(admin.getByText("ذخیره شد").first()).toBeVisible({ timeout: 10_000 });

    // the worker (mock SMS driver) writes the notification to the same outbox within its poll interval
    await expect
      .poll(async () => (await readLastMockSms(OUTBOX_PATH, phone))?.text ?? "", { timeout: 60_000, intervals: [2_000] })
      .toContain("موجود");
    // put the unit back so the product is out of stock again for the next run
    await admin.goto(`${ADMIN_URL}/products/${String(product.id)}?tab=price`);
    await admin.getByPlaceholder("+5 / -2").fill("-1");
    await admin.getByRole("button", { name: "تغییر موجودی" }).click();
    await expect(admin.getByText("ذخیره شد").first()).toBeVisible({ timeout: 10_000 });

    // restore: put the stock back to 0
    await admin.getByPlaceholder("+5 / -2").fill("-1");
    await admin.getByRole("button", { name: "تغییر موجودی" }).click();
  });
});
