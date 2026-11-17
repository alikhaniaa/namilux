import { z } from "zod";
import { appError, archiveProduct, tags, unarchiveProduct } from "@namilux/core";
import { adminHandler } from "@/lib/http-handler";
import { db } from "@/lib/db";

const bodySchema = z
  .object({ redirectTo: z.string().max(512).nullable().optional(), unarchive: z.boolean().optional() })
  .strict();

export const POST = adminHandler({
  schema: bodySchema,
  permission: "catalog.write",
  run: async ({ input, params, staff, ip }) => {
    const id = Number(params.id);
    if (!Number.isInteger(id) || id <= 0) throw appError("VALIDATION", { details: { field: "id" } });
    const actor = { type: "staff" as const, id: staff.id, ip };
    if (input.unarchive === true) await unarchiveProduct(db, id, actor);
    else await archiveProduct(db, id, input.redirectTo ?? null, actor);
    return { ok: true, revalidate: [tags.product(id), tags.catalog, tags.home, tags.sitemap] };
  },
});
