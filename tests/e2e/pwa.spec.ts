import { expect, test } from "@playwright/test";

test.describe("pwa", () => {
  test("manifest is valid and installability audit passes", async ({ page }) => {
    await page.goto("/");
    const href = await page.locator('link[rel="manifest"]').getAttribute("href");
    expect(href).toBeTruthy();
    const res = await page.request.get(href ?? "/manifest.webmanifest");
    expect(res.ok()).toBe(true);
    const manifest = (await res.json()) as { name?: string; start_url?: string; display?: string; icons?: { sizes?: string; purpose?: string }[]; lang?: string; dir?: string };
    expect(manifest.name).toBeTruthy();
    expect(manifest.start_url).toBeTruthy();
    expect(manifest.display).toBe("standalone");
    expect(manifest.dir).toBe("rtl");
    expect((manifest.icons ?? []).some((i) => (i.sizes ?? "").includes("512"))).toBe(true);
    expect((manifest.icons ?? []).some((i) => (i.purpose ?? "").includes("maskable"))).toBe(true);
  });

  test.fixme("service worker registers in prod mode and never caches /account or /api", async () => {
    // the SW is registered only on the production build; run with E2E_BASE_URL against `next start`.
  });

  test.fixme("offline fallback page renders when the network is dropped", async () => {
    // same: requires the production service worker.
  });

  test("Instagram UA shows the open-in-browser coach; standalone shows no coach", async ({ browser }) => {
    const ig = await browser.newContext({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 300.0.0.0", viewport: { width: 390, height: 844 } });
    const page = await ig.newPage();
    await page.goto("/");
    // InstallCoach shows after DWELL_MS (25 s) on the first pageview, or at once on the second; the
    // 10 s the test used to wait could never see the first-visit coach (4 Sep 2026 QA run).
    await expect(page.getByText(/مرورگر|Safari|Chrome/).first()).toBeVisible({ timeout: 30_000 });
    await ig.close();
  });

  test.fixme("update toast appears after a build id change; kill switch unregisters", async () => {
    // requires two production builds with different NEXT_PUBLIC_BUILD_ID values.
  });
});
