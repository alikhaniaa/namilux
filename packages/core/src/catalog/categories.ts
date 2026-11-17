import { and, categories as categoriesTable, eq, isNull, sql } from "@namilux/db";
import type { Db, Row } from "@namilux/db";
import type { Actor } from "../types";
// DECISION (M0 step 3): CategoryStatus is declared once in ../constants and Crumb / SeoFields /
// CategoryChild / CategoryView once in ../types. Re-exported here so ./brands, ./collections,
// ./products.service, ../content/* keep importing them from this module.
import type { CategoryStatus } from "../constants";
import type { CategoryChild, CategoryView, Crumb, SeoFields } from "../types";
import { appError, isAppError } from "../errors";
import { faZwnj } from "../persian";
import { sanitizeHtml } from "../html";
import { ROUTES, categoryUrl } from "../url";
import { audit } from "../audit";
import { tags as cacheTags } from "../cache/tags";
import { insertRedirect } from "../content/redirects";

export type { CategoryStatus, CategoryChild, CategoryView, Crumb, SeoFields };

export type CategoryTreeNode = CategoryChild & {
  parentId: number | null;
  status: CategoryStatus;
  inSitemap: boolean;
  robots: string;
  sort: number;
  children: CategoryTreeNode[];
};

export type CategoryInput = {
  id?: number;
  parentId: number | null;
  slug: string;
  name: string;
  descriptionHtml: string;
  seoTitle: string | null;
  seoDescription: string | null;
  robots: string;
  inSitemap: boolean;
  status: CategoryStatus;
  sort: number;
};

// ---------------------------------------------------------------- constants

/**
 * DECISION: the header's `CategoryView`/`CategoryChild` contract (parent, productCount,
 * buyableCount, legacyLastmod, updatedAt, jsonld; children keyed `slug`/`productCount`) is NOT the
 * declaration this module may emit - `../types/product.ts` owns both names (M0 step 3, src/index.ts
 * rules: "types/* wins; a module may only re-export a type it imports from ../types") and this file
 * already re-exports them above. The read side therefore returns the canonical shape:
 * `{ id, slug, path, name, descriptionHtml, status, inSitemap, crumbs, children, parentId, seo }`
 * with `CategoryChild = { id, name, path, count }`. Nothing is lost that the storefront needs: the
 * ancestor chain is in `crumbs`, `parentId` replaces `parent`, `seo.lastmod` carries
 * legacy_lastmod ?? updated_at, and the PLP's «کالای آماده» count comes from `facets.avail.ready`
 * (list.ts), which is the number the grid actually renders.
 */
const SITE_TITLE_SUFFIX = " - نامی لوکس";

/** the spec: `categories.robots` defaults to this; a blank stored value degrades to it, never to "". */
const DEFAULT_ROBOTS = "index, follow";

/** rules: a hidden category keeps its legacy URL but leaves the index. */
const HIDDEN_ROBOTS = "noindex, follow";

/**
 * DECISION: the two crumb labels are written here rather than in an `i18n/fa.ts` because
 * `packages/core` has no i18n bundle (apps own theirs, the spec) and this module's own rules spell
 * the two strings verbatim: «خانه» and «فروشگاه». They are data of the contract, not UI copy.
 */
const CRUMB_HOME = "خانه";
const CRUMB_SHOP = "فروشگاه";

/**
 * rules: "a legacy category (id ≤ the seed's max legacy id)". The legacy WordPress term ids run
 * 24…287 (`data/extract/04_catalog/categories.csv`, 73 rows) and the seed sets the serial sequence
 * past them, so every row the admin creates gets a higher id.
 * DECISION: the bound is a constant here, exactly as `LEGACY_BRAND_IDS` is a constant in ./brands - 
 * there is no marker column, and a runtime `max(id)` would grow with every new row and stop
 * protecting anything.
 */
const LEGACY_CATEGORY_MAX_ID = 287;

/**
 * rules: these two legacy paths are live 301s and must never resolve to a category page,
 * whatever a later admin edit does to the rows. `محصولات-اسمگ` is seeded `archived`; `بلاگ` has no
 * row at all. The guard is defence in depth, so the two contract URLs cannot silently start
 * serving 200 and shadow their redirects.
 */
const REDIRECTED_CATEGORY_PATHS: readonly string[] = ["بلاگ", "محصولات-اسمگ"];

/** Recursion guard for the ancestor walk - a data cycle must not hang a request. */
const MAX_TREE_DEPTH = 32;

