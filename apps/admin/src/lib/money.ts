import { MAX_TOMAN, enDigits, formatToman } from "@namilux/core/client";

/**
 * Admin money display. `formatToman` from the core groups the digits only («۱۲٬۰۰۰»); on a screen
 * that mixes prices, counts and percentages a bare number is ambiguous, so every price the panel
 * shows outside a column already headed «(تومان)» goes through `toman`.
 */
export const TOMAN = "تومان";

export function toman(n: number): string {
  return `${formatToman(n)} ${TOMAN}`;
}

/**
 * Parses what an admin typed into a Toman field: Persian, Arabic or Latin digits, with or without
 * `٬` `,` or spaces as group separators. Returns null for an empty box and NaN for anything that is
 * not a whole, non-negative amount within the core's MAX_TOMAN - the caller shows the error.
 */
export function parseTomanInput(raw: string): number | null {
  const compact = enDigits(raw).replace(/[\s,٬،_]/g, "");
  if (compact === "") return null;
  if (!/^\d+$/.test(compact)) return Number.NaN;
  const n = Number(compact);
  return Number.isSafeInteger(n) && n <= MAX_TOMAN ? n : Number.NaN;
}

/** Signed whole-number input (bulk «مبلغ ثابت», stock deltas): «-۱۵۰٬۰۰۰» → -150000. */
export function parseSignedInt(raw: string): number | null {
  const compact = enDigits(raw).replace(/[\s,٬،_]/g, "").replace(/^[−–]/, "-");
  if (compact === "" || compact === "-" || compact === "+") return null;
  if (!/^[-+]?\d+$/.test(compact)) return Number.NaN;
  const n = Number(compact);
  return Number.isSafeInteger(n) ? n : Number.NaN;
}
