import { join } from "node:path";
import { expect, type Locator, type Page } from "@playwright/test";
import { hydrated } from "./hydration";
import { readLastMockSms } from "@namilux/integrations";

export const OUTBOX_PATH = process.env["E2E_SMS_OUTBOX"] ?? join(process.env["MEDIA_DIR"] ?? ".media", "..", ".sms-outbox.jsonl");

/** Newest 6-digit code the mock driver "sent" to `phone` after `notBefore` (ISO). Polls for up to 10 s. */
export async function readOtp(phone: string, notBefore = ""): Promise<string> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const last = await readLastMockSms(OUTBOX_PATH, phone);
    if (last !== null && last.at > notBefore) {
      const m = /\b(\d{6})\b/.exec(last.text);
      if (m?.[1] !== undefined) return m[1];
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`no OTP for ${phone} in ${OUTBOX_PATH}`);
}

/** The six one-digit boxes of the OTP step. */
export function otpBoxes(page: Page, root?: Locator) {
  const scope = root ?? page.locator("main");
  return scope.locator('input[inputmode="numeric"][maxlength="1"], input[autocomplete="one-time-code"]');
}

/** Types a 6-digit code into the OTP boxes (they auto-advance) - falls back to a single field. */
export async function enterOtp(page: Page, code: string, root?: Locator): Promise<void> {
  const boxes = otpBoxes(page, root);
  await expect(boxes.first()).toBeVisible();
  const n = await boxes.count();
  if (n >= 6) {
    for (let i = 0; i < 6; i += 1) await boxes.nth(i).fill(code[i] ?? "");
  } else {
    await boxes.first().fill(code);
  }
}

/** Requests a code for `phone` on the current page (any PhoneOtp instance) and returns the ISO time of the request. */
export async function requestOtp(page: Page, phone: string, root?: Locator): Promise<string> {
  const scope = root ?? page.locator("main");
  const notBefore = new Date().toISOString();
  await (await hydrated(scope.getByLabel("تلفن همراه"))).fill(phone);
  await scope.getByRole("button", { name: "دریافت کد" }).first().click();
  await expect(scope.getByText(/کد به .* پیامک شد/)).toBeVisible({ timeout: 15_000 });
  return notBefore;
}

/** Full login: /account/login/ → phone → code from the outbox → session cookie present. */
export async function loginWithOtp(page: Page, phone: string): Promise<void> {
  await page.goto("/account/login/");
  const notBefore = await requestOtp(page, phone);
  const code = await readOtp(phone, notBefore);
  await enterOtp(page, code);
  await page.waitForURL((u) => !u.pathname.startsWith("/account/login"), { timeout: 20_000 });
  const cookies = await page.context().cookies();
  expect(cookies.some((c) => c.name === "nl_s")).toBe(true);
}
