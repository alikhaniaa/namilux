import { type Db, and, banners, brands, collections, desc, eq, media, or, posts, productImages, products, sql } from "@namilux/db";
import type { MediaKind, MediaSource } from "@namilux/db";
import { audit } from "../audit";
import { appError } from "../errors";
import { ulid } from "../ids";
import type { Actor, ImageRef, Paged, Renditions } from "../types";
import { toImageRef, type NormalizeInfo } from "./media";

export type MediaAdminRow = {
  id: string;
  kind: MediaKind;
  storageKey: string;
  mime: string;
  bytes: number;
  width: number | null;
  height: number | null;
  alt: string;
  source: MediaSource;
  quarantined: boolean;
  reason: string | null;
  processed: boolean;
  image: ImageRef | null;
  createdAt: string;
};

export type MediaUsage = { entity: "product" | "brand" | "collection" | "banner" | "post"; id: number; name: string };

export const MEDIA_PAGE_SIZE = 60;

type Row = typeof media.$inferSelect;

function mapRow(r: Row): MediaAdminRow {
  const normalize = r.normalizeJson as (NormalizeInfo & { reason?: string | null }) | null;
  return {
    id: r.id,
    kind: r.kind,
    storageKey: r.storageKey,
    mime: r.mime,
    bytes: r.bytes,
    width: r.width,
    height: r.height,
    alt: r.alt,
    source: r.source,
    quarantined: normalize?.quarantined === true,
    reason: typeof normalize?.reason === "string" ? normalize.reason : null,
    processed: r.renditionsJson !== null,
    image: toImageRef(
      {
        id: r.id,
        kind: r.kind,
        storageKey: r.storageKey,
        mime: r.mime,
        width: r.width,
        height: r.height,
        durationMs: r.durationMs,
        alt: r.alt,
        lqip: r.lqip,
        renditionsJson: r.renditionsJson as Renditions | null,
        normalizeJson: r.normalizeJson as NormalizeInfo | null,
      },
      { allowQuarantined: true },
    ),
    createdAt: r.createdAt.toISOString(),
  };
}

/** Every column that can reference media - the "unused" filter and the delete guard share it. */
const usageSql = sql`(
  exists (select 1 from product_images pi where pi.media_id = ${media.id})
  or exists (select 1 from products p where p.swatch_media_id = ${media.id} or p.video_media_id = ${media.id})
  or exists (select 1 from brands b where b.logo_media_id = ${media.id})
  or exists (select 1 from collections c where c.cover_media_id = ${media.id} or c.cover_dark_media_id = ${media.id})
  or exists (select 1 from banners bn where bn.media_light_id = ${media.id} or bn.media_dark_id = ${media.id})
  or exists (select 1 from posts po where po.cover_media_id = ${media.id})
)`;

export async function listMedia(
  db: Db,
  q: { q?: string; kind?: MediaKind; quarantined?: boolean; unused?: boolean; page?: number },
): Promise<Paged<MediaAdminRow>> {
  const page = Math.max(1, q.page ?? 1);
  const conds = [];
  if (q.kind !== undefined) conds.push(eq(media.kind, q.kind));
  if (q.q !== undefined && q.q.trim() !== "") {
    const like = `%${q.q.trim()}%`;
    conds.push(or(sql`${media.alt} ilike ${like}`, sql`${media.storageKey} ilike ${like}`));
  }
  if (q.quarantined === true) conds.push(sql`coalesce((${media.normalizeJson}->>'quarantined')::boolean, false)`);
  if (q.quarantined === false) conds.push(sql`not coalesce((${media.normalizeJson}->>'quarantined')::boolean, false)`);
  if (q.unused === true) conds.push(sql`not ${usageSql}`);
  const where = conds.length === 0 ? undefined : and(...conds);
  const [rows, totalRows] = await Promise.all([
    db
      .select()
      .from(media)
      .where(where)
      .orderBy(desc(media.createdAt))
      .limit(MEDIA_PAGE_SIZE)
      .offset((page - 1) * MEDIA_PAGE_SIZE),
    db.select({ n: sql<number>`count(*)::int` }).from(media).where(where),
  ]);
  return { items: rows.map(mapRow), total: Number(totalRows[0]?.n ?? 0), page, pageSize: MEDIA_PAGE_SIZE };
}

