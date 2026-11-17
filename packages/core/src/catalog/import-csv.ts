import type { Db } from "@namilux/db";
import type { Actor } from "../types";
import type { ProductQuery } from "./list";
import { appError } from "../errors";
import { enDigits, faZwnj } from "../persian";
import { audit } from "../audit";
import { dedupeTags, tagsForProductChange } from "../cache/invalidation";
import { formatToman } from "../persian/format";
import { getBrandBySlug } from "./brands";
import { findAdminRow, queryAdmin } from "./products.repo";
import { adjustStock, setPrice } from "./products.service";

export const CSV_COLUMNS = [
  "id",
  "slug",
  "display_name",
  "name",
  "brand_slug",
  "sku",
  "model_code",
  "color_name",
  "color_hex",
  "status",
  "visibility",
  "price",
  "compare_at_price",
  "stock_policy",
  "stock_qty",
  "allow_backorder",
  "low_stock_threshold",
  "max_per_order",
  "warranty_months",
  "warranty_text",
  "weight_g",
  "length_mm",
  "width_mm",
  "height_mm",
  "seo_title",
  "seo_description",
  "robots",
  "categories",
  "collections",
] as const;

export type CsvColumn = (typeof CSV_COLUMNS)[number];

// DECISION (M5): this file's contract defines `RawCsvRow = Record<string,string>` (raw cells) and a rich
// `CsvImportReport` (total/skipped/errors:number/rows/tags), but ../types re-declares both from the
// single-product `csvRowSchema` (a typed object) and a slimmer report. The raw parser needs the
// Record shape and the dry-run UI needs the rich report, so both are defined here per the header.
//
export type RawCsvRow = Record<string, string>;
export type CsvImportReport = {
  dryRun: boolean;
  total: number;
  created: number;
  updated: number;
  skipped: number;
  errors: number;
  rows: ImportRowResult[];
  tags: string[];
};

export const IMPORT_MAX_ROWS = 2_000;

export type ParsedRow = {
  line: number;
  id: number | null;
  slug: string | null;
  fields: Partial<Record<CsvColumn, string | number | boolean | null>>;
  errors: string[];
};

export type RowAction = "create" | "update" | "skip" | "error";

export type ImportRowResult = {
  line: number;
  id: number | null;
  slug: string | null;
  action: RowAction;
  changes: Record<string, { before: unknown; after: unknown }>;
  errors: string[];
};

export type ExportRow = Record<CsvColumn, string>;

/** RFC 4180 parser (pure): BOM stripped, CRLF/LF, "" escapes inside quotes, trailing blank line ignored. */
export function parseCsv(text: string): { header: string[]; rows: RawCsvRow[] } {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let inQuotes = false;
  let i = 0;
  const pushField = (): void => {
    record.push(field);
    field = "";
  };
  const pushRecord = (): void => {
    pushField();
    records.push(record);
    record = [];
  };
  while (i < src.length) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += c;
      i += 1;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (c === ",") {
      pushField();
      i += 1;
      continue;
    }
    if (c === "\r") {
      if (src[i + 1] === "\n") i += 1;
      pushRecord();
      i += 1;
      continue;
    }
    if (c === "\n") {
      pushRecord();
      i += 1;
      continue;
    }
    field += c;
    i += 1;
  }
  if (field !== "" || record.length > 0) pushRecord();

  const header = (records.shift() ?? []).map((h) => h.trim());
  const rows: RawCsvRow[] = records
    .filter((r) => !(r.length === 1 && r[0] === ""))
    .map((r) => {
      const obj: RawCsvRow = {};
      header.forEach((h, idx) => {
        obj[h] = r[idx] ?? "";
      });
      return obj;
    });
  return { header, rows };
}

const NUMERIC_COLS = new Set<CsvColumn>([
  "price",
  "compare_at_price",
  "stock_qty",
  "low_stock_threshold",
  "max_per_order",
  "warranty_months",
  "weight_g",
  "length_mm",
  "width_mm",
  "height_mm",
]);
const TEXT_COLS = new Set<CsvColumn>(["display_name", "name", "color_name"]);
const BOOL_COLS = new Set<CsvColumn>(["allow_backorder"]);

