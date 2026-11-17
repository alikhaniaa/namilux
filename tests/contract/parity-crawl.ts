import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { parse as csvParse } from "csv-parse/sync";
import { decPath, ensureTrailingSlash, pathOnly } from "@namilux/core/url";
import { normalizeInventoryPath, readInventory, repoRoot } from "./check-contract";

// ── constants ─────────────────────────────────────────────────────────────────────────────────

export const SEO_LIVE_CSV = "data/extract/02_seo/seo_live.csv";
export const OUT_CSV = "tests/contract/out/seo_crawl.csv";
export const ALLOW_FILE = "tests/contract/parity-allow.json";

/** The 33 columns of seo_live.csv, in order. The crawl CSV is byte-shaped the same way. */
export const SEO_COLUMNS = [
  "url",
  "type",
  "status",
  "redirected",
  "final_url",
  "title",
  "title_len",
  "meta_description",
  "desc_len",
  "canonical",
  "canonical_self",
  "robots",
  "h1_count",
  "h1",
  "h2_count",
  "og_title",
  "og_description",
  "og_image",
  "og_type",
  "og_url",
  "og_locale",
  "og_site_name",
  "twitter_card",
  "twitter_title",
  "twitter_image",
  "schema_types",
  "word_count",
  "img_count",
  "img_missing_alt",
  "internal_links",
  "external_links",
  "lang",
  "html_kb",
] as const;

export const DIFF_COLUMNS = ["status", "title", "canonical", "schema_types", "h1"] as const;
export type DiffColumn = (typeof DIFF_COLUMNS)[number];

const SCHEMA_SEPARATOR = " | ";
const MAX_HOPS = 5;
const DEFAULT_LIMIT = 20;

export type SeoRow = Record<string, string>;
export type AllowList = Record<string, string>;

export type Cell = { path: string; column: DiffColumn; live: string; crawl: string; explained?: string };

export type ParityDiff = {
  total: number;
  compared: number;
  mismatches: Cell[];
  explained: Cell[];
  missingFromCrawl: string[];
  extraInCrawl: string[];
  byColumn: Record<DiffColumn, number>;
};

// ── url helpers ───────────────────────────────────────────────────────────────────────────────

const ANY_ORIGIN_RE = /^[a-z][a-z0-9+.-]*:\/\/[^/]+/i;

/** Absolute or relative URL → its encoded path, trailing-slash normalised (files keep their name). */
export function pathOf(url: string): string {
  const raw = url.trim().replace(ANY_ORIGIN_RE, "");
  const p = pathOnly(raw === "" ? "/" : raw.startsWith("/") ? raw : `/${raw}`);
  return /\.[a-z0-9]{2,5}$/i.test(p) ? p : ensureTrailingSlash(p);
}

// ── html parsing (regex only - the spec allows no HTML parser) ──────────────────────────────

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: "\u00a0",
  zwnj: "\u200c",
  laquo: "«",
  raquo: "»",
  hellip: "…",
  mdash: "—",
  ndash: "–",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, body: string) => {
    if (body.startsWith("#")) {
      const hex = body[1] === "x" || body[1] === "X";
      const code = Number.parseInt(hex ? body.slice(2) : body.slice(1), hex ? 16 : 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match;
  });
}

const TAG_RE = /<[^>]*>/g;

