import "server-only";
import {
  ROUTES,
  STATIC_ROUTES,
  listBrands,
  listCategoryTree,
  listCollections,
  listPagesForSitemap,
  listPostsForSitemap,
  listPublicSlugs,
} from "@namilux/core";
import type { CategoryTreeNode } from "@namilux/core";
import { tagCatalog, tagContent } from "@/lib/cache";
import { db } from "@/lib/db";

/**
 * Every path this storefront answers 200 for, as the proxy's allow-list (lib/route-status.ts).
 *
 * The paths are DECODED - the proxy compares against `decPath(pathname)`, and half the root
 * namespace and most of the category tree are Persian. They are built here rather than through
 * `url/routes.ts` (`productUrl` and friends percent-encode) for exactly that reason.
 *
 * Both family tags are applied: the list spans the catalogue and the content namespace, so an
 * admin archive or a post going live expires it through the `cache.revalidate` job the same way it
 * expires the pages themselves. `minutes` bounds the drift when no write happens at all; anything
 * the list has not caught up with is still answered correctly, one query at a time, by the
 * per-path branch of `/api/internal/routes/`.
 */
export async function loadLiveRoutes(): Promise<string[]> {
  "use cache";
  tagCatalog([], "minutes");
  tagContent([], "minutes");

  const [products, brands, collections, tree, posts, pages] = await Promise.all([
    listPublicSlugs(db),
    listBrands(db, { activeOnly: true }),
    listCollections(db),
    listCategoryTree(db),
    listPostsForSitemap(db),
    listPagesForSitemap(db),
  ]);

  const categories: string[] = [];
  const walk = (nodes: CategoryTreeNode[]): void => {
    for (const node of nodes) {
      if (node.status !== "archived") categories.push(`/category/${node.path}/`);
      walk(node.children);
    }
  };
  walk(tree);

  return [
    ...STATIC_ROUTES,
    ROUTES.sitemapIndex,
    ...products.map((slug) => `/product/${slug}/`),
    ...brands.map((brand) => `/brand/${brand.slug}/`),
    ...collections.map((collection) => `/collection/${collection.slug}/`),
    ...categories,
    ...posts.map((post) => `/${post.slug}/`),
    ...pages.map((page) => `/${page.slug}/`),
  ];
}
