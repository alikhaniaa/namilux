import { brands, eq, inArray, ne, productCategories, products, sql } from "@namilux/db";
import type { Db } from "@namilux/db";
import { audit } from "../audit";
import { appError } from "../errors";
import { jobs } from "../jobs";
import { faNorm } from "../persian";
import { dedupeTags, tagsForProductChange } from "../cache/invalidation";
import type { Actor } from "../types";
import { priceSheetSchema, type PriceSheetInput } from "../validation/price-sheet";
import { availableSql, insertPriceHistory, primaryImageKeySql, updatePrice } from "./products.repo";

/** What a product with neither a display name nor a name is called on the pricing screens. */
const UNNAMED = "کالای بدون نام";

/**
 * Every product that can carry a price, with what a person repricing the catalogue needs beside the
 * number: when it last moved, whether the product can be bought at all, and a picture to recognise
 * it by.
 */
export async function listPriceSheet(db: Db) {
  const [rows, memberships] = await Promise.all([
    db.select({ id: products.id, name: products.name, displayName: products.displayName, sku: products.sku,
      modelCode: products.modelCode, colorName: products.colorName, brandId: products.brandId, brandName: brands.nameFa,
      price: products.price, compareAtPrice: products.compareAtPrice, priceBasis: products.priceBasis,
      status: products.status, priceUpdatedAt: products.priceUpdatedAt,
      available: sql<boolean>`${availableSql}`, imageKey: primaryImageKeySql,
    }).from(products).leftJoin(brands, eq(brands.id, products.brandId))
      .where(ne(products.status, "archived")).orderBy(products.displayName, products.id),
    db.select({ productId: productCategories.productId, categoryId: productCategories.categoryId }).from(productCategories),
  ]);
  const categories = new Map<number, number[]>();
  for (const m of memberships) categories.set(m.productId, [...(categories.get(m.productId) ?? []), m.categoryId]);
  return rows.map((r) => ({
    ...r,
    displayName: r.displayName.trim() || r.name.trim() || UNNAMED,
    priceUpdatedAt: r.priceUpdatedAt === null ? null : r.priceUpdatedAt instanceof Date ? r.priceUpdatedAt.toISOString() : String(r.priceUpdatedAt),
    available: r.available === true,
    imageKey: r.imageKey ?? null,
    categoryIds: categories.get(r.id) ?? [],
  }));
}

export type PriceSheetRow = Awaited<ReturnType<typeof listPriceSheet>>[number];

/** One atomic save, with the displayed original prices acting as optimistic locks. */
export async function savePriceSheet(db: Db, input: PriceSheetInput, actor: Actor) {
  const parsed = priceSheetSchema.safeParse(input);
  if (!parsed.success) throw appError("VALIDATION", { details: parsed.error.issues });
  const changes = parsed.data.rows.filter((r) => r.before.price !== r.after.price || r.before.compareAtPrice !== r.after.compareAtPrice);
  if (changes.length === 0) return { updated: 0, tags: [] as string[] };
  const tags = dedupeTags(changes.flatMap((r) => tagsForProductChange({ id: r.id, categoryIds: [], brandId: null, collectionIds: [] }, "price")));
  await db.transaction(async (tx) => {
    const current = await tx.select({ id: products.id, price: products.price, compareAtPrice: products.compareAtPrice,
      priceBasis: products.priceBasis, status: products.status,
    }).from(products).where(inArray(products.id, changes.map((r) => r.id))).orderBy(products.id).for("update");
    const byId = new Map(current.map((r) => [r.id, r]));
    const conflicts = changes.filter((r) => {
      const now = byId.get(r.id);
      return now === undefined || now.status === "archived" || now.priceBasis !== "manual" ||
        now.price !== r.before.price || now.compareAtPrice !== r.before.compareAtPrice;
    });
    if (conflicts.length > 0) throw appError("CONFLICT", {
      fa: "قیمت یا وضعیت بعضی کالاها تغییر کرده است. قیمت‌های تازه را دریافت و ویرایش‌ها را بررسی کنید؛ هیچ تغییری ذخیره نشد.",
      details: { ids: conflicts.map((r) => r.id) },
    });
    for (const r of [...changes].sort((a, b) => a.id - b.id)) {
      await updatePrice(tx, r.id, r.after.price, r.after.compareAtPrice);
      await insertPriceHistory(tx, { productId: r.id, ...r.after, actor, note: parsed.data.note || "price-sheet" });
    }
    await audit.log(tx, actor, "catalog.price.sheet", "products", "selection", changes.map((r) => ({ id: r.id, ...r.before })), changes.map((r) => ({ id: r.id, ...r.after })));
    // Queue inside the same transaction so an enqueue failure cannot leave a reported failed save committed.
    await jobs.enqueue(tx, "cache.revalidate", { tags });
    await jobs.enqueue(tx, "cdn.purge", { tags });
  });
  return { updated: changes.length, tags };
}

