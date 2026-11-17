import "server-only";
import { buildSearchIndex, getBrandBySlug, getCategoryByPath, getCollectionBySlug, getProductBySlug, getProductCards, brandUrl, listBrands, listCollections, listProducts, normalizePlpState, questions, reviews, tags, } from "@namilux/core";
import type { BrandView, CategoryView, CollectionView, ImageRef, ListProductsResult, Paged, ProductCard, ProductDetail, ProductQuery, Question, Review, ReviewSummary, } from "@namilux/core";
import { createHash } from "node:crypto";
import { tagCatalog } from "@/lib/cache";
import { db } from "@/lib/db";
import { env } from "@/env";
const MAX_COMPARE = 4;
export async function loadProduct(slug: string): Promise<ProductDetail | null> {
    "use cache";
    // The product's own tag cannot be known before the row is read, so the entry is tagged by the
    // catalog family and the slug's key; `tagsForProductChange` revalidates both on an admin write.
    tagCatalog();
    return await getProductBySlug(db, slug, { origin: env.SITE_ORIGIN });
}
export async function loadProductCards(ids: number[]): Promise<ProductCard[]> {
    "use cache";
    tagCatalog(ids.map((id) => tags.product(id)));
    return await getProductCards(db, ids);
}
export async function loadPlp(q: ProductQuery): Promise<ListProductsResult> {
    "use cache";
    // Scope tag so an edit to one category cannot flush every listing in the shop.
    const scopeTag = q.scope.kind === "category" && q.scope.id !== undefined
        ? [tags.category(q.scope.id)]
        : q.scope.kind === "brand" && q.scope.id !== undefined
            ? [tags.brand(q.scope.id)]
            : q.scope.kind === "collection" && q.scope.id !== undefined
                ? [tags.collection(q.scope.id)]
                : [];
    tagCatalog(scopeTag);
    return await listProducts(db, q);
}
/** Normalised before the cache sees it, so two spellings of one filter are one entry. */
export async function loadPlpFor(scope: ProductQuery["scope"], state: ProductQuery): Promise<ListProductsResult> {
    return loadPlp({ ...normalizePlpState(state), scope });
}
export async function loadCategory(path: string): Promise<CategoryView | null> {
    "use cache";
    tagCatalog();
    return getCategoryByPath(db, path);
}
export async function loadBrand(slug: string): Promise<BrandView | null> {
    "use cache";
    tagCatalog();
    return getBrandBySlug(db, slug);
}
export async function loadCollection(slug: string): Promise<CollectionView | null> {
    "use cache";
    tagCatalog();
    return getCollectionBySlug(db, slug);
}
export async function loadSearchIndex(): Promise<{
    body: string;
    etag: string;
}> {
    "use cache";
    tagCatalog([tags.search]);
    const body = JSON.stringify(await buildSearchIndex(db));
    // Weak ETag over the body so a revalidation producing identical bytes costs no download.
    const etag = `W/"${createHash("sha256").update(body).digest("base64url").slice(0, 27)}"`;
    return { body, etag };
}
export async function loadCompareData(ids: number[]): Promise<ProductDetail[]> {
    "use cache";
    tagCatalog(ids.slice(0, MAX_COMPARE).map((id) => tags.product(id)));
    const details = await Promise.all(ids.slice(0, MAX_COMPARE).map(async (id) => {
        const cards = await getProductCards(db, [id]);
        const first = cards[0];
        return first === undefined ? null : getProductBySlug(db, first.slug, { origin: env.SITE_ORIGIN });
    }));
    return details.filter((d): d is ProductDetail => d !== null);
}
// Reviews and questions are cached for minutes under the product tag: moderating a review or
// answering a question revalidates product:id (the spec tagsForProductChange), so a fresh approval
// is on the page within the same window an admin price edit is.
export async function loadReviews(productId: number, page: number): Promise<Paged<Review>> {
    "use cache";
    tagCatalog([tags.product(productId)], "minutes");
    return reviews.listForProduct(db, productId, { page });
}
export async function loadReviewSummary(productId: number): Promise<ReviewSummary> {
    "use cache";
    tagCatalog([tags.product(productId)], "minutes");
    return reviews.summary(db, productId);
}
// DECISION: not in this file's contract - the Q&A module needs the same cached read
// the reviews get, and the PDP is the only caller of both.
export async function loadQuestions(productId: number): Promise<Paged<Question>> {
    "use cache";
    tagCatalog([tags.product(productId)], "minutes");
    return questions.listForProduct(db, productId, 1);
}
/**
 * Collection slug → cover, for the collection facet tiles (3 Sep 2026: "pictures for categories").
 * One cached read of every live group/sub collection; the nav tag covers the same rows.
 */
export async function loadCollectionCovers(): Promise<Record<string, ImageRef>> {
    "use cache";
    tagCatalog([tags.catalog, tags.nav]);
    const tiles = await listCollections(db, { kinds: ["group", "sub"] });
    const out: Record<string, ImageRef> = {};
    for (const tile of tiles)
        if (tile.cover !== null)
            out[tile.slug] = tile.cover;
    return out;
}
/**
 * The houses the shop actually carries, for the About page: active brands that have something on
 * the shelf, each with its OWN logo.
 *
 * DECISION: `listBrands` rather than `loadNav().brands`. The nav's `image` is `logo ?? a photograph
 * of one of the brand's products` - a deliberate fallback for the home marquee, where a picture is
 * better than a gap. On a page that says «these are the houses we carry» that fallback shows a
 * random kettle where a maker's mark belongs, so this loader keeps `logo` (null when the brand has
 * none) and the template draws the Latin name in the serif instead.
 *
 * `buyableCount` is deliberately NOT the filter: a house whose stock is temporarily out is still a
 * house the shop carries. `productCount === 0` is the real "we do not sell this" signal.
 */
export async function loadBrandMarks(): Promise<{
    slug: string;
    name: string;
    nameEn: string;
    href: string;
    count: number;
    image: ImageRef | null;
}[]> {
    "use cache";
    tagCatalog([tags.catalog, tags.nav]);
    const brands = await listBrands(db, { activeOnly: true });
    return brands
        .filter((b) => b.productCount > 0)
        .map((b) => ({
        slug: b.slug,
        name: b.name,
        nameEn: b.nameEn,
        href: brandUrl(b.slug),
        count: b.productCount,
        image: b.logo,
    }));
}
