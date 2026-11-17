import { readFile } from "node:fs/promises";
import path from "node:path";
import { seedEnv } from "@namilux/config/env";
import { pino } from "pino";
import { STAGE_ORDER, createContext, type SeedStage } from "./context.js";
import { openSeedDb } from "./db.js";
import { missingExtractFiles, resolveExtractDir, resolveMediaDir } from "./extract/paths.js";
import { SEED_TABLES, SeedAbort, assertTablesExist, guardAgainstLiveData, stampRun } from "./idempotency.js";
import { finishReport, formatSummary, writeReport, type SeedReport } from "./report.js";
import * as catalog from "./importers/catalog.js";
import * as content from "./importers/content.js";
import * as fixtures from "./importers/fixtures.js";
import * as media from "./importers/media.js";
import * as redirects from "./importers/redirects.js";
import * as seo from "./importers/seo.js";

export type CliOptions = {
  command: "seed" | "report" | "help";
  only: SeedStage[] | null;
  dry: boolean;
  limit: number | null;
  force: boolean;
  extract: string | null;
  mediaDir: string | null;
  report: string | null;
};

export const USAGE = `namilux seed — legacy import

  seed [--only=fixtures,catalog,content,seo,redirects,media] [--dry] [--limit=N] [--force]
       [--extract=<dir>] [--media-dir=<dir>] [--report=<file>]
  seed report
  seed --help

exit codes: 0 ok · 1 usage · 2 guard refused · 3 stage failed · 4 gate failed
`;

/** Default report file name inside the media dir (contract). */
export const REPORT_FILE = "seed-report.json";

export const EXIT = { ok: 0, usage: 1, guard: 2, stage: 3, gate: 4 } as const;

const STAGES: Record<SeedStage, (ctx: ReturnType<typeof createContext>) => Promise<void>> = {
  fixtures: (ctx) => fixtures.run(ctx),
  catalog: (ctx) => catalog.run(ctx),
  content: (ctx) => content.run(ctx),
  seo: (ctx) => seo.run(ctx),
  redirects: (ctx) => redirects.run(ctx),
  media: (ctx) => media.run(ctx),
};

function value(arg: string): string {
  const at = arg.indexOf("=");
  return at < 0 ? "" : arg.slice(at + 1);
}

export function parseArgs(argv: string[]): CliOptions {
  const out: CliOptions = {
    command: "seed",
    only: null,
    dry: false,
    limit: null,
    force: false,
    extract: null,
    mediaDir: null,
    report: null,
  };
  let sawCommand = false;

  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") return { ...out, command: "help" };
    if (!arg.startsWith("-")) {
      if (sawCommand) throw new Error(`unexpected argument: ${arg}\n\n${USAGE}`);
      if (arg !== "seed" && arg !== "report") throw new Error(`unknown command: ${arg}\n\n${USAGE}`);
      out.command = arg;
      sawCommand = true;
      continue;
    }
    if (arg === "--dry") {
      out.dry = true;
      continue;
    }
    if (arg === "--force") {
      out.force = true;
      continue;
    }
    if (arg.startsWith("--only=")) {
      const known = new Set<string>(STAGE_ORDER);
      const requested = value(arg)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      for (const stage of requested) {
        if (!known.has(stage)) throw new Error(`unknown stage: ${stage}\n\n${USAGE}`);
      }
      const wanted = new Set(requested);
      // Deduped and normalised to STAGE_ORDER (fixtures before catalog before media).
      out.only = STAGE_ORDER.filter((s) => wanted.has(s));
      continue;
    }
    if (arg.startsWith("--limit=")) {
      const raw = value(arg);
      const n = Number(raw);
      if (!/^\d+$/.test(raw) || !Number.isInteger(n) || n < 1) {
        throw new Error(`--limit must be a positive integer, got "${raw}"\n\n${USAGE}`);
      }
      out.limit = n;
      continue;
    }
    if (arg.startsWith("--extract=")) {
      out.extract = value(arg) || null;
      continue;
    }
    if (arg.startsWith("--media-dir=")) {
      out.mediaDir = value(arg) || null;
      continue;
    }
    if (arg.startsWith("--report=")) {
      out.report = value(arg) || null;
      continue;
    }
    throw new Error(`unknown flag: ${arg}\n\n${USAGE}`);
  }
  return out;
}

