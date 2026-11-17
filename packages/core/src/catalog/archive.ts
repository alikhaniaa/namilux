import { type Db, and, backInStockRequests, brands, categories, eq, redirects } from "@namilux/db";
import type { Actor } from "../types";
import { appError, isAppError } from "../errors";
import { audit } from "../audit";
import { jobs } from "../jobs";
import { tags } from "../cache/tags";
import { brandUrl, categoryUrl, decPath, productUrl } from "../url";
import { insertRedirect, resolveFinalTarget, servesLivePath } from "../content/redirects";
import { ancestorIds, descendantIds } from "./categories";
import { findAdminRow, findBySlug, setProductStatus } from "./products.repo";

// DECISION (M5): the model-primary recompute (rules: "removed from product_models primary … re-runs
// for the group") is DEFERRED. `models.pickPrimaryVariant` is pure but persisting a new primary needs
// a product_models write helper the package does not expose (same gap products.service.ts recorded
// for the model key). The storefront filters archived rows, so a primary pointing at an archived
// product is not surfaced; `groupModels` re-runs the pick.

const TARGET_NOT_LIVE_FA = "مقصد ریدایرکت وجود ندارد";

export function redirectTargetForProduct(p: { primaryCategoryPath: string | null; brandSlug: string | null }): string {
  if (p.primaryCategoryPath !== null && p.primaryCategoryPath.trim() !== "") return decPath(categoryUrl(p.primaryCategoryPath));
  if (p.brandSlug !== null && p.brandSlug.trim() !== "") return decPath(brandUrl(p.brandSlug));
  return "/shop/";
}

export function redirectTargetForCategory(c: { parentPath: string | null }): string {
  if (c.parentPath !== null && c.parentPath.trim() !== "") return decPath(categoryUrl(c.parentPath));
  return "/shop/";
}

export function redirectTargetForBrand(): "/shop/" {
  return "/shop/";
}

export function redirectTargetForPost(): "/blog/" {
  return "/blog/";
}

export function validateRedirectTarget(fromPath: string, toPath: string): void {
  const bad = (reason: string): never => {
    throw appError("VALIDATION", { details: { field: "toPath", reason } });
  };
  if (!toPath.startsWith("/")) bad("not_site_relative");
  if (!toPath.endsWith("/")) bad("no_trailing_slash");
  if (toPath.includes("?") || toPath.includes("#")) bad("has_query_or_fragment");
  if (toPath.length > 512) bad("too_long");
  if (toPath === fromPath) bad("from_equals_to");
}

/** Resolve, loop-check and liveness-check a redirect target; returns the final live path. */
async function prepareTarget(db: Db, fromPath: string, target: string): Promise<string> {
  validateRedirectTarget(fromPath, target);
  const final = await resolveFinalTarget(db, target);
  if (final === fromPath) throw appError("VALIDATION", { details: { reason: "redirect_loop", path: fromPath } });
  if (!(await servesLivePath(db, final))) throw appError("VALIDATION", { fa: TARGET_NOT_LIVE_FA, details: { path: final } });
  return final;
}

/** Insert an auto_archive redirect; an existing row for from_path (manual or prior) is left untouched. */
async function insertAutoArchiveRedirect(db: Db, fromPath: string, toPath: string, actor: Actor): Promise<void> {
  try {
    await insertRedirect(db, { fromPath, toPath, code: 301, source: "auto_archive" }, actor);
  } catch (e) {
    if (!(isAppError(e) && e.code === "CONFLICT")) throw e;
  }
}

const PRODUCT_TAGS = (id: number): string[] => [tags.product(id), tags.catalog, tags.home, tags.nav, tags.sitemap];

export async function archiveProduct(db: Db, id: number, redirectTo: string | null, actor: Actor): Promise<void> {
  const before = await findAdminRow(db, id);
  if (before === null) throw appError("NOT_FOUND", { details: { productId: id } });
  if (before.status === "archived") return; // idempotent - no second redirect row

  const full = await findBySlug(db, before.slug, { includeArchived: true });
  const primaryCat =
    full?.categories.find((c) => c.isPrimary && c.status !== "archived") ??
    full?.categories.find((c) => c.status !== "archived") ??
    null;
  const fromPath = decPath(productUrl(before.slug));
  const target = await prepareTarget(
    db,
    fromPath,
    redirectTo ?? redirectTargetForProduct({ primaryCategoryPath: primaryCat?.path ?? null, brandSlug: full?.brand?.slug ?? null }),
  );

  await db.transaction(async (tx) => {
    await setProductStatus(tx, id, "archived");
    await tx
      .update(backInStockRequests)
      .set({ status: "cancelled" })
      .where(and(eq(backInStockRequests.productId, id), eq(backInStockRequests.status, "waiting")));
    await insertAutoArchiveRedirect(tx, fromPath, target, actor);
    await audit.log(tx, actor, "catalog.product.archive", "products", String(id), { status: before.status }, { status: "archived", redirectTo: target });
  });

  const revalidate = PRODUCT_TAGS(id);
  await jobs.enqueue(db, "cache.revalidate", { tags: revalidate });
  await jobs.enqueue(db, "cdn.purge", { tags: revalidate });
}

