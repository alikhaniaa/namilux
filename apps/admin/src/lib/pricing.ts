import { MAX_TOMAN, THOUSANDS_SEP, enDigits, faDigits, faInt, formatJalali, formatRelative, formatTehranTime, priceChangePercent, tehranDayKey } from "@namilux/core/client";
// Type-only: erased at build, so this module stays safe to import from client components.
import type { PriceSheetRow } from "@namilux/core";

/**
 * What the pricing screens share: how a typed amount is read and drawn, how a product is found by
 * what a person remembers of it, and how a change is put into words. No React, no fetch - so the
 * same rules can be tested without a browser.
 */

export type PriceRow = PriceSheetRow;
export type Prices = { price: number; compareAtPrice: number | null };

export const pricesOf = (r: Prices): Prices => ({ price: r.price, compareAtPrice: r.compareAtPrice });
export const samePrices = (a: Prices, b: Prices): boolean => a.price === b.price && a.compareAtPrice === b.compareAtPrice;

/**
 * The most digits an amount box takes. One fewer than MAX_TOMAN has, so whatever fits in the box is
 * an amount the core stores - the box never holds a number that would be refused on save.
 */
const MAX_DIGITS = String(MAX_TOMAN).length - 1;

/** Whatever was typed or pasted → bare Latin digits: «۱۲٬۵۰۰٬۰۰۰ تومان» → "12500000". */
export function priceDigits(raw: string): string {
  const digits = enDigits(raw).replace(/\D/g, "").replace(/^0+(?=\d)/, "");
  return digits.slice(0, MAX_DIGITS);
}

/** Bare digits → the grouped Persian figure an amount is read in: "12500000" → «۱۲٬۵۰۰٬۰۰۰». */
export function groupDigits(digits: string): string {
  let out = "";
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += THOUSANDS_SEP;
    out += digits.charAt(i);
  }
  return faDigits(out);
}

/** Digits → a whole Toman amount, or null for an empty box or one beyond what the core stores. */
export function digitsToToman(digits: string): number | null {
  if (digits === "") return null;
  const n = Number(digits);
  return Number.isSafeInteger(n) && n <= MAX_TOMAN ? n : null;
}

// ── finding a product ────────────────────────────────────────────────────────────────────────

/** One alphabet for both sides of a comparison: Persian yeh/kaf, Latin digits, lower case, plain spaces. */
export function foldText(s: string): string {
  return enDigits(s)
    .replace(/[يى]/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[\u200c\u200e\u200f\u00a0]/g, " ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** A code with its punctuation removed, so «ECAM 22.110», «ecam22110» and «ECAM-22.110» are one code. */
export function foldCode(s: string): string {
  return foldText(s).replace(/[^\p{L}\p{N}]/gu, "");
}

/** Everything a row can be found by, folded once. */
export function searchHaystack(r: PriceRow): string {
  return foldText(`${r.displayName} ${r.name} ${r.brandName ?? ""} ${r.sku ?? ""} ${r.modelCode ?? ""} ${r.colorName ?? ""} #${String(r.id)}`);
}

/** Every word typed has to appear somewhere on the row; the order they were typed in does not matter. */
export function queryTokens(q: string): string[] {
  return foldText(q).split(" ").filter((t) => t !== "");
}

export function matchesTokens(haystack: string, tokens: readonly string[]): boolean {
  return tokens.every((t) => haystack.includes(t));
}

/** The short code shown under a product's name: its SKU, else its model code. */
export function rowCode(r: Pick<PriceRow, "sku" | "modelCode">): string | null {
  return r.sku ?? r.modelCode ?? null;
}

// ── time ─────────────────────────────────────────────────────────────────────────────────────

/** The shop's calendar day (Tehran) an instant falls on, as a sortable «2026-10-01». */
export function tehranDay(at: string | number | Date): string {
  return tehranDayKey(at);
}

export function changedOn(iso: string | null, day: string): boolean {
  return iso !== null && tehranDay(iso) === day;
}

/** «امروز ۱۰:۴۲», «دیروز», «۳ روز پیش» - when a price last moved, as someone repricing daily thinks of it. */
export function lastChangedLabel(iso: string | null, now: number): string {
  if (iso === null) return "ثبت نشده";
  const day = tehranDay(iso);
  if (day === tehranDay(now)) return `امروز ${formatTehranTime(iso)}`;
  if (day === tehranDay(now - 86_400_000)) return "دیروز";
  return formatRelative(iso, now);
}

/** A full timestamp for the log: «۹ مهر ۱۴۰۵ · ۱۰:۴۲». */
export function logTime(iso: string, now: number): string {
  const time = formatTehranTime(iso);
  const day = tehranDay(iso);
  if (day === tehranDay(now)) return `امروز ${time}`;
  if (day === tehranDay(now - 86_400_000)) return `دیروز ${time}`;
  return `${formatJalali(iso, "short")} · ${time}`;
}

// ── a change, in words ───────────────────────────────────────────────────────────────────────

export type ChangeSummary = { direction: "up" | "down" | "same" | "new" | "removed"; text: string };

/** «+۵۰۰٬۰۰۰ · ۴٪» - how far a price moved, in Toman and per cent. */
export function describeChange(before: number, after: number): ChangeSummary {
  if (before === after) return { direction: "same", text: "بدون تغییر" };
  if (after === 0) return { direction: "removed", text: "استعلامی شد" };
  if (before === 0) return { direction: "new", text: "قیمت‌دار شد" };
  const delta = after - before;
  const pct = priceChangePercent(before, after);
  const amount = `${delta > 0 ? "+" : "−"}${faInt(Math.abs(delta))}`;
  return { direction: delta > 0 ? "up" : "down", text: pct === null || pct === 0 ? amount : `${amount} · ${faInt(Math.abs(pct))}٪` };
}

/** «۱۰ برابر قیمت فعلی» / «۱۰ برابر کمتر از قیمت فعلی» - the size of a jump, for the question asked before saving one. */
export function jumpLabel(before: number, after: number): string {
  const times = after > before ? after / before : before / after;
  // one decimal below ten («۳٫۵ برابر»), whole numbers from there up
  const shown = times >= 10 ? Math.round(times) : Math.round(times * 10) / 10;
  const figure = faDigits(String(shown)).replace(".", "٫");
  return after > before ? `${figure} برابر قیمت فعلی` : `${figure} برابر کمتر از قیمت فعلی`;
}

/** The notes the pricing screens write into the price history, and what the log calls each source. */
export const PRICE_NOTES = {
  group: "تغییر گروهی",
  paste: "ورود از فهرست",
  undo: "برگشت به قیمت قبلی",
} as const;

export function sourceLabel(note: string | null, actorType: string): string {
  if (note === null || note === "") return actorType === "staff" ? "صفحهٔ محصول" : "سیستم";
  if (note === "price-sheet") return "تغییر سریع";
  if (note.startsWith("bulk:")) return PRICE_NOTES.group;
  if (note.startsWith("fx ")) return "نرخ ارز";
  if (note === "csv" || note.startsWith("import")) return "ورود از CSV";
  return note;
}

/** Tehran has kept one offset all year since 2022 (UTC+03:30), so its midnight is plain arithmetic. */
const TEHRAN_OFFSET_MS = 210 * 60_000;
const DAY_MS = 86_400_000;

/** The instant the shop's day began, `daysBack` days ago (0 = today's midnight in Tehran). */
export function tehranDayStart(now: number, daysBack = 0): Date {
  const local = now + TEHRAN_OFFSET_MS;
  return new Date(local - (local % DAY_MS) - daysBack * DAY_MS - TEHRAN_OFFSET_MS);
}
