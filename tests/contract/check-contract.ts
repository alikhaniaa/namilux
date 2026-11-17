import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { parse as csvParse } from "csv-parse/sync";
import {
  ROUTES,
  decPath,
  encPath,
  ensureTrailingSlash,
  legacyMyAccountRedirect,
  legacyPaginationRedirect,
  pathOnly,
  stripTrailingSlash,
} from "@namilux/core/url";
import type { Db } from "@namilux/db";
import {
  brands,
  categories,
  closeDb,
  createDb,
  eq,
  ne,
  pages,
  posts,
  products,
  redirects,
  settings,
} from "@namilux/db";

// ── constants ─────────────────────────────────────────────────────────────────────────────────

export const INVENTORY_CSV = "data/extract/01_sitemap/url-inventory-and-redirect-map.csv";

/** Settings key the admin health panel reads (spec WHAT, --record). */
export const CONTRACT_SETTINGS_KEY = "system.contract";

/**
 * Paths the router serves without consulting a table. Derived from `ROUTES` so this list can
 * never drift from the storefront, plus the sitemap children Google already knows.
 * DECISION: `/checkout/` is NOT listed. the spec makes it a 301 to `/billing/`, it is absent from the
 * 752 rows, and the simplest reading is that the seed owns it as a `redirects` row like every other
 * legacy 301 - so the gate keeps demanding the row instead of silently blessing the path.
 */
export const STATIC_ROUTES: ReadonlySet<string> = new Set<string>([
  ...Object.values(ROUTES),
  "/post-sitemap.xml",
  "/page-sitemap.xml",
  "/product-sitemap1.xml",
  "/product-sitemap2.xml",
  "/product-sitemap3.xml",
  "/category-sitemap.xml",
  "/product_cat-sitemap.xml",
  "/pa_brand-sitemap.xml",
  "/collection-sitemap.xml",
]);

/**
 * Which rows the router will answer 200 for. Kept as one visible table because it is the single
 * judgement call in this file (the spec "active|link_only; archived → null (router consults redirects)").
 * DECISION: `visibility` is deliberately ignored for products - `hidden` and `link_only` keep their
 * URL, only their listings change - and categories count as served unless `archived`, because the spec
 * serves all 73 category terms and expresses the 15 noindexed ones through `robots`, not through a 404.
 */
const SERVED_WHEN = {
  product: "products.status = 'active'",
  category: "categories.status <> 'archived'",
  brand: "brands.is_active = true",
  post: "posts.status = 'published'",
  page: "pages.status = 'published'",
  redirect: "redirects.is_active = true",
} as const;

// ── types ─────────────────────────────────────────────────────────────────────────────────────

export type InventoryRow = {
  oldUrl: string;
  path: string;
  type: string;
  status: number;
  title: string;
  lastmod: string;
  action: string;
  newUrl: string;
};

export type RedirectTarget = { to: string; code: 301 | 410 };

export type RouteIndex = {
  products: Set<string>;
  categories: Set<string>;
  brands: Set<string>;
  posts: Set<string>;
  pages: Set<string>;
  redirects: Map<string, RedirectTarget>;
};

export type CoverageKind =
  | "static"
  | "product"
  | "category"
  | "brand"
  | "post"
  | "page"
  | "redirect"
  | "pattern"
  | "missing";

export type Coverage = {
  kind: CoverageKind;
  /** the entity key that matched (slug or category path) */
  key?: string;
  /** redirect/pattern destination */
  to?: string;
  code?: 301 | 410;
  /** for `missing`: the DB row that would fix it */
  expected?: string;
  /** for --live: what the origin actually answered */
  observed?: string;
};

export type RowResult = { row: InventoryRow; path: string; coverage: Coverage };

export type ContractReport = {
  total: number;
  unique: number;
  covered: number;
  missing: number;
  byKind: Record<CoverageKind, number>;
  missingByType: Record<string, number>;
  results: RowResult[];
};

export type ContractSummary = {
  runAt: string;
  source: "db" | "live";
  total: number;
  covered: number;
  missing: number;
  ok: boolean;
  byKind: Record<CoverageKind, number>;
  missingByType: Record<string, number>;
  missingSample: string[];
};

// ── repo / env plumbing ───────────────────────────────────────────────────────────────────────

export function repoRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
}

/**
 * `pnpm check:contract` runs `tsx contract/check-contract.ts` (tests/package.json, not ours to edit),
 * so the script loads the gitignored root `.env.local` itself. Node's loader leaves already-set
 * variables alone, which keeps CI's real environment authoritative.
 */
