import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const execute = vi.fn(async () => []);
  const client = { execute };
  return {
    execute,
    client,
    createDb: vi.fn(() => client),
    closeDb: vi.fn(async () => {}),
  };
});

vi.mock("@namilux/db", () => ({
  createDb: mocks.createDb,
  closeDb: mocks.closeDb,
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings: [...strings], values }),
}));

const { DEFAULT_STATEMENT_TIMEOUT_MS, LOCAL_HOSTS, openSeedDb, redactUrl } = await import("../db.js");

const REMOTE = "postgres://nl_admin:s3cr3t@db.example.com:5432/namilux";
const LOCAL = "postgres://nl_admin:s3cr3t@localhost:5432/namilux";

async function failure(p: Promise<unknown>): Promise<Error> {
  try {
    await p;
    throw new Error("expected openSeedDb to reject");
  } catch (e) {
    return e as Error;
  }
}

function lastStatement(): { strings: string[]; values: unknown[] } {
  const call = mocks.execute.mock.calls.at(-1) as unknown as [{ strings: string[]; values: unknown[] }];
  return call[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("openSeedDb", () => {
  it("refuses remote host by default", async () => {
    const err = await failure(openSeedDb({ url: REMOTE, allowRemote: false }));
    expect(err.message).toBe("seed refuses non-local database host: db.example.com");
    expect(err.message).not.toContain("s3cr3t");
    expect(mocks.createDb).not.toHaveBeenCalled();
  });

  it("allows compose host db", async () => {
    expect(LOCAL_HOSTS).toContain("db");
    const handle = await openSeedDb({ url: "postgres://nl_admin:s3cr3t@db:5432/namilux", allowRemote: false });
    expect(mocks.createDb).toHaveBeenCalledTimes(1);
    expect(handle.db).toBe(mocks.client);
  });

  it("treats every documented local host as local", async () => {
    for (const host of ["localhost", "127.0.0.1", "[::1]", "postgres"]) {
      await expect(
        openSeedDb({ url: `postgres://nl_admin:s3cr3t@${host}:5432/namilux`, allowRemote: false }),
      ).resolves.toBeDefined();
    }
  });

  it("opens the admin role with a single connection and the seed application name", async () => {
    await openSeedDb({ url: LOCAL, allowRemote: false });
    expect(mocks.createDb).toHaveBeenCalledWith("admin", {
      url: LOCAL,
      poolMax: 1,
      applicationName: "namilux-seed",
    });
  });

  it("sets the session statement_timeout and search_path with bound parameters", async () => {
    await openSeedDb({ url: LOCAL, allowRemote: false });
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    const stmt = lastStatement();
    expect(stmt.strings.join("?")).toContain("set_config('statement_timeout'");
    expect(stmt.strings.join("?")).toContain("set_config('search_path', 'public', false)");
    expect(stmt.values).toEqual([String(DEFAULT_STATEMENT_TIMEOUT_MS)]);
    expect(DEFAULT_STATEMENT_TIMEOUT_MS).toBe(300_000);
  });

  it("honours an explicit statement timeout and ignores a nonsense one", async () => {
    await openSeedDb({ url: LOCAL, allowRemote: false, statementTimeoutMs: 5_000 });
    expect(lastStatement().values).toEqual(["5000"]);
    await openSeedDb({ url: LOCAL, allowRemote: false, statementTimeoutMs: -1 });
    expect(lastStatement().values).toEqual(["300000"]);
  });

  it("exposes a redacted URL and a close() that goes through closeDb", async () => {
    const handle = await openSeedDb({ url: LOCAL, allowRemote: false });
    expect(handle.url.toString()).toBe("postgres://nl_admin:***@localhost:5432/namilux");
    expect(handle.url.password).toBe("***");
    await handle.close();
    expect(mocks.closeDb).toHaveBeenCalledWith(mocks.client);
  });

  it("refuses a URL without a host", async () => {
    const err = await failure(openSeedDb({ url: "postgres:///var/run/postgresql/namilux", allowRemote: false }));
    expect(err.message).toBe("seed refuses non-local database host: (none)");
    expect(mocks.createDb).not.toHaveBeenCalled();
  });

  it("refuses an unparsable URL rather than passing it through", async () => {
    const err = await failure(openSeedDb({ url: "not a url", allowRemote: false }));
    expect(err.message).toBe("seed refuses an unparsable database url");
    expect(mocks.createDb).not.toHaveBeenCalled();
  });

  it("warns with a redacted URL and proceeds when allowRemote is set", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    await expect(openSeedDb({ url: REMOTE, allowRemote: true })).resolves.toBeDefined();
    expect(stderr).toHaveBeenCalledTimes(1);
    const written = String(stderr.mock.calls[0]?.[0]);
    expect(written).toContain("db.example.com");
    expect(written).toContain("***");
    expect(written).not.toContain("s3cr3t");
  });

  it("never writes the URL to stderr for a local host", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    await openSeedDb({ url: LOCAL, allowRemote: false });
    expect(stderr).not.toHaveBeenCalled();
  });
});

describe("redactUrl", () => {
  it("redacts password", () => {
    expect(redactUrl(LOCAL)).toBe("postgres://nl_admin:***@localhost:5432/namilux");
    expect(redactUrl(LOCAL)).not.toContain("s3cr3t");
  });

  it("redacts a password carried as a query parameter", () => {
    expect(redactUrl("postgres://nl_admin@db:5432/namilux?sslmode=disable&password=s3cr3t")).toBe(
      "postgres://nl_admin@db:5432/namilux?sslmode=disable&password=***",
    );
  });

  it("leaves a password-less URL alone", () => {
    expect(redactUrl("postgres://nl_admin@localhost:5432/namilux")).toBe("postgres://nl_admin@localhost:5432/namilux");
  });

  it("returns a placeholder instead of echoing an unparsable URL", () => {
    expect(redactUrl("nl_admin:s3cr3t@localhost/namilux")).toBe("<invalid database url>");
  });
});