export async function archiveCategory(db: Db, id: number, redirectTo: string | null, actor: Actor): Promise<{ archivedIds: number[] }> {
  const rows = await db
    .select({ id: categories.id, path: categories.path, status: categories.status, parentId: categories.parentId })
    .from(categories)
    .where(eq(categories.id, id))
    .limit(1);
  const top = rows[0];
  if (top === undefined) throw appError("NOT_FOUND", { details: { categoryId: id } });
  if (top.status === "archived") return { archivedIds: [] };

  // Nearest non-archived ancestor path (the top's default target); children share the same live target.
  const ancestors = await ancestorIds(db, id);
  let parentPath: string | null = null;
  for (const ancestorId of ancestors) {
    const [row] = await db
      .select({ path: categories.path, status: categories.status })
      .from(categories)
      .where(eq(categories.id, ancestorId))
      .limit(1);
    if (row !== undefined && row.status !== "archived") {
      parentPath = row.path;
      break;
    }
  }
  const fromTop = decPath(categoryUrl(top.path));
  const target = await prepareTarget(db, fromTop, redirectTo ?? redirectTargetForCategory({ parentPath }));

  const subtree = await descendantIds(db, id); // id + descendants, any status except archived
  const archivedIds: number[] = [];
  const revalidate = new Set<string>([tags.catalog, tags.home, tags.nav, tags.sitemap]);

  await db.transaction(async (tx) => {
    for (const catId of subtree) {
      const [cat] = await tx
        .select({ path: categories.path, status: categories.status })
        .from(categories)
        .where(eq(categories.id, catId))
        .limit(1);
      if (cat === undefined || cat.status === "archived") continue;
      await tx.update(categories).set({ status: "archived" }).where(eq(categories.id, catId));
      const fromPath = decPath(categoryUrl(cat.path));
      if (fromPath !== target) await insertAutoArchiveRedirect(tx, fromPath, target, actor);
      archivedIds.push(catId);
      revalidate.add(tags.category(catId));
    }
    await audit.log(tx, actor, "catalog.category.archive", "categories", String(id), undefined, { archivedIds, redirectTo: target });
  });

  const list = [...revalidate];
  await jobs.enqueue(db, "cache.revalidate", { tags: list });
  await jobs.enqueue(db, "cdn.purge", { tags: list });
  return { archivedIds };
}

export async function archiveBrand(db: Db, id: number, redirectTo: string | null, actor: Actor): Promise<void> {
  const [brand] = await db
    .select({ id: brands.id, slug: brands.slug, isActive: brands.isActive })
    .from(brands)
    .where(eq(brands.id, id))
    .limit(1);
  if (brand === undefined) throw appError("NOT_FOUND", { details: { brandId: id } });
  if (!brand.isActive) return; // already archived (the spec: brands have no status enum)

  const fromPath = decPath(brandUrl(brand.slug));
  const target = await prepareTarget(db, fromPath, redirectTo ?? redirectTargetForBrand());

  await db.transaction(async (tx) => {
    await tx.update(brands).set({ isActive: false }).where(eq(brands.id, id));
    await insertAutoArchiveRedirect(tx, fromPath, target, actor);
    await audit.log(tx, actor, "catalog.brand.archive", "brands", String(id), { isActive: true }, { isActive: false, redirectTo: target });
  });

  const revalidate = [tags.brand(id), tags.catalog, tags.home, tags.nav, tags.sitemap];
  await jobs.enqueue(db, "cache.revalidate", { tags: revalidate });
  await jobs.enqueue(db, "cdn.purge", { tags: revalidate });
}

export async function unarchiveProduct(db: Db, id: number, actor: Actor): Promise<void> {
  const before = await findAdminRow(db, id);
  if (before === null) throw appError("NOT_FOUND", { details: { productId: id } });
  if (before.status !== "archived") return;

  const fromPath = decPath(productUrl(before.slug));
  await db.transaction(async (tx) => {
    await setProductStatus(tx, id, "draft"); // admin must re-activate deliberately
    await tx
      .update(redirects)
      .set({ isActive: false })
      .where(and(eq(redirects.fromPath, fromPath), eq(redirects.source, "auto_archive")));
    await audit.log(tx, actor, "catalog.product.unarchive", "products", String(id), { status: "archived" }, { status: "draft" });
  });

  const revalidate = PRODUCT_TAGS(id);
  await jobs.enqueue(db, "cache.revalidate", { tags: revalidate });
  await jobs.enqueue(db, "cdn.purge", { tags: revalidate });
}
