import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { sql } from "drizzle-orm";
import type { DbClient } from "../src/client";
import { closeDb, createDb, redactDbUrl } from "../src/client";

export type AppRole = "web" | "admin" | "worker";
export type RolePasswords = Partial<Record<AppRole, string>>;

export type ApplyRolesOptions = {
  url: string;
  passwords?: RolePasswords;
  rolesFile?: string;
  log?: (line: string) => void;
};

export const DEFAULT_ROLES_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../roles.sql");

export const APP_ROLES: readonly AppRole[] = ["web", "admin", "worker"] as const;

/** app role → the Postgres role name and the env var whose DSN carries its password. */
const ROLE_META: Record<AppRole, { pgRole: string; envVar: string; setting: string }> = {
  web: { pgRole: "nl_web", envVar: "DATABASE_URL_WEB", setting: "nl.pw_web" },
  admin: { pgRole: "nl_admin", envVar: "DATABASE_URL_ADMIN", setting: "nl.pw_admin" },
  worker: { pgRole: "nl_worker", envVar: "DATABASE_URL_WORKER", setting: "nl.pw_worker" },
};

export function passwordFromUrl(url: string): string | null {
  let raw: string;
  try {
    raw = new URL(url).password;
  } catch {
    throw new Error("invalid database URL");
  }
  if (raw === "") return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    // A password with a stray '%' is not valid percent-encoding; take it literally rather than
    // failing the whole run.
    return raw;
  }
}

export function passwordsFromEnv(env: NodeJS.ProcessEnv = process.env): RolePasswords {
  const out: RolePasswords = {};
  for (const role of APP_ROLES) {
    const url = env[ROLE_META[role].envVar];
    if (url === undefined || url === "") continue;
    const pw = passwordFromUrl(url);
    if (pw !== null) out[role] = pw;
  }
  return out;
}

/** Drizzle wraps driver errors, so walk the `cause` chain for the Postgres SQLSTATE. */
function errorCode(err: unknown): string | null {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && typeof current === "object" && current !== null; depth += 1) {
    if ("code" in current) {
      const code: unknown = current.code;
      if (typeof code === "string") return code;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}

export async function applyRoles(
  opts: ApplyRolesOptions,
): Promise<{ existedBefore: AppRole[]; passwordsSet: AppRole[] }> {
  const rolesFile = opts.rolesFile ?? DEFAULT_ROLES_FILE;
  const log = opts.log ?? ((line: string) => console.log(line));
  if (!existsSync(rolesFile)) throw new Error(`roles file not found: ${rolesFile}`);
  const rolesSql = readFileSync(rolesFile, "utf8");
  const passwords = opts.passwords ?? {};

  const db: DbClient = createDb("migrate", { url: opts.url, applicationName: "nl_roles_script" });
  try {
    const pgRoles = APP_ROLES.map((r) => ROLE_META[r].pgRole);
    const rows = (await db.execute(
      sql`select rolname from pg_roles where rolname in (${sql.join(
        pgRoles.map((r) => sql`${r}`),
        sql`, `,
      )})`,
    )) as unknown as { rolname: string }[];
    const found = new Set(rows.map((r) => r.rolname));
    const existedBefore = APP_ROLES.filter((r) => found.has(ROLE_META[r].pgRole));

    const passwordsSet: AppRole[] = [];
    try {
      // ONE transaction: the transaction-local settings the DO block reads must live on the same
      // connection as the file, and roles.sql opens with REVOKE ALL - a half-applied run would
      // lock the apps out.
      await db.transaction(async (tx) => {
        for (const role of APP_ROLES) {
          const pw = passwords[role];
          if (pw === undefined || pw === "") continue;
          // Bound parameter: the password never reaches the SQL text (spec rules).
          await tx.execute(sql`select set_config(${ROLE_META[role].setting}, ${pw}, true)`);
          passwordsSet.push(role);
        }
        await tx.execute(sql.raw(rolesSql));
      });
    } catch (err: unknown) {
      const code = errorCode(err);
      const message = err instanceof Error ? err.message : String(err);
      // DECISION: the spec names 42P01 (undefined_table) as the "not migrated yet" signal, but on a
      // truly empty database roles.sql reaches `GRANT EXECUTE ON FUNCTION nl_fa_norm(text)` before
      // its first table GRANT, so Postgres raises 42883 (undefined_function). Both mean the same
      // thing - the migration has not run - so both carry the same hint (the 42P01 branch of the
      // contract is unchanged).
      if (code === "42P01" || code === "42883") {
        throw new Error(`${message} — run pnpm db:migrate first`, { cause: err });
      }
      if (code === "42501") {
        throw new Error(`${message} — nl_migrate needs CREATEROLE (packages/db/README.md §2)`, { cause: err });
      }
      throw err;
    }

    const created = APP_ROLES.filter((r) => !existedBefore.includes(r));
    log(`roles present: ${existedBefore.join(", ") || "none"}`);
    log(`roles created: ${created.join(", ") || "none"}`);
    log(`passwords set: ${passwordsSet.join(", ") || "none"}`);
    return { existedBefore, passwordsSet };
  } finally {
    await closeDb(db);
  }
}

type ParsedArgs = { url: string | null; noPasswords: boolean; file: string | null };

function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = { url: null, noPasswords: false, file: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--no-passwords") out.noPasswords = true;
    else if (arg === "--url") {
      i += 1;
      out.url = argv[i] ?? null;
    } else if (arg === "--file") {
      i += 1;
      out.file = argv[i] ?? null;
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

  const url = args.url ?? process.env.DATABASE_URL_MIGRATE ?? "";
  if (url === "") {
    console.log("DATABASE_URL_MIGRATE is not set");
    return 2;
  }

  console.log(`applying roles to ${redactDbUrl(url)} (host ${hostOf(url)})`);
  try {
    await applyRoles({
      url,
      passwords: args.noPasswords ? {} : passwordsFromEnv(),
      ...(args.file === null ? {} : { rolesFile: args.file }),
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
