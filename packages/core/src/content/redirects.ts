import {
  and,
  brands,
  categories,
  count,
  desc,
  eq,
  events,
  gte,
  ilike,
  isNull,
  lte,
  or,
  pages,
  posts,
  products,
  redirects as redirectsTable,
  sql,
} from "@namilux/db";
import type { Db } from "@namilux/db";
import type { Actor } from "../types";
import type { Paged } from "../catalog/list";
import { ERROR_FA, appError, isAppError } from "../errors";
import { audit } from "../audit";
import {
  ROUTES,
  decPath,
  encPath,
  ensureTrailingSlash,
  legacyMyAccountRedirect,
  legacyPaginationRedirect,
  pathOnly,
} from "../url";

export type RedirectHit = { to: string; code: 301 | 410 };

export type StaticRule = { name: string; test: (decodedPath: string) => RedirectHit | null };

export const STATIC_ROUTES: readonly string[] = [
  "/",
  "/shop/",
  "/blog/",
  "/discount/",
  "/new/",
  "/gifts/",
  "/search/",
  "/cart/",
  "/compare/",
  "/wishlist/",
  "/track/",
  "/billing/",
  "/account/",
  "/offline/",
  "/ig/",
];

// ── pure path normalisation ────────────────────────────────────────────────────────────────────

/**
 * A trailing file extension suppresses the trailing slash ("/robots.txt", "/locations.kml").
 * DECISION: the extension must START with a letter, so a slug that merely ends in a decimal
 * ("kf-2.0", "-1.5l") still gets its trailing slash and keeps the spec contract.
 */
const FILE_EXTENSION_RE = /\.[a-z][a-z0-9]{1,11}$/;

const MULTI_SLASH_RE = /\/{2,}/g;

/**
 * C0/C1 control characters (NUL, CR, LF …). Stripped from every path and referrer: a raw newline in
 * a stored to_path would become a header-splitting `Location:` value. Two literals because
 * a /g regex carries `lastIndex` state and must never be shared with `.test()`.
 */
// eslint-disable-next-line no-control-regex -- the guard exists to remove exactly these (CR/LF included: a stored to_path must never split a Location header)
const CONTROL_CHARS_G = /[\u0000-\u001f\u007f-\u009f]/g;
// eslint-disable-next-line no-control-regex -- same class as the line above; the guard exists to remove exactly these (CR/LF included: a stored to_path must never split a Location header)
const CONTROL_CHARS_RE = /[\u0000-\u001f\u007f-\u009f]/;

const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

export function normalizePath(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed === "") return "/";
  // decPath never throws on malformed percent-encoding: the segment is passed through verbatim.
  const decoded = decPath(pathOnly(trimmed)).normalize("NFC").replace(CONTROL_CHARS_G, "");
  // DECISION: `toLowerCase()` is applied to the whole path rather than to "Latin segments" only - 
  // Persian/Arabic letters have no case, so the two readings are identical on every path this repo
  // can produce, and one call cannot drift from a hand-rolled segment classifier.
  const collapsed = decoded.toLowerCase().replace(MULTI_SLASH_RE, "/");
  const withLeadingSlash = collapsed.startsWith("/") ? collapsed : `/${collapsed}`;
  if (withLeadingSlash === "/") return "/";
  const lastSegment = withLeadingSlash.slice(withLeadingSlash.lastIndexOf("/") + 1);
  if (lastSegment !== "" && FILE_EXTENSION_RE.test(lastSegment)) return withLeadingSlash;
  return ensureTrailingSlash(withLeadingSlash);
}

