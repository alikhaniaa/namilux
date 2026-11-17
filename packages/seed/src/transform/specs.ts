import { faNorm, enDigits, splitListItems } from "@namilux/core";
import { cleanText, cleanLabel } from "./zwnj.js";

export type SpecRow = { groupName: string | null; label: string; value: string; sort: number };

export const NON_SPEC_LABELS: readonly string[] = ["برند", "برند سازنده", "رنگ", "توضیحات کوتاه محصول", "مدل دستگاه"];

export const DIMENSION_LABELS = {
  length: ["طول"],
  width: ["عرض"],
  height: ["ارتفاع"],
  weight: ["وزن"],
  dims: ["ابعاد"],
} as const;

export const MAX_ITEMS_PER_VALUE = 40;

// ---------------------------------------------------------------- internals
/** A value item that ends with a colon opens a group («اقلام همراه:»); it is never a row itself. */
const GROUP_HEADER_RE = /[:：]\s*$/;
/** Separators that always split, after the newline/bullet pass (contract order). */
const HARD_SEPARATOR_RE = /[،؛;]|\s\|\s/;
const DIGIT_RE = /[0-9۰-۹٠-٩]/;
const NON_SPEC_KEYS = new Set(NON_SPEC_LABELS.map((l) => faNorm(l)));

/**
 * Split on "," only when it is not a decimal comma ("1,5 لیتر") and not inside parentheses
 * (contract). Every other separator is handled by HARD_SEPARATOR_RE.
 */
function splitOnCommas(part: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = "";
  for (let i = 0; i < part.length; i++) {
    const ch = part.charAt(i);
    if (ch === "(" || ch === "（") depth += 1;
    else if (ch === ")" || ch === "）") depth = Math.max(0, depth - 1);
    if (ch === "," && depth === 0) {
      const before = part.charAt(i - 1);
      const after = part.slice(i + 1).replace(/^\s+/, "").charAt(0);
      if (!(DIGIT_RE.test(before) && DIGIT_RE.test(after))) {
        out.push(current);
        current = "";
        continue;
      }
    }
    current += ch;
  }
  out.push(current);
  return out;
}

