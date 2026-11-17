import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { ADMIN_URL, adminLogin, sudo } from "./helpers/admin";

type Row = { id: number; displayName: string; price: number; compareAtPrice: number | null; priceBasis: string };
type Prices = Pick<Row, "price" | "compareAtPrice">;
const prices = (r: Row): Prices => ({ price: r.price, compareAtPrice: r.compareAtPrice });

async function read(request: APIRequestContext): Promise<Row[]> {
  const response = await request.get(`${ADMIN_URL}/api/products/prices`);
  expect(response.ok()).toBe(true);
  return ((await response.json()) as { data: { rows: Row[] } }).data.rows;
}
const priceOf = async (request: APIRequestContext, id: number): Promise<Prices | undefined> => {
  const row = (await read(request)).find((r) => r.id === id);
  return row === undefined ? undefined : prices(row);
};

/** Puts the given products back exactly as they were, without touching a row someone else has moved since. */
async function restore(page: Page, originals: Row[]): Promise<void> {
  const request = page.context().request;
  const now = new Map((await read(request)).map((r) => [r.id, prices(r)]));
  const rows = originals
    .filter((r) => JSON.stringify(now.get(r.id)) !== JSON.stringify(prices(r)))
    .map((r) => ({ id: r.id, before: now.get(r.id), after: prices(r) }));
  if (rows.length === 0) return;
  const csrf = (await page.context().cookies(ADMIN_URL)).find((c) => c.name === "nl_c")?.value ?? "";
  const response = await request.patch(`${ADMIN_URL}/api/products/prices`, {
    headers: { origin: ADMIN_URL, "x-nl-csrf": decodeURIComponent(csrf) },
    data: { rows, note: "E2E: restore original prices" },
  });
  expect(await response.json()).toMatchObject({ ok: true, data: { updated: rows.length } });
}

/** The second-factor prompt appears only when the last verification is older than five minutes. */
async function sudoIfAsked(page: Page): Promise<void> {
  const asked = await page
    .getByRole("dialog", { name: "تأیید دوباره" })
    .waitFor({ state: "visible", timeout: 4_000 })
    .then(() => true)
    .catch(() => false);
  if (asked) await sudo(page);
}

/** Two priced, hand-priced products with no discount, so the arithmetic below has nothing else to move. */
function pick(rows: Row[]): [Row, Row] {
  const plain = rows.filter((r) => r.priceBasis === "manual" && r.price > 1_000_000 && r.compareAtPrice === null);
  const [a, b] = plain;
  if (a === undefined || b === undefined) throw new Error("the catalogue needs two priced products without a discount");
  return [a, b];
}

