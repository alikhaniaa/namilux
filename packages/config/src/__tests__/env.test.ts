import { readFileSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { z } from "zod";

import {
  ADMIN_KEYS,
  EnvError,
  SEED_KEYS,
  WEB_KEYS,
  WORKER_KEYS,
  adminEnvSchema,
  envSchema,
  envShape,
  loadEnv,
  normalizeSource,
  parseEnv,
  resetEnvCache,
  seedEnvSchema,
  webEnv,
  webEnvSchema,
  workerEnvSchema,
} from "../env";
import type { CoreEnv, EnvIssue, EnvKey } from "../env";

// -  -  - fixtures -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  - 
type Source = Record<string, string | undefined>;

/** Five distinct 32-byte keys, written as 64 hex chars (as `.env.example` documents). */
const SECRETS = {
  SESSION_PEPPER: "a1".repeat(32),
  OTP_PEPPER: "b2".repeat(32),
  QUOTE_SIGNING_KEY: "c3".repeat(32),
  INTERNAL_SIGNING_KEY: "d4".repeat(32),
  TOTP_ENC_KEY: "e5".repeat(32),
} as const;

const DB = {
  web: "postgres://nl_web:pw@localhost:5432/namilux",
  admin: "postgres://nl_admin:pw@localhost:5432/namilux",
  worker: "postgres://nl_worker:pw@localhost:5432/namilux",
  migrate: "postgres://nl_migrate:pw@localhost:5432/namilux",
  test: "postgres://nl_migrate:pw@localhost:5432/namilux_test",
} as const;

/** A complete, valid **dev** source: every key of `envShape`, mock drivers, five distinct secrets. */
function valid(over: Source = {}): Source {
  return {
    NODE_ENV: "development",
    APP_ENV: "dev",
    LOG_LEVEL: "info",

    SITE_ORIGIN: "http://localhost:3000",
    ADMIN_ORIGIN: "http://localhost:3100",
    TRUST_PROXY: "0",

    DATABASE_URL_WEB: DB.web,
    DATABASE_URL_ADMIN: DB.admin,
    DATABASE_URL_WORKER: DB.worker,
    DATABASE_URL_MIGRATE: DB.migrate,
    DATABASE_URL_TEST: DB.test,

    ...SECRETS,

    PAYMENT_DRIVER: "mock",
    ZARINPAL_MERCHANT_ID: "",
    ZARINPAL_SANDBOX: "1",
    ZARINPAL_ACCESS_TOKEN: "",

    SMS_DRIVER: "mock",
    SMS_API_KEY: "",
    SMS_SENDER: "",
    SMS_DAILY_BUDGET_TOMAN: "2000000",

    STORAGE_DRIVER: "fs",
    MEDIA_DIR: "./.media",
    S3_ENDPOINT: "",
    S3_BUCKET: "",
    S3_ACCESS_KEY: "",
    S3_SECRET_KEY: "",

    CDN_DRIVER: "none",
    ARVAN_API_KEY: "",
    ARVAN_DOMAIN: "",

    TELEGRAM_BOT_TOKEN: "",
    TELEGRAM_CHAT_ID: "",

    CHECKOUT_ENABLED: "",
    MAINTENANCE: "",
    SW_KILL: "0",

    NEXT_PUBLIC_BUILD_ID: "dev",
    ...over,
  };
}

/** A complete, valid **staging** source (mock drivers are allowed there, https/proxy are not optional). */
function staging(over: Source = {}): Source {
  return valid({
    NODE_ENV: "production",
    APP_ENV: "staging",
    SITE_ORIGIN: "https://staging.namilux.ir",
    ADMIN_ORIGIN: "https://admin.staging.namilux.ir",
    TRUST_PROXY: "1",
    MEDIA_DIR: "/srv/namilux/media",
    NEXT_PUBLIC_BUILD_ID: "9f1c2a7",
    ...over,
  });
}

/** A complete, valid **prod** source (real drivers, no test database, absolute media dir). */
function prod(over: Source = {}): Source {
  return staging({
    APP_ENV: "prod",
    SITE_ORIGIN: "https://namilux.ir",
    ADMIN_ORIGIN: "https://admin.namilux.ir",
    PAYMENT_DRIVER: "zarinpal",
    ZARINPAL_MERCHANT_ID: "6d8e9a4c-1b2f-4c3d-8e5a-7f0b1c2d3e4f",
    ZARINPAL_SANDBOX: "0",
    SMS_DRIVER: "kavenegar",
    SMS_API_KEY: "kavenegar-key",
    SMS_SENDER: "10008663",
    DATABASE_URL_TEST: "",
    ...over,
  });
}

function issuesOf(source: Source, schema: z.ZodType = envSchema): readonly EnvIssue[] {
  try {
    parseEnv(schema, source);
    return [];
  } catch (err) {
    if (err instanceof EnvError) return err.issues;
    throw err;
  }
}

function pathsOf(source: Source, schema?: z.ZodType): string[] {
  return issuesOf(source, schema).map((i) => i.path);
}

/** No issue text ever repeats a secret (rules: values never leak into messages or logs). */
function expectNoSecrets(text: string): void {
  for (const secret of Object.values(SECRETS)) expect(text).not.toContain(secret);
}

beforeEach(() => {
  resetEnvCache();
});

afterEach(() => {
  vi.restoreAllMocks();
  resetEnvCache();
});

// -  -  - fields -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  - 
describe("env schema - fields", () => {
  it("a complete valid dev source parses with defaults (NODE_ENV development, LOG_LEVEL info, drivers mock/fs/none, budget 2000000, MEDIA_DIR ./.media, BUILD_ID dev)", () => {
    expect(issuesOf(valid())).toEqual([]);

    const source = valid();
    for (const key of [
      "NODE_ENV",
      "LOG_LEVEL",
      "TRUST_PROXY",
      "PAYMENT_DRIVER",
      "ZARINPAL_SANDBOX",
      "SMS_DRIVER",
      "SMS_DAILY_BUDGET_TOMAN",
      "STORAGE_DRIVER",
      "MEDIA_DIR",
      "CDN_DRIVER",
      "SW_KILL",
      "NEXT_PUBLIC_BUILD_ID",
    ]) {
      delete source[key];
    }

    const env = parseEnv(envSchema, source);
    expect(env.APP_ENV).toBe("dev");
    expect(env.NODE_ENV).toBe("development");
    expect(env.LOG_LEVEL).toBe("info");
    expect(env.TRUST_PROXY).toBe(false);
    expect(env.PAYMENT_DRIVER).toBe("mock");
    expect(env.ZARINPAL_SANDBOX).toBe(false);
    expect(env.SMS_DRIVER).toBe("mock");
    expect(env.SMS_DAILY_BUDGET_TOMAN).toBe(2_000_000);
    expect(env.STORAGE_DRIVER).toBe("fs");
    expect(env.MEDIA_DIR).toBe("./.media");
    expect(env.CDN_DRIVER).toBe("none");
    expect(env.SW_KILL).toBe(false);
    expect(env.NEXT_PUBLIC_BUILD_ID).toBe("dev");
    expect(env.SESSION_PEPPER).toBe(SECRETS.SESSION_PEPPER);
  });

  it("empty string values are treated as unset (ZARINPAL_MERCHANT_ID= parses, no UUID issue)", () => {
    const env = parseEnv(envSchema, valid({ ZARINPAL_MERCHANT_ID: "" }));
    expect(env.ZARINPAL_MERCHANT_ID).toBeUndefined();
    expect(env.S3_BUCKET).toBeUndefined();
    expect(env.TELEGRAM_BOT_TOKEN).toBeUndefined();
    // and surrounding whitespace is trimmed rather than stored
    expect(parseEnv(envSchema, valid({ SMS_SENDER: "  10008663  " })).SMS_SENDER).toBe("10008663");
  });

  it("missing SESSION_PEPPER → one issue at path SESSION_PEPPER; message contains no value", () => {
    const source = valid();
    delete source["SESSION_PEPPER"];

    const issues = issuesOf(source);
    expect(issues.map((i) => i.path)).toEqual(["SESSION_PEPPER"]);
    expectNoSecrets(issues.map((i) => i.message).join("\n"));
  });

  it("63-char secret fails; uppercase 64-hex passes", () => {
    const tooShort = "a".repeat(63);
    const issues = issuesOf(valid({ SESSION_PEPPER: tooShort }));
    expect(issues.map((i) => i.path)).toEqual(["SESSION_PEPPER"]);
    expect(issues[0]?.message).not.toContain(tooShort);

    const upper = "A1".repeat(32);
    expect(parseEnv(envSchema, valid({ SESSION_PEPPER: upper })).SESSION_PEPPER).toBe(upper);
  });

  it("SITE_ORIGIN with trailing slash or path fails; bare http origin passes in dev", () => {
    expect(pathsOf(valid({ SITE_ORIGIN: "https://namilux.ir/" }))).toEqual(["SITE_ORIGIN"]);
    expect(pathsOf(valid({ SITE_ORIGIN: "https://namilux.ir/shop" }))).toEqual(["SITE_ORIGIN"]);
    // a value that is not a URL at all fails both the format check and the bare-origin refinement
    expect([...new Set(pathsOf(valid({ SITE_ORIGIN: "namilux.ir" })))]).toEqual(["SITE_ORIGIN"]);
    expect(parseEnv(envSchema, valid()).SITE_ORIGIN).toBe("http://localhost:3000");
    expect(parseEnv(envSchema, valid({ SITE_ORIGIN: "https://namilux.ir" })).SITE_ORIGIN).toBe("https://namilux.ir");
  });

  it("TRUST_PROXY 'yes' fails; '0'/'1' map to boolean", () => {
    expect(pathsOf(valid({ TRUST_PROXY: "yes" }))).toEqual(["TRUST_PROXY"]);
    expect(parseEnv(envSchema, valid({ TRUST_PROXY: "1" })).TRUST_PROXY).toBe(true);
    expect(parseEnv(envSchema, valid({ TRUST_PROXY: "0" })).TRUST_PROXY).toBe(false);
    expect(parseEnv(envSchema, valid({ SW_KILL: "1" })).SW_KILL).toBe(true);
  });

  it("CHECKOUT_ENABLED unset → undefined, '0' → false, '1' → true, 'true' → issue", () => {
    expect(parseEnv(envSchema, valid()).CHECKOUT_ENABLED).toBeUndefined();
    expect(parseEnv(envSchema, valid({ CHECKOUT_ENABLED: "0" })).CHECKOUT_ENABLED).toBe(false);
    expect(parseEnv(envSchema, valid({ CHECKOUT_ENABLED: "1" })).CHECKOUT_ENABLED).toBe(true);
    expect(pathsOf(valid({ CHECKOUT_ENABLED: "true" }))).toEqual(["CHECKOUT_ENABLED"]);
    expect(parseEnv(envSchema, valid({ MAINTENANCE: "1" })).MAINTENANCE).toBe(true);
    expect(parseEnv(envSchema, valid()).MAINTENANCE).toBeUndefined();
  });

  it("SMS_DAILY_BUDGET_TOMAN unset → 2000000; '2,000,000' → issue", () => {
    const source = valid();
    delete source["SMS_DAILY_BUDGET_TOMAN"];
    expect(parseEnv(envSchema, source).SMS_DAILY_BUDGET_TOMAN).toBe(2_000_000);

    expect(pathsOf(valid({ SMS_DAILY_BUDGET_TOMAN: "2,000,000" }))).toEqual(["SMS_DAILY_BUDGET_TOMAN"]);
    expect(parseEnv(envSchema, valid({ SMS_DAILY_BUDGET_TOMAN: "500000" })).SMS_DAILY_BUDGET_TOMAN).toBe(500_000);
  });

  it("TELEGRAM_CHAT_ID must be numeric (negative allowed)", () => {
    const ok = parseEnv(envSchema, valid({ TELEGRAM_BOT_TOKEN: "123456:AA-token", TELEGRAM_CHAT_ID: "-1001234567890" }));
    expect(ok.TELEGRAM_CHAT_ID).toBe("-1001234567890");
    expect(pathsOf(valid({ TELEGRAM_BOT_TOKEN: "123456:AA-token", TELEGRAM_CHAT_ID: "@namilux" }))).toEqual([
      "TELEGRAM_CHAT_ID",
    ]);
  });

  it("unrelated keys (PATH, HOME) are ignored", () => {
    const env = parseEnv(
      envSchema,
      valid({ PATH: "C:\\Windows\\system32", HOME: "/home/nl", npm_config_registry: "https://registry.example" }),
    );
    expect(env).not.toHaveProperty("PATH");
    expect(env).not.toHaveProperty("HOME");
    expect(env).not.toHaveProperty("npm_config_registry");
    expect(env.APP_ENV).toBe("dev");
  });
});

// -  -  - cross checks -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  - 
describe("env schema - cross checks", () => {
  it("SESSION_PEPPER === OTP_PEPPER → issue on OTP_PEPPER mentioning SESSION_PEPPER", () => {
    const issues = issuesOf(valid({ OTP_PEPPER: SECRETS.SESSION_PEPPER }));
    expect(issues.map((i) => i.path)).toEqual(["OTP_PEPPER"]);
    expect(issues[0]?.message).toContain("SESSION_PEPPER");
    expectNoSecrets(issues[0]?.message ?? "");

    // the comparison is case-insensitive: the same 32 bytes in upper case is still a copy-paste
    expect(pathsOf(valid({ OTP_PEPPER: SECRETS.SESSION_PEPPER.toUpperCase() }))).toEqual(["OTP_PEPPER"]);
  });

  it("APP_ENV=prod|staging with http SITE_ORIGIN/ADMIN_ORIGIN → issues; dev http ok", () => {
    expect(pathsOf(prod({ SITE_ORIGIN: "http://namilux.ir" }))).toEqual(["SITE_ORIGIN"]);
    expect(pathsOf(prod({ ADMIN_ORIGIN: "http://admin.namilux.ir" }))).toEqual(["ADMIN_ORIGIN"]);
    expect(pathsOf(staging({ SITE_ORIGIN: "http://staging.namilux.ir" }))).toEqual(["SITE_ORIGIN"]);
    expect(issuesOf(valid({ SITE_ORIGIN: "http://localhost:3000" }))).toEqual([]);
  });

  it("SITE_ORIGIN === ADMIN_ORIGIN → issue on ADMIN_ORIGIN", () => {
    const issues = issuesOf(valid({ ADMIN_ORIGIN: "http://localhost:3000" }));
    expect(issues.map((i) => i.path)).toEqual(["ADMIN_ORIGIN"]);
    expect(issues[0]?.message).toContain("SITE_ORIGIN");
  });

  it("TRUST_PROXY=0 in staging → issue", () => {
    expect(pathsOf(staging({ TRUST_PROXY: "0" }))).toEqual(["TRUST_PROXY"]);
    expect(issuesOf(staging())).toEqual([]);
  });

  it("NEXT_PUBLIC_BUILD_ID 'dev' in staging → issue", () => {
    expect(pathsOf(staging({ NEXT_PUBLIC_BUILD_ID: "dev" }))).toEqual(["NEXT_PUBLIC_BUILD_ID"]);
    expect(issuesOf(valid({ NEXT_PUBLIC_BUILD_ID: "dev" }))).toEqual([]);
  });

  it("MEDIA_DIR relative in prod → issue; absolute posix and windows paths pass", () => {
    expect(pathsOf(prod({ MEDIA_DIR: "./.media" }))).toEqual(["MEDIA_DIR"]);
    expect(issuesOf(prod({ MEDIA_DIR: "/srv/namilux/media" }))).toEqual([]);
    expect(issuesOf(prod({ MEDIA_DIR: "C:\\media" }))).toEqual([]);
  });

  it("prod: NODE_ENV≠production, PAYMENT_DRIVER=mock, SMS_DRIVER=mock, ZARINPAL_SANDBOX=1, DATABASE_URL_TEST set → one issue each", () => {
    expect(issuesOf(prod())).toEqual([]);
    expect(pathsOf(prod({ NODE_ENV: "development" }))).toEqual(["NODE_ENV"]);
    expect(pathsOf(prod({ PAYMENT_DRIVER: "mock" }))).toEqual(["PAYMENT_DRIVER"]);
    expect(pathsOf(prod({ SMS_DRIVER: "mock" }))).toEqual(["SMS_DRIVER"]);
    expect(pathsOf(prod({ ZARINPAL_SANDBOX: "1" }))).toEqual(["ZARINPAL_SANDBOX"]);
    expect(pathsOf(prod({ DATABASE_URL_TEST: DB.test }))).toEqual(["DATABASE_URL_TEST"]);
    // staging may keep the test database and the mock drivers
    expect(issuesOf(staging({ DATABASE_URL_TEST: DB.test, PAYMENT_DRIVER: "mock", SMS_DRIVER: "mock" }))).toEqual([]);
  });

  it("PAYMENT_DRIVER=zarinpal without merchant id → issue on ZARINPAL_MERCHANT_ID", () => {
    expect(pathsOf(valid({ PAYMENT_DRIVER: "zarinpal" }))).toEqual(["ZARINPAL_MERCHANT_ID"]);
    expect(
      issuesOf(valid({ PAYMENT_DRIVER: "zarinpal", ZARINPAL_MERCHANT_ID: "6d8e9a4c-1b2f-4c3d-8e5a-7f0b1c2d3e4f" })),
    ).toEqual([]);
    expect(pathsOf(valid({ PAYMENT_DRIVER: "zarinpal", ZARINPAL_MERCHANT_ID: "not-a-uuid" }))).toEqual([
      "ZARINPAL_MERCHANT_ID",
    ]);
  });

  it("SMS_DRIVER=kavenegar without SMS_API_KEY and SMS_SENDER → two issues", () => {
    expect(pathsOf(valid({ SMS_DRIVER: "kavenegar" }))).toEqual(["SMS_API_KEY", "SMS_SENDER"]);
    expect(issuesOf(valid({ SMS_DRIVER: "smsir", SMS_API_KEY: "k", SMS_SENDER: "10008663" }))).toEqual([]);
  });

  it("STORAGE_DRIVER=s3 with nothing else → four issues (S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY)", () => {
    expect(pathsOf(valid({ STORAGE_DRIVER: "s3" }))).toEqual([
      "S3_ENDPOINT",
      "S3_BUCKET",
      "S3_ACCESS_KEY",
      "S3_SECRET_KEY",
    ]);
    expect(
      issuesOf(
        valid({
          STORAGE_DRIVER: "s3",
          S3_ENDPOINT: "https://s3.ir-thr-at1.arvanstorage.ir",
          S3_BUCKET: "namilux-media",
          S3_ACCESS_KEY: "ak",
          S3_SECRET_KEY: "sk",
        }),
      ),
    ).toEqual([]);
  });

  it("CDN_DRIVER=arvan without ARVAN_API_KEY → issue; ARVAN_DOMAIN must be a hostname", () => {
    expect(pathsOf(valid({ CDN_DRIVER: "arvan", ARVAN_DOMAIN: "cdn.namilux.ir" }))).toEqual(["ARVAN_API_KEY"]);
    expect(pathsOf(valid({ CDN_DRIVER: "arvan", ARVAN_API_KEY: "k" }))).toEqual(["ARVAN_DOMAIN"]);
    expect(pathsOf(valid({ CDN_DRIVER: "arvan", ARVAN_API_KEY: "k", ARVAN_DOMAIN: "https://cdn.namilux.ir" }))).toEqual([
      "ARVAN_DOMAIN",
    ]);
    expect(issuesOf(valid({ CDN_DRIVER: "arvan", ARVAN_API_KEY: "k", ARVAN_DOMAIN: "cdn.namilux.ir" }))).toEqual([]);
  });

  it("TELEGRAM_BOT_TOKEN without TELEGRAM_CHAT_ID → issue (and vice versa)", () => {
    expect(pathsOf(valid({ TELEGRAM_BOT_TOKEN: "123456:AA-token" }))).toEqual(["TELEGRAM_CHAT_ID"]);
    expect(pathsOf(valid({ TELEGRAM_CHAT_ID: "-1001234567890" }))).toEqual(["TELEGRAM_BOT_TOKEN"]);
    expect(issuesOf(valid({ TELEGRAM_BOT_TOKEN: "123456:AA-token", TELEGRAM_CHAT_ID: "-1001234567890" }))).toEqual([]);
  });
});

// -  -  - subsets -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  - 
describe("env subsets - least privilege", () => {
  it("webEnvSchema output has no TOTP_ENC_KEY / TELEGRAM_* / ARVAN_* keys even when the source sets them", () => {
    const web = parseEnv(
      webEnvSchema,
      valid({
        CDN_DRIVER: "arvan",
        ARVAN_API_KEY: "k",
        ARVAN_DOMAIN: "cdn.namilux.ir",
        TELEGRAM_BOT_TOKEN: "123456:AA-token",
        TELEGRAM_CHAT_ID: "-1001234567890",
      }),
    );
    expect(web).not.toHaveProperty("TOTP_ENC_KEY");
    expect(web).not.toHaveProperty("TELEGRAM_BOT_TOKEN");
    expect(web).not.toHaveProperty("TELEGRAM_CHAT_ID");
    expect(web).not.toHaveProperty("ARVAN_API_KEY");
    expect(web).not.toHaveProperty("ARVAN_DOMAIN");
    expect(web).not.toHaveProperty("CDN_DRIVER");
    expect(web).not.toHaveProperty("DATABASE_URL_ADMIN");
    expect(web).not.toHaveProperty("DATABASE_URL_MIGRATE");
    expect(web.DATABASE_URL_WEB).toBe(DB.web);
    expect(web.SESSION_PEPPER).toBe(SECRETS.SESSION_PEPPER);
  });

  it("adminEnvSchema has no OTP_PEPPER / QUOTE_SIGNING_KEY; workerEnvSchema has no SESSION_PEPPER", () => {
    const admin = parseEnv(adminEnvSchema, valid());
    expect(admin).not.toHaveProperty("OTP_PEPPER");
    expect(admin).not.toHaveProperty("QUOTE_SIGNING_KEY");
    expect(admin).not.toHaveProperty("DATABASE_URL_WEB");
    expect(admin.TOTP_ENC_KEY).toBe(SECRETS.TOTP_ENC_KEY);
    expect(admin.DATABASE_URL_ADMIN).toBe(DB.admin);

    const worker = parseEnv(workerEnvSchema, valid());
    expect(worker).not.toHaveProperty("SESSION_PEPPER");
    expect(worker).not.toHaveProperty("OTP_PEPPER");
    expect(worker).not.toHaveProperty("TOTP_ENC_KEY");
    expect(worker.DATABASE_URL_WORKER).toBe(DB.worker);
    expect(worker.INTERNAL_SIGNING_KEY).toBe(SECRETS.INTERNAL_SIGNING_KEY);
  });

  // DECISION (M0): the header said "MIGRATE only", but packages/seed/src/db.ts opens
  // DATABASE_URL_ADMIN and its contract forbids the DDL role, so the seed needs both.
  it("seedEnvSchema requires the admin and migrate URLs only", () => {
    const seed = parseEnv(seedEnvSchema, {
      APP_ENV: "dev",
      SITE_ORIGIN: "http://localhost:3000",
      DATABASE_URL_ADMIN: DB.admin,
      DATABASE_URL_MIGRATE: DB.migrate,
    });
    expect(seed.DATABASE_URL_ADMIN).toBe(DB.admin);
    expect(seed.DATABASE_URL_MIGRATE).toBe(DB.migrate);
    expect(seed.MEDIA_DIR).toBe("./.media");
    expect(seed).not.toHaveProperty("DATABASE_URL_WEB");
    expect(seed).not.toHaveProperty("SESSION_PEPPER");
    expect(seed).not.toHaveProperty("ADMIN_ORIGIN");

    expect(pathsOf({ APP_ENV: "dev", SITE_ORIGIN: "http://localhost:3000" }, seedEnvSchema)).toEqual([
      "DATABASE_URL_ADMIN",
      "DATABASE_URL_MIGRATE",
    ]);
  });

  it("every driver key in a subset travels with its dependants (WEB/ADMIN/WORKER/SEED_KEYS invariant)", () => {
    const shapeKeys = Object.keys(envShape);
    const subsets: Record<string, readonly EnvKey[]> = {
      WEB_KEYS,
      ADMIN_KEYS,
      WORKER_KEYS,
      SEED_KEYS,
    };
    const dependants: [EnvKey, readonly EnvKey[]][] = [
      [
        "PAYMENT_DRIVER",
        [
          "ZARINPAL_MERCHANT_ID",
          "ZARINPAL_SANDBOX",
          // The instalment site settles through SnappPay; the admin refunds and the worker settles
          // through whichever gateway took the money, so its keys travel with the driver too.
          "SNAPPPAY_BASE_URL",
          "SNAPPPAY_CLIENT_ID",
          "SNAPPPAY_CLIENT_SECRET",
          "SNAPPPAY_USERNAME",
          "SNAPPPAY_PASSWORD",
        ],
      ],
      ["SMS_DRIVER", ["SMS_API_KEY", "SMS_SENDER"]],
      ["STORAGE_DRIVER", ["S3_ENDPOINT", "S3_BUCKET", "S3_ACCESS_KEY", "S3_SECRET_KEY"]],
      ["CDN_DRIVER", ["ARVAN_API_KEY", "ARVAN_DOMAIN"]],
      ["TELEGRAM_BOT_TOKEN", ["TELEGRAM_CHAT_ID"]],
      ["TELEGRAM_CHAT_ID", ["TELEGRAM_BOT_TOKEN"]],
    ];

    for (const [name, keys] of Object.entries(subsets)) {
      expect(new Set(keys).size, `${name} has a duplicate key`).toBe(keys.length);
      expect(keys, `${name} must require APP_ENV`).toContain("APP_ENV");
      for (const key of keys) expect(shapeKeys, `${name}: ${key} is not in envShape`).toContain(key);
      for (const [driver, deps] of dependants) {
        if (!keys.includes(driver)) continue;
        for (const dep of deps) expect(keys, `${name}: ${driver} needs ${dep}`).toContain(dep);
      }
    }
  });

  it("CoreEnv is assignable from WebEnv (type-level test via satisfies)", () => {
    const web = parseEnv(webEnvSchema, valid());
    const core = web satisfies CoreEnv;
    expect(core.APP_ENV).toBe("dev");
    expect(core.PAYMENT_DRIVER).toBe("mock");
    expect(core.QUOTE_SIGNING_KEY).toBe(SECRETS.QUOTE_SIGNING_KEY);
    expect(core.SMS_DAILY_BUDGET_TOMAN).toBe(2_000_000);
  });
});

// -  -  - loader -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  - 
describe("loader", () => {
  it("normalizeSource trims and maps '' → undefined without mutating the input", () => {
    const source = Object.freeze({ A: "  x  ", B: "", C: undefined, D: "y", E: "   " });
    const out = normalizeSource(source);

    expect(out["A"]).toBe("x");
    expect(out["B"]).toBeUndefined();
    expect(out["C"]).toBeUndefined();
    expect(out["D"]).toBe("y");
    expect(out["E"]).toBeUndefined();
    expect(out).not.toBe(source);
    expect(source).toEqual({ A: "  x  ", B: "", C: undefined, D: "y", E: "   " });
  });

  it("parseEnv rejects NEXT_PUBLIC_API_KEY before schema parsing (EnvError path = key)", () => {
    const issues = issuesOf(valid({ NEXT_PUBLIC_API_KEY: "leak-me" }));
    expect(issues.map((i) => i.path)).toEqual(["NEXT_PUBLIC_API_KEY"]);
    expect(issues[0]?.message).not.toContain("leak-me");

    // "before schema parsing": a source that is *also* schema-invalid still reports only the public key
    expect(pathsOf(valid({ NEXT_PUBLIC_API_KEY: "leak-me", TRUST_PROXY: "yes" }))).toEqual(["NEXT_PUBLIC_API_KEY"]);
    // the single allow-listed public variable is fine
    expect(issuesOf(valid({ NEXT_PUBLIC_BUILD_ID: "9f1c2a7" }))).toEqual([]);
  });

  it("parseEnv throws EnvError whose issues carry path + message and whose message lists paths only", () => {
    const source = valid({ TRUST_PROXY: "yes" });
    delete source["SESSION_PEPPER"];

    let caught: unknown;
    try {
      parseEnv(envSchema, source);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(EnvError);
    const error = caught as EnvError;
    expect(error.name).toBe("EnvError");
    expect([...error.issues].map((i) => i.path).sort()).toEqual(["SESSION_PEPPER", "TRUST_PROXY"]);
    for (const issue of error.issues) expect(issue.message.length).toBeGreaterThan(0);
    expect(error.message).toContain("SESSION_PEPPER");
    expect(error.message).toContain("TRUST_PROXY");
    expect(error.message).not.toContain("yes");
    expectNoSecrets(error.message);
  });

  it("loadEnv on failure: exit code 1, one '[env] ' line per issue + hint line, no values in stderr", () => {
    const writes: string[] = [];
    const writeSpy = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      writes.push(String(chunk));
      return true;
    });
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((code?: number | string | null): never => {
      throw new Error(`process.exit:${String(code)}`);
    });

    const badSecret = "0123456789abcdef";
    const source = valid({ SESSION_PEPPER: badSecret, TRUST_PROXY: "yes" });

    expect(() => loadEnv(envSchema, source)).toThrow("process.exit:1");
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(writeSpy).toHaveBeenCalledTimes(3); // 2 issues + hint

    expect(writes).toHaveLength(3);
    for (const line of writes) {
      expect(line.startsWith("[env] ")).toBe(true);
      expect(line.endsWith("\n")).toBe(true);
      expect(line).not.toContain(badSecret);
      expect(line).not.toContain("yes");
      expectNoSecrets(line);
    }
    expect(writes.filter((l) => l.startsWith("[env] SESSION_PEPPER: "))).toHaveLength(1);
    expect(writes.filter((l) => l.startsWith("[env] TRUST_PROXY: "))).toHaveLength(1);
    expect(writes.at(-1)).toBe("[env] see .env.example\n");
  });

  it("loadEnv returns the parsed environment when the source is valid", () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((): never => {
      throw new Error("process.exit must not be called");
    }));

    expect(loadEnv(envSchema, valid()).APP_ENV).toBe("dev");
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("webEnv() twice returns the same object; resetEnvCache() yields a new one", () => {
    const first = webEnv(valid());
    expect(webEnv()).toBe(first);
    expect(webEnv(valid({ SW_KILL: "1" }))).toBe(first); // memoised: the later source is ignored

    resetEnvCache();
    const second = webEnv(valid());
    expect(second).not.toBe(first);
    expect(second).toEqual(first);
  });
});

