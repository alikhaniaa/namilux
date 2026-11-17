import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { jobs, ogKeyFor, tags, ulid } from "@namilux/core";
import type { OgTarget } from "@namilux/core";
import { brands, categories, collections, eq, media, posts, products } from "@namilux/db";
import { ogCard } from "@namilux/seed/images/og-card";
import type { OgKind } from "@namilux/seed/images/og-card";
import type { Handler } from "../runtime";
import { throwIfAborted } from "../runtime";

const OG_W = 1200;
const OG_H = 630;
const SITE_LABEL = "نامی‌لوکس";

const OG_KIND: Record<OgTarget["kind"], OgKind> = {
  product: "product",
  brand: "brand",
  collection: "collection",
  category: "collection",
  post: "site",
  site: "site",
};

async function labelFor(db: Parameters<Handler>[0]["db"], t: OgTarget): Promise<string> {
  const one = async (rows: Promise<{ v: string | null }[]>): Promise<string> => (await rows)[0]?.v ?? SITE_LABEL;
  switch (t.kind) {
    case "product":
      return one(db.select({ v: products.displayName }).from(products).where(eq(products.id, t.id)).limit(1));
    case "brand":
      return one(db.select({ v: brands.nameFa }).from(brands).where(eq(brands.id, t.id)).limit(1));
    case "collection":
      return one(db.select({ v: collections.name }).from(collections).where(eq(collections.id, t.id)).limit(1));
    case "category":
      return one(db.select({ v: categories.name }).from(categories).where(eq(categories.id, t.id)).limit(1));
    case "post":
      return one(db.select({ v: posts.title }).from(posts).where(eq(posts.slug, t.slug)).limit(1));
    case "site":
      return SITE_LABEL;
  }
}

function tagFor(t: OgTarget): string {
  switch (t.kind) {
    case "product":
      return tags.product(t.id);
    case "brand":
      return tags.brand(t.id);
    case "collection":
      return tags.collection(t.id);
    case "category":
      return tags.category(t.id);
    case "post":
      return tags.post(t.slug);
    case "site":
      return tags.home;
  }
}

export const ogGenerate: Handler = async ({ db, env, log, job, signal }) => {
  const t = job.payload as OgTarget;
  if (typeof t?.kind !== "string") {
    log.warn({ jobId: job.id }, "og-generate: bad target");
    return;
  }
  const key = ogKeyFor(t);
  const label = await labelFor(db, t);
  // Nothing is written before the card is composited, so this is the one checkpoint that matters.
  throwIfAborted(signal);
  const card = await ogCard({ kind: OG_KIND[t.kind], label, image: null });
  throwIfAborted(signal);

  // og cards are re-generatable, so they overwrite their deterministic key (the fs storage driver is
  // immutable by design); the write goes straight to the media dir the storefront serves.
  const target = join(env.MEDIA_DIR, key);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, card);

  await db
    .insert(media)
    .values({ id: ulid(), kind: "image", storageKey: key, mime: "image/jpeg", bytes: card.byteLength, width: OG_W, height: OG_H, alt: label, source: "seed" })
    .onConflictDoUpdate({ target: media.storageKey, set: { bytes: card.byteLength, alt: label, updatedAt: new Date() } });

  await jobs.enqueue(db, "cache.revalidate", { tags: [tagFor(t)] }, { uniqueKey: `revalidate:og:${key}` });
  log.info({ key, kind: t.kind }, "og card generated");
};
