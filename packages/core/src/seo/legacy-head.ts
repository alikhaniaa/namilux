import { desc, eq, seoSnapshots } from "@namilux/db";
import type { Db } from "@namilux/db";
import { decPath } from "../url/encode";

export type LegacyHead = {
  title: string | null;
  description: string | null;
  robots: string | null;
  canonical: string | null;
};

const orNull = (v: string | null): string | null => (v === null || v === "" ? null : v);

export async function getLegacyHead(db: Db, path: string): Promise<LegacyHead | null> {
  // DECISION: decode before the lookup. Routes build their paths with `encPath` (lowercase percent
  // encoding, the spec) while the importer stores the decoded form, so comparing raw would miss
  // every non-ASCII route - `/تست/` among the ten.
  const wanted = decPath(path);

  const rows = await db
    .select({
      title: seoSnapshots.title,
      description: seoSnapshots.description,
      robots: seoSnapshots.robots,
      canonical: seoSnapshots.canonical,
    })
    .from(seoSnapshots)
    .where(eq(seoSnapshots.path, wanted))
    .orderBy(desc(seoSnapshots.crawledAt))
    .limit(1);

  const row = rows[0];
  if (row === undefined) return null;
  return {
    title: orNull(row.title),
    description: orNull(row.description),
    robots: orNull(row.robots),
    canonical: orNull(row.canonical),
  };
}
