import {
  brands as brandsTable,
  categories as categoriesTable,
  eq,
  pages as pagesTable,
  posts as postsTable,
  products as productsTable,
  seoSnapshots as seoSnapshotsTable,
  sql,
} from "@namilux/db";
import type { SeedContext } from "../context.js";
import { EXTRACT_META } from "../extract/paths.js";
import {
  STATIC_SEO_ROUTES,
  readSeoLive,
  readSitemap,
  seoFieldsFor,
  snapshotRows,
} from "../extract/seo.js";
import { inChunks } from "../idempotency.js";
import { warn } from "../report.js";

export type EntityKind = "product" | "category" | "brand" | "post" | "page" | "static";

/** One crawl = one run id; derived from the extract stamp so a re-seed never duplicates it. */
export const SNAPSHOT_RUN_ID = `legacy-${EXTRACT_META.extractedAt}`;

const CHUNK = 200;
const STATIC = new Set<string>(STATIC_SEO_ROUTES);

export function entityForPath(path: string): { kind: EntityKind; key: string } | null {
  const p = (path ?? "").trim();
  if (!p.startsWith("/")) return null;
  if (STATIC.has(p)) return { kind: "static", key: p };
  if (p.startsWith("/product/")) {
    const slug = p.slice("/product/".length).replace(/\/+$/, "");
    return slug ? { kind: "product", key: slug } : null;
  }
  if (p.startsWith("/category/")) {
    const dbPath = p.slice("/category/".length).replace(/\/+$/, "");
    return dbPath ? { kind: "category", key: dbPath } : null;
  }
  if (p.startsWith("/brand/")) {
    const slug = p.slice("/brand/".length).replace(/\/+$/, "");
    return slug ? { kind: "brand", key: slug } : null;
  }
  const segments = p.split("/").filter(Boolean);
  // DECISION: posts and pages share the root namespace and a bare path cannot tell them
  // apart, so a single root segment reports "post" - the 150:15 majority - and `run` resolves it
  // against posts first and pages second. The pure function stays dependency-free, as the contract
  // requires; nothing downstream keys on the returned kind alone.
  if (segments.length === 1 && !segments[0]?.includes(".")) return { kind: "post", key: segments[0] as string };
  return null;
}

type SeoTriple = { seoTitle: string | null; seoDescription: string | null; robots: string };

// Verbatim: no trim beyond the CSV reader's, no ZWNJ, no title-suffix surgery - 
// `run()` below builds the triple inline from seoFieldsFor().

function same(a: SeoTriple, b: SeoTriple): boolean {
  return a.seoTitle === b.seoTitle && a.seoDescription === b.seoDescription && a.robots === b.robots;
}

