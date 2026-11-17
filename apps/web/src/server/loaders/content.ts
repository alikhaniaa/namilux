import "server-only";
import { getBanners, getFaqs, getPageBySlug, getPostBySlug, listPosts, tags } from "@namilux/core";
import type { Banner, FaqItem, PageView, Paged, PostCard, PostView } from "@namilux/core";
import type { BannerSlot } from "@namilux/core/constants";
import { tagContent } from "@/lib/cache";
import { db } from "@/lib/db";
import { env } from "@/env";

// Each loader carries the `"use cache"` directive itself - Next 16 cannot take a callback across
// the cache boundary (see the DEVIATION note in lib/cache.ts).

export async function loadPost(slug: string): Promise<PostView | null> {
  "use cache";
  tagContent([tags.post(slug)]);
  return getPostBySlug(db, slug, { origin: env.SITE_ORIGIN });
}

export async function loadPosts(page: number): Promise<Paged<PostCard>> {
  "use cache";
  tagContent();
  return listPosts(db, page);
}

export async function loadPage(slug: string): Promise<PageView | null> {
  "use cache";
  tagContent([tags.page(slug)]);
  return getPageBySlug(db, slug, { origin: env.SITE_ORIGIN });
}

export async function loadFaqs(group?: string): Promise<FaqItem[]> {
  "use cache";
  tagContent();
  return group === undefined ? getFaqs(db) : getFaqs(db, group);
}

export async function loadBanners(slot: BannerSlot): Promise<Banner[]> {
  "use cache";
  // A banner's live window is evaluated when the entry is built, so a slot is cached in minutes
  // rather than hours: a campaign that starts at noon must not wait out an hours-long window.
  tagContent([tags.home], "minutes");
  return getBanners(db, slot);
}

/**
 * the spec - the root namespace is shared: posts first (150 of them), then pages (15). The
 * redirects table is consulted by the route itself, uncached, only when this returns null, so a
 * 404 costs one extra query and a hit costs none.
 */
export async function loadRootSlug(
  slug: string,
): Promise<{ kind: "post"; post: PostView } | { kind: "page"; page: PageView } | null> {
  const post = await loadPost(slug);
  if (post !== null) return { kind: "post", post };
  const page = await loadPage(slug);
  if (page !== null) return { kind: "page", page };
  return null;
}