export function loadEnvLocal(root: string = repoRoot()): void {
  try {
    process.loadEnvFile(path.join(root, ".env.local"));
  } catch {
    // No .env.local (CI) - the environment is expected to carry DATABASE_URL_ADMIN already.
  }
}

export function resolveDbUrl(explicit?: string): string {
  const url = explicit ?? process.env.DATABASE_URL_ADMIN ?? "";
  if (url === "") {
    throw new Error("DATABASE_URL_ADMIN is not set (add it to .env.local or pass --db <url>)");
  }
  return url;
}

// ── inventory ─────────────────────────────────────────────────────────────────────────────────

/** csv-parse's sync `parse` is typed `any`; this is the single place that pins it to a record shape. */
function parseCsvRecords(input: Buffer): Record<string, string | undefined>[] {
  return csvParse(input, { columns: true, bom: true, skip_empty_lines: true });
}

export function readInventory(file: string = path.join(repoRoot(), INVENTORY_CSV)): InventoryRow[] {
  const raw = parseCsvRecords(readFileSync(file));

  return raw.map((r) => ({
    oldUrl: r["old_url"] ?? "",
    path: r["path"] ?? "",
    type: r["type"] ?? "",
    status: Number.parseInt(r["status"] ?? "0", 10) || 0,
    title: r["current_title"] ?? "",
    lastmod: r["lastmod"] ?? "",
    action: r["action"] ?? "",
    newUrl: r["new_url"] ?? "",
  }));
}

const ORIGIN_RE = /^https?:\/\/(www\.)?namilux\.ir/i;
const FILE_EXT_RE = /\.[a-z0-9]{2,5}$/i;

/**
 * LIFT of v1 `toPath()`. DECISION: the decode step uses `decPath` (per-segment, never throws) instead
 * of v1's whole-string `decodeURIComponent` - byte-identical on all 752 rows, but a malformed escape
 * now degrades to "router finds nothing" instead of aborting the whole run.
 */
export function normalizeInventoryPath(url: string): string {
  let p = url.trim().replace(ORIGIN_RE, "");
  if (!p.startsWith("/")) p = `/${p}`;
  p = decPath(pathOnly(p));
  if (!p.endsWith("/") && !FILE_EXT_RE.test(p)) p += "/";
  return p;
}

// ── the matching rule (pure) ──────────────────────────────────────────────────────────────────

export function emptyRouteIndex(): RouteIndex {
  return {
    products: new Set<string>(),
    categories: new Set<string>(),
    brands: new Set<string>(),
    posts: new Set<string>(),
    pages: new Set<string>(),
    redirects: new Map<string, RedirectTarget>(),
  };
}

/**
 * Index a redirect under every spelling the router could see it in: as stored, decoded, and with and
 * without the trailing slash. The seed is free to store `from_path` encoded or decoded.
 */
export function indexRedirect(index: RouteIndex, fromPath: string, to: string, code: 301 | 410): void {
  const target: RedirectTarget = { to, code };
  const base = pathOnly(fromPath.trim());
  for (const variant of [base, decPath(base)]) {
    if (variant === "") continue;
    index.redirects.set(variant, target);
    index.redirects.set(ensureTrailingSlash(variant), target);
    index.redirects.set(stripTrailingSlash(variant), target);
  }
}

/** Static route or a live DB entity - i.e. everything the router answers 200 for. */
function servedBy(decodedPath: string, index: RouteIndex): Coverage | null {
  if (STATIC_ROUTES.has(decodedPath)) return { kind: "static" };

  const segs = decodedPath.split("/").filter((s) => s !== "");
  const [head = "", second = ""] = segs;

  if (head === "product") {
    if (segs.length === 2 && index.products.has(second)) return { kind: "product", key: second };
    return null;
  }
  if (head === "category") {
    const catPath = segs.slice(1).join("/");
    if (segs.length >= 2 && index.categories.has(catPath)) return { kind: "category", key: catPath };
    return null;
  }
  if (head === "brand") {
    if (segs.length === 2 && index.brands.has(second)) return { kind: "brand", key: second };
    return null;
  }
  // Root catch-all: posts share the namespace with pages and are resolved first.
  if (segs.length === 1) {
    if (index.posts.has(head)) return { kind: "post", key: head };
    if (index.pages.has(head)) return { kind: "page", key: head };
  }
  return null;
}