export function normalizeRow(row: RawCsvRow, line: number): ParsedRow {
  const fields: ParsedRow["fields"] = {};
  const errors: string[] = [];
  for (const col of CSV_COLUMNS) {
    const raw = (row[col] ?? "").trim();
    if (raw === "") continue; // empty cell = unchanged
    if (NUMERIC_COLS.has(col)) {
      const n = Number(enDigits(raw).replace(/[٬,]/g, ""));
      if (!Number.isFinite(n)) errors.push(`«${col}» عدد نیست`);
      else fields[col] = Math.trunc(n);
    } else if (BOOL_COLS.has(col)) {
      fields[col] = raw === "1" || raw.toLowerCase() === "true" || raw === "بله";
    } else if (TEXT_COLS.has(col)) {
      fields[col] = faZwnj(raw);
    } else {
      fields[col] = raw;
    }
  }
  const idRaw = (row.id ?? "").trim();
  const id = idRaw === "" ? null : Number(enDigits(idRaw));
  return {
    line,
    id: id !== null && Number.isInteger(id) ? id : null,
    slug: (row.slug ?? "").trim() === "" ? null : (row.slug ?? "").trim(),
    fields,
    errors,
  };
}

/**
 * DECISION (M5): the apply path implements the highest-value CSV operations - price change (setPrice
 * → price_history), stock delta (adjustStock → movement), and identity/validation - plus dry-run diff.
 * Scalar-field and category/collection membership updates via CSV need a partial product updater that
 * the package does not expose (upsertProduct requires the full ProductAdminInput); those cells are
 * reported as unsupported for updates and left unchanged.
 */
export async function importCsv(db: Db, rows: RawCsvRow[], actor: Actor, dryRun: boolean): Promise<CsvImportReport> {
  if (rows.length > IMPORT_MAX_ROWS) throw appError("VALIDATION", { fa: "تعداد ردیف‌ها بیش از حد مجاز است", details: { max: IMPORT_MAX_ROWS } });

  const results: ImportRowResult[] = [];
  const touched: number[] = [];

  for (let idx = 0; idx < rows.length; idx += 1) {
    const parsed = normalizeRow(rows[idx] ?? {}, idx + 2); // +2: header is line 1
    const changes: ImportRowResult["changes"] = {};
    const rowErrors = [...parsed.errors];

    if (parsed.id === null && parsed.slug === null) {
      results.push({ line: parsed.line, id: null, slug: null, action: "error", changes, errors: ["شناسه یا نامک لازم است"] });
      continue;
    }
    if (parsed.fields.status === "archived") rowErrors.push("بایگانی از طریق CSV مجاز نیست؛ از ابزار بایگانی استفاده کنید");

    const existing = parsed.id !== null ? await findAdminRow(db, parsed.id) : null;
    if (parsed.id !== null && existing === null) {
      results.push({ line: parsed.line, id: parsed.id, slug: parsed.slug, action: "error", changes, errors: ["شناسه ناشناخته است"] });
      continue;
    }
    if (existing !== null && parsed.slug !== null && parsed.slug !== existing.slug) {
      rowErrors.push("نامک محصول از طریق CSV تغییر نمی‌کند");
    }
    if (parsed.fields.brand_slug !== undefined) {
      const brand = await getBrandBySlug(db, String(parsed.fields.brand_slug));
      if (brand === null) rowErrors.push("برند ناشناخته است");
    }

    if (existing === null) {
      // create requires slug + display_name (03/09); left as a report-only action here (create needs
      // the full ProductAdminInput; the admin uses the product form for new products).
      if (parsed.slug === null || parsed.fields.display_name === undefined) rowErrors.push("ایجاد نیازمند نامک و نام نمایشی است");
      results.push({ line: parsed.line, id: null, slug: parsed.slug, action: rowErrors.length > 0 ? "error" : "create", changes, errors: rowErrors });
      continue;
    }

    // price diff
    const newPrice = parsed.fields.price;
    const newCompare = parsed.fields.compare_at_price;
    if (typeof newPrice === "number" || typeof newCompare === "number") {
      const price = typeof newPrice === "number" ? newPrice : existing.price;
      const compareAt = typeof newCompare === "number" ? newCompare : existing.compareAtPrice;
      if (existing.priceBasis === "fx") rowErrors.push("قیمت ردیف ارزی از طریق CSV تغییر نمی‌کند");
      else if (compareAt !== null && !(price > 0 && compareAt > price)) rowErrors.push("قیمت قبل باید بیشتر از قیمت باشد");
      else if (price !== existing.price || compareAt !== existing.compareAtPrice) {
        changes.price = { before: formatToman(existing.price), after: formatToman(price) };
      }
    }
    // stock delta
    if (typeof parsed.fields.stock_qty === "number" && parsed.fields.stock_qty !== existing.stockQty) {
      changes.stock_qty = { before: existing.stockQty, after: parsed.fields.stock_qty };
    }

    const action: RowAction = rowErrors.length > 0 ? "error" : Object.keys(changes).length === 0 ? "skip" : "update";
    results.push({ line: parsed.line, id: existing.id, slug: existing.slug, action, changes, errors: rowErrors });
    if (action === "update") touched.push(existing.id);
  }

  const errorCount = results.filter((r) => r.action === "error").length;
  const report: CsvImportReport = {
    dryRun,
    total: rows.length,
    created: results.filter((r) => r.action === "create").length,
    updated: results.filter((r) => r.action === "update").length,
    skipped: results.filter((r) => r.action === "skip").length,
    errors: errorCount,
    rows: results,
    tags: dedupeTags(touched.flatMap((id) => tagsForProductChange({ id, categoryIds: [], brandId: null, collectionIds: [] }, "price"))),
  };

  // rules: any row error aborts apply; partial imports are not allowed.
  if (dryRun || errorCount > 0) return report;

  await db.transaction(async (tx) => {
    for (let idx = 0; idx < rows.length; idx += 1) {
      const r = results[idx];
      if (r === undefined || r.action !== "update" || r.id === null) continue;
      const parsed = normalizeRow(rows[idx] ?? {}, idx + 2);
      const existing = await findAdminRow(tx, r.id);
      if (existing === null) continue;
      if ("price" in r.changes) {
        const price = typeof parsed.fields.price === "number" ? parsed.fields.price : existing.price;
        const compareAt = typeof parsed.fields.compare_at_price === "number" ? parsed.fields.compare_at_price : existing.compareAtPrice;
        // A CSV price change goes through `setPrice`, which is also what re-derives the instalment
        // price (and leaves a pinned one alone) - the import needs no rule of its own.
        await setPrice(tx, r.id, price, compareAt, actor, "csv import");
      }
      if ("stock_qty" in r.changes && typeof parsed.fields.stock_qty === "number") {
        await adjustStock(tx, r.id, parsed.fields.stock_qty - existing.stockQty, "adjust", actor);
      }
    }
    await audit.log(tx, actor, "catalog.import.csv", "products", "csv", undefined, {
      total: report.total,
      updated: report.updated,
      created: report.created,
    });
  });
  return report;
}

