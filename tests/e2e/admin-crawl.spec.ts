/**
 * Ad-hoc admin walkthrough (3 Sep 2026): every admin route as the owner - HTTP status, console
 * errors, 5xx responses, visible error text, a screenshot per route. Diagnostic, not a gate:
 * run with CRAWL=1 (it is skipped otherwise) and read `<CRAWL_OUT>/report.txt`.
 * CRAWL_FROM=<index> starts part-way through ROUTES (a long crawl in two halves).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { ADMIN_URL, adminLogin } from "./helpers/admin";

const ROUTES = [
  "/", "/account", "/analytics", "/attributes", "/brands", "/categories", "/collections", "/content/faq", "/content/menus",
  "/content/pages", "/content/posts", "/customers", "/inbox", "/marketing/banners", "/marketing/coupons", "/marketing/ig",
  "/marketing/loyalty", "/marketing/promo", "/marketing/sms", "/media", "/orders", "/orders/new", "/products",
  "/products/import", "/products/new", "/products/prices", "/products/prices/fx", "/products/prices/group", "/products/prices/history",
  "/products/prices/paste", "/returns", "/reviews", "/seo", "/seo/404",
  "/seo/redirects", "/settings", "/settings/roles", "/settings/shipping", "/settings/sms-templates", "/settings/staff",
  "/system/cache", "/system/health", "/system/jobs", "/system/security", "/system/sms-log",
];
const LISTS = ["/products", "/orders", "/customers", "/brands", "/collections", "/content/posts", "/content/pages", "/marketing/coupons", "/marketing/banners", "/media", "/settings/staff"];

test.skip(process.env["CRAWL"] !== "1", "diagnostic crawl; set CRAWL=1");

test("admin crawl", async ({ page }) => {
  test.setTimeout(40 * 60_000);
  const out = process.env["CRAWL_OUT"] ?? "test-results/admin-crawl";
  mkdirSync(out, { recursive: true });
  const errors: string[] = [];
  const rows: string[] = [];
  const where = (): string => page.url().replace(ADMIN_URL, "");
  const flush = (): void => {
    writeFileSync(`${out}/report.txt`, `${rows.join("\n")}\n\n--- console / 5xx ---\n${errors.join("\n")}\n`);
  };
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`[${where()}] ${m.text().slice(0, 300)}`);
  });
  page.on("pageerror", (e) => errors.push(`[${where()}] pageerror ${String(e).slice(0, 300)}`));
  page.on("response", (r) => {
    if (r.status() >= 500) errors.push(`[${where()}] ${r.status()} ${r.url().replace(ADMIN_URL, "")}`);
  });

  await adminLogin(page);

  const visit = async (route: string): Promise<void> => {
    const res = await page.goto(`${ADMIN_URL}${route}`, { waitUntil: "domcontentloaded", timeout: 60_000 }).catch(() => null);
    await page.locator("main").first().waitFor({ timeout: 30_000 }).catch(() => undefined);
    await page.waitForTimeout(1500);
    const text = await page.locator("main").innerText({ timeout: 15_000 }).catch(() => "");
    const h1 = (await page.locator("h1").first().textContent({ timeout: 10_000 }).catch(() => ""))?.trim() ?? "";
    const errorish = /خطا|Error|Unhandled|exception|پیدا نشد|مشکلی پیش آمد/i.test(text) ? "ERRTEXT" : "";
    rows.push(`${res?.status() ?? 0} | ${route} | h1=${h1} | ${errorish} | ${text.length} chars`);
    await page.screenshot({ path: `${out}/${route.replace(/\W+/g, "_") || "root"}.png` }).catch(() => undefined);
    flush();
  };

  const details: string[] = [];
  const from = Number(process.env["CRAWL_FROM"] ?? "0");
  for (const route of ROUTES.slice(from)) {
    await visit(route);
    if (LISTS.includes(route)) {
      // the first real record link (an id segment), not the list's own sub-tools (new, bulk-price, fx, import)
      const hrefs = await page
        .locator("main a[href]")
        .evaluateAll((els) => els.map((e) => e.getAttribute("href") ?? ""))
        .catch(() => [] as string[]);
      const re = new RegExp(`^${route}/(?!new$|bulk-price$|fx$|import$)[A-Za-z0-9_-]+/?$`);
      const hit = hrefs.map((h) => h.replace(ADMIN_URL, "")).find((h) => re.test(h));
      if (hit !== undefined) details.push(hit);
    }
  }
  for (const route of details) await visit(route);
  flush();
  expect(rows.length).toBeGreaterThan(0);
});
