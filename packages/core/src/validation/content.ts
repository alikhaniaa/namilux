import { z } from "zod";
import { CONTENT_STATUSES, MENU_ITEM_KINDS, MENU_KEYS, PAGE_TEMPLATES } from "../constants";
import type { MenuItemKind } from "../constants";
import { clean, zBool, zHref, zId, zIsoDateTime, zLatinKey, zMultiline, zPath, zSlug, zSort, zText, zUlid, FA } from "./common";

const ROBOTS_PREVIEW = /^max-(snippet|video-preview):-?\d+$|^max-image-preview:(none|standard|large)$/;

/**
 * The editors offer ROBOTS_VALUES, but the WordPress import stored Yoast's longer strings ("follow,
 * index, max-snippet:-1, max-video-preview:-1, max-image-preview:large") on most products, posts,
 * pages and categories, and the storefront prints `robots` verbatim. Refusing them made every
 * imported row unsavable, so a stored string is accepted as it is: exactly one index/noindex, one
 * follow/nofollow, and otherwise only those preview directives.
 */
export function isRobotsDirective(value: string): boolean {
  const tokens = value.split(",").map((t) => t.trim());
  if (new Set(tokens).size !== tokens.length) return false;
  const index = tokens.filter((t) => t === "index" || t === "noindex").length;
  const follow = tokens.filter((t) => t === "follow" || t === "nofollow").length;
  return index === 1 && follow === 1 && tokens.every((t) => ["index", "noindex", "follow", "nofollow"].includes(t) || ROBOTS_PREVIEW.test(t));
}

export const robotsSchema = z.preprocess(clean, z.string().max(200, FA.tooLong).refine(isRobotsDirective, FA.invalid));

/**
 * `robots` carries a DEFAULT rather than being merely optional: every service that stores these
 * fields reads `input.robots.trim()`, so a body that legitimately omitted the key (the schema
 * allowed it) crashed the category/brand/collection writes with a TypeError and a 500 instead of
 * saving. The default is the value those services fell back to anyway.
 */
export const seoFields = {
  seoTitle: zText(200).nullable().optional(),
  seoDescription: zText(400).nullable().optional(),
  robots: robotsSchema.default("index, follow"),
};

export const htmlField = (max: number) => z.preprocess(clean, z.string().max(max, FA.tooLong));

export const postSchema = z
  .object({
    id: zId.optional(),
    slug: zSlug,
    title: zText(200, 3),
    excerpt: zMultiline(500).default(""),
    bodyHtml: htmlField(200_000),
    coverMediaId: zUlid.nullable().optional(),
    authorName: zText(80).optional(),
    tags: z.array(zText(40, 1)).max(20, FA.tooLong).default([]),
    status: z.enum(CONTENT_STATUSES),
    publishedAt: zIsoDateTime.nullable().optional(),
    relatedProductIds: z.array(zId).max(12, FA.tooLong).default([]),
    ...seoFields,
  })
  .strict();

export const pageSchema = z
  .object({
    id: zId.optional(),
    slug: zSlug,
    title: zText(200, 2),
    bodyHtml: htmlField(200_000),
    template: z.enum(PAGE_TEMPLATES),
    status: z.enum(CONTENT_STATUSES),
    ...seoFields,
  })
  .strict();

export const faqSchema = z
  .object({
    id: zId.optional(),
    groupKey: zLatinKey,
    question: zText(300, 3),
    answerHtml: htmlField(20_000),
    sort: zSort,
    isActive: zBool.default(true),
  })
  .strict();

export type MenuItemInput = {
  label: string;
  kind: MenuItemKind;
  href?: string | undefined;
  ref?: string | undefined;
  imageMediaId?: string | null | undefined;
  badge?: string | undefined;
  children?: MenuItemInput[] | undefined;
};

export const MENU_MAX_DEPTH = 3;
export const MENU_MAX_CHILDREN = 30;

function menuItemAtDepth(depth: number): z.ZodType<MenuItemInput> {
  const base = z
    .object({
      label: zText(60, 1),
      kind: z.enum(MENU_ITEM_KINDS),
      href: zHref.optional(),
      ref: zText(200).optional(),
      imageMediaId: zUlid.nullable().optional(),
      badge: zText(20).optional(),
      children:
        depth < MENU_MAX_DEPTH
          ? z
              .array(z.lazy(() => menuItemAtDepth(depth + 1)))
              .max(MENU_MAX_CHILDREN, FA.tooLong)
              .optional()
          : z.array(z.never()).max(0, FA.invalid).optional(),
    })
    .strict()
    .superRefine((m, ctx) => {
      if (m.kind === "url" && !m.href) ctx.addIssue({ code: "custom", path: ["href"], message: FA.required });
      // A collection/brand/category/page item needs a handle the storefront can resolve. `ref` is
      // the slug the picker writes; `href` is the already-resolved path, and that is ALL the seeded
      // and imported rows carry (`menus.items_json` has no `ref`). Demanding `ref` made every menu
      // in the database unsaveable - the editor loaded an item without one and posted it straight
      // back. Either handle is enough; `setMenu` stores whichever arrives.
      if (m.kind !== "url" && !m.ref && !m.href) ctx.addIssue({ code: "custom", path: ["ref"], message: FA.required });
    });
  return base;
}

export const menuItemSchema: z.ZodType<MenuItemInput> = menuItemAtDepth(1);

export const menuSchema = z
  .object({
    key: z.enum(MENU_KEYS),
    items: z.array(menuItemSchema).max(MENU_MAX_CHILDREN, FA.tooLong),
  })
  .strict();

export const redirectSchema = z
  .object({
    id: zId.optional(),
    fromPath: zPath,
    toPath: zPath,
    code: z.union([z.literal(301), z.literal(410)]),
    isActive: zBool.default(true),
  })
  .strict()
  .refine((r) => r.fromPath !== r.toPath, { message: FA.invalid, path: ["toPath"] });

export const seoMetaSchema = z
  .object({
    entity: z.enum(["product", "category", "brand", "collection", "post", "page"]),
    id: zId,
    ...seoFields,
  })
  .strict();

export const slugParamSchema = z.object({ slug: zSlug }).strict();

export type PostInput = z.infer<typeof postSchema>;
export type PageInput = z.infer<typeof pageSchema>;
export type FaqInput = z.infer<typeof faqSchema>;
export type MenuInput = z.infer<typeof menuSchema>;
export type RedirectInput = z.infer<typeof redirectSchema>;
export type SeoMetaInput = z.infer<typeof seoMetaSchema>;
