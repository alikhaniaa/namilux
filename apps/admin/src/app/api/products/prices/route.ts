import { listPriceSheet, priceEditSchema, priceSheetSchema, savePriceSheet, tags } from "@namilux/core";
import { adminHandler } from "@/lib/http-handler";
import { db } from "@/lib/db";

export const GET = adminHandler({
  permission: "catalog.price",
  run: async () => ({ rows: await listPriceSheet(db) }),
});

/**
 * A hand edit: the few rows a person just typed, each carrying the price it was typed over. It asks
 * for what /api/products/[id]/price asks - the pricing permission, no second factor - because it is
 * the same act, and it is capped (PRICE_EDIT_MAX) so it cannot stand in for the bulk save below.
 * The product pages named in the response are refreshed at once; the rest follows from the queue.
 */
export const PATCH = adminHandler({
  permission: "catalog.price",
  schema: priceEditSchema,
  run: async ({ input, staff, ip }) => {
    const result = await savePriceSheet(db, input, { type: "staff", id: staff.id, ip });
    if (result.updated === 0) return { updated: 0 };
    return { updated: result.updated, revalidate: [...input.rows.map((r) => tags.product(r.id)), tags.catalog, tags.home] };
  },
});

/** A bulk save - a formula's result or a pasted list: the bulk permission and a fresh second factor. */
export const PUT = adminHandler({
  permission: "catalog.bulk",
  schema: priceSheetSchema,
  bodyCap: 1024 * 1024,
  run: async ({ input, staff, ip }) => {
    const result = await savePriceSheet(db, input, { type: "staff", id: staff.id, ip });
    return { updated: result.updated, revalidate: [tags.catalog, tags.home] };
  },
});
