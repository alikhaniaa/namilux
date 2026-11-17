import { products, inArray } from "@namilux/db";
import type { Db } from "@namilux/db";
import type { Actor } from "../types";
import type { ProductQuery } from "./list";
import { appError } from "../errors";
import { audit } from "../audit";
import { jobs } from "../jobs";
import { bulkPriceSchema } from "../validation";
import { dedupeTags, tagsForProductChange } from "../cache/invalidation";
import { descendantIds } from "./categories";
import { collectionProductIds } from "./collections";
import {
  type AdminProductFilter,
  adminProductIds,
  insertPriceHistory,
  priceRowsForIds,
  productIdsByBrand,
  productIdsInCategories,
  updatePrice,
} from "./products.repo";

export type BulkPriceScope =
  | { kind: "brand"; id: number }
  | { kind: "category"; id: number }
  | { kind: "collection"; id: number }
  | { kind: "selection"; ids: number[] }
  | { kind: "filter"; query: ProductQuery };

// DECISION (M0 step 3): BulkPriceOp / BulkPricePreview / BulkPriceResult are declared once in ../types
// (BulkPriceOp is z.infer'd from ../validation/catalog-admin.bulkPriceSchema), and `roundToman` is
// owned by ../money/totals.ts - money/ is the module that owns every Toman arithmetic.
import type { BulkPriceOp, BulkPricePreview, BulkPriceResult } from "../types";
import { roundToman } from "../money/totals";

export type { BulkPriceOp, BulkPricePreview, BulkPriceResult };
export { roundToman };

// The arithmetic is pure and lives in ./price-ops, where the admin's client screens can reach it too.
import { applyOperation } from "./price-ops";
import type { BulkPriceOperation, PriceState } from "./price-ops";

export { applyOperation, planPrice, typedPrice, isPriceJump, priceChangePercent, PRICE_JUMP_RATIO } from "./price-ops";
export type { BulkPriceOperation, PriceState, SkipReason } from "./price-ops";

export type BulkPriceRow = {
  id: number;
  displayName: string;
  before: PriceState;
  after: PriceState;
  saleEnded: boolean;
};

export const BULK_SELECTION_MAX = 2_000;

/** BulkPriceOp (validation) → the internal BulkPriceOperation applyOperation consumes. */
function toOperation(op: BulkPriceOp): BulkPriceOperation {
  const target: BulkPriceOperation["target"] =
    op.applyTo === "compare_at" ? "compareAt" : op.applyTo === "both" ? "both" : "price";
  const inner = op.op;
  if (inner.kind === "round") return { op: "round", value: 0, target, round: inner.to };
  return { op: inner.kind, value: inner.value, target, round: null };
}

// DECISION (M5): the exported `BulkPriceScope` (this file's stub contract) uses `{kind:"filter"; query}`,
// but the DECIDED `bulkPriceSchema` (validation) uses `{kind:"filter"; filter: productFilterSchema}`.
// `bulkPrice` takes `BulkPriceOp` (= z.infer of the schema), so the internal scope type is derived
// from it - the drifted export stays for source compatibility.
type OpScope = BulkPriceOp["scope"];

function filterScopeToAdmin(f: Extract<OpScope, { kind: "filter" }>): AdminProductFilter {
  const q = f.filter as {
    brandIds?: number[];
    categoryIds?: number[];
    collectionIds?: number[];
    status?: ("draft" | "active" | "archived")[];
    stockState?: AdminProductFilter["stockState"];
    priceState?: AdminProductFilter["priceState"];
    missing?: AdminProductFilter["missing"][];
    modelId?: number;
    q?: string;
  };
  return {
    ...(q.brandIds?.[0] === undefined ? {} : { brandId: q.brandIds[0] }),
    ...(q.categoryIds === undefined ? {} : { categoryIds: q.categoryIds }),
    ...(q.collectionIds?.[0] === undefined ? {} : { collectionId: q.collectionIds[0] }),
    ...(q.status?.[0] === undefined ? {} : { status: q.status[0] }),
    ...(q.stockState === undefined ? {} : { stockState: q.stockState }),
    ...(q.priceState === undefined ? {} : { priceState: q.priceState }),
    ...(q.missing?.[0] === undefined ? {} : { missing: q.missing[0] }),
    ...(q.modelId === undefined ? {} : { modelId: q.modelId }),
    ...(q.q === undefined ? {} : { q: q.q }),
  };
}