function textOf(html: string): string {
  return decodeEntities(html.replace(TAG_RE, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function stripNonText(html: string): string {
  return html.replace(/<(script|style|noscript|svg|template)\b[\s\S]*?<\/\1>/gi, " ");
}

/** `<meta name="x" content="y">` or `<meta property="x" content="y">`, attribute order agnostic. */
function meta(html: string, key: string, attr: "name" | "property"): string {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(
    `<meta\\b[^>]*\\b${attr}\\s*=\\s*["']${escaped}["'][^>]*>|<meta\\b[^>]*\\bcontent\\s*=\\s*["'][^"']*["'][^>]*\\b${attr}\\s*=\\s*["']${escaped}["'][^>]*>`,
    "i",
  );
  const tag = re.exec(html)?.[0];
  if (tag === undefined) return "";
  const content = /\bcontent\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1] ?? "";
  return decodeEntities(content).trim();
}

function attrOf(html: string, tagRe: RegExp, attr: string): string {
  const tag = tagRe.exec(html)?.[0];
  if (tag === undefined) return "";
  const re = new RegExp(`\\b${attr}\\s*=\\s*["']([^"']*)["']`, "i");
  return decodeEntities(re.exec(tag)?.[1] ?? "").trim();
}

function collectTypes(value: unknown, out: string[]): void {
  if (Array.isArray(value)) {
    for (const v of value) collectTypes(v, out);
    return;
  }
  if (value === null || typeof value !== "object") return;
  const obj = value as Record<string, unknown>;
  const t = obj["@type"];
  if (typeof t === "string") {
    if (!out.includes(t)) out.push(t);
  } else if (Array.isArray(t)) {
    for (const one of t) if (typeof one === "string" && !out.includes(one)) out.push(one);
  }
  for (const v of Object.values(obj)) collectTypes(v, out);
}

export function schemaTypesOf(html: string): string[] {
  const out: string[] = [];
  const re = /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const m of html.matchAll(re)) {
    const body = (m[1] ?? "").trim();
    if (body === "") continue;
    try {
      collectTypes(JSON.parse(body), out);
    } catch {
      // A malformed JSON-LD block is not fatal for a parity report; it simply contributes no types.
    }
  }
  return out;
}

export type ParsedHead = {
  title: string;
  description: string;
  canonical: string;
  robots: string;
  h1: string;
  h1Count: number;
  h2Count: number;
  og: Record<"title" | "description" | "image" | "type" | "url" | "locale" | "site_name", string>;
  twitter: Record<"card" | "title" | "image", string>;
  schemaTypes: string[];
  lang: string;
  wordCount: number;
  imgCount: number;
  imgMissingAlt: number;
  internalLinks: number;
  externalLinks: number;
};

export function parseHead(html: string, finalUrl: string): ParsedHead {
  const h1s = [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)];
  const h2s = [...html.matchAll(/<h2\b[^>]*>/gi)];
  const imgs = [...html.matchAll(/<img\b[^>]*>/gi)].map((m) => m[0]);
  const anchors = [...html.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']*)["'][^>]*>/gi)].map((m) => m[1] ?? "");

  let host = "";
  try {
    host = new URL(finalUrl).host;
  } catch {
    host = "";
  }
  let internal = 0;
  let external = 0;
  for (const href of anchors) {
    if (href === "" || href.startsWith("#") || /^(mailto|tel|javascript):/i.test(href)) continue;
    const abs = ANY_ORIGIN_RE.test(href);
    if (!abs) internal += 1;
    else if (host !== "" && href.includes(host)) internal += 1;
    else external += 1;
  }

  return {
    title: textOf(/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? ""),
    description: meta(html, "description", "name"),
    canonical: attrOf(html, /<link\b[^>]*\brel\s*=\s*["']canonical["'][^>]*>/i, "href"),
    robots: meta(html, "robots", "name"),
    h1: textOf(h1s[0]?.[1] ?? ""),
    h1Count: h1s.length,
    h2Count: h2s.length,
    og: {
      title: meta(html, "og:title", "property"),
      description: meta(html, "og:description", "property"),
      image: meta(html, "og:image", "property"),
      type: meta(html, "og:type", "property"),
      url: meta(html, "og:url", "property"),
      locale: meta(html, "og:locale", "property"),
      site_name: meta(html, "og:site_name", "property"),
    },
    twitter: {
      card: meta(html, "twitter:card", "name"),
      title: meta(html, "twitter:title", "name"),
      image: meta(html, "twitter:image", "name"),
    },
    schemaTypes: schemaTypesOf(html),
    lang: attrOf(html, /<html\b[^>]*>/i, "lang"),
    wordCount: textOf(stripNonText(html)).split(/\s+/).filter(Boolean).length,
    imgCount: imgs.length,
    imgMissingAlt: imgs.filter((t) => !/\balt\s*=\s*["'][^"']+["']/i.test(t)).length,
    internalLinks: internal,
    externalLinks: external,
  };
}

// ── crawl ─────────────────────────────────────────────────────────────────────────────────────

export type CrawlResult = {
  url: string;
  type: string;
  status: number;
  redirected: boolean;
  finalUrl: string;
  bytes: number;
  head: ParsedHead | null;
};

const pyBool = (b: boolean): string => (b ? "True" : "False");

export function toSeoRow(i: CrawlResult): SeoRow {
  const h = i.head;
  const canonical = h?.canonical ?? "";
  return {
    url: i.url,
    type: i.type,
    status: String(i.status),
    redirected: pyBool(i.redirected),
    final_url: i.finalUrl,
    title: h?.title ?? "",
    title_len: String((h?.title ?? "").length),
    meta_description: h?.description ?? "",
    desc_len: String((h?.description ?? "").length),
    canonical,
    canonical_self: pyBool(canonical !== "" && pathOf(canonical) === pathOf(i.finalUrl)),
    robots: h?.robots ?? "",
    h1_count: String(h?.h1Count ?? 0),
    h1: h?.h1 ?? "",
    h2_count: String(h?.h2Count ?? 0),
    og_title: h?.og.title ?? "",
    og_description: h?.og.description ?? "",
    og_image: h?.og.image ?? "",
    og_type: h?.og.type ?? "",
    og_url: h?.og.url ?? "",
    og_locale: h?.og.locale ?? "",
    og_site_name: h?.og.site_name ?? "",
    twitter_card: h?.twitter.card ?? "",
    twitter_title: h?.twitter.title ?? "",
    twitter_image: h?.twitter.image ?? "",
    schema_types: (h?.schemaTypes ?? []).join(SCHEMA_SEPARATOR),
    word_count: String(h?.wordCount ?? 0),
    img_count: String(h?.imgCount ?? 0),
    img_missing_alt: String(h?.imgMissingAlt ?? 0),
    internal_links: String(h?.internalLinks ?? 0),
    external_links: String(h?.externalLinks ?? 0),
    lang: h?.lang ?? "",
    html_kb: String(Math.round(i.bytes / 1024)),
  };
}

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

async function fetchPage(origin: string, encodedPath: string): Promise<CrawlResult> {
  const start = `${origin.replace(/\/+$/, "")}${encodedPath}`;
  let url = start;
  let redirected = false;
  for (let hop = 0; hop <= MAX_HOPS; hop += 1) {
    let res: Response;
    try {
      res = await fetch(url, { redirect: "manual", headers: { "user-agent": "namilux-seo-crawl" } });
    } catch {
      return { url: start, type: "", status: 0, redirected, finalUrl: url, bytes: 0, head: null };
    }
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (location === null) break;
      redirected = true;
      url = new URL(location, url).toString();
      continue;
    }
    const html = await res.text();
    return {
      url: start,
      type: "",
      status: res.status,
      redirected,
      finalUrl: url,
      bytes: Buffer.byteLength(html, "utf8"),
      head: res.status === 200 ? parseHead(html, url) : null,
    };
  }
  return { url: start, type: "", status: 0, redirected, finalUrl: url, bytes: 0, head: null };
}