/** Encode a decoded site-relative target, keeping an already-ASCII "?page=N" query untouched. */
function encodeTarget(decodedTarget: string): string {
  if (decodedTarget === "") return "";
  const cut = decodedTarget.search(/[?#]/);
  if (cut === -1) return encPath(decodedTarget);
  return `${encPath(decodedTarget.slice(0, cut))}${decodedTarget.slice(cut)}`;
}

/**
 * Open-redirect guard (rules): a target is only ever a site-relative path. Checked on the RAW value
 * BEFORE normalisation - normalizePath("https://evil.example/") would collapse "//" and prepend a
 * "/", turning a hostile absolute URL into something that looks site-relative.
 */
function assertSiteRelative(field: "fromPath" | "toPath", raw: string): void {
  const value = raw.trim();
  if (
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.startsWith("/\\") ||
    SCHEME_RE.test(value) ||
    CONTROL_CHARS_RE.test(value)
  ) {
    throw appError("VALIDATION", { details: { field, reason: "must_be_site_relative" } });
  }
}

// ── static pattern rules (pure, evaluated by proxy.ts before routing) ──────────────────────────

const CHECKOUT_PREFIX = "/checkout/";
const MY_ACCOUNT_PREFIX = "/my-account/";
const PRODUCT_CATEGORY_PREFIX = "/product-category/";
const CATEGORY_PREFIX = "/category/";
const SITEMAP_LEGACY_PATH = "/sitemap.xml";
const LOCATIONS_KML_PATH = "/locations.kml";

/**
 * DECISION: legacy pagination is matched only under the four bases the contract names
 * (/shop/, /category/, /brand/, /blog/) even though `legacyPaginationRedirect` is generic - the root
 * namespace holds 165 post/page slugs and a generic rule would shadow any of them that
 * ever gained a "/page/N/" child.
 */
const PAGINATION_PREFIXES: readonly string[] = ["/shop/", CATEGORY_PREFIX, "/brand/", "/blog/"];

export const STATIC_REDIRECT_RULES: readonly StaticRule[] = [
  {
    name: "checkout",
    test: (decodedPath: string): RedirectHit | null => {
      const path = normalizePath(decodedPath);
      return path.startsWith(CHECKOUT_PREFIX) ? { to: ROUTES.billing, code: 301 } : null;
    },
  },
  {
    name: "my-account",
    test: (decodedPath: string): RedirectHit | null => {
      const path = normalizePath(decodedPath);
      if (!path.startsWith(MY_ACCOUNT_PREFIX)) return null;
      const target = legacyMyAccountRedirect(path);
      return target === null ? null : { to: target, code: 301 };
    },
  },
  {
    name: "pagination",
    test: (decodedPath: string): RedirectHit | null => {
      const path = normalizePath(decodedPath);
      if (!PAGINATION_PREFIXES.some((prefix) => path.startsWith(prefix))) return null;
      const target = legacyPaginationRedirect(path);
      return target === null ? null : { to: encodeTarget(target), code: 301 };
    },
  },
  {
    name: "sitemap",
    test: (decodedPath: string): RedirectHit | null =>
      normalizePath(decodedPath) === SITEMAP_LEGACY_PATH ? { to: ROUTES.sitemapIndex, code: 301 } : null,
  },
  {
    name: "locations-kml",
    test: (decodedPath: string): RedirectHit | null =>
      normalizePath(decodedPath) === LOCATIONS_KML_PATH ? { to: "", code: 410 } : null,
  },
  {
    name: "product-category",
    test: (decodedPath: string): RedirectHit | null => {
      const path = normalizePath(decodedPath);
      if (!path.startsWith(PRODUCT_CATEGORY_PREFIX)) return null;
      const rest = path.slice(PRODUCT_CATEGORY_PREFIX.length);
      // DECISION: the bare base "/product-category/" has no category path to carry over, so it does
      // NOT match - it falls through to the redirects table and then to a 404 instead of minting the
      // meaningless "/category/".
      if (rest === "") return null;
      return { to: encodeTarget(`${CATEGORY_PREFIX}${rest}`), code: 301 };
    },
  },
];

export function matchStaticRedirect(decodedPath: string): RedirectHit | null {
  // DECISION: normalised here as well as inside every rule (normalizePath is idempotent) so a caller
  // that hands over a raw request path - proxy.ts sees "%D8%A2" and "?utm_source" - cannot miss a rule.
  const path = normalizePath(decodedPath);
  for (const rule of STATIC_REDIRECT_RULES) {
    const hit = rule.test(path);
    if (hit !== null) return hit;
  }
  return null;
}

export type RedirectRow = {
  id: number;
  fromPath: string;
  toPath: string;
  code: 301 | 410;
  source: "legacy" | "manual" | "auto_archive";
  hits: number;
  lastHitAt: string | null;
  isActive: boolean;
};

export type RootResolution =
  | { kind: "post"; slug: string }
  | { kind: "page"; slug: string }
  | { kind: "redirect"; to: string; code: 301 | 410 };

/** the spec redirects manager / 404 monitor. DECISION: 50 rows per page - the docs leave it open. */
export const REDIRECTS_PAGE_SIZE = 50;

const asCode = (code: number): 301 | 410 => (code === 410 ? 410 : 301);

const toIso = (value: unknown): string => {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return new Date(value).toISOString();
  return new Date(0).toISOString();
};

const toIsoOrNull = (value: unknown): string | null => (value === null || value === undefined ? null : toIso(value));

// ── hit counting (batched in-process; a lost batch is acceptable - rules) ──────────────────────

const HIT_FLUSH_MS = 10_000;
const HIT_FLUSH_COUNT = 100;

let pendingHits = new Map<number, number>();
let pendingHitsDb: Db | null = null;
let pendingHitsTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * DECISION: exported although it is not in the contract - the batch has to be drainable at graceful
 * shutdown (and by the unit tests) or a whole flush window of hits is lost on every deploy. It is
 * the only way to observe the batch, and it can never throw.
 */
export async function flushRedirectHits(): Promise<void> {
  if (pendingHitsTimer !== null) {
    clearTimeout(pendingHitsTimer);
    pendingHitsTimer = null;
  }
  const db = pendingHitsDb;
  const batch = pendingHits;
  if (db === null || batch.size === 0) return;
  pendingHits = new Map<number, number>();
  pendingHitsDb = null;
  try {
    await Promise.all(
      [...batch].map(([id, hits]) =>
        db
          .update(redirectsTable)
          .set({ hits: sql`${redirectsTable.hits} + ${hits}`, lastHitAt: sql`now()` })
          .where(eq(redirectsTable.id, id)),
      ),
    );
  } catch {
    // rules: "a lost batch is acceptable" - a counter must never break a redirect response.
  }
}

function scheduleHitFlush(): void {
  if (pendingHitsTimer !== null) return;
  // DECISION: this is a debounce, not the `setTimeout` polling loop the spec forbids (that rule is
  // about polling for work - which belongs in the `jobs` table). The handle is unref'd so a pending
  // flush never keeps a process (or a vitest worker) alive.
  const timer = setTimeout(() => {
    pendingHitsTimer = null;
    void flushRedirectHits();
  }, HIT_FLUSH_MS);
  const unrefable = timer as unknown as { unref?: () => void };
  if (typeof unrefable.unref === "function") unrefable.unref();
  pendingHitsTimer = timer;
}

function queueHit(db: Db, id: number): void {
  if (pendingHitsDb !== null && pendingHitsDb !== db) void flushRedirectHits();
  pendingHitsDb = db;
  pendingHits.set(id, (pendingHits.get(id) ?? 0) + 1);
  let total = 0;
  for (const hits of pendingHits.values()) total += hits;
  if (total >= HIT_FLUSH_COUNT) void flushRedirectHits();
  else scheduleHitFlush();
}

// ── resolution ─────────────────────────────────────────────────────────────────────────────────

export async function resolveRedirect(
  db: Db,
  decodedPath: string,
): Promise<{ to: string; code: 301 | 410 } | null> {
  const fromPath = normalizePath(decodedPath);
  const rows = await db
    .select({ id: redirectsTable.id, toPath: redirectsTable.toPath, code: redirectsTable.code })
    .from(redirectsTable)
    .where(and(eq(redirectsTable.fromPath, fromPath), eq(redirectsTable.isActive, true)))
    .limit(1);
  const row = rows[0];
  if (row === undefined) return null;
  // rules: exactly ONE lookup happens here - chains were collapsed at insert time.
  queueHit(db, row.id);
  const code = asCode(row.code);
  // DECISION: a 410 row always emits "" even if a stray target was stored - rules fix to_path "" for
  // 410 and the router must never send a Location header with a 410.
  return { to: code === 410 ? "" : encodeTarget(row.toPath), code };
}

/** Strip the wrapping slashes of a normalised path back to a bare decoded slug/path. */
const innerPath = (normalised: string): string => normalised.replace(/^\/+/, "").replace(/\/+$/, "");

export async function resolveRootSlug(
  db: Db,
  slug: string,
  ctx?: { now?: Date },
): Promise<RootResolution | null> {
  const decodedSlug = innerPath(normalizePath(`/${slug.trim().replace(/^\/+|\/+$/g, "")}/`));
  if (decodedSlug === "") return null;
  const now = ctx?.now ?? new Date();

  // DECISION: posts.ts / pages.ts expose no existence check (getPostBySlug returns a whole PostView
  // and both modules were not yet built when this was written); the root resolver only needs to know WHICH kind serves
  // the slug, so it reads the two slug columns directly instead of hydrating a view per candidate.
  const post = await db
    .select({ slug: posts.slug })
    .from(posts)
    .where(
      and(
        eq(posts.slug, decodedSlug),
        eq(posts.status, "published"),
        // DECISION: a NULL published_at counts as live (not scheduled) - tests/contract/check-contract.ts
        // serves a post on `posts.status = 'published'` alone, and the 752-URL contract must not depend
        // on a legacy date the seed may not have.
        or(isNull(posts.publishedAt), lte(posts.publishedAt, now)),
      ),
    )
    .limit(1);
  const postRow = post[0];
  if (postRow !== undefined) return { kind: "post", slug: postRow.slug };

  const page = await db
    .select({ slug: pages.slug })
    .from(pages)
    .where(and(eq(pages.slug, decodedSlug), eq(pages.status, "published")))
    .limit(1);
  const pageRow = page[0];
  if (pageRow !== undefined) return { kind: "page", slug: pageRow.slug };

  const hit = await resolveRedirect(db, `/${decodedSlug}/`);
  if (hit !== null) return { kind: "redirect", to: hit.to, code: hit.code };
  return null;
}

// ── 404 monitor ────────────────────────────────────────────────────────────────────────────────

/**
 * DECISION: `events.type` is free text and constants.EVENT_TYPES does not list '404'; the value is
 * DECIDED by packages/db/src/schema/system.ts ("events.type per the spec plus '404'"), so it lives here
 * as a local constant rather than as an edit to another module's constant list.
 */
const NOT_FOUND_EVENT_TYPE = "404";
const NOT_FOUND_THROTTLE_MS = 60_000;
const NOT_FOUND_REFERRER_MAX = 512;
const NOT_FOUND_SEEN_MAX = 5_000;
const NOT_FOUND_DAYS_MAX = 400;
const HTML_EXTENSION = ".html";
const NOISE_PREFIXES: readonly string[] = ["/api/", "/_next/"];

const notFoundSeen = new Map<string, number>();

/** rules: /api/, /_next/ and every non-.html file extension are noise, not candidate redirects. */
function isRecordableNotFound(normalisedPath: string): boolean {
  if (NOISE_PREFIXES.some((prefix) => normalisedPath.startsWith(prefix))) return false;
  // normalizePath only omits the trailing slash when the last segment carries a file extension.
  const lastSegment = normalisedPath.slice(normalisedPath.lastIndexOf("/") + 1);
  if (lastSegment !== "" && !lastSegment.endsWith(HTML_EXTENSION)) return false;
  return true;
}

function sanitizeReferrer(referrer: string | undefined): string | null {
  if (referrer === undefined) return null;
  const cut = referrer.trim().search(/[?#]/);
  const withoutQuery = cut === -1 ? referrer.trim() : referrer.trim().slice(0, cut);
  const clean = withoutQuery.replace(CONTROL_CHARS_G, "").slice(0, NOT_FOUND_REFERRER_MAX);
  return clean === "" ? null : clean;
}

/** DECISION: memory guard - a crawler walking random paths must not grow the throttle map forever. */
function pruneNotFoundSeen(now: number): void {
  if (notFoundSeen.size <= NOT_FOUND_SEEN_MAX) return;
  for (const [path, at] of notFoundSeen) {
    if (now - at >= NOT_FOUND_THROTTLE_MS) notFoundSeen.delete(path);
  }
  if (notFoundSeen.size > NOT_FOUND_SEEN_MAX) notFoundSeen.clear();
}

export async function recordNotFound(db: Db, path: string, referrer?: string): Promise<void> {
  // DECISION: the rules name `sanitizePath` from analytics/record.ts, but that module's contract has
  // no such export (and was not yet built when this was written). `normalizePath` above performs exactly the documented
  // job - decode, strip query/hash, drop control characters, NFC - so it is used instead; reported to
  // the architect rather than adding an export to a file this task does not own.
  const normalised = normalizePath(path);
  if (!isRecordableNotFound(normalised)) return;

  const now = Date.now();
  const last = notFoundSeen.get(normalised);
  if (last !== undefined && now - last < NOT_FOUND_THROTTLE_MS) return;
  notFoundSeen.set(normalised, now);
  pruneNotFoundSeen(now);

  try {
    await db.insert(events).values({
      type: NOT_FOUND_EVENT_TYPE,
      path: normalised,
      ref: sanitizeReferrer(referrer),
      // DECISION: `session_hash` and `ua_class` are NOT NULL but this contract receives
      // neither a session nor a user agent. "" is written for the hash (it can never collide with a
      // sha256 hex digest) and "desktop" for the class; the 404 monitor groups by path only, and
      // type='404' rows are excluded from every pv/atc aggregate.
      sessionHash: "",
      uaClass: "desktop",
    });
  } catch {
    // A monitoring write must never turn a 404 page into a 500 (same rule as analytics/record.ts).
  }
}

// ── writes (admin / archive flow) ──────────────────────────────────────────────────────────────

/** The exact "serves 200" table of tests/contract/check-contract.ts, kept identical on purpose. */
// DECISION (M5): exported so catalog/archive.ts can enforce "a redirect target must serve 200"
// (its rules) against the identical predicate the contract check uses - no second implementation.
export async function servesLivePath(db: Db, normalisedPath: string): Promise<boolean> {
  if (STATIC_ROUTES.includes(normalisedPath)) return true;

  const inner = innerPath(normalisedPath);
  if (inner === "") return false;
  const segments = inner.split("/");

  if (segments[0] === "product") {
    if (segments.length !== 2) return false;
    const rows = await db
      .select({ id: products.id })
      .from(products)
      .where(and(eq(products.slug, segments[1] ?? ""), eq(products.status, "active")))
      .limit(1);
    return rows.length > 0;
  }

  if (segments[0] === "category") {
    if (segments.length < 2) return false;
    const rows = await db
      .select({ id: categories.id })
      .from(categories)
      .where(and(eq(categories.path, segments.slice(1).join("/")), sql`${categories.status} <> 'archived'`))
      .limit(1);
    return rows.length > 0;
  }

  if (segments[0] === "brand") {
    if (segments.length !== 2) return false;
    const rows = await db
      .select({ id: brands.id })
      .from(brands)
      .where(and(eq(brands.slug, segments[1] ?? ""), eq(brands.isActive, true)))
      .limit(1);
    return rows.length > 0;
  }

  // Root namespace: posts share it with pages.
  if (segments.length !== 1) return false;
  const post = await db
    .select({ id: posts.id })
    .from(posts)
    .where(and(eq(posts.slug, inner), eq(posts.status, "published")))
    .limit(1);
  if (post.length > 0) return true;
  const page = await db
    .select({ id: pages.id })
    .from(pages)
    .where(and(eq(pages.slug, inner), eq(pages.status, "published")))
    .limit(1);
  return page.length > 0;
}

export async function resolveFinalTarget(db: Db, toPath: string, maxHops = 5): Promise<string> {
  let current = normalizePath(toPath);
  const seen = new Set<string>([current]);
  const hops = Number.isFinite(maxHops) ? Math.max(0, Math.trunc(maxHops)) : 0;
  for (let hop = 0; hop < hops; hop += 1) {
    const rows = await db
      .select({ toPath: redirectsTable.toPath, code: redirectsTable.code })
      .from(redirectsTable)
      .where(and(eq(redirectsTable.fromPath, current), eq(redirectsTable.isActive, true)))
      .limit(1);
    const row = rows[0];
    if (row === undefined) break;
    // DECISION: a 410 in the middle of a chain ends the walk and the last live target is returned - 
    // the caller (archive.validateRedirectTarget / insertRedirect) then rejects it if it is not live.
    if (asCode(row.code) === 410 || row.toPath.trim() === "") break;
    const next = normalizePath(row.toPath);
    if (seen.has(next)) throw appError("VALIDATION", { details: { reason: "redirect_loop", path: next } });
    seen.add(next);
    current = next;
  }
  // DECISION: exhausting maxHops without a loop is NOT an error (only a loop is, per the contract);
  // the deepest target reached is returned so the row is still written without a chain.
  return current;
}

type PreparedRedirect = { fromPath: string; toPath: string; code: 301 | 410 };

/** Everything insertRedirect validates, shared with the dry-run branch of importRedirectsCsv. */
async function prepareRedirect(
  db: Db,
  r: { fromPath: string; toPath: string; code: 301 | 410; source: RedirectRow["source"] },
): Promise<PreparedRedirect> {
  const code = asCode(r.code);
  assertSiteRelative("fromPath", r.fromPath);
  const fromPath = normalizePath(r.fromPath);

  let toPath = "";
  if (code === 301) {
    assertSiteRelative("toPath", r.toPath);
    toPath = normalizePath(r.toPath);
    if (toPath === fromPath) {
      throw appError("VALIDATION", { details: { reason: "from_equals_to", path: fromPath } });
    }
    toPath = await resolveFinalTarget(db, toPath);
    if (toPath === fromPath) {
      throw appError("VALIDATION", { details: { reason: "redirect_loop", path: fromPath } });
    }
  } else if (r.toPath.trim() !== "") {
    // rules: 410 rows have to_path "".
    throw appError("VALIDATION", { details: { field: "toPath", reason: "gone_rows_have_no_target" } });
  }

  // rules: only the archive flow may put a row on a path that currently answers 200.
  if (r.source !== "auto_archive" && (await servesLivePath(db, fromPath))) {
    throw appError("CONFLICT", { details: { reason: "path_serves_200", path: fromPath } });
  }

  return { fromPath, toPath, code };
}

export async function insertRedirect(
  db: Db,
  r: { fromPath: string; toPath: string; code: 301 | 410; source: RedirectRow["source"] },
  actor: Actor,
): Promise<{ id: number }> {
  const prepared = await prepareRedirect(db, r);
  // DECISION: an existing row for the same from_path is a CONFLICT, never a silent overwrite - 
  // `onConflictDoNothing` makes the check and the race-safe insert one statement, and importCsv maps
  // this exact code to `skipped`. Re-targeting a row is an explicit admin edit, not an "insert".
  const inserted = await db
    .insert(redirectsTable)
    .values({
      fromPath: prepared.fromPath,
      toPath: prepared.toPath,
      code: prepared.code,
      source: r.source,
      isActive: true,
    })
    .onConflictDoNothing({ target: redirectsTable.fromPath })
    .returning({ id: redirectsTable.id });
  const row = inserted[0];
  if (row === undefined) {
    throw appError("CONFLICT", { details: { reason: "redirect_exists", path: prepared.fromPath } });
  }
  await audit.log(db, actor, "redirect.create", "redirect", String(row.id), undefined, {
    fromPath: prepared.fromPath,
    toPath: prepared.toPath,
    code: prepared.code,
    source: r.source,
  });
  return { id: row.id };
}

export async function setRedirectActive(
  db: Db,
  id: number,
  isActive: boolean,
  actor: Actor,
): Promise<void> {
  const updated = await db
    .update(redirectsTable)
    .set({ isActive })
    .where(eq(redirectsTable.id, id))
    .returning({ id: redirectsTable.id, isActive: redirectsTable.isActive });
  const row = updated[0];
  if (row === undefined) throw appError("NOT_FOUND", { details: { entity: "redirect", id } });
  await audit.log(
    db,
    actor,
    isActive ? "redirect.enable" : "redirect.disable",
    "redirect",
    String(id),
    { isActive: !isActive },
    { isActive },
  );
}

const escapeLike = (term: string): string => term.replace(/[\\%_]/g, (c) => `\\${c}`);

const toRedirectRow = (row: {
  id: number;
  fromPath: string;
  toPath: string;
  code: number;
  source: RedirectRow["source"];
  hits: number;
  lastHitAt: Date | string | null;
  isActive: boolean;
}): RedirectRow => ({
  id: row.id,
  fromPath: row.fromPath,
  toPath: row.toPath,
  code: asCode(row.code),
  source: row.source,
  hits: row.hits,
  lastHitAt: toIsoOrNull(row.lastHitAt),
  isActive: row.isActive,
});

export async function listRedirects(
  db: Db,
  q: { search?: string; source?: RedirectRow["source"]; page: number },
): Promise<Paged<RedirectRow>> {
  const page = Number.isFinite(q.page) ? Math.max(1, Math.trunc(q.page)) : 1;
  const terms = [];
  if (q.source !== undefined) terms.push(eq(redirectsTable.source, q.source));
  const search = q.search?.trim() ?? "";
  if (search !== "") {
    const pattern = `%${escapeLike(search)}%`;
    terms.push(or(ilike(redirectsTable.fromPath, pattern), ilike(redirectsTable.toPath, pattern)));
  }
  const where = terms.length === 0 ? undefined : and(...terms);

  const rows = await db
    .select({
      id: redirectsTable.id,
      fromPath: redirectsTable.fromPath,
      toPath: redirectsTable.toPath,
      code: redirectsTable.code,
      source: redirectsTable.source,
      hits: redirectsTable.hits,
      lastHitAt: redirectsTable.lastHitAt,
      isActive: redirectsTable.isActive,
    })
    .from(redirectsTable)
    .where(where)
    // DECISION: most-hit first - the spec's manager exists to spot the rows real traffic uses.
    .orderBy(desc(redirectsTable.hits), desc(redirectsTable.id))
    .limit(REDIRECTS_PAGE_SIZE)
    .offset((page - 1) * REDIRECTS_PAGE_SIZE);

  const totals = await db.select({ value: count() }).from(redirectsTable).where(where);
  return {
    items: rows.map(toRedirectRow),
    total: totals[0]?.value ?? 0,
    page,
    pageSize: REDIRECTS_PAGE_SIZE,
  };
}

export async function importRedirectsCsv(
  db: Db,
  rows: { from: string; to: string; code?: "301" | "410" }[],
  actor: Actor,
  dryRun: boolean,
): Promise<{ inserted: number; skipped: number; errors: { line: number; message: string }[] }> {
  let inserted = 0;
  let skipped = 0;
  const errors: { line: number; message: string }[] = [];

  for (const [index, row] of rows.entries()) {
    // DECISION: `line` is the 1-based index of the row array - the caller owns the CSV header offset.
    const line = index + 1;
    const input = {
      fromPath: row.from,
      toPath: row.to,
      code: row.code === "410" ? (410 as const) : (301 as const),
      source: "manual" as const,
    };
    try {
      if (dryRun) {
        const prepared = await prepareRedirect(db, input);
        const existing = await db
          .select({ id: redirectsTable.id })
          .from(redirectsTable)
          .where(eq(redirectsTable.fromPath, prepared.fromPath))
          .limit(1);
        if (existing.length > 0) skipped += 1;
        else inserted += 1;
      } else {
        await insertRedirect(db, input, actor);
        inserted += 1;
      }
    } catch (err: unknown) {
      // DECISION: a duplicate row is "skipped" (re-importing the same CSV is normal); every other
      // failure - including a from_path that currently serves 200 - is an error the admin must see.
      // The message is the AppError's Persian copy from errors.ts, so no new Persian string is minted
      // in core (the spec keeps UI copy in i18n/fa.ts).
      const isDuplicate =
        isAppError(err) &&
        err.code === "CONFLICT" &&
        typeof err.details === "object" &&
        err.details !== null &&
        (err.details as { reason?: unknown }).reason === "redirect_exists";
      if (isDuplicate) skipped += 1;
      else errors.push({ line, message: isAppError(err) ? err.fa : ERROR_FA.INTERNAL });
    }
  }

  return { inserted, skipped, errors };
}

export async function listNotFound(
  db: Db,
  q: { days: number; page: number },
): Promise<Paged<{ path: string; hits: number; referrers: string[]; lastAt: string }>> {
  const days = Number.isFinite(q.days) ? Math.min(NOT_FOUND_DAYS_MAX, Math.max(1, Math.trunc(q.days))) : 1;
  const page = Number.isFinite(q.page) ? Math.max(1, Math.trunc(q.page)) : 1;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const where = and(eq(events.type, NOT_FOUND_EVENT_TYPE), gte(events.ts, since));

  const rows = await db
    .select({
      path: events.path,
      hits: count(),
      // "every 404 with a referrer is a candidate redirect" - at most 5 distinct referrers.
      referrers: sql<
        string[] | null
      >`(array_agg(distinct ${events.ref}) filter (where ${events.ref} is not null))[1:5]`,
      lastAt: sql<Date | string>`max(${events.ts})`,
    })
    .from(events)
    .where(where)
    .groupBy(events.path)
    .orderBy(sql`count(*) desc`, sql`max(${events.ts}) desc`)
    .limit(REDIRECTS_PAGE_SIZE)
    .offset((page - 1) * REDIRECTS_PAGE_SIZE);

  const totals = await db
    .select({ value: sql<number>`count(distinct ${events.path})::int` })
    .from(events)
    .where(where);

  return {
    items: rows.map((row) => ({
      path: row.path,
      hits: row.hits,
      referrers: row.referrers ?? [],
      lastAt: toIso(row.lastAt),
    })),
    total: totals[0]?.value ?? 0,
    page,
    pageSize: REDIRECTS_PAGE_SIZE,
  };
}
