import { type Db, brands, categories, collections, desc, pages, posts, products, seoSnapshots, sql } from "@namilux/db";

export async function latestSnapshotRun(db: Db): Promise<{ runId: string; at: string; paths: number; non200: number; missingTitle: number } | null> {
  const last = await db.select({ runId: seoSnapshots.runId, at: sql<Date>`max(${seoSnapshots.crawledAt})` }).from(seoSnapshots).groupBy(seoSnapshots.runId).orderBy(desc(sql`max(${seoSnapshots.crawledAt})`)).limit(1);
  const run = last[0];
  if (run === undefined) return null;
  const stats = await db
    .select({
      paths: sql<number>`count(*)::int`,
      non200: sql<number>`count(*) filter (where ${seoSnapshots.status} is not null and ${seoSnapshots.status} <> 200)::int`,
      missingTitle: sql<number>`count(*) filter (where coalesce(${seoSnapshots.title}, '') = '')::int`,
    })
    .from(seoSnapshots)
    .where(sql`${seoSnapshots.runId} = ${run.runId}`);
  const s = stats[0];
  return { runId: run.runId, at: new Date(run.at).toISOString(), paths: Number(s?.paths ?? 0), non200: Number(s?.non200 ?? 0), missingTitle: Number(s?.missingTitle ?? 0) };
}

export async function sitemapCounts(db: Db): Promise<{ products: number; categories: number; brands: number; collections: number; posts: number; pages: number }> {
  const count = async (q: Promise<{ n: number }[]>): Promise<number> => Number((await q)[0]?.n ?? 0);
  const [p, c, b, co, po, pa] = await Promise.all([
    count(db.select({ n: sql<number>`count(*)::int` }).from(products).where(sql`${products.status} = 'active' and ${products.visibility} = 'public'`)),
    count(db.select({ n: sql<number>`count(*)::int` }).from(categories).where(sql`${categories.status} = 'active' and ${categories.inSitemap}`)),
    count(db.select({ n: sql<number>`count(*)::int` }).from(brands).where(sql`${brands.isActive}`)),
    count(db.select({ n: sql<number>`count(*)::int` }).from(collections).where(sql`${collections.status} = 'active'`)),
    count(db.select({ n: sql<number>`count(*)::int` }).from(posts).where(sql`${posts.status} = 'published'`)),
    count(db.select({ n: sql<number>`count(*)::int` }).from(pages).where(sql`${pages.status} = 'published'`)),
  ]);
  return { products: p, categories: c, brands: b, collections: co, posts: po, pages: pa };
}
