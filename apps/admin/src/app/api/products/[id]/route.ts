import { appError, assertMayWriteCost, can, channelScope, getProductAdmin, productAdminSchema, redactProductAdminView, upsertProduct } from "@namilux/core";
import { adminHandler } from "@/lib/http-handler";
import { assertMayWritePrice } from "@/lib/product-price-permission";
import { db } from "@/lib/db";

function productId(params: Record<string, string>): number {
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) throw appError("VALIDATION", { details: { field: "id" } });
  return id;
}

export const GET = adminHandler({
  permission: "catalog.read",
  run: async ({ params, staff }) => {
    const view = await getProductAdmin(db, productId(params));
    if (view === null || (channelScope(staff) === "instalments" && !view.row.instalmentEligible)) throw appError("NOT_FOUND", { details: { entity: "product" } });
    // The purchase price never leaves the server for a reader without `catalog.cost`, whether the
    // caller is the product page hydrating a form or a hand-made request.
    return redactProductAdminView(view, can(staff, "catalog.cost"));
  },
});

export const PUT = adminHandler({
  schema: productAdminSchema,
  permission: "catalog.write",
  bodyCap: 256 * 1024,
  run: async ({ input, params, staff, ip }) => {
    // A `costPrice` key from staff without `catalog.cost` is refused, never silently dropped; an
    // absent key preserves the stored cost (core: writeValuesFor).
    assertMayWriteCost(staff, input);
    const id = productId(params);
    // The URL id is the product being written, so it is also the row the comparison reads. A
    // conflicting `input.id` in the body never decides which stored values the payload is judged
    // against - `upsertProduct` below receives the URL id regardless.
    const view = await getProductAdmin(db, id);
    if (view === null) throw appError("NOT_FOUND", { details: { entity: "product" } });
    // Only `catalog.price` may move a commercial value - the same permission the separate
    // /api/products/[id]/price route asserts. A payload whose price values did not change (text,
    // images, specs) passes for every role that holds `catalog.write`.
    assertMayWritePrice(staff, input, view.row);
    const { id: saved, tags } = await upsertProduct(db, { ...input, id }, { type: "staff", id: staff.id, ip });
    return { id: saved, tags, revalidate: tags };
  },
});
