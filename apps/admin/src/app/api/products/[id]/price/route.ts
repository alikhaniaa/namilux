import { appError, setPrice, setPriceSchema, tags } from "@namilux/core";
import { adminHandler } from "@/lib/http-handler";
import { db } from "@/lib/db";

export const PUT = adminHandler({
  schema: setPriceSchema,
  permission: "catalog.price",
  run: async ({ input, params, staff, ip }) => {
    const id = Number(params.id);
    if (!Number.isInteger(id) || id <= 0) throw appError("VALIDATION", { details: { field: "id" } });
    await setPrice(db, id, input.price, input.compareAtPrice, { type: "staff", id: staff.id, ip }, input.note);
    return { ok: true, revalidate: [tags.product(id), tags.catalog, tags.home] };
  },
});
