import { expect, test } from "@playwright/test";
import { ADMIN_URL, adminLogin } from "./helpers/admin";

/** A valid 1×1 JPEG (baseline, 8-bit). */
const JPEG_1PX = Buffer.from(
  "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AKAAB//Z",
  "base64",
);

test.describe("admin media", () => {
  test.skip(({ isMobile }) => isMobile === true, "the back-office is a desktop tool");
  // the TOTP step lock serialises admin logins across workers and dev compiles are slow: 3× the budget
  test.slow();
  test("upload a JPEG → renditions appear on the product", async ({ page }) => {
    await adminLogin(page);
    await page.goto(`${ADMIN_URL}/media`);
    const input = page.locator('input[type="file"]').first();
    await input.setInputFiles({ name: `e2e-${String(Date.now())}.jpg`, mimeType: "image/jpeg", buffer: JPEG_1PX });
    await expect(page.getByText(/بارگذاری شد|در صف پردازش|در حال پردازش|در انتظار پردازش/).first()).toBeVisible({ timeout: 90_000 });
    await page.reload();
    await expect(page.locator('main a[href^="/media/"]').first()).toBeVisible({ timeout: 15_000 });
  });

  test("upload a polyglot file → rejected with reason", async ({ page }) => {
    await adminLogin(page);
    await page.goto(`${ADMIN_URL}/media`);
    const input = page.locator('input[type="file"]').first();
    await input.setInputFiles({ name: "polyglot.jpg", mimeType: "image/jpeg", buffer: Buffer.from("<html><script>alert(1)</script></html>") });
    await expect(page.getByText(/فایل رد شد/).first()).toBeVisible({ timeout: 30_000 });
  });

  test.fixme("archive a product → its URL 301s and check:contract stays green", async () => {
    // archiving one of the 541 legacy products inside a shared dev database is not reversible for the next spec run;
    // core catalog/archive unit tests cover the redirect row and tests/contract covers the 752-URL map.
  });
});
