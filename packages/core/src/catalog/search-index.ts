import { createHash } from "node:crypto";
import type { Db } from "@namilux/db";
import type { ProductCard } from "./cards";
import type { ImageRef } from "./media";
import { toProductCard } from "./cards";
import { sortCards } from "./sort";
import { findCardSources, listPublicIds } from "./products.repo";
import { collectionProductIds, listCollections } from "./collections";

// DECISION (M0 step 3): SearchIndexEntry is declared once in ../types (the spec short keys).
// That declaration is the row this module emits: `m` / `i` are OPTIONAL (an absent key costs nothing
// in the ≈120 KB gz budget, a `null` costs five bytes per row) and `s` is a boolean. The header
// contract spells them `string | null` and `0 | 1`; the canonical type wins, exactly as the M0
// de-duplication decided, and the edge cases read the same ("without image → no `i`").
//
import type { SearchIndexEntry } from "../types";

export type { SearchIndexEntry };

export const SEARCH_INDEX_TARGET_GZ_BYTES = 122_880;
export const SEARCH_INDEX_MAX_ENTRIES = 3_000;

/** rules: at most 6 collection slugs per product, in collection sort order. */
export const SEARCH_INDEX_MAX_COLLECTIONS = 6;

/** The collection kinds the overlay groups results under (rules). */
const INDEXED_COLLECTION_KINDS = ["group", "sub"] as const;

/**
 * The smallest rendition of a map keyed by width ("320" → storage key). `renditions_json` is jsonb,
 * so every entry is re-checked: a non-numeric width or a non-string key is ignored (media.ts does
 * the same when it builds a srcset).
 */
function smallestOf(map: Record<string, string> | undefined): string | null {
  if (typeof map !== "object" || map === null) return null;
  let bestWidth = Number.POSITIVE_INFINITY;
  let bestKey: string | null = null;
  for (const [rawWidth, rawKey] of Object.entries(map)) {
    const width = Number(rawWidth);
    if (!Number.isFinite(width) || width <= 0) continue;
    if (typeof rawKey !== "string" || rawKey === "") continue;
    if (width < bestWidth) {
      bestWidth = width;
      bestKey = rawKey;
    }
  }
  return bestKey;
}

/**
 * rules: the smallest webp rendition - the 56 px result thumb of the overlay.
 * DECISION: when a row has no webp map (a legacy image the pipeline has not re-rendered yet) the
 * avif map and then the master key are used instead. The alternative - emitting `i` null - would
 * show a blank tile for a product that does have a picture, and every value here is still a
 * storage key the client turns into `/media/<key>`.
 */
function thumbKey(image: ImageRef | undefined): string | null {
  if (image === undefined) return null;
  const webp = smallestOf(image.renditions?.webp);
  if (webp !== null) return webp;
  const avif = smallestOf(image.renditions?.avif);
  if (avif !== null) return avif;
  const master = image.renditions?.master;
  if (typeof master === "string" && master !== "") return master;
  return image.key === "" ? null : image.key;
}

export function toSearchIndexEntry(card: ProductCard, collectionSlugs: string[]): SearchIndexEntry {
  const modelCode = card.modelCode?.trim() ?? "";
  const thumb = thumbKey(card.image);

  const slugs: string[] = [];
  for (const slug of Array.isArray(collectionSlugs) ? collectionSlugs : []) {
    if (typeof slug !== "string" || slug === "") continue;
    if (slugs.includes(slug)) continue;
    slugs.push(slug);
    if (slugs.length >= SEARCH_INDEX_MAX_COLLECTIONS) break;
  }

  return {
    id: card.id,
    slug: card.slug,
    dn: card.displayName,
    // EDGE CASE: a product without a brand carries "" - the client groups it under no brand.
    b: card.brand?.name ?? "",
    ...(modelCode === "" ? {} : { m: modelCode }),
    // EDGE CASE: on-request in stock → p 0, s true (`price === 0` IS the on-request flag, the spec).
    p: card.price,
    s: card.available,
    ...(thumb === null ? {} : { i: thumb }),
    c: slugs,
  };
}

/** Live group/sub collections → the slugs each product belongs to, in collection sort order. */
async function collectionSlugsByProduct(db: Db): Promise<Map<number, string[]>> {
  // listCollections returns LIVE collections only (sorted by sort, then name), so a campaign that
  // has not started is absent - EDGE CASE "not-yet-live collection → slug absent from c".
  const live = await listCollections(db, { kinds: [...INDEXED_COLLECTION_KINDS] });
  const memberships = await Promise.all(
    live.map(async (collection) => ({
      slug: collection.slug,
      ids: await collectionProductIds(db, collection.id),
    })),
  );

  const out = new Map<number, string[]>();
  for (const membership of memberships) {
    for (const productId of membership.ids) {
      const bucket = out.get(productId);
      if (bucket === undefined) out.set(productId, [membership.slug]);
      else bucket.push(membership.slug);
    }
  }
  return out;
}

export async function buildSearchIndex(db: Db): Promise<SearchIndexEntry[]> {
  // rules: active + public only - listPublicIds is that predicate (link_only, hidden, draft and
  // archived rows never reach the client index).
  const ids = await listPublicIds(db);
  if (ids.length === 0) return [];

  const [sources, byProduct] = await Promise.all([
    findCardSources(db, ids),
    collectionSlugsByProduct(db),
  ]);

  // rules: recommended order - buyable first, so the first N matches a client renders are sellable.
  const cards = sortCards(
    sources.map((source) => toProductCard(source)),
    "recommended",
  );

  // DECISION: SEARCH_INDEX_TARGET_GZ_BYTES / SEARCH_INDEX_MAX_ENTRIES are published for the caller to
  // assert against (the route and the build step own the logger - the spec forbids console.log and this
  // package has no pino). The builder never truncates: a short index would silently hide products.
  return cards.map((card) => toSearchIndexEntry(card, byProduct.get(card.id) ?? []));
}

export function serializeSearchIndex(entries: SearchIndexEntry[]): string {
  // The keys are re-emitted in contract order (id · slug · dn · b · m? · p · s · i? · c): JSON.stringify
  // preserves insertion order for non-numeric keys, and an absent optional key is simply not written.
  const ordered = entries.map((e) => ({
    id: e.id,
    slug: e.slug,
    dn: e.dn,
    b: e.b,
    ...(e.m === undefined ? {} : { m: e.m }),
    p: e.p,
    s: e.s,
    ...(e.i === undefined ? {} : { i: e.i }),
    c: e.c,
  }));
  // JSON.stringify without a spacer emits no whitespace outside strings.
  return JSON.stringify(ordered);
}

export function indexEtag(serialized: string): string {
  return createHash("sha256").update(serialized, "utf8").digest("hex").slice(0, 16);
}
