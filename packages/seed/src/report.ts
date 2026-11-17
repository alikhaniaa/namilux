import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export type GateCheck = { name: string; expected: string; actual: string; ok: boolean };
export type GateResult = { ok: boolean; checks: GateCheck[] };

export type SeedReport = {
  version: 2;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  dryRun: boolean;
  limit: number | null;
  stages: string[];
  extractDir: string;
  mediaDir: string;
  products: number;
  priced: number;
  onRequest: number;
  inStock: number;
  purchasable: number;
  onSale: number;
  withImages: number;
  withoutImages: number;
  unbranded: number;
  uncategorised: number;
  unsorted: number;
  displayNameDrafts: number;
  models: number;
  modelMembers: number;
  specsRows: number;
  fusedSpecsSplit: number;
  brands: number;
  categories: number;
  categoriesEmpty: number;
  collections: number;
  collectionProducts: number;
  posts: number;
  pages: number;
  pagesPublished: number;
  pagesArchived: number;
  pageSkeletons: number;
  menus: number;
  seoRowsApplied: number;
  seoSnapshots: number;
  seoMissingDescription: number;
  seoNoindex: number;
  redirects: number;
  redirects410: number;
  unmatchedContractPaths: string[];
  slugCollisions: { path: string; kept: number; dropped: number }[];
  media: {
    masters: number;
    renditions: number;
    normalized: number;
    widthBound: number;
    atTarget: number;
    quarantined: number;
    missingSource: number;
    failures: { productId: number; n: number; file: string; error: string }[];
    overBudget: string[];
    ogCards: number;
    contentImagesResolved: number;
    contentImagesDropped: number;
    videosDropped: number;
  };
  fixtures: { roles: number; settingsKeys: number; shippingMethods: number; menus: number; pageSkeletons: number; ownerCreated: boolean };
  legacyOrders: { rows: number; imported: number; skipped: number } | null;
  warnings: string[];
  gate: GateResult | null;
};

/** M0 gate expectations (the spec §M0). Data - keep in sync with the plan, not with the extract. */
export const GATE_EXPECTED = {
  products: 541,
  categories: 73,
  brands: 13,
  posts: 150,
  pages: 15,
  redirectsMin: 20,
  withImages: 295,
  normalized: { target: 269, tolerance: 5 },
  quarantined: { target: 26, tolerance: 5 },
} as const;

/** Warning pushed by `evaluateGate` when a `--limit`ed run makes the counts meaningless. */
export const GATE_SKIPPED_LIMIT = "gate skipped: --limit";

export function createReport(i: {
  startedAt: Date;
  dryRun: boolean;
  limit: number | null;
  stages: string[];
  extractDir: string;
  mediaDir: string;
}): SeedReport {
  return {
    version: 2,
    startedAt: i.startedAt.toISOString(),
    finishedAt: null,
    durationMs: null,
    dryRun: i.dryRun,
    limit: i.limit,
    stages: [...i.stages],
    extractDir: i.extractDir,
    mediaDir: i.mediaDir,
    products: 0,
    priced: 0,
    onRequest: 0,
    inStock: 0,
    purchasable: 0,
    onSale: 0,
    withImages: 0,
    withoutImages: 0,
    unbranded: 0,
    uncategorised: 0,
    unsorted: 0,
    displayNameDrafts: 0,
    models: 0,
    modelMembers: 0,
    specsRows: 0,
    fusedSpecsSplit: 0,
    brands: 0,
    categories: 0,
    categoriesEmpty: 0,
    collections: 0,
    collectionProducts: 0,
    posts: 0,
    pages: 0,
    pagesPublished: 0,
    pagesArchived: 0,
    pageSkeletons: 0,
    menus: 0,
    seoRowsApplied: 0,
    seoSnapshots: 0,
    seoMissingDescription: 0,
    seoNoindex: 0,
    redirects: 0,
    redirects410: 0,
    unmatchedContractPaths: [],
    slugCollisions: [],
    media: {
      masters: 0,
      renditions: 0,
      normalized: 0,
      widthBound: 0,
      atTarget: 0,
      quarantined: 0,
      missingSource: 0,
      failures: [],
      overBudget: [],
      ogCards: 0,
      contentImagesResolved: 0,
      contentImagesDropped: 0,
      videosDropped: 0,
    },
    fixtures: { roles: 0, settingsKeys: 0, shippingMethods: 0, menus: 0, pageSkeletons: 0, ownerCreated: false },
    legacyOrders: null,
    warnings: [],
    gate: null,
  };
}

