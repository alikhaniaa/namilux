import { expect, type Page } from "@playwright/test";
import { hydrated } from "./hydration";

export type Entry = { id: number; slug: string; dn: string; p: number; s: boolean };

const BASE = (process.env["E2E_BASE_URL"] ?? "http://localhost:3000").replace(/\/$/, "");
let cached: Entry[] | null = null;

export async function searchIndex(): Promise<Entry[]> {
  if (cached !== null) return cached;
  const res = await fetch(`${BASE}/search-index.json`);
  cached = (await res.json()) as Entry[];
  return cached;
}

/** `nth` lets specs spread their pending orders over different products, so one product's stock is never exhausted by reservations. */
export async function pickProduct(kind: "in-stock" | "out-of-stock" | "on-request", nth = 0): Promise<Entry> {
  const all = await searchIndex();
  const hits = all.filter((e) => (kind === "in-stock" ? e.s && e.p > 0 : kind === "out-of-stock" ? !e.s && e.p > 0 : e.p === 0));
  const hit = hits[nth] ?? hits[0];
  if (hit === undefined) throw new Error(`no ${kind} product in the index`);
  return hit;
}

export function productPath(slug: string): string {
  return `/product/${encodeURIComponent(slug).toLowerCase()}/`;
}

/** A unique test phone per run so quotas and existing sessions never collide. */
export function testPhone(): string {
  const n = String(Date.now()).slice(-7);
  return `0912${n}`;
}

export async function addToCartFromPdp(page: Page, slug: string): Promise<void> {
  await page.goto(productPath(slug));
  await (await hydrated(page.getByRole("button", { name: "افزودن به سبد" }))).click();
  await expect(page.getByText("به سبد اضافه شد")).toBeVisible({ timeout: 10_000 });
}

export async function fillCheckoutAddress(page: Page): Promise<void> {
  await page.getByLabel("نام گیرنده").fill("علی رضایی");
  await page.getByLabel("تلفن گیرنده").fill("09121234567");
  // exact: the province <label> wraps its <select>, whose option text «بوشهر» would also match a loose "شهر"
  await page.getByLabel("شهر", { exact: true }).fill("تهران");
  await page.getByLabel("نشانی کامل").fill("خیابان ولیعصر، کوچهٔ سوم");
  await page.getByLabel("کد پستی").fill("1234567890");
  await page.getByRole("button", { name: "ذخیره در نشانی‌های من" }).click();
  await expect(page.getByRole("radio", { name: /علی رضایی/ })).toBeVisible({ timeout: 10_000 });
}

/** Text nodes outside <bdi>, [dir=ltr] and <code> that contain a Latin digit. */
export async function latinDigitOffenders(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node !== null) {
      const text = node.textContent ?? "";
      if (/[0-9]/.test(text)) {
        const el = node.parentElement;
        const skip = el?.closest("bdi, [dir='ltr'], code, script, style, article, .prose, nextjs-portal, [data-nextjs-toast], [data-nextjs-dialog-overlay]") !== null;
        if (!skip && el !== null && el.offsetParent !== null) out.push(text.trim().slice(0, 60));
      }
      node = walker.nextNode();
    }
    return out;
  });
}