async function resolveScopeIds(db: Db, scope: OpScope): Promise<number[]> {
  switch (scope.kind) {
    case "brand":
      return productIdsByBrand(db, scope.id);
    case "category": {
      const kids = await descendantIds(db, scope.id);
      return productIdsInCategories(db, [scope.id, ...kids]);
    }
    case "collection":
      return collectionProductIds(db, scope.id);
    case "selection":
      if (scope.ids.length > BULK_SELECTION_MAX) throw appError("VALIDATION", { details: { field: "ids", max: BULK_SELECTION_MAX } });
      return scope.ids;
    case "filter":
      return adminProductIds(db, filterScopeToAdmin(scope));
  }
}

export async function bulkPrice(
  db: Db,
  op: BulkPriceOp,
  actor: Actor,
  dryRun: boolean,
): Promise<BulkPricePreview | BulkPriceResult> {
  const parsed = bulkPriceSchema.safeParse(op);
  if (!parsed.success) throw appError("VALIDATION", { details: parsed.error.issues });
  const operation = toOperation(op);
  const note = op.note?.trim() === "" ? null : (op.note ?? null);

  const ids = await resolveScopeIds(db, op.scope);
  const rows = await priceRowsForIds(db, ids);

  const changed: BulkPriceRow[] = [];
  const skipped: BulkPricePreview["skipped"] = [];
  for (const row of rows) {
    if (row.priceBasis === "fx") {
      skipped.push({ id: row.id, displayName: row.displayName, reason: "fx_basis" }); // rules: fx rows are skipped
      continue;
    }
    const result = applyOperation({ price: row.price, compareAt: row.compareAtPrice }, operation);
    if ("skip" in result) {
      skipped.push({ id: row.id, displayName: row.displayName, reason: result.skip });
      continue;
    }
    changed.push({ id: row.id, displayName: row.displayName, before: { price: row.price, compareAt: row.compareAtPrice }, after: result.after, saleEnded: result.saleEnded });
  }

  if (dryRun) {
    return { dryRun: true, count: changed.length, rows: changed, skipped };
  }

  const noteText = note ?? `bulk:${operation.op}`;
  // Both checkout methods use this main selling price. Legacy price columns remain for rollback.
  await db.transaction(async (tx) => {
    // Lock in a stable order and verify the exact preview before writing any price.
    // This also protects against concurrent changes between the initial read and this transaction.
    const current = changed.length === 0 ? [] : await tx.select({ id: products.id, price: products.price, compareAt: products.compareAtPrice, basis: products.priceBasis, status: products.status })
      .from(products).where(inArray(products.id, changed.map((c) => c.id))).orderBy(products.id).for("update");
    const expected = op.expected === undefined ? null : new Map(op.expected.map((r) => [r.id, r]));
    if (expected !== null && (expected.size !== op.expected?.length || expected.size !== changed.length || op.scope.kind !== "selection" || op.scope.ids.length !== expected.size)) {
      throw appError("CONFLICT", { fa: "فهرست کالاها تغییر کرده است. دوباره پیش‌نمایش بگیرید." });
    }
    const currentById = new Map(current.map((r) => [r.id, r]));
    for (const c of changed) {
      const row = currentById.get(c.id);
      const before = expected?.get(c.id) ?? (expected === null ? c.before : undefined);
      if (row === undefined || before === undefined || row.status === "archived" || row.basis === "fx" || row.price !== before.price || row.compareAt !== before.compareAt || row.price !== c.before.price || row.compareAt !== c.before.compareAt) {
        throw appError("CONFLICT", { fa: "قیمت کالاها پس از پیش‌نمایش تغییر کرده است. دوباره پیش‌نمایش بگیرید." });
      }
    }
    for (const c of changed) {
      await updatePrice(tx, c.id, c.after.price, c.after.compareAt);
      await insertPriceHistory(tx, { productId: c.id, price: c.after.price, compareAtPrice: c.after.compareAt, actor, note: noteText });
    }
    await audit.log(tx, actor, "catalog.price.bulk", "products", op.scope.kind, undefined, {
      operation: op.op,
      applyTo: op.applyTo,
      count: changed.length,
    });
  });

  const tags = dedupeTags(
    changed.flatMap((c) => tagsForProductChange({ id: c.id, categoryIds: [], brandId: null, collectionIds: [] }, "price")),
  );
  const jobId = await jobs.enqueue(db, "cache.revalidate", { tags });
  const purgeId = await jobs.enqueue(db, "cdn.purge", { tags });
  return { dryRun: false, updated: changed.length, skipped: skipped.length, tags, jobIds: [jobId, purgeId] };
}