// DECISION: `finishReport` mutates and returns the same object rather than a copy - `SeedContext.report`
// is the shared reference every importer counted into, so a copy would leave the CLI holding a stale one.
export function finishReport(r: SeedReport, finishedAt: Date): SeedReport {
  r.finishedAt = finishedAt.toISOString();
  // DECISION: clamp to >= 0 so an injected or skewed clock can never report a negative duration.
  r.durationMs = Math.max(0, finishedAt.getTime() - Date.parse(r.startedAt));
  r.gate = evaluateGate(r);
  return r;
}

function check(name: string, expected: string, actual: number | string, ok: boolean): GateCheck {
  return { name, expected, actual: String(actual), ok };
}

function within(actual: number, tolerance: { target: number; tolerance: number }): boolean {
  return Math.abs(actual - tolerance.target) <= tolerance.tolerance;
}

// DECISION: ASCII only in `expected` ("269 +/- 5", ">= 20"). This string is printed to a developer
// terminal (possibly a legacy Windows console); the report is an artefact, not UI copy, so the spec
// (Persian digits) does not apply - the header says so explicitly.
function band(b: { target: number; tolerance: number }): string {
  return `${b.target} +/- ${b.tolerance}`;
}

export function evaluateGate(r: SeedReport): GateResult {
  if (r.limit !== null) {
    warn(r, GATE_SKIPPED_LIMIT);
    return { ok: true, checks: [] };
  }
  const g = GATE_EXPECTED;
  const checks: GateCheck[] = [
    check("products", String(g.products), r.products, r.products === g.products),
    check("categories", String(g.categories), r.categories, r.categories === g.categories),
    check("brands", String(g.brands), r.brands, r.brands === g.brands),
    check("posts", String(g.posts), r.posts, r.posts === g.posts),
    check("pages", String(g.pages), r.pages, r.pages === g.pages),
    check("redirects", `>= ${g.redirectsMin}`, r.redirects, r.redirects >= g.redirectsMin),
    check("withImages", String(g.withImages), r.withImages, r.withImages === g.withImages),
    check("media.normalized", band(g.normalized), r.media.normalized, within(r.media.normalized, g.normalized)),
    check("media.quarantined", band(g.quarantined), r.media.quarantined, within(r.media.quarantined, g.quarantined)),
    check("unmatchedContractPaths", "0", r.unmatchedContractPaths.length, r.unmatchedContractPaths.length === 0),
    check("media.failures", "0", r.media.failures.length, r.media.failures.length === 0),
  ];
  return { ok: checks.every((c) => c.ok), checks };
}

function line(label: string, value: string | number): string {
  return `  ${label.padEnd(24)}${String(value)}`;
}

// DECISION: integer math, not `toFixed` - the spec bans toFixed repo-wide (it renders Latin digits in
// UI). This string is a developer artefact, so the ban is satisfied by not calling it at all.
function seconds(ms: number): string {
  const tenths = Math.round(ms / 100);
  return `${Math.floor(tenths / 10)}.${tenths % 10}s`;
}