export async function crawl(
  origin: string,
  paths: readonly string[],
  opts?: {
    concurrency?: number;
    gapMs?: number;
    types?: ReadonlyMap<string, string>;
    onProgress?: (done: number, total: number) => void;
  },
): Promise<SeoRow[]> {
  let done = 0;
  const rows = await mapPool(paths, opts?.concurrency ?? 4, opts?.gapMs ?? 100, async (p) => {
    const result = await fetchPage(origin, p);
    done += 1;
    opts?.onProgress?.(done, paths.length);
    return toSeoRow({ ...result, type: opts?.types?.get(pathOf(p)) ?? "" });
  });
  return rows;
}

// ── csv ───────────────────────────────────────────────────────────────────────────────────────

const BOM = "\ufeff";

function csvCell(v: string): string {
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function toCsv(rows: SeoRow[], columns: readonly string[] = SEO_COLUMNS): string {
  const lines = [columns.map(csvCell).join(",")];
  for (const row of rows) lines.push(columns.map((c) => csvCell(row[c] ?? "")).join(","));
  return `${BOM}${lines.join("\r\n")}\r\n`;
}

export function readSeoCsv(file: string): SeoRow[] {
  const raw: Record<string, string | undefined>[] = csvParse(readFileSync(file), {
    columns: true,
    bom: true,
    skip_empty_lines: true,
  });
  return raw.map((r) => {
    const row: SeoRow = {};
    for (const [k, v] of Object.entries(r)) row[k] = v ?? "";
    return row;
  });
}

// ── diff ──────────────────────────────────────────────────────────────────────────────────────

export function loadAllow(file: string = path.join(repoRoot(), ALLOW_FILE)): AllowList {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: AllowList = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "string") out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

const NBSP_RE = /[\u00a0\u200b\ufeff]/g;

/**
 * DECISION: `canonical` is compared as a PATH, not as a full URL - otherwise a crawl of
 * http://localhost:3000 (or any staging host) would report 752 mismatches and the tool would only be
 * usable against production. The full values are still printed on mismatch.
 */
export function normalizeCell(column: DiffColumn, value: string): string {
  const base = value.replace(NBSP_RE, " ").replace(/\s+/g, " ").trim().normalize("NFC");
  if (column === "status") return String(Number.parseInt(base, 10) || 0);
  if (column === "canonical") return base === "" ? "" : decPath(pathOf(base));
  if (column === "schema_types") {
    return [...new Set(base.split("|").map((s) => s.trim()).filter(Boolean))].sort().join(SCHEMA_SEPARATOR);
  }
  return base;
}

/**
 * DECISION (M1): the allow-list gained one form, `"schema_types +Type": "<reason>"`, and it is the
 * only way this file can be both green and meaningful. the spec REQUIRES the new graph to publish
 * nodes the Yoast head never had - HomeGoodsStore, PostalAddress, SearchAction, EntryPoint, Brand,
 * Offer, ItemList, ListItem - on every page, so whole-set equality against `seo_live.csv` can never
 * hold. Allow-listing the whole `schema_types` column instead would silence the opposite case, and
 * that case is a real regression: a legacy node that DISAPPEARED (the crawl found WebPage missing on
 * 162 URLs and BreadcrumbList on 159, both since fixed). So a schema cell is explained only when
 * every type it ADDS is allow-listed and it REMOVES nothing.
 */
function schemaExplanation(cell: { live: string; crawl: string }, allow: AllowList): string | undefined {
  const set = (v: string): Set<string> =>
    new Set(v.split("|").map((s) => s.trim()).filter(Boolean));
  const live = set(cell.live);
  const crawl = set(cell.crawl);

  const removed = [...live].filter((t) => !crawl.has(t));
  if (removed.length > 0) return undefined;

  const added = [...crawl].filter((t) => !live.has(t));
  const reasons: string[] = [];
  for (const type of added) {
    const reason = allow[`schema_types +${type}`];
    if (reason === undefined) return undefined;
    if (!reasons.includes(reason)) reasons.push(reason);
  }
  return reasons.length === 0 ? undefined : reasons.join("; ");
}

function explanationFor(
  cell: { path: string; column: DiffColumn; live: string; crawl: string },
  allow: AllowList,
  legacyStatus?: Map<string, number>,
): string | undefined {
  const byPath = allow[`${cell.column} ${cell.path}`];
  if (byPath !== undefined) return byPath;
  // Keys beginning with "_" are comments; a DiffColumn never starts with "_", so they never match.
  const byColumn = allow[cell.column];
  if (byColumn !== undefined) return byColumn;
  if (cell.column === "schema_types") {
    const added = schemaExplanation(cell, allow);
    if (added !== undefined) return added;
  }
  // The 5 brand URLs that were already 404 before the rebuild are fixed on purpose.
  if (cell.column === "status") {
    const was = legacyStatus?.get(cell.path);
    if (was !== undefined && was !== 200) return `legacy ${was} fixed on purpose`;
  }
  return undefined;
}

export function diffRows(
  live: SeoRow[],
  crawlRows: SeoRow[],
  allow: AllowList,
  legacyStatus?: Map<string, number>,
): ParityDiff {
  const byPath = new Map<string, SeoRow>();
  for (const row of crawlRows) byPath.set(pathOf(row["url"] ?? ""), row);

  const mismatches: Cell[] = [];
  const explained: Cell[] = [];
  const missingFromCrawl: string[] = [];
  const seen = new Set<string>();
  const byColumn = Object.fromEntries(DIFF_COLUMNS.map((c) => [c, 0])) as Record<DiffColumn, number>;
  let compared = 0;

  for (const baseline of live) {
    const p = pathOf(baseline["url"] ?? "");
    seen.add(p);
    const actual = byPath.get(p);
    if (actual === undefined) {
      missingFromCrawl.push(p);
      continue;
    }
    compared += 1;
    for (const column of DIFF_COLUMNS) {
      const l = normalizeCell(column, baseline[column] ?? "");
      const c = normalizeCell(column, actual[column] ?? "");
      if (l === c) continue;
      const reason = explanationFor({ path: p, column, live: l, crawl: c }, allow, legacyStatus);
      const cell: Cell = {
        path: p,
        column,
        live: baseline[column] ?? "",
        crawl: actual[column] ?? "",
        ...(reason === undefined ? {} : { explained: reason }),
      };
      if (reason === undefined) {
        mismatches.push(cell);
        byColumn[column] += 1;
      } else {
        explained.push(cell);
      }
    }
  }

  const extraInCrawl = [...byPath.keys()].filter((p) => !seen.has(p));
  return { total: live.length, compared, mismatches, explained, missingFromCrawl, extraInCrawl, byColumn };
}

// ── reporting ─────────────────────────────────────────────────────────────────────────────────

function clip(v: string, max = 90): string {
  const one = v.replace(/\s+/g, " ").trim();
  return one.length <= max ? one : `${one.slice(0, max - 1)}…`;
}

export function formatDiff(
  diff: ParityDiff,
  opts?: { all?: boolean; limit?: number; head?: string[] },
): string {
  const limit = opts?.all === true ? Number.POSITIVE_INFINITY : (opts?.limit ?? DEFAULT_LIMIT);
  const lines: string[] = [...(opts?.head ?? [])];

  for (const column of DIFF_COLUMNS) {
    const cells = diff.mismatches.filter((c) => c.column === column);
    if (cells.length === 0) continue;
    lines.push("");
    lines.push(`  ${column} — ${cells.length} mismatch${cells.length === 1 ? "" : "es"}`);
    let shown = 0;
    for (const c of cells) {
      if (shown >= limit) {
        lines.push(`    … and ${cells.length - shown} more (run with --all)`);
        break;
      }
      lines.push(`    ${c.path}`);
      lines.push(`      live  : ${clip(c.live)}`);
      lines.push(`      crawl : ${clip(c.crawl)}`);
      shown += 1;
    }
  }

  if (diff.missingFromCrawl.length > 0) {
    lines.push("");
    lines.push(`  not crawled — ${diff.missingFromCrawl.length}`);
    for (const p of diff.missingFromCrawl.slice(0, Number.isFinite(limit) ? limit : undefined)) {
      lines.push(`    ${p}`);
    }
  }
  if (diff.extraInCrawl.length > 0) {
    lines.push("");
    lines.push(`  crawled but not in the baseline — ${diff.extraInCrawl.length}`);
    for (const p of diff.extraInCrawl.slice(0, Number.isFinite(limit) ? limit : undefined)) {
      lines.push(`    ${p}`);
    }
  }

  lines.push("");
  const perColumn = DIFF_COLUMNS.map((c) => `${c} ${diff.byColumn[c]}`).join(" · ");
  lines.push(`  by column: ${perColumn}`);
  lines.push(
    `  compared ${diff.compared}/${diff.total} URLs — ${diff.mismatches.length} unexplained, ` +
      `${diff.explained.length} explained by ${ALLOW_FILE}`,
  );
  const ok = diff.mismatches.length === 0 && diff.missingFromCrawl.length === 0 && diff.extraInCrawl.length === 0;
  lines.push(ok ? "  PARITY OK" : "  PARITY FAILED");
  return lines.join("\n");
}

// ── CLI ───────────────────────────────────────────────────────────────────────────────────────

const USAGE = `pnpm seo:crawl <origin> — head parity crawl of the 752 URLs

  tsx contract/parity-crawl.ts <origin> [options]

  --out <file>        where to write the crawl CSV (default: ${OUT_CSV})
  --from <file>       skip the crawl and diff an existing crawl CSV instead
  --baseline <file>   baseline CSV (default: ${SEO_LIVE_CSV})
  --allow <file>      accepted-difference list (default: ${ALLOW_FILE})
  --concurrency <n>   parallel requests (default 4)
  --gap <ms>          pause after each request (default 100)
  --limit <n>         mismatches listed per column (default ${DEFAULT_LIMIT})
  --all               list every mismatch
  --json              print the diff as JSON
  --help
`;

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        out: { type: "string" },
        from: { type: "string" },
        baseline: { type: "string" },
        allow: { type: "string" },
        concurrency: { type: "string" },
        gap: { type: "string" },
        limit: { type: "string" },
        all: { type: "boolean", default: false },
        json: { type: "boolean", default: false },
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

  const root = repoRoot();
  const origin = parsed.positionals[0] ?? "";
  if (flags.from === undefined && !/^https?:\/\//i.test(origin)) {
    console.error("an <origin> such as http://localhost:3000 is required (or --from <crawl.csv>)");
    console.error(USAGE);
    return 1;
  }

  const inventory = readInventory();
  const baselineFile = flags.baseline ?? path.join(root, SEO_LIVE_CSV);
  const baseline = readSeoCsv(baselineFile);
  const allow = loadAllow(flags.allow ?? path.join(root, ALLOW_FILE));

  // The inventory carries the legacy status and the entity type for every URL.
  const legacyStatus = new Map<string, number>();
  const types = new Map<string, string>();
  for (const row of inventory) {
    const key = pathOf(row.path === "" ? row.oldUrl : row.path);
    legacyStatus.set(key, row.status);
    types.set(key, row.type);
  }

  const head: string[] = [];
  let crawlRows: SeoRow[];

  if (flags.from !== undefined) {
    crawlRows = readSeoCsv(flags.from);
    head.push(`NAMILUX parity diff — ${flags.from} vs ${path.relative(root, baselineFile).replace(/\\/g, "/")}`);
  } else {
    const paths = inventory.map((r) => (r.path === "" ? normalizeInventoryPath(r.oldUrl) : r.path));
    const concurrency = Number.parseInt(flags.concurrency ?? "4", 10) || 4;
    const gapMs = Number.parseInt(flags.gap ?? "100", 10);
    head.push(`NAMILUX parity crawl — ${origin} · ${paths.length} URLs · ${concurrency} concurrent · ${gapMs} ms gap`);
    crawlRows = await crawl(origin, paths, {
      concurrency,
      gapMs: Number.isFinite(gapMs) ? gapMs : 100,
      types,
      onProgress: (done, total) => {
        if (done % 50 === 0 || done === total) process.stderr.write(`  crawled ${done}/${total}\r`);
      },
    });
    process.stderr.write("\n");

    const outFile = flags.out ?? path.join(root, OUT_CSV);
    mkdirSync(path.dirname(outFile), { recursive: true });
    writeFileSync(outFile, toCsv(crawlRows), "utf8");
    head.push(`wrote ${path.relative(root, outFile).replace(/\\/g, "/")}`);
  }

  // Every crawl row is compared against the legacy origin's URL, so both sides key on the same path.
  const diff = diffRows(baseline, crawlRows, allow, legacyStatus);

  if (flags.json === true) {
    console.log(JSON.stringify({ ...diff, baseline: baselineFile, origin: origin || flags.from }, null, 2));
  } else {
    const limit = flags.limit === undefined ? undefined : Number.parseInt(flags.limit, 10);
    console.log(
      formatDiff(diff, {
        all: flags.all === true,
        ...(limit !== undefined && Number.isFinite(limit) ? { limit } : {}),
        head,
      }),
    );
  }

  const ok = diff.mismatches.length === 0 && diff.missingFromCrawl.length === 0 && diff.extraInCrawl.length === 0;
  return ok ? 0 : 1;
}

const invokedDirectly =
  process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url;

if (invokedDirectly) {
  process.exitCode = await main();
}