const CSV_QUOTE_RE = /[",\r\n]/;
function csvCell(v: string): string {
  return CSV_QUOTE_RE.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function toCsv(rows: ExportRow[]): string {
  const BOM = String.fromCharCode(0xfeff);
  const header = CSV_COLUMNS.join(",");
  const body = rows.map((r) => CSV_COLUMNS.map((c) => csvCell(r[c] ?? "")).join(","));
  return `${BOM}${[header, ...body].join("\r\n")}\r\n`;
}

export async function exportCsv(db: Db, q: ProductQuery): Promise<string> {
  const rows: ExportRow[] = [];
  let page = 1;
  // Walk every page of the admin list (200/page).
  for (;;) {
    const { rows: pageRows, total } = await queryAdmin(db, { ...(q.scope.slug === undefined ? {} : { q: q.scope.slug }), page, pageSize: 200 });
    for (const p of pageRows) {
      const row = Object.fromEntries(CSV_COLUMNS.map((c) => [c, ""])) as ExportRow;
      row.id = String(p.id);
      row.slug = p.slug;
      row.display_name = p.displayName;
      row.brand_slug = p.brandName ?? "";
      row.model_code = p.modelCode ?? "";
      row.status = p.status;
      row.visibility = p.visibility;
      row.price = String(p.price);
      row.compare_at_price = p.compareAtPrice === null ? "" : String(p.compareAtPrice);
      row.stock_qty = String(p.stockQty);
      rows.push(row);
    }
    if (page * 200 >= total || pageRows.length === 0) break;
    page += 1;
  }
  return toCsv(rows);
}
