import { assertMayWriteCost, channelScope, listAdmin, productAdminSchema, upsertProduct } from "@namilux/core";
import type { AdminProductFilter, AdminSort } from "@namilux/core";
import { adminHandler } from "@/lib/http-handler";
import { assertMayWritePrice } from "@/lib/product-price-permission";
import { db } from "@/lib/db";

const SORTS = new Set<AdminSort>(["updated", "price_asc", "price_desc", "name", "stock_asc"]);

function parseFilter(u: URL): AdminProductFilter {
  const s = u.searchParams;
  const int = (k: string): number | undefined => {
    const v = s.get(k);
    if (v === null) return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };
  const sortRaw = s.get("sort");
  const f: AdminProductFilter = {};
  const q = s.get("q");
  if (q !== null && q.trim() !== "") f.q = q;
  const brandId = int("brandId");
  if (brandId !== undefined) f.brandId = brandId;
  const categoryId = int("categoryId");
  if (categoryId !== undefined) f.categoryIds = [categoryId];
  const collectionId = int("collectionId");
  if (collectionId !== undefined) f.collectionId = collectionId;
  const status = s.get("status");
  if (status === "draft" || status === "active" || status === "archived") f.status = status;
  const stock = s.get("stockState");
  if (stock === "in" || stock === "out" || stock === "low" || stock === "backorder") f.stockState = stock;
  const price = s.get("priceState");
  if (price === "priced" || price === "on_request" || price === "sale") f.priceState = price;
  const missing = s.get("missing");
  if (missing === "image" || missing === "description" || missing === "spec" || missing === "seo") f.missing = missing;
  if (sortRaw !== null && SORTS.has(sortRaw as AdminSort)) f.sort = sortRaw as AdminSort;
  const page = int("page");
  if (page !== undefined) f.page = page;
  const pageSize = int("pageSize");
  if (pageSize !== undefined) f.pageSize = pageSize;
  return f;
}

export const GET = adminHandler({
  permission: "catalog.read",
  run: ({ req, staff }) => {
    const filter = parseFilter(new URL(req.url));
    // Confined to the instalment site: the products it may sell, nothing else.
    if (channelScope(staff) === "instalments") filter.instalmentEligible = true;
    return listAdmin(db, filter);
  },
});

export const POST = adminHandler({
  schema: productAdminSchema,
  permission: "catalog.write",
  bodyCap: 256 * 1024,
  run: async ({ input, staff, ip }) => {
    // Same rule as the update path: only `catalog.cost` may post a purchase price.
    assertMayWriteCost(staff, input);
    // POST is the CREATE route, and `productAdminSchema` carries an optional `id` only because PUT
    // reuses the schema. A body id would make `upsertProduct` write an EXISTING row while the guard
    // below judges a fresh product, so a hand-made `{ id: <priced product>, price: 0, … }` could
    // zero a stored price through the neutral-create door. Dropping it keeps the comparison and the
    // write looking at the same product: the URL id is the update route's id, never this one's.
    const { id: _spoofedId, ...create } = input;
    // Without `catalog.price` a staff member may still create a product, but only one that says
    // nothing commercial: the unpriced default. Every value the separate price route guards - 
    // price, compareAtPrice, the instalment price and its manual pin, the price basis with its FX
    // inputs, instalment eligibility - is refused here too, so POST is not a way around it.
    assertMayWritePrice(staff, create, null);
    const { id, tags } = await upsertProduct(db, create, { type: "staff", id: staff.id, ip });
    return { id, tags, revalidate: tags };
  },
});
