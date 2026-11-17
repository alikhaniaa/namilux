import { MAX_TOMAN, enDigits } from "@namilux/core/client";
import { foldCode, foldText, queryTokens, searchHaystack } from "./pricing";
import type { PriceRow } from "./pricing";

/**
 * A price list as people actually have it - a column copied out of Excel, a supplier's message, a
 * note typed on a phone - turned into «this product, this price».
 *
 * Each line is read on its own: the LAST number on it is the price, everything before it names the
 * product. Nothing here writes anything; the screen shows what each line was understood as, and the
 * person confirms.
 */

export type PasteUnit = "toman" | "rial";

export type PasteLine = {
  /** 1-based line number in the pasted text. */
  line: number;
  raw: string;
  /** What names the product on this line; "" when the line was only a number. */
  key: string;
  /** A number sign and digits on the line: the panel id of the product, as its copied list writes it. */
  id: number | null;
  /** Whole Toman, or null when the line carries no usable amount. */
  price: number | null;
};

const UNIT_WORDS = /(?:تومان|تومن|ریال|ريال|toman|rial|irr|irt)\.?$/iu;
/** «12,500,000», «12.500.000», «12 500 000» - a grouped figure - or a bare run of digits. */
const AMOUNT = /^(?:\d{1,3}(?:[,٬،.\s]\d{3})+|\d+)$/u;
/** The amount must stand apart from the product: after a space, a colon, «=» or «|» - never a hyphen or a comma, which codes and half-typed numbers are full of. */
const TRAILING_AMOUNT = /^(.*?)(?:^|[\s:=|])((?:\d{1,3}(?:[,٬،.\s]\d{3})+|\d+))$/u;
const ID = /(?:^|\s)#(\d{1,9})(?=\s|$)/u;

function toAmount(text: string, unit: PasteUnit): number | null {
  const cleaned = text.trim().replace(UNIT_WORDS, "").trim();
  if (!AMOUNT.test(cleaned)) return null;
  const n = Number(cleaned.replace(/\D/g, ""));
  if (!Number.isSafeInteger(n)) return null;
  const toman = unit === "rial" ? Math.round(n / 10) : n;
  return toman > MAX_TOMAN ? null : toman;
}

function readLine(raw: string, line: number, unit: PasteUnit): PasteLine {
  const text = enDigits(raw).replace(/[\u200e\u200f]/g, "");
  let key = "";
  let price: number | null = null;
  if (text.includes("\t")) {
    // A row copied out of a spreadsheet: the price is the last cell that is an amount, and the
    // product is named by the cells in front of it. An EMPTY cell ends the search - a price column
    // left blank must not make the numeric code beside it the price.
    const cells = text.split("\t").map((c) => c.trim());
    for (let i = cells.length - 1; i >= 1; i--) {
      if (cells[i] === "") break;
      const amount = toAmount(cells[i] ?? "", unit);
      if (amount !== null) {
        price = amount;
        key = cells.slice(0, i).filter((c) => c !== "").join(" ");
        break;
      }
    }
    if (price === null) key = cells.filter((c) => c !== "").join(" ");
  } else {
    const trimmed = text.trim().replace(UNIT_WORDS, "").trim();
    const m = TRAILING_AMOUNT.exec(trimmed);
    if (m === null) key = trimmed;
    else {
      key = (m[1] ?? "").trim().replace(/[\s:=|؛;,،\-–—]+$/u, "");
      price = toAmount(m[2] ?? "", unit);
    }
  }
  const idMatch = ID.exec(key);
  const id = idMatch === null ? null : Number(idMatch[1]);
  return { line, raw, key: key.replace(ID, " ").replace(/\s+/g, " ").trim(), id, price };
}

/** Blank lines are dropped; every other line comes back, understood or not, in the order pasted. */
export function parsePriceList(text: string, unit: PasteUnit = "toman"): PasteLine[] {
  const out: PasteLine[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    if (raw.trim() !== "") out.push(readLine(raw, i + 1, unit));
  });
  return out;
}