export async function run(ctx: SeedContext): Promise<void> {
  const [live, sitemap] = await Promise.all([readSeoLive(ctx.extractDir), readSitemap(ctx.extractDir)]);

  const [products, categories, brands, posts, pages] = await Promise.all([
    ctx.db
      .select({
        key: productsTable.slug,
        seoTitle: productsTable.seoTitle,
        seoDescription: productsTable.seoDescription,
        robots: productsTable.robots,
      })
      .from(productsTable),
    ctx.db
      .select({
        key: categoriesTable.path,
        seoTitle: categoriesTable.seoTitle,
        seoDescription: categoriesTable.seoDescription,
        robots: categoriesTable.robots,
      })
      .from(categoriesTable),
    ctx.db
      .select({
        key: brandsTable.slug,
        seoTitle: brandsTable.seoTitle,
        seoDescription: brandsTable.seoDescription,
        robots: brandsTable.robots,
      })
      .from(brandsTable),
    ctx.db
      .select({
        key: postsTable.slug,
        seoTitle: postsTable.seoTitle,
        seoDescription: postsTable.seoDescription,
        robots: postsTable.robots,
      })
      .from(postsTable),
    ctx.db
      .select({
        key: pagesTable.slug,
        seoTitle: pagesTable.seoTitle,
        seoDescription: pagesTable.seoDescription,
        robots: pagesTable.robots,
      })
      .from(pagesTable),
  ]);

  const index: Record<Exclude<EntityKind, "static">, Map<string, SeoTriple>> = {
    product: new Map(products.map((r) => [r.key, r])),
    category: new Map(categories.map((r) => [r.key, r])),
    brand: new Map(brands.map((r) => [r.key, r])),
    post: new Map(posts.map((r) => [r.key, r])),
    page: new Map(pages.map((r) => [r.key, r])),
  };
  const table = {
    product: productsTable,
    category: categoriesTable,
    brand: brandsTable,
    post: postsTable,
    page: pagesTable,
  } as const;
  const column = {
    product: productsTable.slug,
    category: categoriesTable.path,
    brand: brandsTable.slug,
    post: postsTable.slug,
    page: pagesTable.slug,
  } as const;

  let applied = 0;
  let written = 0;
  let missingDescription = 0;
  let noindex = 0;
  let staticRoutes = 0;
  const unknown: string[] = [];

  for (const row of live.values()) {
    if (!row.description) missingDescription += 1;
    if (row.robots.includes("noindex")) noindex += 1;
    // The 2 live-301ed paths and the 5 brand 404s never donate their head to an entity.
    if (row.redirected || row.status === 404) continue;

    const target = entityForPath(row.path);
    if (target === null) {
      unknown.push(row.path);
      continue;
    }
    if (target.kind === "static") {
      staticRoutes += 1;
      continue;
    }

    const order: Exclude<EntityKind, "static">[] =
      target.kind === "post" ? ["post", "page"] : [target.kind];
    const hit = order.find((k) => index[k].has(target.key));
    if (hit === undefined) {
      unknown.push(row.path);
      continue;
    }
    applied += 1;

    const current = index[hit].get(target.key) as SeoTriple;
    const fields = seoFieldsFor(row.path, live, sitemap);
    const desired: SeoTriple = {
      seoTitle: fields.seoTitle,
      seoDescription: fields.seoDescription,
      robots: fields.robots,
    };
    if (same(current, desired)) continue;
    written += 1;
    if (!ctx.dry) {
      await ctx.db.update(table[hit]).set(desired).where(eq(column[hit], target.key));
    }
    index[hit].set(target.key, desired);
  }

  for (const path of unknown) warn(ctx.report, `seo_live path serves no entity: ${path}`);
  if (staticRoutes > 0) {
    // DECISION: the verbatim head of the 10 static routes has nowhere to live - `settings["seo.defaults"]`
    // is typed { titleTemplate, defaultOgKey, siteName } in core and would strip a `routes` key. The
    // snapshot rows below keep them as the parity baseline.
    warn(ctx.report, `${staticRoutes} static-route head rows kept only as snapshots (settings["seo.defaults"] has no routes key)`);
  }

  const snapshots = snapshotRows(live, EXTRACT_META.extractedAt);
  const already = await ctx.db
    .select({ n: sql<number>`count(*)::int` })
    .from(seoSnapshotsTable)
    .where(eq(seoSnapshotsTable.runId, SNAPSHOT_RUN_ID));
  const haveRun = (already[0]?.n ?? 0) > 0;
  if (!haveRun && !ctx.dry) {
    // seo_snapshots has no unique key: idempotency is "this crawl id is already stored".
    await inChunks(snapshots, CHUNK, async (chunk) => {
      await ctx.db.transaction(async (tx) => {
        await tx.insert(seoSnapshotsTable).values(
          chunk.map((s) => ({
            runId: SNAPSHOT_RUN_ID,
            path: s.path,
            status: live.get(s.path)?.status ?? null,
            title: s.title,
            description: s.description,
            canonical: s.canonical,
            robots: s.robots,
            h1: live.get(s.path)?.h1 ?? null,
            schemaTypes: s.schemaTypes,
            crawledAt: new Date(s.crawledAt),
          })),
        );
      });
    });
  }

  ctx.report.seoRowsApplied = applied;
  ctx.report.seoSnapshots = snapshots.length;
  ctx.report.seoMissingDescription = missingDescription;
  ctx.report.seoNoindex = noindex;

  ctx.log.info(
    { applied, written, snapshots: snapshots.length, unknown: unknown.length, staticRoutes },
    "seo stage done",
  );
}