/** The DB row that would make a missing path resolve - printed so the report is actionable. */
function expectationFor(decodedPath: string): string {
  const segs = decodedPath.split("/").filter((s) => s !== "");
  const [head = "", second = ""] = segs;
  if (head === "product" && segs.length === 2) return `products.slug = '${second}' with ${SERVED_WHEN.product}`;
  if (head === "category" && segs.length >= 2) {
    return `categories.path = '${segs.slice(1).join("/")}' with ${SERVED_WHEN.category}`;
  }
  if (head === "brand" && segs.length === 2) return `brands.slug = '${second}' with ${SERVED_WHEN.brand}`;
  if (segs.length === 1) return `posts.slug or pages.slug = '${head}' (published)`;
  return `redirects.from_path = '${decodedPath}' with ${SERVED_WHEN.redirect}`;
}

function redirectFor(decodedPath: string, index: RouteIndex): RedirectTarget | undefined {
  return (
    index.redirects.get(decodedPath) ??
    index.redirects.get(ensureTrailingSlash(decodedPath)) ??
    index.redirects.get(stripTrailingSlash(decodedPath))
  );
}

export function coverageFor(decodedPath: string, index: RouteIndex): Coverage {
  const served = servedBy(decodedPath, index);
  if (served) return served;

  const red = redirectFor(decodedPath, index);
  if (red) return { kind: "redirect", to: red.to, code: red.code };

  const account = legacyMyAccountRedirect(decodedPath);
  if (account !== null) return { kind: "pattern", to: account, code: 301 };

  const paged = legacyPaginationRedirect(decodedPath);
  if (paged !== null) return { kind: "pattern", to: paged, code: 301 };

  return { kind: "missing", expected: expectationFor(decodedPath) };
}

const KIND_ORDER: readonly CoverageKind[] = [
  "static",
  "product",
  "category",
  "brand",
  "post",
  "page",
  "redirect",
  "pattern",
  "missing",
];

function zeroByKind(): Record<CoverageKind, number> {
  const out = {} as Record<CoverageKind, number>;
  for (const k of KIND_ORDER) out[k] = 0;
  return out;
}

export function checkCoverage(rows: InventoryRow[], index: RouteIndex): ContractReport {
  const byKind = zeroByKind();
  const missingByType: Record<string, number> = {};
  const seen = new Set<string>();
  const results: RowResult[] = [];

  for (const row of rows) {
    const p = normalizeInventoryPath(row.path === "" ? row.oldUrl : row.path);
    seen.add(p);
    const coverage = coverageFor(p, index);
    byKind[coverage.kind] += 1;
    if (coverage.kind === "missing") {
      missingByType[row.type] = (missingByType[row.type] ?? 0) + 1;
    }
    results.push({ row, path: p, coverage });
  }

  const missing = byKind.missing;
  return {
    total: rows.length,
    unique: seen.size,
    covered: rows.length - missing,
    missing,
    byKind,
    missingByType,
    results,
  };
}

// ── reporting ─────────────────────────────────────────────────────────────────────────────────

const DEFAULT_LIMIT = 25;

export function summarize(report: ContractReport, source: "db" | "live"): ContractSummary {
  return {
    runAt: new Date().toISOString(),
    source,
    total: report.total,
    covered: report.covered,
    missing: report.missing,
    ok: report.missing === 0,
    byKind: report.byKind,
    missingByType: report.missingByType,
    missingSample: report.results
      .filter((r) => r.coverage.kind === "missing")
      .slice(0, 20)
      .map((r) => r.path),
  };
}

export function formatReport(
  report: ContractReport,
  opts?: { all?: boolean; limit?: number; head?: string[] },
): string {
  const limit = opts?.all === true ? Number.POSITIVE_INFINITY : (opts?.limit ?? DEFAULT_LIMIT);
  const lines: string[] = [];
  for (const h of opts?.head ?? []) lines.push(h);

  const missingRows = report.results.filter((r) => r.coverage.kind === "missing");
  const byType = new Map<string, RowResult[]>();
  for (const r of missingRows) {
    const bucket = byType.get(r.row.type);
    if (bucket) bucket.push(r);
    else byType.set(r.row.type, [r]);
  }

  for (const [type, rowsOfType] of byType) {
    lines.push("");
    lines.push(`  ${type} — ${rowsOfType.length} uncovered`);
    let shown = 0;
    for (const r of rowsOfType) {
      if (shown >= limit) {
        lines.push(`    … and ${rowsOfType.length - shown} more (run with --all)`);
        break;
      }
      lines.push(`    MISSING: ${r.path}`);
      const detail = r.coverage.observed ?? r.coverage.expected;
      if (detail !== undefined) lines.push(`             needs ${detail}`);
      shown += 1;
    }
  }

  lines.push("");
  const kinds = KIND_ORDER.filter((k) => report.byKind[k] > 0)
    .map((k) => `${k} ${report.byKind[k]}`)
    .join(" · ");
  lines.push(`  by kind: ${kinds === "" ? "(nothing matched)" : kinds}`);
  lines.push(
    `  checked ${report.total} URLs (${report.unique} unique) — ${report.covered} covered, ${report.missing} uncovered`,
  );
  lines.push(report.missing === 0 ? "  CONTRACT OK" : "  CONTRACT FAILED");
  return lines.join("\n");
}

