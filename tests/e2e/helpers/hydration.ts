import { expect, type Locator } from "@playwright/test";

export async function hydrated(target: Locator): Promise<Locator> {
  const first = target.first();
  await expect(first).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(() => first.evaluate((el) => Object.keys(el).some((k) => k.startsWith("__reactProps"))), { timeout: 30_000, intervals: [100, 250, 500] })
    .toBe(true);
  return first;
}
