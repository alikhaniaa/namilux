import { and, asc, eq, isNotNull, max, ne, pages as pagesTable } from "@namilux/db";
import type { Db } from "@namilux/db";
import type { Actor, SeoFields } from "../types";
import { appError } from "../errors";
import { audit } from "../audit";
import { faZwnj } from "../persian";
import { sanitizeHtml } from "../html";
import { absUrl, decPath, pageUrl } from "../url";
import { tags } from "../cache/tags";
import { tagsForPageChange } from "../cache/invalidation";
import { validateRedirectTarget } from "../catalog/archive";
import { lastmodFor } from "../seo/sitemaps";
import { insertRedirect } from "./redirects";

// DECISION (M0 step 3): PageTemplate is declared once in ../constants and PageView / PageInput once in
// ../types (the spec §content · getPageBySlug).
import type { PageTemplate } from "../constants";
import type { PageInput, PageView } from "../types";

export type { PageTemplate, PageInput, PageView };

export type PageStatus = "draft" | "published" | "archived";

export const LEGAL_TEMPLATES: readonly PageTemplate[] = ["privacy", "terms", "returns", "warranty"];

/**
 * DECISION - the header's inline `PageView` field list is superseded by ../types (src/index.ts
 * rules: "types/* wins; a module may only re-export a type it imports from ../types"; declaring it
 * twice is a TS2308 build break). Nothing is lost:
 *   • `href`           → `pageUrl(slug)` (../url, client-safe) - the one URL contract.
 *   • `robots`         → `seo.robots`; `legacyLastmod` → `seo.lastmod` (SeoFields carries both).
 *   • `faqs`           → `getFaqs(db)` from ./faq, which the FAQ page calls directly; keeping it out
 *                         of the view also keeps `getPageBySlug` to a single query for the other
 *                         eight templates.
 *   • `crumbs`         → «خانه» is Persian UI copy and the spec keeps UI copy in apps/web/src/i18n.
 *   • `jsonld`         → `jsonld.webPage(...)` / `jsonld.faq(...)` (seo/jsonld.ts, DONE). Their real
 *                         signatures need a `JsonLdCtx` (siteName + store settings + mediaUrl) that
 *                         this function's `ctx` cannot supply, so the caller composes it.
 *
 */

/**
 * rules: «Only one published page per template ∈ {…}; `default` is unlimited».
 * Derived from PAGE_TEMPLATES minus "default" so a new template cannot silently become unlimited.
 */
const SINGLETON_TEMPLATES: readonly PageTemplate[] = [
  "contact",
  "store",
  "faq",
  "privacy",
  "terms",
  "returns",
  "warranty",
  "installments",
  // DECISION: `about` joins the singletons for the same reason the other eight are here - the
  // template renders one identity (the shop's own story, the houses it carries, where to find it)
  // and two published copies of that would compete with each other in search. It is also why it is
  // a NEW value rather than a reuse of `contact` or `store`: both are singletons already claimed by
  // /contact-us/ and /store/, so About would have been a CONFLICT the moment it published.
  "about",
];

/**
 * rules: «the two legal legacy slugs … plus about-us / contact-us are contract URLs and must
 * always serve 200». They are named here so renaming, drafting or archiving one is a VALIDATION /
 * CONFLICT rather than a silent break of `pnpm check:contract`.
 */
const CONTRACT_PAGE_SLUGS: readonly string[] = [
  "about-us",
  "contact-us",
  "حریم-خصوصی-کاربران",
  "قوانین-و-مقررات-نامی-لوکس",
];

/** Mirrors content/posts.TITLE_SUFFIX - the row-level fallback of the spec */
const TITLE_SUFFIX = " - نامی لوکس";

/** Mirrors content/posts.LAUNCH_AT; see the DECISION there (seo/sitemaps keeps its own copy private). */
const LAUNCH_AT = "2026-09-01T00:00:00.000Z";