// ── database ──────────────────────────────────────────────────────────────────────────────────

export async function loadRouteIndex(db: Db): Promise<RouteIndex> {
  const index = emptyRouteIndex();

  const [productRows, categoryRows, brandRows, postRows, pageRows, redirectRows] = await Promise.all([
    db.select({ slug: products.slug }).from(products).where(eq(products.status, "active")),
    db.select({ path: categories.path }).from(categories).where(ne(categories.status, "archived")),
    db.select({ slug: brands.slug }).from(brands).where(eq(brands.isActive, true)),
    db.select({ slug: posts.slug }).from(posts).where(eq(posts.status, "published")),
    db.select({ slug: pages.slug }).from(pages).where(eq(pages.status, "published")),
    db
      .select({ fromPath: redirects.fromPath, toPath: redirects.toPath, code: redirects.code })
      .from(redirects)
      .where(eq(redirects.isActive, true)),
  ]);

  for (const r of productRows) index.products.add(r.slug);
  // Category paths are stored decoded and without the "/category/" prefix; tolerate both.
  for (const r of categoryRows) index.categories.add(stripTrailingSlash(r.path).replace(/^\/?(category\/)?/, ""));
  for (const r of brandRows) index.brands.add(r.slug);
  for (const r of postRows) index.posts.add(r.slug);
  for (const r of pageRows) index.pages.add(r.slug);
  for (const r of redirectRows) indexRedirect(index, r.fromPath, r.toPath, r.code === 410 ? 410 : 301);

  return index;
}

export async function recordSummary(db: Db, summary: ContractSummary): Promise<void> {
  await db
    .insert(settings)
    .values({ key: CONTRACT_SETTINGS_KEY, valueJson: summary, updatedBy: "check-contract" })
    .onConflictDoUpdate({
      target: settings.key,
      set: { valueJson: summary, updatedBy: "check-contract" },
    });
}

// ── --live ────────────────────────────────────────────────────────────────────────────────────

async function mapPool<T, R>(
  items: readonly T[],
  concurrency: number,
  gapMs: number,
  fn: (item: T, i: number) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next;
      next += 1;
      const item = items[i];
      if (item === undefined) return;
      out[i] = await fn(item, i);
      if (gapMs > 0) await new Promise((r) => setTimeout(r, gapMs));
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
  return out;
}

const MAX_HOPS = 5;

/** Follows redirects by hand so the chain (and its final status) is observable. */
async function probe(origin: string, encodedPath: string): Promise<{ status: number; hops: string[] }> {
  const hops: string[] = [];
  let url = `${origin.replace(/\/+$/, "")}${encodedPath.startsWith("/") ? encodedPath : `/${encodedPath}`}`;
  for (let hop = 0; hop <= MAX_HOPS; hop += 1) {
    let res: Response;
    try {
      res = await fetch(url, { redirect: "manual", headers: { "user-agent": "namilux-contract-check" } });
    } catch (err) {
      hops.push(`fetch failed: ${err instanceof Error ? err.message : String(err)}`);
      return { status: 0, hops };
    }
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      hops.push(`${res.status} → ${location ?? "(no location)"}`);
      if (location === null) return { status: res.status, hops };
      url = new URL(location, url).toString();
      continue;
    }
    return { status: res.status, hops };
  }
  return { status: 0, hops: [...hops, `too many redirects (> ${MAX_HOPS})`] };
}

