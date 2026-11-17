import { type Page } from "@playwright/test";

export async function payOnMockGateway(page: Page, outcome: "ok" | "fail"): Promise<void> {
  // generous: the first hit of /billing/gateway-sim and /billing/result compiles the route on a dev server
  await page.waitForURL(/\/billing\/gateway-sim\//, { timeout: 90_000 });
  await page.getByRole("button", { name: outcome === "ok" ? "پرداخت موفق" : "انصراف" }).click();
  await page.waitForURL(/\/billing\/result\//, { timeout: 90_000 });
}