// ---------------------------------------------------------------- pure helpers

const iso = (d: Date | null): string | null => (d === null ? null : d.toISOString());

/** Root slugs are stored DECODED; a request may arrive either way. */
function slugKey(raw: string): string {
  if (typeof raw !== "string") return "";
  const trimmed = raw.trim().replace(/^\/+/, "").replace(/\/+$/, "");
  if (trimmed === "") return "";
  return decPath(trimmed).normalize("NFC");
}

const isLegalTemplate = (template: PageTemplate): boolean => LEGAL_TEMPLATES.includes(template);

type PageRow = {
  id: number;
  slug: string;
  title: string;
  bodyHtml: string;
  template: PageTemplate;
  status: PageStatus;
  seoTitle: string | null;
  seoDescription: string | null;
  robots: string;
  legacyLastmod: Date | null;
  updatedAt: Date;
};

const pageColumns = {
  id: pagesTable.id,
  slug: pagesTable.slug,
  title: pagesTable.title,
  bodyHtml: pagesTable.bodyHtml,
  template: pagesTable.template,
  status: pagesTable.status,
  seoTitle: pagesTable.seoTitle,
  seoDescription: pagesTable.seoDescription,
  robots: pagesTable.robots,
  legacyLastmod: pagesTable.legacyLastmod,
  updatedAt: pagesTable.updatedAt,
} as const;