// -  -  - .env.example parity -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  - 
describe("owner-authorized password-only test server", () => {
  it("defaults off and only accepts the exact test server", () => {
    expect(parseEnv(adminEnvSchema, valid()).ADMIN_TOTP_DISABLED).toBe(false);
    expect(parseEnv(adminEnvSchema, valid({ADMIN_TOTP_DISABLED:"1",ADMIN_ORIGIN:"https://203.0.113.10:8100"})).ADMIN_TOTP_DISABLED).toBe(true);
    expect(parseEnv(adminEnvSchema, staging({ADMIN_TOTP_DISABLED:"1",ADMIN_ORIGIN:"https://203.0.113.10:8100"})).ADMIN_TOTP_DISABLED).toBe(true);
    expect(() => parseEnv(adminEnvSchema, valid({ADMIN_TOTP_DISABLED:"1"}))).toThrow(EnvError);
  });
  it("rejects the flag in production even on the test origin", () => {
    expect(() => parseEnv(adminEnvSchema, prod({ADMIN_TOTP_DISABLED:"1",ADMIN_ORIGIN:"https://203.0.113.10:8100"}))).toThrow(EnvError);
  });
  it("rejects malformed flags and excludes the flag from storefront env", () => {
    expect(() => parseEnv(adminEnvSchema, valid({ADMIN_TOTP_DISABLED:"true"}))).toThrow(EnvError);
    expect(parseEnv(webEnvSchema, valid({ADMIN_TOTP_DISABLED:"1"}))).not.toHaveProperty("ADMIN_TOTP_DISABLED");
  });
});

/** DATABASE_URL_TEST is optional on both sides (the spec: only the test runner sets it). */
const OPTIONAL_IN_BOTH = new Set<string>(["DATABASE_URL_TEST"]);

/** The keys documented in the root `.env.example` (uncommented `KEY=` lines). */
function documentedKeys(): Set<string> {
  const text = readFileSync(new URL("../../../../.env.example", import.meta.url), "utf8");
  const keys = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const match = /^([A-Z][A-Z0-9_]*)=/.exec(line.trim());
    const key = match?.[1];
    if (key !== undefined && !OPTIONAL_IN_BOTH.has(key)) keys.add(key);
  }
  return keys;
}

describe(".env.example parity", () => {
  it("every KEY= in root .env.example is a key of envShape", () => {
    const documented = documentedKeys();
    expect(documented.size).toBeGreaterThan(20);
    expect([...documented].filter((key) => !Object.hasOwn(envShape, key))).toEqual([]);
  });

  it("every key of envShape appears in root .env.example", () => {
    const documented = documentedKeys();
    expect(Object.keys(envShape).filter((key) => !OPTIONAL_IN_BOTH.has(key) && !documented.has(key))).toEqual([]);
  });
});