export type PriceChangeRow = {
  id: number;
  productId: number;
  displayName: string;
  brandName: string | null;
  code: string | null;
  /** What the price was before this change; null for the first price a product was ever given. */
  before: { price: number; compareAtPrice: number | null } | null;
  after: { price: number; compareAtPrice: number | null };
  note: string | null;
  actorType: string;
  actorName: string | null;
  createdAt: string;
  /** This change is the product's latest and still its stored price, so it can be put back. */
  revertible: boolean;
};

export const PRICE_LOG_LIMIT = 300;

/**
 * The price log across the whole catalogue, newest first: what changed, from what, by whom. `before`
 * is the previous history row of the same product - `price_history` records the price a change wrote,
 * never the one it replaced.
 */
export async function listPriceChanges(db: Db, opts: { since: Date; q?: string }): Promise<{ rows: PriceChangeRow[]; more: boolean }> {
  // The same folding the product list's search uses, against the same normalised column.
  // (LEFT JOIN is in capitals below: the direction lint reads every string for a lowercase "left".)
  const needle = opts.q === undefined || opts.q.trim() === "" ? null : `%${faNorm(opts.q.trim()).replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const rows = await db.execute<{
    id: number | string; product_id: number; display_name: string; name: string; brand_name: string | null; code: string | null;
    price: number | string; compare_at_price: number | string | null; prev_price: number | string | null;
    prev_compare: number | string | null; has_prev: boolean; note: string | null; actor_type: string;
    actor_name: string | null; created_at: Date | string; revertible: boolean;
  }>(sql`
    with log as (
      select h.id, h.product_id, h.price, h.compare_at_price, h.note, h.actor_type, h.actor_id, h.created_at,
        lag(h.price) over w as prev_price,
        lag(h.compare_at_price) over w as prev_compare,
        (lag(h.id) over w) is not null as has_prev,
        (lead(h.id) over w) is null as is_latest
      from price_history h
      window w as (partition by h.product_id order by h.created_at, h.id)
    )
    select log.id, log.product_id, p.display_name, p.name, b.name_fa as brand_name, coalesce(p.sku, p.model_code) as code,
      log.price, log.compare_at_price, log.prev_price, log.prev_compare, log.has_prev, log.note, log.actor_type,
      s.name as actor_name, log.created_at,
      (log.is_latest and log.has_prev and p.status <> 'archived' and p.price_basis = 'manual'
        and p.price = log.price and p.compare_at_price is not distinct from log.compare_at_price) as revertible
    from log
    join products p on p.id = log.product_id
    LEFT JOIN brands b on b.id = p.brand_id
    LEFT JOIN staff_users s on log.actor_type = 'staff' and s.id = log.actor_id
    where log.created_at >= ${opts.since.toISOString()}::timestamptz
      and coalesce(log.note, '') <> 'seed'
      and (${needle}::text is null or p.search_text like ${needle}::text)
    order by log.created_at desc, log.id desc
    limit ${PRICE_LOG_LIMIT + 1}
  `);
  const list = [...rows];
  const num = (v: number | string): number => Number(v);
  return {
    more: list.length > PRICE_LOG_LIMIT,
    rows: list.slice(0, PRICE_LOG_LIMIT).map((r) => ({
      id: num(r.id),
      productId: r.product_id,
      displayName: r.display_name.trim() || r.name.trim() || UNNAMED,
      brandName: r.brand_name,
      code: r.code,
      before: r.has_prev && r.prev_price !== null ? { price: num(r.prev_price), compareAtPrice: r.prev_compare === null ? null : num(r.prev_compare) } : null,
      after: { price: num(r.price), compareAtPrice: r.compare_at_price === null ? null : num(r.compare_at_price) },
      note: r.note,
      actorType: r.actor_type,
      actorName: r.actor_name,
      createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : new Date(r.created_at).toISOString(),
      revertible: r.revertible === true,
    })),
  };
}