function toPageView(row: PageRow, origin: string | undefined): PageView {
  const path = pageUrl(row.slug);
  const seoTitle = (row.seoTitle ?? "").trim();
  const seoDescription = (row.seoDescription ?? "").trim();

  const seo: SeoFields = {
    title: seoTitle === "" ? `${row.title}${TITLE_SUFFIX}` : seoTitle,
    // the spec: a missing legacy description stays missing - never auto-generated at launch.
    description: seoDescription === "" ? null : seoDescription,
    robots: row.robots,
    // DECISION: `canonical` (../types SeoFields) is the header's `canonicalPath` - site-relative and
    // already encoded - and becomes absolute only when the caller supplies its origin.
    canonical: origin === undefined || origin === "" ? path : absUrl(origin, path),
    // rules: «ogImagePath site fallback» - a page has no own image, so the site card is applied one
    // layer up by seo/metadata.buildMetadata (which already takes `defaultOgKey`).
    ogImage: null,
    lastmod: lastmodFor({
      legacyLastmod: iso(row.legacyLastmod),
      updatedAt: row.updatedAt.toISOString(),
      publishedAt: null,
      launchAt: LAUNCH_AT,
    }),
  };

  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    bodyHtml: row.bodyHtml,
    template: row.template,
    status: row.status,
    seo,
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ---------------------------------------------------------------- read

export async function getPageBySlug(
  db: Db,
  slug: string,
  ctx?: { origin?: string },
): Promise<PageView | null> {
  const key = slugKey(slug);
  if (key === "") return null;

  const rows = await db
    .select(pageColumns)
    .from(pagesTable)
    // rules: published only - a draft or archived page falls through to redirects, then 404.
    .where(and(eq(pagesTable.slug, key), eq(pagesTable.status, "published")))
    .limit(1);

  const row = rows[0];
  return row === undefined ? null : toPageView(row, ctx?.origin);
}

export async function getPageByTemplate(db: Db, template: PageTemplate): Promise<PageView | null> {
  const rows = await db
    .select(pageColumns)
    .from(pagesTable)
    .where(and(eq(pagesTable.template, template), eq(pagesTable.status, "published")))
    // The singleton rule makes this a single row; `id asc` keeps the answer deterministic if a
    // legacy import ever left two behind.
    .orderBy(asc(pagesTable.id))
    .limit(1);

  const row = rows[0];
  return row === undefined ? null : toPageView(row, undefined);
}

export async function listPagesForSitemap(
  db: Db,
): Promise<
  { slug: string; legacyLastmod: string | null; updatedAt: string; robots: string; template: PageTemplate }[]
> {
  const rows = await db
    .select({
      slug: pagesTable.slug,
      legacyLastmod: pagesTable.legacyLastmod,
      updatedAt: pagesTable.updatedAt,
      robots: pagesTable.robots,
      template: pagesTable.template,
    })
    .from(pagesTable)
    .where(eq(pagesTable.status, "published"))
    .orderBy(asc(pagesTable.id));

  return rows.map((row) => ({
    slug: row.slug,
    legacyLastmod: iso(row.legacyLastmod),
    updatedAt: row.updatedAt.toISOString(),
    robots: row.robots,
    template: row.template,
  }));
}

// ---------------------------------------------------------------- admin

/**
 * rules: «Legacy slugs immutable».
 * DECISION: the ceiling is derived rather than hard-coded - a legacy page is exactly a page the seed
 * gave a `legacy_lastmod` (the spec page-sitemap dates), so `max(id) where legacy_lastmod is not null`
 * IS "the max legacy id". CONTRACT_PAGE_SLUGS covers the four URLs that must serve 200 even if a
 * re-seed ever leaves one of them without a sitemap date.
 */
async function maxLegacyPageId(db: Db): Promise<number> {
  const rows = await db
    .select({ value: max(pagesTable.id) })
    .from(pagesTable)
    .where(isNotNull(pagesTable.legacyLastmod));
  return rows[0]?.value ?? 0;
}

/** rules: «LEGAL_TEMPLATES pages cannot be archived or set to draft» - enamad requires them live. */
function assertLegalPageStaysLive(template: PageTemplate, status: PageStatus): void {
  if (isLegalTemplate(template) && status !== "published") {
    throw appError("VALIDATION", {
      details: { field: "status", reason: "legal_page_must_stay_published", template },
    });
  }
}

/** rules: «Only one published page per template ∈ SINGLETON_TEMPLATES». */
async function assertTemplateFree(
  db: Db,
  template: PageTemplate,
  exceptId: number | undefined,
): Promise<void> {
  if (!SINGLETON_TEMPLATES.includes(template)) return;
  const where =
    exceptId === undefined
      ? and(eq(pagesTable.template, template), eq(pagesTable.status, "published"))
      : and(
          eq(pagesTable.template, template),
          eq(pagesTable.status, "published"),
          ne(pagesTable.id, exceptId),
        );
  const clash = await db.select({ id: pagesTable.id }).from(pagesTable).where(where).limit(1);
  if (clash.length > 0) {
    throw appError("VALIDATION", {
      details: { field: "template", reason: "template_already_published", template },
    });
  }
}

export async function upsertPage(
  db: Db,
  input: PageInput,
  actor: Actor,
): Promise<{ id: number; tags: string[] }> {
  const slug = slugKey(input.slug);
  if (slug === "") throw appError("VALIDATION", { details: { field: "slug", reason: "required" } });

  const title = faZwnj((input.title ?? "").trim());
  if (title === "") throw appError("VALIDATION", { details: { field: "title", reason: "required" } });

  const template = input.template;
  const status = input.status;
  assertLegalPageStaysLive(template, status);

  // the spec: sanitized at WRITE time; RichHtml sanitizes again at render.
  const bodyHtml = sanitizeHtml(input.bodyHtml ?? "", { allowImages: true });

  const existing =
    input.id === undefined
      ? undefined
      : (await db.select(pageColumns).from(pagesTable).where(eq(pagesTable.id, input.id)).limit(1))[0];

  if (input.id !== undefined && existing === undefined) {
    throw appError("NOT_FOUND", { details: { entity: "page", id: input.id } });
  }

  if (status === "published") await assertTemplateFree(db, template, existing?.id);

  const values = {
    slug,
    title,
    bodyHtml,
    template,
    status,
    seoTitle: input.seoTitle ?? null,
    seoDescription: input.seoDescription ?? null,
    robots: input.robots ?? "index, follow",
  };

  if (existing === undefined) {
    const inserted = await db.insert(pagesTable).values(values).returning({ id: pagesTable.id });
    const row = inserted[0];
    if (row === undefined) throw appError("INTERNAL", { details: { reason: "page_insert_failed" } });
    await audit.log(db, actor, "page.create", "page", String(row.id), undefined, values);
    return { id: row.id, tags: tagsForPageChange(slug) };
  }

  // A legal page that is already live must not be demoted through its own template either.
  assertLegalPageStaysLive(existing.template, status);

  const slugChanged = existing.slug !== slug;
  if (slugChanged) {
    const isContractSlug = CONTRACT_PAGE_SLUGS.includes(existing.slug);
    if (isContractSlug || existing.id <= (await maxLegacyPageId(db))) {
      throw appError("CONFLICT", {
        details: { field: "slug", reason: "legacy_slug_immutable", id: existing.id },
      });
    }
  }

  await db
    .update(pagesTable)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(pagesTable.id, existing.id));
  await audit.log(db, actor, "page.update", "page", String(existing.id), existing, values);

  const changed = tagsForPageChange(slug);
  // rules: «+ nav when the title changed because footer menus may show it».
  if (existing.title !== title) changed.push(tags.nav);
  if (slugChanged) {
    // The row above already moved, so the old path no longer serves 200 and a `manual` redirect is
    // legal (redirects.prepareRedirect refuses manual rows on live paths).
    await insertRedirect(
      db,
      { fromPath: `/${existing.slug}/`, toPath: `/${slug}/`, code: 301, source: "manual" },
      actor,
    );
    changed.push(...tagsForPageChange(existing.slug));
  }
  return { id: existing.id, tags: [...new Set(changed)].sort() };
}

