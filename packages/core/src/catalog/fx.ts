import { type Db, and, eq, products, sql } from "@namilux/db";
import { audit } from "../audit";
import { tags } from "../cache/tags";
import type { BaseCurrency } from "../constants";
import type { Actor } from "../types";
import { getSettings } from "../settings/service";
import { instalmentsRule } from "../pricing/instalments";
import { insertPriceHistory, updatePrice } from "./products.repo";

export type FxInput = { baseCurrency: BaseCurrency; rate: number; rounding: 0 | 10_000 | 100_000 };
export type FxRow = { id: number; displayName: string; basePrice: number; before: number; after: number };

/** How many live products take their price from an exchange rate - zero for a shop that prices in Toman only. */
export async function countFxProducts(db: Db): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(products)
    .where(and(eq(products.priceBasis, "fx"), sql`${products.status} <> 'archived'`));
  return Number(row?.n ?? 0);
}

export function fxPrice(basePrice: number, rate: number, rounding: FxInput["rounding"]): number {
  const raw = basePrice * rate;
  if (rounding === 0) return Math.round(raw);
  return Math.round(raw / rounding) * rounding;
}

export async function fxRecompute(db: Db, input: FxInput, actor: Actor, dryRun: boolean): Promise<{ rows: FxRow[]; changed: number; tags: string[] }> {
  const candidates = await db
    .select({ id: products.id, displayName: products.displayName, basePrice: products.basePrice, price: products.price, compareAt: products.compareAtPrice })
    .from(products)
    .where(and(eq(products.priceBasis, "fx"), eq(products.baseCurrency, input.baseCurrency), sql`${products.status} <> 'archived'`, sql`${products.basePrice} is not null`));
  const rows: FxRow[] = candidates
    .map((c) => {
      const base = Number(c.basePrice ?? 0);
      return { id: c.id, displayName: c.displayName, basePrice: base, before: c.price, after: fxPrice(base, input.rate, input.rounding) };
    })
    .filter((r) => r.basePrice > 0);
  const changed = rows.filter((r) => r.after !== r.before);
  if (dryRun) return { rows, changed: changed.length, tags: [] };

  // FX moves the fixed price, so it moves the derived instalment one with it (updatePrice leaves
  // the rows a human pinned alone).
  const rule = instalmentsRule(await getSettings(db));
  for (const r of changed) {
    const compareAt = candidates.find((c) => c.id === r.id)?.compareAt ?? null;
    // A stale compare-at below the new price is not a sale: drop it (the spec sale iff compare_at > price).
    const nextCompare = compareAt !== null && compareAt > r.after ? compareAt : null;
    await updatePrice(db, r.id, r.after, nextCompare, rule);
    await insertPriceHistory(db, { productId: r.id, price: r.after, compareAtPrice: nextCompare, actor, note: `fx ${input.baseCurrency} ${String(input.rate)}` });
  }
  await audit.log(db, actor, "product.fx.recompute", "products", "*", null, { baseCurrency: input.baseCurrency, rate: input.rate, rounding: input.rounding, changed: changed.length });
  return { rows, changed: changed.length, tags: changed.length === 0 ? [] : [tags.catalog, ...changed.map((r) => tags.product(r.id))] };
}
