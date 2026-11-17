import { type Db, asc, banners, eq, faqs, pages, posts } from "@namilux/db";
import type { BannerInput } from "../validation/marketing";
import { getAllBanners } from "./banners";
import type { Banner } from "../types";
import type { PageInput, PostInput } from "../validation/content";

export type FaqAdminRow = { id: number; groupKey: string; question: string; answerHtml: string; sort: number; isActive: boolean };
export type PageAdminRow = { id: number; slug: string; title: string; template: string; status: string; updatedAt: string };

const iso = (d: Date | string | null | undefined): string | null => (d === null || d === undefined ? null : typeof d === "string" ? d : d.toISOString());

export async function listFaqsAdmin(db: Db): Promise<FaqAdminRow[]> {
  const rows = await db.select().from(faqs).orderBy(asc(faqs.groupKey), asc(faqs.sort), asc(faqs.id));
  return rows.map((r) => ({ id: r.id, groupKey: r.groupKey, question: r.question, answerHtml: r.answerHtml, sort: r.sort, isActive: r.isActive }));
}

export async function listPagesAdmin(db: Db): Promise<PageAdminRow[]> {
  const rows = await db.select({ id: pages.id, slug: pages.slug, title: pages.title, template: pages.template, status: pages.status, updatedAt: pages.updatedAt }).from(pages).orderBy(asc(pages.title));
  return rows.map((r) => ({ id: r.id, slug: r.slug, title: r.title, template: r.template, status: r.status, updatedAt: iso(r.updatedAt) ?? "" }));
}

export async function getPageAdmin(db: Db, id: number): Promise<(PageInput & { legacy: boolean }) | null> {
  const rows = await db.select().from(pages).where(eq(pages.id, id)).limit(1);
  const r = rows[0];
  if (r === undefined) return null;
  return {
    id: r.id,
    slug: r.slug,
    title: r.title,
    bodyHtml: r.bodyHtml,
    template: r.template,
    status: r.status,
    seoTitle: r.seoTitle,
    seoDescription: r.seoDescription,
    robots: r.robots,
    legacy: r.legacyLastmod !== null,
  };
}

export async function getPostAdmin(db: Db, id: number): Promise<(PostInput & { legacy: boolean }) | null> {
  const rows = await db.select().from(posts).where(eq(posts.id, id)).limit(1);
  const r = rows[0];
  if (r === undefined) return null;
  return {
    id: r.id,
    slug: r.slug,
    title: r.title,
    excerpt: r.excerpt ?? "",
    bodyHtml: r.bodyHtml,
    coverMediaId: r.coverMediaId,
    ...(r.authorName === null ? {} : { authorName: r.authorName }),
    tags: r.tags,
    status: r.status,
    publishedAt: iso(r.publishedAt),
    relatedProductIds: r.relatedProductIds ?? [],
    seoTitle: r.seoTitle,
    seoDescription: r.seoDescription,
    robots: r.robots,
    legacy: r.legacyLastmod !== null,
  };
}

export async function getBannerAdmin(db: Db, id: number): Promise<BannerInput | null> {
  const rows = await db.select().from(banners).where(eq(banners.id, id)).limit(1);
  const r = rows[0];
  if (r === undefined) return null;
  return {
    id: r.id,
    slot: r.slot,
    title: r.title ?? "",
    subtitle: r.subtitle,
    ctaLabel: r.ctaLabel,
    ctaHref: r.ctaHref,
    mediaLightId: r.mediaLightId,
    mediaDarkId: r.mediaDarkId,
    theme: r.theme,
    startsAt: iso(r.startsAt),
    endsAt: iso(r.endsAt),
    isActive: r.isActive,
    sort: r.sort,
    targeting: (r.targetingJson ?? null) as BannerInput["targeting"],
  };
}

export async function listBannersAdmin(db: Db, slot: Banner["slot"]): Promise<(Banner & { mediaLightId: string | null; mediaDarkId: string | null })[]> {
  // every row of the slot - getBanners would drop the inactive, scheduled and expired ones
  const [all, rows] = await Promise.all([getAllBanners(db, slot), db.select({ id: banners.id, mediaLightId: banners.mediaLightId, mediaDarkId: banners.mediaDarkId }).from(banners).where(eq(banners.slot, slot))]);
  const ids = new Map(rows.map((r) => [r.id, r]));
  return all.map((b) => ({ ...b, mediaLightId: ids.get(b.id)?.mediaLightId ?? null, mediaDarkId: ids.get(b.id)?.mediaDarkId ?? null }));
}