export async function archivePage(
  db: Db,
  id: number,
  redirectTo: string,
  actor: Actor,
): Promise<void> {
  const rows = await db.select(pageColumns).from(pagesTable).where(eq(pagesTable.id, id)).limit(1);
  const row = rows[0];
  if (row === undefined) throw appError("NOT_FOUND", { details: { entity: "page", id } });

  // rules: a legal page is never archived, and neither is one of
  // the four contract URLs of the spec
  if (isLegalTemplate(row.template)) {
    throw appError("VALIDATION", {
      details: { field: "template", reason: "legal_page_must_stay_published", template: row.template },
    });
  }
  if (CONTRACT_PAGE_SLUGS.includes(row.slug)) {
    throw appError("VALIDATION", {
      details: { field: "slug", reason: "contract_url_must_serve_200", slug: row.slug },
    });
  }

  const fromPath = `/${row.slug}/`;
  const target = typeof redirectTo === "string" ? redirectTo.trim() : "";
  if (target === "") {
    throw appError("VALIDATION", { details: { field: "redirectTo", reason: "required" } });
  }
  // contract: «explicit target required (no default rule for pages)» - the shape, the loop guard and
  // the "must serve 200" check all live in catalog/archive.validateRedirectTarget.
  validateRedirectTarget(fromPath, target);

  // EDGE CASE: archiving twice writes one redirect row and one audit entry.
  if (row.status === "archived") return;

  await db
    .update(pagesTable)
    .set({ status: "archived", updatedAt: new Date() })
    .where(eq(pagesTable.id, id));

  await insertRedirect(
    db,
    { fromPath, toPath: target, code: 301, source: "auto_archive" },
    actor,
  );

  await audit.log(
    db,
    actor,
    "page.archive",
    "page",
    String(id),
    { status: row.status },
    { status: "archived", redirectTo: target },
  );
  // DECISION: the contract returns void, so the tag list cannot be handed back; the admin route
  // revalidates with `tagsForPageChange(slug)` (+ the URL purge of cache/urls.ts), as upsert does.
}
