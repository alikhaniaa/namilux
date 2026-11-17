import { z } from "zod";
import { appError, markProductUnavailable, tags } from "@namilux/core";
import { adminHandler } from "@/lib/http-handler";
import { db } from "@/lib/db";

export const PUT = adminHandler({
  schema: z.object({}).strict(),
  permission: "catalog.write",
  run: async ({ params, staff, ip }) => {
    const id = Number(params.id);
    if (!Number.isSafeInteger(id) || id <= 0) throw appError("VALIDATION");
    await markProductUnavailable(db, id, { type: "staff", id: staff.id, ip });
    return { ok: true, revalidate: [tags.product(id), tags.catalog, tags.home, tags.search, tags.sitemap] };
  },
});