export async function checkLive(
  origin: string,
  rows: InventoryRow[],
  index: RouteIndex,
  opts?: { concurrency?: number; gapMs?: number },
): Promise<ContractReport> {
  const byKind = zeroByKind();
  const missingByType: Record<string, number> = {};
  const seen = new Set<string>();

  const results = await mapPool(rows, opts?.concurrency ?? 4, opts?.gapMs ?? 100, async (row) => {
    const decoded = normalizeInventoryPath(row.path === "" ? row.oldUrl : row.path);
    seen.add(decoded);
    const expected = coverageFor(decoded, index);
    const { status, hops } = await probe(origin, row.path === "" ? encPath(decoded) : row.path);
    const chain = hops.length > 0 ? ` [${hops.join(" ")}]` : "";

    // DECISION: 200 after ≤5 hops always passes (a 301 that lands on a live page keeps the ranking,
    // which is what the contract protects). 410 passes only when the index proves it was intended.
    if (status === 200) {
      const unpredicted = expected.kind === "missing";
      const kind: CoverageKind = unpredicted ? "static" : expected.kind;
      const observed = unpredicted ? `200${chain} (served, but no router-index row explains it)` : `200${chain}`;
      return { row, path: decoded, coverage: { kind, observed } satisfies Coverage };
    }
    if (status === 410 && expected.kind === "redirect" && expected.code === 410) {
      return { row, path: decoded, coverage: { kind: "redirect", code: 410, observed: "410 gone" } satisfies Coverage };
    }
    return {
      row,
      path: decoded,
      coverage: { kind: "missing", observed: `HTTP ${status}${chain}` } satisfies Coverage,
    };
  });

  for (const r of results) {
    byKind[r.coverage.kind] += 1;
    if (r.coverage.kind === "missing") missingByType[r.row.type] = (missingByType[r.row.type] ?? 0) + 1;
  }
  const missing = byKind.missing;
  return {
    total: rows.length,
    unique: seen.size,
    covered: rows.length - missing,
    missing,
    byKind,
    missingByType,
    results,
  };
}

// ── CLI ───────────────────────────────────────────────────────────────────────────────────────

const USAGE = `pnpm check:contract — the 752-URL SEO contract

  tsx contract/check-contract.ts [options]

  --live <origin>   HTTP-check every URL against a running instance instead of the router index
  --db <url>        Postgres URL (default: DATABASE_URL_ADMIN from .env.local)
  --record          upsert the summary into settings["${CONTRACT_SETTINGS_KEY}"]
  --all             list every uncovered URL (default: ${DEFAULT_LIMIT} per type)
  --json            print the summary as JSON instead of a table
  --limit <n>       how many uncovered URLs to list per type
  --help
`;

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: false,
      options: {
        live: { type: "string" },
        db: { type: "string" },
        record: { type: "boolean", default: false },
        all: { type: "boolean", default: false },
        json: { type: "boolean", default: false },
        limit: { type: "string" },
        help: { type: "boolean", default: false, short: "h" },
      },
    });
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    console.error(USAGE);
    return 1;
  }

  const flags = parsed.values;
  if (flags.help === true) {
    console.log(USAGE);
    return 0;
  }

  loadEnvLocal();
  const rows = readInventory();
  const source: "db" | "live" = flags.live === undefined ? "db" : "live";

  let db: ReturnType<typeof createDb> | null = null;
  let report: ContractReport;
  const head: string[] = [`NAMILUX contract check — ${INVENTORY_CSV} (${rows.length} rows)`];

  try {
    const url = resolveDbUrl(flags.db);
    db = createDb("admin", { url, poolMax: 2, applicationName: "nl_check_contract" });
    const index = await loadRouteIndex(db);
    head.push(
      `router index: ${index.products.size} products · ${index.categories.size} categories · ` +
        `${index.brands.size} brands · ${index.posts.size} posts · ${index.pages.size} pages · ` +
        `${index.redirects.size} redirect keys`,
    );
    if (source === "live") {
      head.push(`mode: live — ${flags.live ?? ""}`);
      report = await checkLive(flags.live ?? "", rows, index);
    } else {
      head.push("mode: router index (database)");
      report = checkCoverage(rows, index);
    }

    if (flags.record === true) {
      await recordSummary(db, summarize(report, source));
      head.push(`recorded: settings["${CONTRACT_SETTINGS_KEY}"]`);
    }
  } catch (err) {
    console.error(`contract check could not run: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  } finally {
    if (db !== null) await closeDb(db);
  }

  if (flags.json === true) {
    console.log(JSON.stringify(summarize(report, source), null, 2));
  } else {
    const limit = flags.limit === undefined ? undefined : Number.parseInt(flags.limit, 10);
    console.log(
      formatReport(report, {
        all: flags.all === true,
        ...(limit !== undefined && Number.isFinite(limit) ? { limit } : {}),
        head,
      }),
    );
  }
  return report.missing === 0 ? 0 : 1;
}

const invokedDirectly =
  process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url;

if (invokedDirectly) {
  process.exitCode = await main();
}
