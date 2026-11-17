import { type Db, brands, categories, collections, desc, eq, or, pages, posts, products, sql } from "@namilux/db";
import { audit } from "../audit";
import { tags } from "../cache/tags";
import { appError } from "../errors";
import type { Actor } from "../types";
import { brandUrl, categoryUrl, collectionUrl, pageUrl, postUrl, productUrl } from "../url";
import type { SeoMetaInput } from "../validation/content";

export type SeoEntityKind = "product" | "category" | "brand" | "collection" | "post" | "page";
export type SeoFlag = "title_long" | "title_missing" | "description_missing" | "description_long";
export type SeoEntityRow = {
  kind: SeoEntityKind;
  id: number;
  name: string;
  path: string;
  seoTitle: string | null;
  seoDescription: string | null;
  robots: string;
  flags: SeoFlag[];
};

export const SEO_TITLE_MAX = 60;
export const SEO_DESCRIPTION_MAX = 160;

export function seoFlags(title: string | null, description: string | null): SeoFlag[] {
  const flags: SeoFlag[] = [];
  if (title === null || title.trim() === "") flags.push("title_missing");
  else if (title.length > SEO_TITLE_MAX) flags.push("title_long");
  if (description === null || description.trim() === "") flags.push("description_missing");
  else if (description.length > SEO_DESCRIPTION_MAX) flags.push("description_long");
  return flags;
}

type Raw = { id: number; name: string; slugOrPath: string; seoTitle: string | null; seoDescription: string | null; robots: string | null };

const PATH_OF: Record<SeoEntityKind, (s: string) => string> = {
  product: productUrl,
  category: categoryUrl,
  brand: brandUrl,
  collection: collectionUrl,
  post: postUrl,
  page: pageUrl,
};

export async function searchSeoEntities(db: Db, kind: SeoEntityKind, q: string, limit = 50): Promise<SeoEntityRow[]> {
  const like = `%${q.trim()}%`;
  const has = q.trim() !== "";
  let rows: Raw[];
  switch (kind) {
    case "product":
      rows = await db
        .select({ id: products.id, name: products.displayName, slugOrPath: products.slug, seoTitle: products.seoTitle, seoDescription: products.seoDescription, robots: products.robots })
        .from(products)
        .where(has ? or(sql`${products.displayName} ilike ${like}`, sql`${products.slug} ilike ${like}`) : sql`${products.status} <> 'archived'`)
        .orderBy(desc(products.updatedAt))
        .limit(limit);
      break;
    case "category":
      rows = await db
        .select({ id: categories.id, name: categories.name, slugOrPath: categories.path, seoTitle: categories.seoTitle, seoDescription: categories.seoDescription, robots: categories.robots })
        .from(categories)
        .where(has ? or(sql`${categories.name} ilike ${like}`, sql`${categories.path} ilike ${like}`) : sql`true`)
        .orderBy(categories.sort)
        .limit(limit);
      break;
    case "brand":
      rows = await db
        .select({ id: brands.id, name: brands.nameFa, slugOrPath: brands.slug, seoTitle: brands.seoTitle, seoDescription: brands.seoDescription, robots: brands.robots })
        .from(brands)
        .where(has ? or(sql`${brands.nameFa} ilike ${like}`, sql`${brands.slug} ilike ${like}`) : sql`true`)
        .orderBy(brands.sort)
        .limit(limit);
      break;
    case "collection":
      rows = await db
        .select({ id: collections.id, name: collections.name, slugOrPath: collections.slug, seoTitle: collections.seoTitle, seoDescription: collections.seoDescription, robots: sql<string | null>`null` })
        .from(collections)
        .where(has ? or(sql`${collections.name} ilike ${like}`, sql`${collections.slug} ilike ${like}`) : sql`true`)
        .orderBy(collections.sort)
        .limit(limit);
      break;
    case "post":
      rows = await db
        .select({ id: posts.id, name: posts.title, slugOrPath: posts.slug, seoTitle: posts.seoTitle, seoDescription: posts.seoDescription, robots: posts.robots })
        .from(posts)
        .where(has ? or(sql`${posts.title} ilike ${like}`, sql`${posts.slug} ilike ${like}`) : sql`${posts.status} = 'published'`)
        .orderBy(desc(posts.publishedAt))
        .limit(limit);
      break;
    case "page":
      rows = await db
        .select({ id: pages.id, name: pages.title, slugOrPath: pages.slug, seoTitle: pages.seoTitle, seoDescription: pages.seoDescription, robots: pages.robots })
        .from(pages)
        .where(has ? or(sql`${pages.title} ilike ${like}`, sql`${pages.slug} ilike ${like}`) : sql`true`)
        .orderBy(pages.id)
        .limit(limit);
      break;
    default: {
      const exhaustive: never = kind;
      throw appError("VALIDATION", { details: { kind: exhaustive } });
    }
  }
  return rows.map((r) => ({
    kind,
    id: r.id,
    name: r.name,
    path: PATH_OF[kind](r.slugOrPath),
    seoTitle: r.seoTitle,
    seoDescription: r.seoDescription,
    robots: r.robots ?? "index, follow",
    flags: seoFlags(r.seoTitle, r.seoDescription),
  }));
}

export async function updateSeoMeta(db: Db, input: SeoMetaInput, actor: Actor): Promise<{ tags: string[] }> {
  const set = {
    seoTitle: input.seoTitle ?? null,
    seoDescription: input.seoDescription ?? null,
  };
  const robots = input.robots;
  const before = (await searchSeoEntities(db, input.entity, "", 1_000_000)).find((r) => r.id === input.id);
  if (before === undefined) throw appError("NOT_FOUND", { fa: "موردی با این شناسه پیدا نشد" });
  let entityTags: string[];
  switch (input.entity) {
    case "product":
      await db.update(products).set({ ...set, ...(robots === undefined ? {} : { robots }) }).where(eq(products.id, input.id));
      entityTags = [tags.product(input.id), tags.catalog];
      break;
    case "category":
      await db.update(categories).set({ ...set, ...(robots === undefined ? {} : { robots }) }).where(eq(categories.id, input.id));
      entityTags = [tags.category(input.id), tags.catalog];
      break;
    case "brand":
      await db.update(brands).set({ ...set, ...(robots === undefined ? {} : { robots }) }).where(eq(brands.id, input.id));
      entityTags = [tags.brand(input.id), tags.catalog];
      break;
    case "collection":
      await db.update(collections).set(set).where(eq(collections.id, input.id));
      entityTags = [tags.collection(input.id), tags.catalog];
      break;
    case "post":
      await db.update(posts).set({ ...set, ...(robots === undefined ? {} : { robots }) }).where(eq(posts.id, input.id));
      entityTags = [tags.post(before.path), tags.content];
      break;
    case "page":
      await db.update(pages).set({ ...set, ...(robots === undefined ? {} : { robots }) }).where(eq(pages.id, input.id));
      entityTags = [tags.page(before.path), tags.content];
      break;
  }
  await audit.log(
    db,
    actor,
    "seo.meta.update",
    input.entity,
    String(input.id),
    { seoTitle: before.seoTitle, seoDescription: before.seoDescription, robots: before.robots },
    { seoTitle: set.seoTitle, seoDescription: set.seoDescription, robots: robots ?? before.robots },
  );
  return { tags: [...entityTags, tags.sitemap] };
}