function reportPathFor(opts: CliOptions, mediaDir: string): string {
  return opts.report ? path.resolve(opts.report) : path.join(mediaDir, REPORT_FILE);
}

async function printLastReport(opts: CliOptions): Promise<number> {
  const mediaDir = resolveMediaDir(opts.mediaDir);
  const file = reportPathFor(opts, mediaDir);
  try {
    const parsed = JSON.parse(await readFile(file, "utf8")) as SeedReport;
    process.stdout.write(`${formatSummary(parsed)}\n`);
    return EXIT.ok;
  } catch {
    process.stdout.write(`no report yet (${file})\n`);
    return EXIT.ok;
  }
}

export async function main(argv: string[]): Promise<number> {
  let opts: CliOptions;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    return EXIT.usage;
  }
  if (opts.command === "help") {
    process.stdout.write(USAGE);
    return EXIT.ok;
  }
  if (opts.command === "report") return printLastReport(opts);

  const env = seedEnv();
  const log = pino({ level: env.LOG_LEVEL, base: { app: "seed" } });
  const extractDir = resolveExtractDir(opts.extract);
  const mediaDir = resolveMediaDir(opts.mediaDir ?? env.MEDIA_DIR);
  const reportFile = reportPathFor(opts, mediaDir);

  let close: (() => Promise<void>) | null = null;
  try {
    const missing = missingExtractFiles(extractDir);
    if (missing.length > 0) {
      throw new SeedAbort(`extract is incomplete under ${extractDir}: ${missing.join(", ")}`, "EXTRACT_MISSING");
    }

    const seedDb = await openSeedDb({
      url: env.DATABASE_URL_ADMIN,
      // DECISION: SEED_ALLOW_REMOTE is not a key of @namilux/config `envShape`, so it is read here
      // from the raw environment exactly as extract/paths.ts reads SEED_EXTRACT_DIR.
      allowRemote: process.env["SEED_ALLOW_REMOTE"] === "1",
    });
    close = () => seedDb.close();
    log.info({ db: seedDb.url.toString(), extractDir, mediaDir }, "seed starting");

    await assertTablesExist(seedDb.db, SEED_TABLES);
    // A dry run must not pretend it would succeed: the guard runs either way.
    await guardAgainstLiveData(seedDb.db, { force: opts.force, log });

    const ctx = createContext({
      db: seedDb.db,
      extractDir,
      mediaDir,
      siteOrigin: env.SITE_ORIGIN,
      dry: opts.dry,
      limit: opts.limit,
      force: opts.force,
      only: opts.only,
      log,
    });

    for (const stage of STAGE_ORDER) {
      if (!ctx.stages.has(stage)) continue;
      const startedAt = Date.now();
      log.info({ stage }, "stage start");
      await STAGES[stage](ctx);
      log.info({ stage, ms: Date.now() - startedAt }, "stage done");
    }

    finishReport(ctx.report, ctx.now());
    // A dry run writes nothing to disk when the report would land inside the media dir (contract).
    const reportInsideMedia = path.resolve(reportFile).startsWith(path.resolve(mediaDir) + path.sep);
    if (!opts.dry || !reportInsideMedia) await writeReport(ctx.report, reportFile);

    if (!opts.dry) {
      await stampRun(seedDb.db, {
        runId: ctx.report.startedAt,
        summary: {
          products: ctx.report.products,
          categories: ctx.report.categories,
          brands: ctx.report.brands,
          posts: ctx.report.posts,
          pages: ctx.report.pages,
          redirects: ctx.report.redirects,
          media: ctx.report.media.masters,
          forced: opts.force,
          gate: ctx.report.gate?.ok ?? null,
        },
      });
    }

    process.stdout.write(`${formatSummary(ctx.report)}\n`);
    return ctx.report.gate?.ok === false ? EXIT.gate : EXIT.ok;
  } catch (err) {
    if (err instanceof SeedAbort) {
      process.stderr.write(`[seed] ${err.code}: ${err.message}\n`);
      return EXIT.guard;
    }
    process.stderr.write(`${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
    return EXIT.stage;
  } finally {
    if (close) await close();
  }
}

// Run when invoked directly (`tsx src/cli.ts …`); imported by tests without side effects.
if (process.argv[1] && /cli\.(ts|js)$/.test(process.argv[1])) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err: unknown) => {
      process.stderr.write(String(err instanceof Error ? (err.stack ?? err.message) : err) + "\n");
      process.exit(3);
    },
  );
}
