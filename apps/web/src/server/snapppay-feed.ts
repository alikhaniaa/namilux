import "server-only";
import { decPath, listSnapppayFeedProducts, toSnapppayFeedItem } from "@namilux/core";
import type { ProductDetail, SnapppayFeedItem, SnapppayFeedPage } from "@namilux/core";
import { env } from "@/env";
import { db } from "@/lib/db";
import { loadCategory, loadProduct } from "@/server/loaders/catalog";

/**
 * The SnappPay product feed (core/catalog/snapppay-feed.ts has the field contract and its source).
 *
 * NOT a `"use cache"` scope itself: it only calls the cached loaders. Entering one cached scope from
 * inside another makes Next join promises across scopes and the request hangs (see loaders/nav.ts).
 * The loaders are shared with the storefront, so products and prices match the main website.
 */

/** «لوازم آشپزخانه > توستر» from the product's primary category; its own name when the tree cannot be read. */
async function categoryPath(detail: ProductDetail, memo: Map<string, string>): Promise<string> {
  const primary = detail.categories[0];
  if (primary === undefined) return "";
  const cached = memo.get(primary.href);
  if (cached !== undefined) return cached;
  let path = primary.name;
  try {
    const raw = decPath(primary.href).replace(/^\/category\//u, "").replace(/\/+$/u, "");
    const view = raw === "" ? null : await loadCategory(raw);
    if (view !== null) {
      const trail = view.crumbs.filter((c) => c.href.startsWith("/category/")).map((c) => c.name);
      const names = [...trail, view.name].filter((n, i, all) => n.trim() !== "" && all.indexOf(n) === i);
      if (names.length > 0) path = names.join(" > ");
    }
  } catch {
    // the primary category's own name is still a correct, if shorter, category
  }
  memo.set(primary.href, path);
  return path;
}

async function items(slugs: readonly string[]): Promise<SnapppayFeedItem[]> {
  const memo = new Map<string, string>();
  const out: SnapppayFeedItem[] = [];
  // a few products at a time: the loaders share this process's small database pool
  for (let i = 0; i < slugs.length; i += 8) {
    const chunk = await Promise.all(
      slugs.slice(i, i + 8).map(async (slug) => {
        const detail = await loadProduct(slug);
        if (detail === null || detail.onRequest || detail.price <= 0) return null;
        return toSnapppayFeedItem(detail, { origin: env.SITE_ORIGIN, categoryPath: await categoryPath(detail, memo) });
      }),
    );
    for (const item of chunk) if (item !== null) out.push(item);
  }
  return out;
}

export async function snapppayFeedPage(page: number, size: number): Promise<SnapppayFeedPage> {
  const { slugs, total } = await listSnapppayFeedProducts(db, { page, size });
  return { page, size, total, total_pages: Math.max(1, Math.ceil(total / size)), products: await items(slugs) };
}

/** One product, without scanning the whole catalog. */
export async function snapppayFeedOne(key: { id?: string; slug?: string }): Promise<SnapppayFeedItem | null> {
  if (key.id !== undefined && (!/^[1-9]\d{0,9}$/u.test(key.id) || Number(key.id) > 2_147_483_647)) return null;
  const result = await listSnapppayFeedProducts(db, { page: 1, size: 1,
    ...(key.id !== undefined ? { id: Number(key.id) } : key.slug !== undefined ? { slug: decPath(key.slug) } : {}),
  });
  return (await items(result.slugs))[0] ?? null;
}
