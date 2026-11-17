import "server-only";
import { listBrands, listCategoryTree, listCollections, listPagesForSitemap, listPostsForSitemap, listPublicSlugs } from "@namilux/core";
import type { CategoryTreeNode } from "@namilux/core";
import { db } from "@/lib/db";
const PLACEHOLDER = "__no-rows__";
function orPlaceholder(slugs: string[]): {
    slug: string;
}[] {
    return (slugs.length === 0 ? [PLACEHOLDER] : slugs).map((slug) => ({ slug }));
}
export async function productParams(): Promise<{
    slug: string;
}[]> {
    return orPlaceholder(await listPublicSlugs(db));
}
export async function brandParams(): Promise<{
    slug: string;
}[]> {
    return orPlaceholder((await listBrands(db, { activeOnly: true })).map((b) => b.slug));
}
export async function collectionParams(): Promise<{
    slug: string;
}[]> {
    // Seasons are judged against the clock at request time (collection/[slug]/page.tsx seasonGone) and
    // therefore never prerender; every other live collection does.
    return orPlaceholder((await listCollections(db)).filter((c) => c.kind !== "season").map((c) => c.slug));
}
export async function categoryParams(): Promise<{
    slug: string[];
}[]> {
    const paths: string[] = [];
    const walk = (nodes: CategoryTreeNode[]): void => {
        for (const node of nodes) {
            if (node.status !== "archived")
                paths.push(node.path);
            walk(node.children);
        }
    };
    walk(await listCategoryTree(db));
    return (paths.length === 0 ? [PLACEHOLDER] : paths).map((path) => ({ slug: path.split("/").filter((s) => s !== "") }));
}
/** The root namespace serves posts first, then pages - both live at `/<slug>/`. */
export async function rootSlugParams(): Promise<{
    slug: string;
}[]> {
    const [posts, pages] = await Promise.all([listPostsForSitemap(db), listPagesForSitemap(db)]);
    return orPlaceholder([...posts.map((p) => p.slug), ...pages.map((p) => p.slug)]);
}
