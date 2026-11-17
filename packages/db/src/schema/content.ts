import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  smallint,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { staffUsers } from "./auth";
import { media } from "./catalog";
import { createdAt, tstz, ulid, updatedAt } from "./columns";
import { bannerSlot, bannerTheme, contentStatus, pageTemplate, redirectSource } from "./enums";

// ── jsonb shapes ───────────────────────────────────────────────────────────────────────────────

/** menus.items_json - the spec */
export type MenuItem = {
  label: string;
  href: string;
  kind: "url" | "collection" | "brand" | "category" | "page";
  /** the slug (or category path) a non-url item points at; the href is a cache derived from it */
  ref?: string;
  children?: MenuItem[];
  imageMediaId?: string;
  badge?: string;
};

/** banners.targeting_json - the spec */
export type BannerTargeting = {
  collectionSlug?: string;
  brandSlug?: string;
};

// ── posts (journal; legacy ids, root slugs) ────────────────────────────────────────────────────

export const posts = pgTable(
  "posts",
  {
    id: serial("id").primaryKey(),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    excerpt: text("excerpt"),
    bodyHtml: text("body_html").notNull().default(""),
    coverMediaId: ulid("cover_media_id").references(() => media.id),
    authorStaffId: ulid("author_staff_id").references(() => staffUsers.id, { onDelete: "set null" }),
    authorName: text("author_name"),
    tags: text("tags")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    status: contentStatus("status").notNull().default("draft"),
    publishedAt: tstz("published_at"),
    legacyLastmod: tstz("legacy_lastmod"),
    seoTitle: text("seo_title"),
    seoDescription: text("seo_description"),
    robots: text("robots").notNull().default("index, follow"),
    readMinutes: integer("read_minutes").notNull().default(0),
    relatedProductIds: integer("related_product_ids").array(),
    searchText: text("search_text")
      .notNull()
      .generatedAlwaysAs(sql`nl_fa_norm(concat_ws(' ', title, excerpt, array_to_string(tags, ' ')))`),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("posts_slug_uq").on(t.slug),
    index("posts_search_text_trgm_idx").using("gin", t.searchText.op("gin_trgm_ops")),
    index("posts_status_published_idx").on(t.status, t.publishedAt.desc()),
    index("posts_updated_at_idx").on(t.updatedAt),
  ],
);

// ── pages ──────────────────────────────────────────────────────────────────────────────────────

export const pages = pgTable(
  "pages",
  {
    id: serial("id").primaryKey(),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    bodyHtml: text("body_html").notNull().default(""),
    template: pageTemplate("template").notNull().default("default"),
    status: contentStatus("status").notNull().default("published"),
    seoTitle: text("seo_title"),
    seoDescription: text("seo_description"),
    robots: text("robots").notNull().default("index, follow"),
    legacyLastmod: tstz("legacy_lastmod"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("pages_slug_uq").on(t.slug), index("pages_status_idx").on(t.status)],
);

// ── faqs ───────────────────────────────────────────────────────────────────────────────────────

export const faqs = pgTable(
  "faqs",
  {
    id: serial("id").primaryKey(),
    groupKey: text("group_key").notNull(),
    question: text("question").notNull(),
    answerHtml: text("answer_html").notNull(),
    sort: integer("sort").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("faqs_group_sort_idx").on(t.groupKey, t.sort)],
);

// ── menus ──────────────────────────────────────────────────────────────────────────────────────

export const menus = pgTable(
  "menus",
  {
    id: serial("id").primaryKey(),
    key: text("key").notNull(),
    itemsJson: jsonb("items_json").$type<MenuItem[]>().notNull().default([]),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("menus_key_uq").on(t.key)],
);

// ── banners ────────────────────────────────────────────────────────────────────────────────────

export const banners = pgTable(
  "banners",
  {
    id: serial("id").primaryKey(),
    slot: bannerSlot("slot").notNull(),
    title: text("title"),
    subtitle: text("subtitle"),
    ctaLabel: text("cta_label"),
    ctaHref: text("cta_href"),
    mediaLightId: ulid("media_light_id").references(() => media.id),
    mediaDarkId: ulid("media_dark_id").references(() => media.id),
    theme: bannerTheme("theme").notNull().default("auto"),
    startsAt: tstz("starts_at"),
    endsAt: tstz("ends_at"),
    isActive: boolean("is_active").notNull().default(true),
    sort: integer("sort").notNull().default(0),
    targetingJson: jsonb("targeting_json").$type<BannerTargeting>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("banners_slot_active_sort_idx").on(t.slot, t.isActive, t.sort),
    check("banners_window_valid", sql`starts_at is null or ends_at is null or starts_at < ends_at`),
  ],
);

// ── redirects (the 752-URL contract's safety net) ──────────────────────────────────────────────

export const redirects = pgTable(
  "redirects",
  {
    id: serial("id").primaryKey(),
    fromPath: text("from_path").notNull(),
    toPath: text("to_path").notNull(),
    code: smallint("code").notNull().default(301),
    source: redirectSource("source").notNull(),
    hits: integer("hits").notNull().default(0),
    lastHitAt: tstz("last_hit_at"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("redirects_from_path_uq").on(t.fromPath),
    index("redirects_active_idx").on(t.isActive),
    check("redirects_code_valid", sql`code in (301, 410)`),
    check("redirects_from_path_leading_slash", sql`from_path like '/%'`),
    check("redirects_hits_nonneg", sql`hits >= 0`),
  ],
);

// ── seo_snapshots (parity crawls) ──────────────────────────────────────────────────────────────

export const seoSnapshots = pgTable(
  "seo_snapshots",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    runId: text("run_id").notNull(),
    path: text("path").notNull(),
    status: smallint("status"),
    title: text("title"),
    description: text("description"),
    canonical: text("canonical"),
    robots: text("robots"),
    h1: text("h1"),
    schemaTypes: text("schema_types").array(),
    crawledAt: tstz("crawled_at").notNull().defaultNow(),
  },
  (t) => [
    index("seo_snapshots_run_path_idx").on(t.runId, t.path),
    index("seo_snapshots_path_crawled_idx").on(t.path, t.crawledAt),
  ],
);
