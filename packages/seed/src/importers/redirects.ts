import { redirects as redirectsTable, sql } from "@namilux/db";
import type { SeedContext } from "../context.js";
import { readLegacyCategories } from "../extract/categories.js";
import { readLegacyPages, PUBLISHED_PAGE_SLUGS } from "../extract/pages.js";
import { readLegacyPosts } from "../extract/posts.js";
import { readLegacyProducts } from "../extract/products.js";
import { computeRedirects, readInventory, servedPaths, type RedirectSeed } from "../extract/redirects.js";
import { readLegacyBrands } from "../extract/brands.js";
import { inChunks } from "../idempotency.js";
import { warn } from "../report.js";

const CHUNK = 200;
/** A chain longer than this is a cycle; the resolver stops and keeps the last hop. */
const MAX_HOPS = 8;

/**
 * rules: never chains. A → B → C is stored as A → C, so a client never pays two round trips and the
 * contract check never sees a 301 pointing at a 301.
 */
export function resolveChains(redirects: readonly RedirectSeed[]): RedirectSeed[] {
  const byFrom = new Map(redirects.map((r) => [r.from, r]));
  return redirects.map((r) => {
    if (r.code === 410) return r;
    let to = r.to;
    const seen = new Set<string>([r.from]);
    for (let hop = 0; hop < MAX_HOPS; hop += 1) {
      const next = byFrom.get(to);
      if (next === undefined || next.code === 410 || seen.has(to)) break;
      seen.add(to);
      to = next.to;
    }
    return to === r.to ? r : { ...r, to };
  });
}

export async function run(ctx: SeedContext): Promise<void> {
  // EDGE CASE (extract/redirects): `served` is built from the FULL catalogue even under --limit - 
  // a product the run skipped would still be served by a full seed and must not gain a redirect.
  const [inventory, categoriesRead, brands, posts, pagesRead, productsRead] = await Promise.all([
    readInventory(ctx.extractDir),
    readLegacyCategories(ctx.extractDir),
    readLegacyBrands(ctx.extractDir),
    readLegacyPosts(ctx.extractDir),
    readLegacyPages(ctx.extractDir),
    readLegacyProducts(ctx.extractDir, { limit: null }),
  ]);

  const served = servedPaths({
    productSlugs: productsRead.products.map((p) => p.slug),
    categoryPaths: categoriesRead.categories.map((c) => c.path),
    brandSlugs: brands.map((b) => b.slug),
    postSlugs: posts.posts.map((p) => p.slug),
    // Only published pages serve 200; the archived ones are routes or redirects (extract/pages rules).
    publishedPageSlugs: pagesRead.pages.filter((p) => p.publish).map((p) => p.slug),
  });
  for (const slug of PUBLISHED_PAGE_SLUGS) served.add(`/${slug}/`);

  const computed = computeRedirects({
    inventory,
    served,
    categories: categoriesRead.categories.map((c) => ({ path: c.path })),
  });
  const rows = resolveChains(computed.redirects);

  ctx.report.unmatchedContractPaths = computed.unmatched;
  ctx.report.redirects = rows.length;
  ctx.report.redirects410 = rows.filter((r) => r.code === 410).length;

  if (!ctx.dry) {
    await inChunks(rows, CHUNK, async (chunk) => {
      await ctx.db.transaction(async (tx) => {
        await tx
          .insert(redirectsTable)
          .values(
            chunk.map((r) => ({
              fromPath: r.from,
              // 410 rows carry an empty target (extract/redirects EDGE CASE).
              toPath: r.to,
              code: r.code,
              source: "legacy" as const,
              isActive: true,
            })),
          )
          .onConflictDoUpdate({
            target: redirectsTable.fromPath,
            // `hits`/`last_hit_at` belong to the router, never to the seed.
            set: {
              toPath: sql`excluded.to_path`,
              code: sql`excluded.code`,
              source: sql`excluded.source`,
              isActive: sql`excluded.is_active`,
            },
          });
      });
    });
  }

  if (computed.unmatched.length > 0) {
    for (const path of computed.unmatched) warn(ctx.report, `contract path neither served nor redirected: ${path}`);
    // rules (extract/redirects): every inventory path is served or redirected - an unmatched one is a
    // human decision (a FIXED_REDIRECTS entry), never a blanket redirect to "/".
    throw new Error(
      `${computed.unmatched.length} contract paths are neither served nor redirected; add them to FIXED_REDIRECTS: ${computed.unmatched
        .slice(0, 10)
        .join(", ")}`,
    );
  }

  ctx.log.info(
    { redirects: ctx.report.redirects, gone: ctx.report.redirects410, unmatched: computed.unmatched.length },
    "redirects stage done",
  );
}