export function formatSummary(r: SeedReport): string {
  const out: string[] = [];
  const mode = `${r.dryRun ? "dry-run" : "write"} / ${r.limit === null ? "full" : `limit ${r.limit}`}`;
  out.push(`namilux seed report v${r.version}`);
  out.push(line("started", r.startedAt));
  out.push(line("finished", r.finishedAt ?? "(unfinished)"));
  out.push(line("duration", r.durationMs === null ? "-" : seconds(r.durationMs)));
  out.push(line("mode", mode));
  out.push(line("stages", r.stages.length > 0 ? r.stages.join(", ") : "(none)"));
  out.push(line("extract", r.extractDir));
  out.push(line("media dir", r.mediaDir));

  out.push("catalogue");
  out.push(line("products", `${r.products} (priced ${r.priced}, on request ${r.onRequest}, on sale ${r.onSale})`));
  out.push(line("stock", `${r.inStock} in stock, ${r.purchasable} purchasable`));
  out.push(line("images", `${r.withImages} with, ${r.withoutImages} without`));
  out.push(
    line(
      "taxonomy",
      `${r.brands} brands (${r.unbranded} unbranded), ${r.categories} categories (${r.categoriesEmpty} empty), ${r.uncategorised} uncategorised`,
    ),
  );
  out.push(line("collections", `${r.collections} (${r.collectionProducts} memberships, ${r.unsorted} unsorted)`));
  out.push(line("models", `${r.models} groups, ${r.modelMembers} members`));
  out.push(line("specs", `${r.specsRows} rows (${r.fusedSpecsSplit} fused lists split)`));
  out.push(line("display names", `${r.displayNameDrafts} drafts`));

  out.push("content & seo");
  out.push(line("posts", r.posts));
  out.push(
    line("pages", `${r.pages} (${r.pagesPublished} published, ${r.pagesArchived} archived, ${r.pageSkeletons} skeletons)`),
  );
  out.push(line("menus", r.menus));
  out.push(
    line(
      "seo",
      `${r.seoRowsApplied} rows applied, ${r.seoSnapshots} snapshots, ${r.seoMissingDescription} without description, ${r.seoNoindex} noindex`,
    ),
  );
  out.push(line("redirects", `${r.redirects} (${r.redirects410} gone)`));
  out.push(line("unmatched paths", r.unmatchedContractPaths.length));
  out.push(line("slug collisions", r.slugCollisions.length));

  const m = r.media;
  out.push("media");
  out.push(line("masters", `${m.masters} (${m.renditions} renditions, ${m.ogCards} og cards)`));
  out.push(line("normalized", `${m.normalized} (width-bound ${m.widthBound}, at target ${m.atTarget})`));
  out.push(line("quarantined", `${m.quarantined} (missing source ${m.missingSource})`));
  out.push(line("failures", m.failures.length));
  out.push(line("over budget", m.overBudget.length));
  out.push(
    line(
      "content images",
      `${m.contentImagesResolved} resolved, ${m.contentImagesDropped} dropped, ${m.videosDropped} videos dropped`,
    ),
  );

  const f = r.fixtures;
  out.push("fixtures");
  out.push(
    line(
      "rows",
      `${f.roles} roles, ${f.settingsKeys} settings, ${f.shippingMethods} shipping, ${f.menus} menus, ${f.pageSkeletons} page skeletons`,
    ),
  );
  out.push(line("owner", f.ownerCreated ? "created" : "unchanged"));
  if (r.legacyOrders !== null) {
    out.push(
      line("legacy orders", `${r.legacyOrders.rows} rows, ${r.legacyOrders.imported} imported, ${r.legacyOrders.skipped} skipped`),
    );
  }

  if (r.warnings.length > 0) {
    out.push(`warnings (${r.warnings.length})`);
    for (const w of r.warnings) out.push(`  ! ${w}`);
  }

  if (r.gate === null) {
    out.push("gate: not evaluated");
  } else if (r.gate.checks.length === 0) {
    out.push(`gate: ${r.gate.ok ? "SKIPPED" : "FAIL"} (no checks)`);
  } else {
    const passed = r.gate.checks.filter((c) => c.ok).length;
    out.push(`gate: ${r.gate.ok ? "PASS" : "FAIL"} (${passed}/${r.gate.checks.length})`);
    for (const c of r.gate.checks) {
      if (!c.ok) out.push(`  [x] ${c.name}: expected ${c.expected}, actual ${c.actual}`);
    }
  }
  return out.join("\n");
}

export async function writeReport(r: SeedReport, file: string): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(r, null, 2)}\n`, "utf8");
}

export function warn(r: SeedReport, msg: string): void {
  if (!r.warnings.includes(msg)) r.warnings.push(msg);
}
