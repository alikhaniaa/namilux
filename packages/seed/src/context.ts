import type { Db } from "@namilux/db";
import type { Logger } from "pino";
import { createReport, warn, type SeedReport } from "./report.js";

export type SeedStage = "fixtures" | "catalog" | "content" | "seo" | "redirects" | "media";

export const STAGE_ORDER: readonly SeedStage[] = ["fixtures", "catalog", "content", "seo", "redirects", "media"];

export type SeedContext = {
  db: Db;
  extractDir: string;
  mediaDir: string;
  siteOrigin: string;
  dry: boolean;
  limit: number | null;
  force: boolean;
  stages: ReadonlySet<SeedStage>;
  report: SeedReport;
  log: Logger;
  now: () => Date;
};

/** Warning pushed when `--limit=0` is given (0 means "no limit", not "seed nothing"). */
export const LIMIT_ZERO_WARNING = "--limit=0 ignored: no limit applied";

function normaliseStages(only: SeedStage[] | null): ReadonlySet<SeedStage> {
  if (only === null) return new Set(STAGE_ORDER);
  const known = new Set<string>(STAGE_ORDER);
  for (const s of only) {
    if (!known.has(s)) throw new Error(`unknown stage: ${s}`);
  }
  const requested = new Set<SeedStage>(only);
  // Input order is ignored: stages always run in STAGE_ORDER (fixtures before catalog before media).
  return new Set(STAGE_ORDER.filter((s) => requested.has(s)));
}

export function createContext(i: {
  db: Db;
  extractDir: string;
  mediaDir: string;
  siteOrigin: string;
  dry: boolean;
  limit: number | null;
  force: boolean;
  only: SeedStage[] | null;
  log: Logger;
  now?: () => Date;
}): SeedContext {
  // DECISION: `only: []` enables no stage at all (an explicit empty selection), rather than falling
  // back to "everything" - doing less than asked is the safe reading; `only: null` means all.
  const stages = normaliseStages(i.only);
  const now = i.now ?? (() => new Date());
  // DECISION: limit <= 0 (not just 0) collapses to null; a negative cap can only be a caller bug and
  // "no limit" is what the header prescribes for 0.
  const limitZero = i.limit !== null && i.limit <= 0;
  const limit = limitZero ? null : i.limit;
  const report = createReport({
    startedAt: now(),
    dryRun: i.dry,
    limit,
    stages: [...stages],
    extractDir: i.extractDir,
    mediaDir: i.mediaDir,
  });
  if (limitZero) warn(report, LIMIT_ZERO_WARNING);

  // DECISION: no filesystem work here. The header's dependency list lists neither node:fs nor node:path,
  // and `createContext` is synchronous, so creating/validating mediaDir stays with the media stage
  // and extract/paths.ts (which owns extract validation) - see the report note for this batch.
  return {
    db: i.db,
    extractDir: i.extractDir,
    mediaDir: i.mediaDir,
    siteOrigin: i.siteOrigin,
    dry: i.dry,
    limit,
    force: i.force,
    stages,
    report,
    log: i.log,
    now,
  };
}

export function stageEnabled(ctx: SeedContext, s: SeedStage): boolean {
  return ctx.stages.has(s);
}