export type ProductIndex = {
  byId: Map<number, PriceRow>;
  byCode: Map<string, PriceRow[]>;
  byName: Map<string, PriceRow[]>;
  all: { row: PriceRow; text: string; codes: string[] }[];
};

function push<K>(map: Map<K, PriceRow[]>, key: K, row: PriceRow): void {
  const list = map.get(key);
  if (list === undefined) map.set(key, [row]);
  else if (!list.includes(row)) list.push(row);
}

export function indexProducts(rows: readonly PriceRow[]): ProductIndex {
  const index: ProductIndex = { byId: new Map(), byCode: new Map(), byName: new Map(), all: [] };
  for (const row of rows) {
    index.byId.set(row.id, row);
    const codes = [row.sku, row.modelCode].flatMap((c) => (c === null || foldCode(c) === "" ? [] : [foldCode(c)]));
    for (const code of codes) push(index.byCode, code, row);
    for (const name of [row.displayName, row.name]) if (foldText(name) !== "") push(index.byName, foldText(name), row);
    index.all.push({ row, text: searchHaystack(row), codes });
  }
  return index;
}

export type PasteMatch =
  | { kind: "one"; row: PriceRow }
  /** Several products fit - colours of one model, usually. The person picks. */
  | { kind: "many"; rows: PriceRow[] }
  | { kind: "none" };

/** The most candidates offered for one line; beyond this the line names too little to choose from. */
export const PASTE_CANDIDATES_MAX = 12;

function pick(rows: readonly PriceRow[]): PasteMatch {
  if (rows.length === 0) return { kind: "none" };
  if (rows.length === 1 && rows[0] !== undefined) return { kind: "one", row: rows[0] };
  return rows.length > PASTE_CANDIDATES_MAX ? { kind: "none" } : { kind: "many", rows: [...rows] };
}

/**
 * Which product a line means. In order of how sure each reading is: the panel's own `#id`; the whole
 * key as a code; the whole key as a name; a code standing as one of the key's words; and last, every
 * word of the key appearing on the product.
 */
export function matchLine(line: Pick<PasteLine, "key" | "id">, index: ProductIndex): PasteMatch {
  if (line.id !== null) {
    const row = index.byId.get(line.id);
    return row === undefined ? { kind: "none" } : { kind: "one", row };
  }
  if (line.key === "") return { kind: "none" };

  const asCode = foldCode(line.key);
  if (asCode !== "") {
    const exact = index.byCode.get(asCode);
    if (exact !== undefined) return pick(exact);
  }
  const named = index.byName.get(foldText(line.key));
  if (named !== undefined) return pick(named);

  // «دلونگی ECAM22.110 مشکی»: one word of the line is a product's code.
  const words = foldText(line.key).split(" ").map(foldCode).filter((w) => w.length >= 3);
  const byWord = new Set<PriceRow>();
  for (const w of words) for (const row of index.byCode.get(w) ?? []) byWord.add(row);
  if (byWord.size > 0) {
    // Other words on the line (a colour, a brand) narrow a model down to one of its variants.
    const tokens = queryTokens(line.key);
    const narrowed = [...byWord].filter((row) => {
      const text = searchHaystack(row);
      const compact = foldCode(text);
      return tokens.every((t) => text.includes(t) || compact.includes(foldCode(t)));
    });
    return pick(narrowed.length > 0 ? narrowed : [...byWord]);
  }

  const tokens = queryTokens(line.key);
  if (tokens.length === 0) return { kind: "none" };
  return pick(index.all.filter((p) => tokens.every((t) => p.text.includes(t))).map((p) => p.row));
}

/** The catalogue as a sheet to edit elsewhere and paste back: id, name, code, price - tab-separated. */
export function exportPriceList(rows: readonly PriceRow[]): string {
  const clean = (s: string): string => s.replace(/[\t\r\n]+/g, " ").trim();
  const lines = rows.map((r) => [`#${String(r.id)}`, clean(r.displayName), clean(r.sku ?? r.modelCode ?? ""), String(r.price)].join("\t"));
  return ["کد پنل\tنام کالا\tکد کالا\tقیمت (تومان)", ...lines].join("\n");
}