export async function mediaUsages(db: Db, id: string): Promise<MediaUsage[]> {
  const out: MediaUsage[] = [];
  const imgs = await db
    .select({ id: products.id, name: products.displayName })
    .from(productImages)
    .innerJoin(products, eq(products.id, productImages.productId))
    .where(eq(productImages.mediaId, id));
  for (const r of imgs) out.push({ entity: "product", id: r.id, name: r.name });
  const swatch = await db
    .select({ id: products.id, name: products.displayName })
    .from(products)
    .where(or(eq(products.swatchMediaId, id), eq(products.videoMediaId, id)));
  for (const r of swatch) if (!out.some((u) => u.entity === "product" && u.id === r.id)) out.push({ entity: "product", id: r.id, name: r.name });
  const brandRows = await db.select({ id: brands.id, name: brands.nameFa }).from(brands).where(eq(brands.logoMediaId, id));
  for (const r of brandRows) out.push({ entity: "brand", id: r.id, name: r.name ?? "" });
  const collRows = await db
    .select({ id: collections.id, name: collections.name })
    .from(collections)
    .where(or(eq(collections.coverMediaId, id), eq(collections.coverDarkMediaId, id)));
  for (const r of collRows) out.push({ entity: "collection", id: r.id, name: r.name ?? "" });
  const bannerRows = await db
    .select({ id: banners.id, name: banners.title })
    .from(banners)
    .where(or(eq(banners.mediaLightId, id), eq(banners.mediaDarkId, id)));
  for (const r of bannerRows) out.push({ entity: "banner", id: r.id, name: r.name ?? "" });
  const postRows = await db.select({ id: posts.id, name: posts.title }).from(posts).where(eq(posts.coverMediaId, id));
  for (const r of postRows) out.push({ entity: "post", id: r.id, name: r.name ?? "" });
  return out;
}

export async function getMediaAdmin(
  db: Db,
  id: string,
): Promise<(MediaAdminRow & { normalize: NormalizeInfo | null; renditions: Renditions | null; usages: MediaUsage[] }) | null> {
  const rows = await db.select().from(media).where(eq(media.id, id)).limit(1);
  const row = rows[0];
  if (row === undefined) return null;
  const usages = await mediaUsages(db, id);
  return {
    ...mapRow(row),
    normalize: (row.normalizeJson as NormalizeInfo | null) ?? null,
    renditions: (row.renditionsJson as Renditions | null) ?? null,
    usages,
  };
}

export async function setMediaAlt(db: Db, id: string, alt: string, actor: Actor): Promise<void> {
  const rows = await db.select({ alt: media.alt }).from(media).where(eq(media.id, id)).limit(1);
  if (rows[0] === undefined) throw appError("NOT_FOUND", { fa: "رسانه پیدا نشد" });
  await db.update(media).set({ alt }).where(eq(media.id, id));
  await audit.log(db, actor, "media.alt", "media", id, { alt: rows[0].alt }, { alt });
}

export async function createPendingMedia(
  db: Db,
  i: { kind: MediaKind; storageKey: string; mime: string; bytes: number; staffId: string | null },
): Promise<{ id: string }> {
  const id = ulid();
  await db.insert(media).values({
    id,
    kind: i.kind,
    storageKey: i.storageKey,
    mime: i.mime,
    bytes: i.bytes,
    source: "admin",
    ...(i.staffId === null ? {} : { uploadedByStaffId: i.staffId }),
  });
  return { id };
}

export async function deleteMedia(db: Db, id: string, actor: Actor): Promise<void> {
  const rows = await db.select({ storageKey: media.storageKey }).from(media).where(eq(media.id, id)).limit(1);
  const row = rows[0];
  if (row === undefined) throw appError("NOT_FOUND", { fa: "رسانه پیدا نشد" });
  const usages = await mediaUsages(db, id);
  if (usages.length > 0) throw appError("CONFLICT", { fa: "این رسانه در حال استفاده است", details: { usages } });
  await db.delete(media).where(eq(media.id, id));
  await audit.log(db, actor, "media.delete", "media", id, { storageKey: row.storageKey }, null);
}