/** Numbers for the dimension parser: Persian/Arabic digits folded, Persian decimal mark normalised. */
function parseNumbers(value: string): number[] {
  const text = enDigits(value).replace(/٫/g, ".").replace(/٬/g, "");
  const out: number[] = [];
  for (const match of text.matchAll(/\d+(?:[.,]\d+)?/g)) {
    const n = Number.parseFloat((match[0] ?? "").replace(",", "."));
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

/** Unit → millimetres. DECISION: an unrecognised/absent unit yields null - never invent a size. */
function lengthFactorMm(value: string): number | null {
  const n = faNorm(value);
  if (/میلی ?متر|میلیمتر|(?:^| )mm(?:$| )/u.test(n)) return 1;
  if (/سانتی ?متر|سانتیمتر|(?:^| )cm(?:$| )/u.test(n)) return 10;
  if (/(?:^| )(?:متر|m)(?:$| )/u.test(n)) return 1000;
  if (/اینچ|(?:^| )inch(?:$| )/u.test(n)) return 25.4;
  return null;
}

/** Unit → grams. Same DECISION as lengthFactorMm. */
function weightFactorG(value: string): number | null {
  const n = faNorm(value);
  if (/کیلو ?گرم|کیلوگرم|(?:^| )(?:kg|کیلو)(?:$| )/u.test(n)) return 1000;
  if (/گرم|(?:^| )(?:g|gr)(?:$| )/u.test(n)) return 1;
  return null;
}

function matchesLabel(rowLabel: string, labels: readonly string[]): boolean {
  const n = faNorm(rowLabel);
  return labels.some((l) => n === faNorm(l) || n.startsWith(`${faNorm(l)} `));
}

// ---------------------------------------------------------------- contract
export function splitFusedValue(raw: string): string[] {
  if (typeof raw !== "string" || raw.trim() === "") return [];
  const out: string[] = [];
  const seen = new Set<string>();
  // Pass 1 - newlines, <li>/<br>/</p> and bullets (core splitListItems, v2 §6.6).
  for (const line of splitListItems(raw)) {
    // Pass 2 - «،» «؛» ";" " | ", then the guarded ",".
    for (const chunk of line.split(HARD_SEPARATOR_RE)) {
      if (chunk === undefined) continue;
      for (const piece of splitOnCommas(chunk)) {
        const item = piece.trim();
        if (item === "") continue;
        const key = faNorm(item);
        if (key === "" || seen.has(key)) continue;
        seen.add(key);
        out.push(item);
        if (out.length >= MAX_ITEMS_PER_VALUE) return out;
      }
    }
  }
  return out;
}

export function specsFromAttributes(attrs: { label: string; rawValue: string }[]): { rows: SpecRow[]; fusedSplit: number } {
  const rows: SpecRow[] = [];
  let fusedSplit = 0;
  if (!Array.isArray(attrs)) return { rows, fusedSplit };

  for (const attr of attrs) {
    const label = cleanLabel(attr?.label ?? "");
    // brand/colour are columns, the short description is short_html, the model is model_code.
    if (label === "" || NON_SPEC_KEYS.has(faNorm(label))) continue;

    const items = splitFusedValue(attr?.rawValue ?? "");
    if (items.length === 0) continue;

    // DECISION (header): the label stays the ATTRIBUTE label for every item of a catch-all like
    // «سایر مشخصات», so the compare table keeps one stable label column.
    let groupName: string | null = null;
    let produced = 0;
    for (const item of items) {
      if (GROUP_HEADER_RE.test(item)) {
        groupName = cleanLabel(item) || null;
        continue;
      }
      const value = cleanText(item);
      if (value === "") continue;
      rows.push({ groupName, label, value, sort: rows.length });
      produced += 1;
    }
    if (produced > 1) fusedSplit += 1;
  }
  return { rows, fusedSplit };
}

export function dimsFromSpecs(rows: SpecRow[]): {
  lengthMm: number | null;
  widthMm: number | null;
  heightMm: number | null;
  weightG: number | null;
} {
  const out: { lengthMm: number | null; widthMm: number | null; heightMm: number | null; weightG: number | null } = {
    lengthMm: null,
    widthMm: null,
    heightMm: null,
    weightG: null,
  };
  if (!Array.isArray(rows)) return out;

  const round = (n: number): number | null => {
    const mm = Math.round(n);
    return Number.isFinite(mm) && mm > 0 ? mm : null;
  };

  // «ابعاد ۳۰×۲۰×۱۵ سانتی متر» first; explicit طول/عرض/ارتفاع rows override it below.
  for (const row of rows) {
    if (!matchesLabel(row.label, DIMENSION_LABELS.dims)) continue;
    const factor = lengthFactorMm(row.value);
    if (factor === null) continue;
    const numbers = parseNumbers(row.value);
    if (numbers.length < 3) continue;
    out.lengthMm = round((numbers[0] ?? 0) * factor);
    out.widthMm = round((numbers[1] ?? 0) * factor);
    out.heightMm = round((numbers[2] ?? 0) * factor);
  }

  for (const row of rows) {
    const single = (labels: readonly string[]): number | null => {
      if (!matchesLabel(row.label, labels)) return null;
      const factor = lengthFactorMm(row.value);
      const first = parseNumbers(row.value)[0];
      if (factor === null || first === undefined) return null;
      return round(first * factor);
    };
    const length = single(DIMENSION_LABELS.length);
    if (length !== null) out.lengthMm = length;
    const width = single(DIMENSION_LABELS.width);
    if (width !== null) out.widthMm = width;
    const height = single(DIMENSION_LABELS.height);
    if (height !== null) out.heightMm = height;

    if (matchesLabel(row.label, DIMENSION_LABELS.weight)) {
      const factor = weightFactorG(row.value);
      const first = parseNumbers(row.value)[0];
      if (factor !== null && first !== undefined) {
        const grams = round(first * factor);
        if (grams !== null) out.weightG = grams;
      }
    }
  }
  return out;
}
