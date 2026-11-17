import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import type { Db, DbClient } from "../src/client";
import { closeDb, createDb, redactDbUrl } from "../src/client";

export type MigrateOptions = {
  url: string;
  migrationsFolder?: string;
  dryRun?: boolean;
  log?: (line: string) => void;
};

export type MigrateResult = {
  applied: string[];
  pending: string[];
  partitionsCreated: number;
};

export const DEFAULT_MIGRATIONS_FOLDER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../migrations");

const MIGRATIONS_SCHEMA = "drizzle";
const MIGRATIONS_TABLE = "__drizzle_migrations";

type JournalEntry = { tag: string; when: number };

/** Reads migrations/meta/_journal.json - the ordered list drizzle's migrator itself walks. */
function readJournal(migrationsFolder: string): JournalEntry[] {
  const journalPath = path.join(migrationsFolder, "meta", "_journal.json");
  if (!existsSync(journalPath)) {
    throw new Error("migrations journal not found — run drizzle-kit generate (migrations/README.md §2)");
  }
  const parsed: unknown = JSON.parse(readFileSync(journalPath, "utf8"));
  const entries =
    typeof parsed === "object" && parsed !== null && Array.isArray((parsed as { entries?: unknown }).entries)
      ? ((parsed as { entries: unknown[] }).entries as { tag?: unknown; when?: unknown }[])
      : [];
  return entries
    .filter((e): e is { tag: string; when: number } => typeof e.tag === "string" && typeof e.when === "number")
    .map((e) => ({ tag: e.tag, when: e.when }));
}

/**
 * The applied high-water mark, using drizzle's own rule: a journal entry is pending when its
 * `when` is greater than the newest `created_at` in drizzle.__drizzle_migrations.
 */
async function appliedHighWaterMark(db: Db): Promise<number> {
  const tableRows = (await db.execute(
    sql`select to_regclass(${`${MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE}`}) is not null as present`,
  )) as unknown as { present: boolean }[];
  if (tableRows[0]?.present !== true) return -1;
  const rows = (await db.execute(
    sql`select max(created_at)::text as max_created_at from ${sql.identifier(MIGRATIONS_SCHEMA)}.${sql.identifier(MIGRATIONS_TABLE)}`,
  )) as unknown as { max_created_at: string | null }[];
  const raw = rows[0]?.max_created_at ?? null;
  return raw === null ? -1 : Number(raw);
}

async function pendingFor(db: Db, migrationsFolder: string): Promise<string[]> {
  const journal = readJournal(migrationsFolder);
  const mark = await appliedHighWaterMark(db);
  return journal.filter((e) => e.when > mark).map((e) => e.tag);
}

export async function listPending(url: string, migrationsFolder: string = DEFAULT_MIGRATIONS_FOLDER): Promise<string[]> {
  // Read the journal before connecting so a missing journal fails fast and without a socket.
  readJournal(migrationsFolder);
  const db: DbClient = createDb("migrate", { url, applicationName: "nl_migrate_script" });
  try {
    return await pendingFor(db, migrationsFolder);
  } finally {
    await closeDb(db);
  }
}

/** Creates the current month's partition plus `months_ahead` more, when the function exists. */
async function ensureEventPartitions(db: Db, monthsAhead: number): Promise<number> {
  const probe = (await db.execute(
    sql`select to_regproc('nl_events_ensure_partitions') is not null as present`,
  )) as unknown as { present: boolean }[];
  if (probe[0]?.present !== true) return 0;
  const rows = (await db.execute(
    sql`select nl_events_ensure_partitions(${monthsAhead}) as created`,
  )) as unknown as { created: number }[];
  return Number(rows[0]?.created ?? 0);
}

export async function runMigrations(opts: MigrateOptions): Promise<MigrateResult> {
  const migrationsFolder = opts.migrationsFolder ?? DEFAULT_MIGRATIONS_FOLDER;
  const log = opts.log ?? ((line: string) => console.log(line));
  // DECISION: no assertLocalDatabase here - migrations are additive and infra/deploy/migrate.sh
  // runs this against production (spec contract). Only destructive helpers guard the host.
  const db: DbClient = createDb("migrate", { url: opts.url, applicationName: "nl_migrate_script" });
  try {
    const pending = await pendingFor(db, migrationsFolder);
    if (opts.dryRun === true) {
      log(pending.length === 0 ? "up to date" : `dry-run: ${pending.length} pending`);
      for (const tag of pending) log(`pending ${tag}`);
      return { applied: [], pending, partitionsCreated: 0 };
    }

    if (pending.length === 0) {
      log("up to date");
    } else {
      try {
        await migrate(db, {
          migrationsFolder,
          migrationsSchema: MIGRATIONS_SCHEMA,
          migrationsTable: MIGRATIONS_TABLE,
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        // Drizzle applies the pending set in one transaction; name the first pending tag so the
        // deploy log points at the file to read.
        throw new Error(`migration failed at or after ${pending[0] ?? "<unknown>"}: ${message}`, { cause: err });
      }
      for (const tag of pending) log(`applied ${tag}`);
    }

    const partitionsCreated = await ensureEventPartitions(db, 2);
    log(
      `migrations: ${pending.length} applied, ${partitionsCreated} event partition(s) created`,
    );
    return { applied: pending, pending: [], partitionsCreated };
  } finally {
    await closeDb(db);
  }
}

type ParsedArgs = { dryRun: boolean; yes: boolean; url: string | null; folder: string | null };

function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = { dryRun: false, yes: false, url: null, folder: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") out.dryRun = true;
    else if (arg === "--yes") out.yes = true;
    else if (arg === "--url") {
      i += 1;
      out.url = argv[i] ?? null;
    } else if (arg === "--folder") {
      i += 1;
      out.folder = argv[i] ?? null;
    }
  }
  return out;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "<unparsable url>";
  }
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const args = parseArgs(argv);

  if (process.env.APP_ENV === "prod" && !args.yes) {
    console.log("refusing: APP_ENV=prod requires --yes");
    return 2;
  }

  const url = args.url ?? process.env.DATABASE_URL_MIGRATE ?? "";
  if (url === "") {
    console.log("DATABASE_URL_MIGRATE is not set");
    return 2;
  }

  console.log(`migrating ${redactDbUrl(url)} (host ${hostOf(url)})`);
  try {
    await runMigrations({
      url,
      ...(args.folder === null ? {} : { migrationsFolder: args.folder }),
      dryRun: args.dryRun,
    });
    return 0;
  } catch (err: unknown) {
    console.error(err);
    return 1;
  }
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(path.resolve(entry)).href) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err: unknown) => {
      console.error(err);
      process.exitCode = 1;
    });
}