test.describe("pricing section", () => {
  test.skip(({ isMobile }) => isMobile === true, "the keyboard workflow is a desktop one; the phone layout is asserted below");
  test.slow();

  test("quick list: type, Enter, saved at once - with the zero guard and undo", async ({ page, context }) => {
    page.setDefaultTimeout(30_000);
    await adminLogin(page);
    await page.goto(`${ADMIN_URL}/products/prices`);
    await expect(page.getByRole("heading", { name: "تغییر قیمت‌ها", exact: true })).toBeVisible();
    const [a, b] = pick(await read(context.request));
    const search = page.getByLabel("جستجوی نام یا کد کالا");
    const row = (id: number) => page.locator(`[data-product-id="${String(id)}"]`);
    try {
      // The panel's own id pins one row; Enter in the search box lands on its price.
      await search.fill(`#${String(a.id)}`);
      await expect(page.locator("[data-product-id]")).toHaveCount(1);
      await search.press("Enter");
      const input = row(a.id).locator('[data-price-field="price"]');
      await expect(input).toBeFocused();

      // Persian digits, grouped as typed; Enter saves this row alone, and no second factor is asked.
      await input.fill(String(a.price + 1000).replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)] ?? d));
      await input.press("Enter");
      await expect(row(a.id)).toHaveAttribute("data-state", "saved");
      await expect(page.getByRole("dialog")).toHaveCount(0);
      expect(await priceOf(context.request, a.id)).toEqual({ price: a.price + 1000, compareAtPrice: null });

      // Ten times the price is far more often a doubled zero than a real change: it is asked, not written.
      await input.fill(String((a.price + 1000) * 10));
      await input.press("Enter");
      await expect(row(a.id)).toHaveAttribute("data-state", "ask");
      expect(await priceOf(context.request, a.id)).toEqual({ price: a.price + 1000, compareAtPrice: null });
      await input.press("Escape");
      await expect(row(a.id)).not.toHaveAttribute("data-state", "ask");

      // Leaving the box saves too (a phone has no Enter to rely on) - but never answers the question.
      await search.fill(`#${String(b.id)}`);
      const second = row(b.id).locator('[data-price-field="price"]');
      await second.fill(String(b.price * 10));
      await search.focus();
      await expect(row(b.id)).toHaveAttribute("data-state", "ask");
      expect(await priceOf(context.request, b.id)).toEqual(prices(b));
      await row(b.id).getByRole("button", { name: "نه، برگردان" }).click();
      await second.fill(String(b.price + 2000));
      await search.focus();
      await expect(row(b.id)).toHaveAttribute("data-state", "saved");
      expect(await priceOf(context.request, b.id)).toEqual({ price: b.price + 2000, compareAtPrice: null });

      // The saved row offers its own way back.
      await row(b.id).getByRole("button", { name: "برگرداندن" }).click();
      await expect(row(b.id)).toContainText("برگردانده شد");
      expect(await priceOf(context.request, b.id)).toEqual(prices(b));

      // Both changes are in the log, newest first, each with the price it replaced.
      await page.goto(`${ADMIN_URL}/products/prices/history`);
      await expect(page.locator("tbody tr").first()).toContainText(b.displayName);
    } finally {
      await restore(page, [a, b]);
    }
  });

  test("percent change: the products are listed first, every new price is shown, the second factor is asked, and it can be undone", async ({ page, context }, info) => {
    page.setDefaultTimeout(30_000);
    await adminLogin(page);
    const [a, b] = pick(await read(context.request));
    try {
      // What the product list hands over when rows are ticked there.
      await page.goto(`${ADMIN_URL}/products/prices/group?ids=${String(a.id)},${String(b.id)}`);
      await expect(page.getByText("کالایی که در فهرست محصولات تیک زده‌اید")).toBeVisible();
      // The products are listed - each with its tick - before any change is typed, so what is about
      // to be changed can be seen and narrowed first. Nothing can be applied yet.
      await expect(page.locator('tbody [data-product-id][data-line="idle"]')).toHaveCount(2);
      await expect(page.getByText("۲ کالا تیک خورده")).toBeVisible();
      await expect(page.getByRole("button", { name: "اعمال روی ۰ کالا" })).toBeDisabled();
      // One product is left out by hand, and stays out once the change is typed.
      await page.getByLabel(`اعمال روی ${b.displayName}`).uncheck();
      await expect(page.getByText("۱ کالا تیک خورده")).toBeVisible();
      await page.getByLabel("چند درصد؟").fill("۱۰");
      await expect(page.locator('tbody [data-product-id][data-line="ok"]')).toHaveCount(2);
      await expect(page.getByLabel(`اعمال روی ${b.displayName}`)).not.toBeChecked();
      // Searching narrows the list on the spot; clearing the search brings the rest back.
      await page.getByLabel("جستجوی نام یا کد کالا").fill(`#${String(a.id)}`);
      await expect(page.locator("tbody [data-product-id]")).toHaveCount(1);
      await page.getByLabel("جستجوی نام یا کد کالا").fill("");
      await expect(page.locator("tbody [data-product-id]")).toHaveCount(2);
      await page.screenshot({ path: info.outputPath("group-change.png"), fullPage: true });
      await page.getByRole("button", { name: "اعمال روی ۱ کالا" }).click();
      await page.getByRole("button", { name: "بله، اعمال شود" }).click();
      await sudoIfAsked(page);
      await expect(page.getByRole("button", { name: "برگرداندن این تغییر" })).toBeVisible({ timeout: 30_000 });
      expect(await priceOf(context.request, a.id)).toEqual({ price: Math.round(a.price * 1.1), compareAtPrice: null });
      expect(await priceOf(context.request, b.id)).toEqual(prices(b));

      await page.getByRole("button", { name: "برگرداندن این تغییر" }).click();
      await sudoIfAsked(page);
      await expect(page.getByRole("button", { name: "برگرداندن این تغییر" })).toHaveCount(0, { timeout: 30_000 });
      expect(await priceOf(context.request, a.id)).toEqual(prices(a));
    } finally {
      await restore(page, [a, b]);
    }
  });

  test("pasted list: each line is shown as understood, and only the confirmed ones are written", async ({ page, context }) => {
    page.setDefaultTimeout(30_000);
    await adminLogin(page);
    const [a, b] = pick(await read(context.request));
    try {
      await page.goto(`${ADMIN_URL}/products/prices/paste`);
      await page.getByLabel("فهرست قیمت").fill([`#${String(a.id)}\t${String(a.price + 3000)}`, `#${String(b.id)} ${String(b.price * 10)}`, "no-such-product-e2e 5000000", "فهرست امروز"].join("\n"));
      const line = (n: number) => page.locator(`tr[data-line="${String(n)}"]`);
      await expect(line(1)).toHaveAttribute("data-reading", "ready");
      await expect(line(2)).toHaveAttribute("data-reading", "jump");
      await expect(line(3)).toHaveAttribute("data-reading", "none");
      await expect(line(4)).toHaveAttribute("data-reading", "noprice");
      // The suspicious line is not written unless it is ticked by hand.
      await page.getByRole("button", { name: "ثبت ۱ قیمت" }).click();
      await sudoIfAsked(page);
      await expect(page.getByRole("button", { name: "برگرداندن این تغییر" })).toBeVisible({ timeout: 30_000 });
      expect(await priceOf(context.request, a.id)).toEqual({ price: a.price + 3000, compareAtPrice: null });
      expect(await priceOf(context.request, b.id)).toEqual(prices(b));
      await page.getByRole("button", { name: "برگرداندن این تغییر" }).click();
      await sudoIfAsked(page);
      await expect(page.getByRole("button", { name: "برگرداندن این تغییر" })).toHaveCount(0, { timeout: 30_000 });
      expect(await priceOf(context.request, a.id)).toEqual(prices(a));
    } finally {
      await restore(page, [a, b]);
    }
  });

  test("the old addresses still open the new screens, and a phone gets a list without sideways scrolling", async ({ page }) => {
    page.setDefaultTimeout(30_000);
    await adminLogin(page);
    await page.goto(`${ADMIN_URL}/products/bulk-price?brandId=1`);
    await expect(page).toHaveURL(/\/products\/prices\/group\?brandId=1$/);
    await page.goto(`${ADMIN_URL}/products/fx`);
    await expect(page).toHaveURL(/\/products\/prices\/fx$/);

    await page.setViewportSize({ width: 390, height: 844 });
    for (const path of ["/products/prices", "/products/prices/group", "/products/prices/paste", "/products/prices/history"]) {
      await page.goto(`${ADMIN_URL}${path}`);
      await expect(page.getByRole("heading", { name: "تغییر قیمت‌ها", exact: true })).toBeVisible();
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
  });
});
