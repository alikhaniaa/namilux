import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { expect, type Page } from "@playwright/test";
import { hydrated } from "./hydration";
import { base32Decode, totp } from "@namilux/core";

export const ADMIN_URL = (process.env["E2E_ADMIN_URL"] ?? "http://localhost:3100").replace(/\/$/, "");
const EMAIL = process.env["E2E_ADMIN_EMAIL"] ?? "owner@namilux.local";
const PASSWORD = process.env["E2E_ADMIN_PASSWORD"] ?? "NamiluxOwner2026x";
let secret = process.env["E2E_ADMIN_TOTP_SECRET"] ?? "";

const STEP_MS = 30_000;
const LOCK = join(process.cwd(), "test-results", ".totp-step");

/** A code that is valid right now (and for the verifier's ±1 step window). */
export function currentCode(): string {
  if (secret === "") throw new Error("E2E_ADMIN_TOTP_SECRET is not set and no enrolment secret was captured");
  return totp(base32Decode(secret));
}

/** Waits until the current 30-s step has not been used by any worker of this run, then claims it. */
async function claimStep(): Promise<void> {
  mkdirSync(dirname(LOCK), { recursive: true });
  for (;;) {
    let used = -1;
    try {
      used = Number(readFileSync(LOCK, "utf8"));
    } catch {
      /* first claim of the run */
    }
    const step = Math.floor(Date.now() / STEP_MS);
    if (!(used >= step)) {
      writeFileSync(LOCK, String(step));
      return;
    }
    await new Promise((r) => setTimeout(r, STEP_MS - (Date.now() % STEP_MS) + 300));
  }
}

export async function adminLogin(page: Page): Promise<void> {
  await page.goto(`${ADMIN_URL}/login`);
  await (await hydrated(page.getByLabel("ایمیل"))).fill(EMAIL);
  await page.getByLabel(/^(گذرواژه|رمز عبور)$/).fill(PASSWORD);
  await page.getByRole("button", { name: "ورود" }).click();
  await page.waitForURL(/\/login\/totp/, { timeout: 60_000 });
  // First login enrols: the page prints the base32 secret - capture it so the same run can log in again.
  const shown = page.locator("main").getByText(/^[A-Z2-7]{32}$/);
  if (await page.evaluate(() => sessionStorage.getItem("nl_enrol") === "1")) {
    await expect(shown.first()).toBeVisible({ timeout: 30_000 });
    secret = (await shown.first().textContent())?.trim() ?? secret;
  }
  for (let attempt = 1; ; attempt++) {
    await claimStep();
    await page.getByLabel(/کد تأیید دومرحله‌ای/).fill(currentCode());
    await page.getByRole("button", { name: "تأیید" }).click();
    const left = await page
      .waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30_000 })
      .then(() => true)
      .catch(() => false);
    if (left) break;
    if (attempt >= 3) throw new Error("admin TOTP login did not succeed in 3 attempts");
  }
  // The dashboard greets by name since the panel redesign («سلام، …»); the menu entry is what stays put.
  await expect(page.getByRole("link", { name: "داشبورد" }).first()).toBeVisible();
  await expect(page.locator("main h1")).toBeVisible();
}

/** Completes the sudo dialog (fresh TOTP) if it is open. */
export async function sudo(page: Page): Promise<void> {
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await claimStep();
  await dialog.getByRole("textbox").fill(currentCode());
  await dialog.getByRole("button", { name: /تأیید/ }).click();
  await expect(dialog).toBeHidden();
}