/** zSlug (validation/common.ts) verbatim: no whitespace and none of / ? # % \. */
const SLUG_RE = /^[^\s/?#%\\]+$/;
const SLUG_MAX = 200;

type CategoryRow = Row<typeof categoriesTable>;

// ---------------------------------------------------------------- pure helpers

const stripSlashes = (s: string): string => s.replace(/\/{2,}/g, "/").replace(/^\/+/, "").replace(/\/+$/, "");

/**
 * EDGE CASE: "path with a trailing slash or leading /category/ passed by mistake → normalized
 * before lookup, not 404". The "category" prefix is stripped BEFORE the trailing slash so that the
 * bare "/category/" is recognised as an empty path (same order as url/routes.categoryUrl).
 */
function normalizeCategoryPath(raw: string): string {
  let p = raw.trim().replace(/\/{2,}/g, "/").replace(/^\/+/, "");
  if (p === "category" || p.startsWith("category/")) p = p.slice("category".length).replace(/^\/+/, "");
  return p.replace(/\/+$/, "").normalize("NFC");
}

export function buildPath(parentPath: string | null, slug: string): string {
  const child = stripSlashes(slug.trim()).normalize("NFC");
  // DECISION: an empty slug throws instead of minting "parent/" or "" - a path is a URL, and an
  // empty segment would produce "/category//" (url/routes.ts refuses the same input).
  if (child === "") throw new RangeError("buildPath: slug must not be empty");
  const parent = parentPath === null ? "" : stripSlashes(parentPath.trim()).normalize("NFC");
  return parent === "" ? child : `${parent}/${child}`;
}

export function categoryPagePath(path: string): string {
  const p = normalizeCategoryPath(path);
  if (p === "") throw new RangeError("categoryPagePath: path must not be empty");
  return `/category/${p}/`;
}

/**
 * DECISION: `SeoFields.canonical` carries the DECODED site path (as products.service.ts spells it:
 * "canonicalPath … decoded - the page encodes via productUrl"). seo/metadata.ts runs `encPath` on
 * `MetaInput.path`, so an already-encoded value here would be double-encoded and break the spec
 * contract. `Crumb.href`, by contrast, is encoded (types/common.ts) and goes through `categoryUrl`.
 */
function seoFor(row: CategoryRow): SeoFields {
  const title = row.seoTitle?.trim() ?? "";
  const description = row.seoDescription?.trim() ?? "";
  const robots = row.robots.trim();
  return {
    title: title === "" ? `${row.name}${SITE_TITLE_SUFFIX}` : title,
    // the spec: "86 missing descriptions stay missing until Phase 2" - never invented here.
    description: description === "" ? null : description,
    robots: row.status === "hidden" ? HIDDEN_ROBOTS : robots === "" ? DEFAULT_ROBOTS : robots,
    canonical: categoryPagePath(row.path),
    // DECISION: null, i.e. the site default. The header names `seo/og.ts` for the OG key, but that
    // module was not yet built when this was written and every one of its exports throws, so calling it would 404 every
    // category page. A category has no card of its own (rules), so the site fallback is also the
    // documented outcome. When og.ts lands, swap this for `ogKeyFor({ kind: "category", id })`.
    ogImage: null,
    // the spec: lastmod = legacy_lastmod until the entity is edited after launch, then updated_at.
    lastmod: (row.legacyLastmod ?? row.updatedAt).toISOString(),
  };
}

// ---------------------------------------------------------------- read side

const CATEGORY_COLUMNS = {
  id: categoriesTable.id,
  parentId: categoriesTable.parentId,
  slug: categoriesTable.slug,
  path: categoriesTable.path,
  name: categoriesTable.name,
  descriptionHtml: categoriesTable.descriptionHtml,
  seoTitle: categoriesTable.seoTitle,
  seoDescription: categoriesTable.seoDescription,
  robots: categoriesTable.robots,
  inSitemap: categoriesTable.inSitemap,
  legacyLastmod: categoriesTable.legacyLastmod,
  status: categoriesTable.status,
  sort: categoriesTable.sort,
  createdAt: categoriesTable.createdAt,
  updatedAt: categoriesTable.updatedAt,
} as const;

async function findRowById(db: Db, id: number): Promise<CategoryRow | undefined> {
  const rows = await db.select(CATEGORY_COLUMNS).from(categoriesTable).where(eq(categoriesTable.id, id)).limit(1);
  return rows[0];
}

/**
 * Children of `id` (status=active only, rules) with the number of DISTINCT active+public products in
 * each child's own subtree. One statement: a product that sits in both a category and one of its
 * descendants is counted once, which a per-row count plus an in-memory roll-up could not do.
 */
async function childrenWithCounts(db: Db, id: number): Promise<CategoryChild[]> {
  const rows = (await db.execute(sql`
    with recursive tree as (
      select id as root, id as node from categories where parent_id = ${id}
      union
      select t.root, c.id from categories c join tree t on c.parent_id = t.node
    )
    select ch.id as id, ch.name as name, ch.path as path,
           count(distinct p.id)::int as n
      from categories ch
      join tree t on t.root = ch.id
      left join product_categories pc on pc.category_id = t.node
      left join products p on p.id = pc.product_id and p.status = 'active' and p.visibility = 'public'
     where ch.parent_id = ${id} and ch.status = 'active'
     group by ch.id, ch.name, ch.path, ch.sort
     order by ch.sort asc, ch.name asc
  `)) as unknown as { id: number; name: string; path: string; n: number }[];
  return rows.map((r) => ({ id: r.id, name: r.name, path: r.path, count: Number(r.n) }));
}

export async function getCategoryByPath(db: Db, path: string): Promise<CategoryView | null> {
  const wanted = normalizeCategoryPath(path);
  if (wanted === "") return null;
  // rules: the two live 301 paths are never a category page.
  if (REDIRECTED_CATEGORY_PATHS.includes(wanted)) return null;

  const rows = await db
    .select(CATEGORY_COLUMNS)
    .from(categoriesTable)
    .where(eq(categoriesTable.path, wanted))
    .limit(1);
  const row = rows[0];
  if (row === undefined) return null;
  // rules: archived → null; the router then consults resolveRedirect.
  if (row.status === "archived") return null;

  const [crumbs, children] = await Promise.all([crumbsFor(db, row.id), childrenWithCounts(db, row.id)]);

  return {
    id: row.id,
    slug: row.slug,
    path: row.path,
    name: row.name,
    // the spec: stored HTML was sanitized at write; RichHtml sanitizes again at render.
    descriptionHtml: row.descriptionHtml ?? "",
    status: row.status,
    inSitemap: row.inSitemap,
    crumbs,
    children,
    parentId: row.parentId,
    seo: seoFor(row),
  };
}

export async function descendantIds(db: Db, id: number): Promise<number[]> {
  if (!Number.isSafeInteger(id) || id <= 0) return [];
  // `union` (not `union all`) terminates even if the data ever contained a parent cycle.
  const rows = (await db.execute(sql`
    with recursive sub as (
      select id, status from categories where id = ${id}
      union
      select c.id, c.status from categories c join sub s on c.parent_id = s.id
    )
    select id from sub where status <> 'archived' order by id asc
  `)) as unknown as { id: number }[];
  return rows.map((r) => Number(r.id));
}

export async function ancestorIds(db: Db, id: number): Promise<number[]> {
  if (!Number.isSafeInteger(id) || id <= 0) return [];
  const rows = (await db.execute(sql`
    with recursive up as (
      select id, parent_id, 0 as depth from categories where id = ${id}
      union all
      select c.id, c.parent_id, u.depth + 1
        from categories c join up u on c.id = u.parent_id
       where u.depth < ${MAX_TREE_DEPTH}
    )
    select id from up where depth > 0 order by depth asc
  `)) as unknown as { id: number }[];
  return rows.map((r) => Number(r.id));
}

export async function crumbsFor(db: Db, id: number): Promise<Crumb[]> {
  const chain = (await db.execute(sql`
    with recursive up as (
      select id, parent_id, name, path, 0 as depth from categories where id = ${id}
      union all
      select c.id, c.parent_id, c.name, c.path, u.depth + 1
        from categories c join up u on c.id = u.parent_id
       where u.depth < ${MAX_TREE_DEPTH}
    )
    select name, path from up order by depth desc
  `)) as unknown as { name: string; path: string }[];

  // types/common.ts: `Crumb.href` is already url-encoded - every category href goes through
  // `categoryUrl` (the spec: no URL is emitted outside packages/core/src/url/*).
  return [
    { name: CRUMB_HOME, href: ROUTES.home },
    { name: CRUMB_SHOP, href: ROUTES.shop },
    ...chain.map((c) => ({ name: c.name, href: categoryUrl(c.path) })),
  ];
}

export async function listCategoryTree(db: Db): Promise<CategoryTreeNode[]> {
  // DECISION: archived rows are excluded. They have no URL any more (getCategoryByPath returns null
  // and a redirect took over), so neither the nav nor the admin tree may offer them as a parent;
  // un-archiving is the archive flow's job, not the tree editor's.
  const rows = (await db.execute(sql`
    with recursive tree as (
      select id as root, id as node from categories
      union
      select t.root, c.id from categories c join tree t on c.parent_id = t.node
    )
    select c.id as id, c.parent_id as parent_id, c.name as name, c.path as path,
           c.status as status, c.in_sitemap as in_sitemap, c.robots as robots, c.sort as sort,
           count(distinct p.id)::int as n
      from categories c
      join tree t on t.root = c.id
      left join product_categories pc on pc.category_id = t.node
      left join products p on p.id = pc.product_id and p.status = 'active' and p.visibility = 'public'
     where c.status <> 'archived'
     group by c.id
     order by c.sort asc, c.name asc
  `)) as unknown as {
    id: number;
    parent_id: number | null;
    name: string;
    path: string;
    status: CategoryStatus;
    in_sitemap: boolean;
    robots: string;
    sort: number;
    n: number;
  }[];

  const byId = new Map<number, CategoryTreeNode>();
  for (const r of rows) {
    byId.set(r.id, {
      id: r.id,
      name: r.name,
      path: r.path,
      count: Number(r.n),
      parentId: r.parent_id,
      status: r.status,
      inSitemap: r.in_sitemap,
      robots: r.robots,
      sort: r.sort,
      children: [],
    });
  }

  const roots: CategoryTreeNode[] = [];
  for (const node of byId.values()) {
    const parent = node.parentId === null ? undefined : byId.get(node.parentId);
    // A child whose parent is archived (and therefore absent) is re-attached at the root rather
    // than dropped: the admin must still be able to see and move it.
    if (parent === undefined) roots.push(node);
    else parent.children.push(node);
  }
  return roots;
}

// ---------------------------------------------------------------- write side

function assertSlug(slug: string): string {
  const s = slug.trim();
  if (s === "" || s.length > SLUG_MAX || !SLUG_RE.test(s) || s.includes("..")) {
    throw appError("VALIDATION", { details: { field: "slug", reason: "invalid_slug" } });
  }
  return s.normalize("NFC");
}

/** UNIQUE(parent_id, slug) with NULLS NOT DISTINCT - checked before the write so the error is ours. */
async function assertNoSiblingClash(
  db: Db,
  parentId: number | null,
  slug: string,
  selfId: number | undefined,
): Promise<void> {
  const rows = await db
    .select({ id: categoriesTable.id })
    .from(categoriesTable)
    .where(
      and(
        parentId === null ? isNull(categoriesTable.parentId) : eq(categoriesTable.parentId, parentId),
        eq(categoriesTable.slug, slug),
      ),
    );
  if (rows.some((r) => r.id !== selfId)) {
    throw appError("CONFLICT", { details: { field: "slug", reason: "sibling_slug_taken", slug } });
  }
}

/**
 * Every row of the moved subtree (the node itself excluded) with its current path, deepest last so
 * the UPDATEs never transiently violate `categories_path_uq`.
 */
async function subtreePaths(db: Db, id: number): Promise<{ id: number; path: string }[]> {
  const rows = (await db.execute(sql`
    with recursive sub as (
      select id, path, 0 as depth from categories where id = ${id}
      union all
      select c.id, c.path, s.depth + 1
        from categories c join sub s on c.parent_id = s.id
       where s.depth < ${MAX_TREE_DEPTH}
    )
    select id, path from sub where depth > 0 order by depth asc, id asc
  `)) as unknown as { id: number; path: string }[];
  return rows.map((r) => ({ id: Number(r.id), path: r.path }));
}

/**
 * rules: "old paths get `redirects` rows (source manual)".
 * DECISION: a from_path that already redirects somewhere is left alone instead of aborting the
 * whole rename - `insertRedirect` is deliberately not an upsert (re-targeting a row is an explicit
 * admin edit), and losing one historical hop must never cost the admin the edit.
 */
async function redirectOldPath(db: Db, fromPath: string, toPath: string, actor: Actor): Promise<void> {
  if (fromPath === toPath) return;
  try {
    await insertRedirect(db, { fromPath, toPath, code: 301, source: "manual" }, actor);
  } catch (err: unknown) {
    if (isAppError(err) && err.code === "CONFLICT") return;
    throw err;
  }
}

export async function upsertCategory(
  db: Db,
  input: CategoryInput,
  actor: Actor,
): Promise<{ id: number; tags: string[] }> {
  const slug = assertSlug(input.slug);
  // the spec §3.7 - orthography at write, sanitizer at write.
  const name = faZwnj(input.name.trim());
  if (name === "") throw appError("VALIDATION", { details: { field: "name", reason: "required" } });
  const descriptionHtml = sanitizeHtml(input.descriptionHtml ?? "");
  const robots = input.robots.trim() === "" ? DEFAULT_ROBOTS : input.robots.trim();
  const parentId = input.parentId;
  const sort = Number.isSafeInteger(input.sort) ? input.sort : 0;

  const result = await db.transaction(async (tx) => {
    let parentPath: string | null = null;
    if (parentId !== null) {
      const parent = await findRowById(tx, parentId);
      if (parent === undefined) {
        throw appError("VALIDATION", { details: { field: "parentId", reason: "unknown_parent" } });
      }
      parentPath = parent.path;
    }

    const values = {
      parentId,
      slug,
      name,
      descriptionHtml,
      seoTitle: input.seoTitle,
      seoDescription: input.seoDescription,
      robots,
      inSitemap: input.inSitemap,
      status: input.status,
      sort,
    };

    if (input.id === undefined) {
      await assertNoSiblingClash(tx, parentId, slug, undefined);
      const path = buildPath(parentPath, slug);
      const inserted = await tx
        .insert(categoriesTable)
        .values({ ...values, path })
        .returning({ id: categoriesTable.id });
      const created = inserted[0];
      if (created === undefined) throw appError("INTERNAL", { details: { reason: "insert_returned_nothing" } });
      await audit.log(tx, actor, "category.create", "category", String(created.id), undefined, {
        ...values,
        path,
      });
      return { id: created.id, previousParentId: null as number | null };
    }

    const before = await findRowById(tx, input.id);
    if (before === undefined) throw appError("NOT_FOUND", { details: { entity: "category", id: input.id } });

    const isLegacy = before.id <= LEGACY_CATEGORY_MAX_ID;
    if (isLegacy && (slug !== before.slug || parentId !== before.parentId)) {
      // rules / the spec: every URL that ever existed keeps working - a legacy path is frozen.
      throw appError("CONFLICT", {
        details: { field: slug !== before.slug ? "slug" : "parentId", reason: "legacy_path_immutable", id: before.id },
      });
    }

    if (parentId !== null) {
      // EDGE CASE: parentId = self or one of the node's own descendants → VALIDATION.
      const own = await subtreePaths(tx, before.id);
      if (parentId === before.id || own.some((d) => d.id === parentId)) {
        throw appError("VALIDATION", { details: { field: "parentId", reason: "cycle" } });
      }
    }

    await assertNoSiblingClash(tx, parentId, slug, before.id);

    const path = buildPath(parentPath, slug);
    await tx.update(categoriesTable).set({ ...values, path }).where(eq(categoriesTable.id, before.id));

    if (path !== before.path) {
      // The subtree carries the node's path as a prefix; rewrite it depth-first, then hand every
      // old page path to `redirects` (the UPDATEs come first so the old paths no longer serve 200).
      const moved: { from: string; to: string }[] = [{ from: before.path, to: path }];
      for (const node of await subtreePaths(tx, before.id)) {
        const nextPath = `${path}${node.path.slice(before.path.length)}`;
        if (nextPath === node.path) continue;
        await tx.update(categoriesTable).set({ path: nextPath }).where(eq(categoriesTable.id, node.id));
        moved.push({ from: node.path, to: nextPath });
      }
      for (const m of moved) {
        await redirectOldPath(tx, categoryPagePath(m.from), categoryPagePath(m.to), actor);
      }
    }

    await audit.log(tx, actor, "category.update", "category", String(before.id), before, { ...values, path });
    return { id: before.id, previousParentId: before.parentId };
  });

  // rules: category(id) + ancestors' category tags + nav + catalog + sitemap. A move also
  // invalidates the branch the node came from (over-invalidation beats staleness, the spec).
  const ids = new Set<number>([result.id]);
  for (const a of await ancestorIds(db, result.id)) ids.add(a);
  if (result.previousParentId !== null && result.previousParentId !== parentId) {
    ids.add(result.previousParentId);
    for (const a of await ancestorIds(db, result.previousParentId)) ids.add(a);
  }

  // DECISION: the tag list is built from ../cache/tags (the vocabulary) rather than through
  // ../cache/invalidation.tagsForCategoryChange, which the header names in dependency list: that
  // function was not yet built when this was written (it throws) and its documented output covers only id + parent,
  // not the whole ancestor chain this rules line requires.
  const tags = [
    ...[...ids].map((id) => cacheTags.category(id)),
    cacheTags.nav,
    cacheTags.catalog,
    cacheTags.sitemap,
  ];
  return { id: result.id, tags };
}
