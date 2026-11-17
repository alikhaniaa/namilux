import { expect, test } from "@playwright/test";
import { latinDigitOffenders, pickProduct, productPath } from "./helpers/shop";

test.describe("persian correctness", () => {
  test("rendered text nodes contain no [0-9]", async ({ page }) => {
    const product = await pickProduct("in-stock");
    for (const path of ["/", "/shop/", productPath(product.slug), "/cart/", "/blog/"]) {
      await page.goto(path);
      expect(await latinDigitOffenders(page), path).toEqual([]);
    }
  });

  test("known names carry ZWNJ", async ({ page }) => {
    await page.goto("/");
    const brand = await page.getByRole("link", { name: "نامی‌لوکس" }).first().textContent();
    expect(brand ?? "").toContain("‌");
    const body = await page.locator("body").innerText();
    expect(body).toContain("علاقه‌مندی");
  });

  test("model codes are wrapped in bdi", async ({ page }) => {
    const product = await pickProduct("in-stock");
    await page.goto(productPath(product.slug));
    const h1 = page.locator("h1");
    const text = (await h1.textContent()) ?? "";
    if (/[A-Za-z][A-Za-z0-9-]*\d/.test(text)) {
      expect(await h1.locator("bdi, [dir='ltr']").count()).toBeGreaterThan(0);
    }
  });
});
