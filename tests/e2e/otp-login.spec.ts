import { expect, test } from "@playwright/test";
import { hydrated } from "./helpers/hydration";
import { enterOtp, loginWithOtp, otpBoxes, readOtp, requestOtp } from "./helpers/otp";
import { testPhone } from "./helpers/shop";

test.describe("otp login", () => {
  test("login on 360 with mock SMS code", async ({ page }) => {
    await loginWithOtp(page, testPhone());
    await expect(page.getByRole("heading", { name: "حساب کاربری" })).toBeVisible();
  });

  test("wrong code 5 times locks the code", async ({ page }) => {
    await page.goto("/account/login/");
    const phone = testPhone();
    await requestOtp(page, phone);
    for (let i = 0; i < 5; i += 1) {
      await enterOtp(page, "000000");
      // The field error carries role="alert"; the resend timer («ارسال دوباره تا …») also contains
      // «دوباره» since the 3 Sep copy change, so a bare text match hit two elements (4 Sep 2026).
      await expect(page.locator("main").getByRole("alert").filter({ hasText: /کد درست نیست|منقضی|تعداد|دوباره/ })).toBeVisible({ timeout: 10_000 });
      // the boxes are cleared after a failure; a sixth attempt must not log in
      await expect(otpBoxes(page).first()).toHaveValue("");
    }
    const cookies = await page.context().cookies();
    expect(cookies.some((c) => c.name === "nl_s")).toBe(false);
  });

  test("resend timer counts down in Persian digits", async ({ page }) => {
    await page.goto("/account/login/");
    await requestOtp(page, testPhone());
    const timer = page.getByText(/ارسال دوباره تا/);
    await expect(timer).toBeVisible();
    const text = (await timer.textContent()) ?? "";
    expect(text).toMatch(/[۰-۹]/);
    expect(text).not.toMatch(/[0-9]/);
  });

  test("logout clears the session cookie", async ({ page }) => {
    const phone = testPhone();
    await loginWithOtp(page, phone);
    await page.goto("/account/");
    await (await hydrated(page.getByRole("button", { name: "خروج" }))).click();
    await page.waitForURL((u) => !u.pathname.startsWith("/account") || u.pathname.includes("login"), { timeout: 20_000 });
    const cookies = await page.context().cookies();
    expect(cookies.some((c) => c.name === "nl_s")).toBe(false);
    // a second code for the same phone still works (nothing was locked by the logout)
    await page.goto("/account/login/");
    const at = await requestOtp(page, phone);
    expect(await readOtp(phone, at)).toMatch(/^\d{6}$/);
  });
});
