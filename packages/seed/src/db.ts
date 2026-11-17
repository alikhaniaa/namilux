import { closeDb, createDb, sql, type Db } from "@namilux/db";

export type SeedDb = { db: Db; close(): Promise<void>; url: URL };

export const LOCAL_HOSTS: readonly string[] = ["localhost", "127.0.0.1", "::1", "[::1]", "db", "postgres"];

/** Default session statement_timeout: the media stage does long batched inserts (the spec worker band). */
export const DEFAULT_STATEMENT_TIMEOUT_MS = 300_000;

/** Parses without ever throwing the URL (and therefore the password) into an error message. */
function parse(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

function redactParsed(u: URL): URL {
  const out = new URL(u.href);
  if (out.password !== "") out.password = "***";
  // DECISION: libpq URIs may also carry the password as a query parameter; drop it so a redacted URL
  // can never leak one through a log line.
  if (out.searchParams.has("password")) {
    out.searchParams.set("password", "***");
  }
  return out;
}

export async function openSeedDb(i: { url: string; allowRemote: boolean; statementTimeoutMs?: number }): Promise<SeedDb> {
  const parsed = parse(i.url);
  if (parsed === null) throw new Error("seed refuses an unparsable database url");

  const host = parsed.hostname;
  const local = LOCAL_HOSTS.includes(host);
  if (!local) {
    // Empty host (unix socket form, `postgres:///db`) is never local enough to trust.
    if (!i.allowRemote) throw new Error(`seed refuses non-local database host: ${host === "" ? "(none)" : host}`);
    // DECISION: the contract takes no Logger, and the spec forbids `console.*`; the warning goes to
    // stderr so it cannot be swallowed by a stdout pipe reading the JSON log.
    process.stderr.write(`[seed] SEED_ALLOW_REMOTE: running against ${redactUrl(i.url)}\n`);
  }

  // Role admin: full DML, no DDL. The seed must fail on a missing table, never create one.
  // DECISION: poolMax 1. The session GUCs below are set on one connection; with a larger pool the
  // rest of the pool would keep the role defaults (admin statement_timeout 30 s) and the media stage
  // would time out non-deterministically.
  const client = createDb("admin", { url: i.url, poolMax: 1, applicationName: "namilux-seed" });

  const requested = i.statementTimeoutMs;
  const timeoutMs =
    requested !== undefined && Number.isInteger(requested) && requested >= 0 ? requested : DEFAULT_STATEMENT_TIMEOUT_MS;
  // DECISION: `set_config(...)` rather than `SET …` - SET takes no bind parameters, so `SET` would
  // mean building SQL from a value. `false` = session scope, not transaction scope.
  await client.execute(
    sql`select set_config('statement_timeout', ${String(timeoutMs)}, false), set_config('search_path', 'public', false)`,
  );

  return {
    db: client,
    close: () => closeDb(client),
    url: redactParsed(parsed),
  };
}

export function redactUrl(url: string): string {
  const parsed = parse(url);
  if (parsed === null) return "<invalid database url>";
  return redactParsed(parsed).toString();
}
