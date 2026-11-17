import { readFile } from "node:fs/promises";
import { parse } from "csv-parse/sync";
import { extractPath } from "./paths.js";
import { toPath } from "../transform/slugs.js";

export type RedirectSeed = { from: string; to: string; code: 301 | 410; reason: string };
export type InventoryRow = {
  path: string;
  type: "product" | "page/post" | "category" | "brand";
  status: number;
  action: string;
  newUrl: string | null;
};

export const FIXED_REDIRECTS: readonly RedirectSeed[] = [
  { from: "/checkout/", to: "/billing/", code: 301, reason: "the spec courtesy — /checkout/ 404s on the live site" },
  { from: "/my-account/", to: "/account/", code: 301, reason: "the spec accounts moved" },
  { from: "/my-account/orders/", to: "/account/orders/", code: 301, reason: "the spec" },
  { from: "/my-account/edit-address/", to: "/account/addresses/", code: 301, reason: "the spec" },
  { from: "/my-account/edit-account/", to: "/account/", code: 301, reason: "the spec" },
  { from: "/my-account/payment-methods/", to: "/account/", code: 301, reason: "the spec" },
  { from: "/my-account/downloads/", to: "/account/", code: 301, reason: "the spec" },
  { from: "/my-account/customer-logout/", to: "/account/", code: 301, reason: "the spec" },
  { from: "/category/بلاگ/", to: "/blog/", code: 301, reason: "the spec existing live 301, kept" },
  { from: "/category/محصولات-اسمگ/", to: "/brand/smeg/", code: 301, reason: "the spec existing live 301, kept (category row archived)" },
  { from: "/locations.kml", to: "", code: 410, reason: "the spec GMB artefact" },
  { from: "/تست/", to: "/", code: 301, reason: "staging test page (v1 unmatched list)" },
];

export const MY_ACCOUNT_FALLBACK = "/account/";

export const STATIC_SERVED_PATHS: readonly string[] = [
  "/",
  "/shop/",
  "/blog/",
  "/cart/",
  "/billing/",
  "/compare/",
  "/wishlist/",
  "/discount/",
  "/new/",
  "/gifts/",
  "/track/",
  "/search/",
  "/offline/",
  "/account/",
  "/ig/",
];

const INVENTORY_TYPES: readonly InventoryRow["type"][] = ["product", "page/post", "category", "brand"];

/** WooCommerce default archive base; this site serves /category/ instead. */
const WOO_CATEGORY_BASE = "/product-category/";
const CATEGORY_BASE = "/category/";
const MY_ACCOUNT_BASE = "/my-account/";

export function productCategoryCourtesy(categories: { path: string }[]): RedirectSeed[] {
  const out: RedirectSeed[] = [];
  const seen = new Set<string>();
  for (const c of categories) {
    if (!c.path.startsWith(CATEGORY_BASE)) continue;
    const from = WOO_CATEGORY_BASE + c.path.slice(CATEGORY_BASE.length);
    if (seen.has(from)) continue;
    seen.add(from);
    out.push({
      from,
      to: c.path,
      code: 301,
      reason: "courtesy — WooCommerce default archive base",
    });
  }
  return out;
}

function withTrailingSlash(p: string): string {
  return p.endsWith("/") ? p : `${p}/`;
}

export function servedPaths(i: {
  productSlugs: string[];
  categoryPaths: string[];
  brandSlugs: string[];
  postSlugs: string[];
  publishedPageSlugs: string[];
}): Set<string> {
  const out = new Set<string>(STATIC_SERVED_PATHS);
  for (const slug of i.productSlugs) out.add(`/product/${slug}/`);
  for (const slug of i.brandSlugs) out.add(`/brand/${slug}/`);
  for (const slug of i.postSlugs) out.add(`/${slug}/`);
  for (const slug of i.publishedPageSlugs) out.add(`/${slug}/`);
  for (const p of i.categoryPaths) {
    // DECISION: accept both the full decoded URL path ("/category/a/b/") and the DB form ("a/b"),
    // because the spec stores the latter - the caller should not have to remember which one to pass.
    out.add(p.startsWith("/") ? withTrailingSlash(p) : `${CATEGORY_BASE}${p.replace(/^\/+|\/+$/g, "")}/`);
  }
  return out;
}

function inventoryType(raw: string | undefined): InventoryRow["type"] {
  const v = (raw ?? "").trim() as InventoryRow["type"];
  // DECISION: an unrecognised `type` degrades to "page/post"; the column is descriptive and the
  // redirect decision is taken from the path prefix, never from it.
  return INVENTORY_TYPES.includes(v) ? v : "page/post";
}

export async function readInventory(dir: string): Promise<InventoryRow[]> {
  const buf = await readFile(extractPath(dir, "inventoryCsv"));
  const rows: Record<string, string | undefined>[] = parse(buf, { columns: true, bom: true, relax_column_count: true });
  const out: InventoryRow[] = [];
  for (const r of rows) {
    const raw = (r["path"] ?? "").trim() || (r["old_url"] ?? "").trim();
    if (!raw) continue;
    out.push({
      path: toPath(raw),
      type: inventoryType(r["type"]),
      status: Number(r["status"]) || 0,
      action: (r["action"] ?? "").trim(),
      newUrl: (r["new_url"] ?? "").trim() || null,
    });
  }
  return out;
}

export function computeRedirects(i: {
  inventory: InventoryRow[];
  served: Set<string>;
  categories: { path: string }[];
}): { redirects: RedirectSeed[]; unmatched: string[] } {
  const redirects: RedirectSeed[] = [];
  const seen = new Set<string>();
  const push = (r: RedirectSeed): void => {
    if (r.from === r.to) return;
    if (seen.has(r.from)) return;
    seen.add(r.from);
    redirects.push(r);
  };

  for (const r of FIXED_REDIRECTS) push(r);
  for (const r of productCategoryCourtesy(i.categories)) push(r);

  const knownCategoryPaths = new Set(i.categories.map((c) => c.path));
  const unmatched: string[] = [];

  for (const row of i.inventory) {
    const from = row.path;
    if (seen.has(from)) continue;
    if (i.served.has(from)) continue;
    if (from === MY_ACCOUNT_BASE || from.startsWith(MY_ACCOUNT_BASE)) {
      push({ from, to: MY_ACCOUNT_FALLBACK, code: 301, reason: "the spec my-account fallback" });
      continue;
    }
    if (from.startsWith(CATEGORY_BASE)) {
      push({
        from,
        to: "/shop/",
        code: 301,
        reason: knownCategoryPaths.has(from)
          ? "category not served"
          : "category not served (absent from categories.csv)",
      });
      continue;
    }
    if (from.startsWith("/product/")) {
      push({ from, to: "/shop/", code: 301, reason: "product not served" });
      continue;
    }
    if (from.startsWith("/brand/")) {
      push({ from, to: "/shop/", code: 301, reason: "brand not served" });
      continue;
    }
    // Never blanket-redirect to "/" the way v1 did: the M0 gate requires unmatched = 0, so every
    // remaining case has to be named in FIXED_REDIRECTS by a human.
    unmatched.push(from);
  }

  return { redirects, unmatched };
}
