import { z } from "zod";
import { STOCK_RESTORE_MAX, appError, markProductAvailable, tags } from "@namilux/core";
import { adminHandler } from "@/lib/http-handler";
import { db } from "@/lib/db";

export const PUT = adminHandler({
  schema: z.object({ qty: z.number().int().min(1).max(STOCK_RESTORE_MAX) }).strict(),
  permission: "catalog.write",
  run: async ({ input, params, staff, ip }) => {
    const id = Number(params.id);
    if (!Number.isSafeInteger(id) || id <= 0) throw appError("VALIDATION");
    await markProductAvailable(db, id, input.qty, { type: "staff", id: staff.id, ip });
    return { ok: true, revalidate: [tags.product(id), tags.catalog, tags.home, tags.search, tags.sitemap] };
  },
});
