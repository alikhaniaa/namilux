import { type Db, asc, brands, categories, collections, eq, inArray, media, productImages } from "@namilux/db";
import type { ImageRef } from "../types";
import type { BrandAdminInput, CategoryAdminInput, CollectionAdminInput } from "../validation/catalog-admin";
import { collectionProductIds } from "./collections";
import { type MediaRowLike, toImageRef } from "./media";

export type MediaPreview = { storageKey: string; image: ImageRef | null };

const iso = (d: Date | string | null | undefined): string | null => (d === null || d === undefined ? null : typeof d === "string" ? d : d.toISOString());

export async function getCategoryAdmin(db: Db, id: number): Promise<(CategoryAdminInput & { legacy: boolean }) | null> {
  const rows = await db.select().from(categories).where(eq(categories.id, id)).limit(1);
  const r = rows[0];
  if (r === undefined) return null;
  return {
    id: r.id,
    parentId: r.parentId,
    slug: r.slug,
    name: r.name,
    descriptionHtml: r.descriptionHtml ?? "",
    status: r.status,
    inSitemap: r.inSitemap,
    sort: r.sort,
    seoTitle: r.seoTitle,
    seoDescription: r.seoDescription,
    robots: r.robots,
    legacy: r.legacyLastmod !== null,
  };
}

export async function getBrandAdmin(db: Db, id: number): Promise<(BrandAdminInput & { legacy: boolean }) | null> {
  const rows = await db.select().from(brands).where(eq(brands.id, id)).limit(1);
  const r = rows[0];
  if (r === undefined) return null;
  return {
    id: r.id,
    slug: r.slug,
    nameFa: r.nameFa,
    nameEn: r.nameEn,
    logoMediaId: r.logoMediaId,
    storyHtml: r.storyHtml ?? "",
    claim: r.claim,
    isActive: r.isActive,
    sort: r.sort,
    seoTitle: r.seoTitle,
    seoDescription: r.seoDescription,
    robots: r.robots,
    legacy: r.legacyLastmod !== null,
  };
}

export async function getCollectionAdmin(db: Db, id: number): Promise<(CollectionAdminInput & { legacy: boolean }) | null> {
  const rows = await db.select().from(collections).where(eq(collections.id, id)).limit(1);
  const r = rows[0];
  if (r === undefined) return null;
  const rule = (r.ruleJson ?? null) as CollectionAdminInput["rule"];
  const productIds = rule ? [] : await collectionProductIds(db, id);
  return {
    id: r.id,
    slug: r.slug,
    parentId: r.parentId,
    name: r.name,
    kind: r.kind,
    rule,
    productIds,
    coverMediaId: r.coverMediaId,
    coverDarkMediaId: r.coverDarkMediaId,
    descriptionHtml: r.descriptionHtml ?? "",
    isNav: r.isNav,
    startsAt: iso(r.startsAt),
    endsAt: iso(r.endsAt),
    status: r.status,
    sort: r.sort,
    seoTitle: r.seoTitle,
    seoDescription: r.seoDescription,
    // `collections` has no robots column (the storefront gives a collection page the site default),
    // so the form shows the default the schema would fill in anyway.
    robots: "index, follow",
    legacy: false,
  };
}

export function toMediaRowLike(r: typeof media.$inferSelect): MediaRowLike {
  return {
    id: r.id,
    kind: r.kind,
    storageKey: r.storageKey,
    mime: r.mime,
    width: r.width,
    height: r.height,
    durationMs: r.durationMs,
    alt: r.alt,
    lqip: r.lqip,
    renditionsJson: (r.renditionsJson ?? null) as MediaRowLike["renditionsJson"],
    normalizeJson: (r.normalizeJson ?? null) as MediaRowLike["normalizeJson"],
  };
}

export async function mediaPreviews(db: Db, ids: readonly (string | null | undefined)[]): Promise<Record<string, MediaPreview>> {
  const wanted = Array.from(new Set(ids.filter((x): x is string => typeof x === "string" && x !== "")));
  if (wanted.length === 0) return {};
  const rows = await db.select().from(media).where(inArray(media.id, wanted));
  const out: Record<string, MediaPreview> = {};
  for (const r of rows) {
    const like = toMediaRowLike(r);
    out[r.id] = { storageKey: r.storageKey, image: toImageRef(like, { allowQuarantined: true }) };
  }
  return out;
}

export type ProductImageAdminRow = { mediaId: string; role: "primary" | "gallery" | "editorial"; sort: number; alt: string; preview: MediaPreview };

export async function listProductImagesAdmin(db: Db, productId: number): Promise<ProductImageAdminRow[]> {
  const rows = await db
    .select({ mediaId: productImages.mediaId, role: productImages.role, sort: productImages.sort, alt: productImages.alt, media })
    .from(productImages)
    .innerJoin(media, eq(media.id, productImages.mediaId))
    .where(eq(productImages.productId, productId))
    .orderBy(asc(productImages.sort), asc(productImages.id));
  return rows.map((r) => ({
    mediaId: r.mediaId,
    role: r.role,
    sort: r.sort,
    alt: r.alt ?? "",
    preview: { storageKey: r.media.storageKey, image: toImageRef(toMediaRowLike(r.media), { allowQuarantined: true }) },
  }));
}
