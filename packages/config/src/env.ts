import { z } from "zod";

// -  -  - enumerations -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  - 
export const APP_ENVS = ["dev", "staging", "prod"] as const;
export const NODE_ENVS = ["development", "test", "production"] as const;
export const LOG_LEVELS = ["fatal", "error", "warn", "info", "debug", "trace", "silent"] as const;
export const PAYMENT_DRIVERS = ["mock", "zarinpal", "snapppay"] as const;
/** The two storefront instances of the same code/database (see @namilux/core `SALES_CHANNELS`). */
export const SITE_MODES = ["main"] as const;
export const SMS_DRIVERS = ["mock", "kavenegar", "smsir", "melipayamak", "farazsms"] as const;
export const STORAGE_DRIVERS = ["fs", "s3"] as const;
export const CDN_DRIVERS = ["none", "arvan"] as const;
export const SECRET_KEYS = [
  "SESSION_PEPPER",
  "OTP_PEPPER",
  "QUOTE_SIGNING_KEY",
  "INTERNAL_SIGNING_KEY",
  "TOTP_ENC_KEY",
] as const;
export const NEXT_PUBLIC_ALLOWLIST = ["NEXT_PUBLIC_BUILD_ID"] as const;

export type AppEnvName = (typeof APP_ENVS)[number];
export type NodeEnvName = (typeof NODE_ENVS)[number];
export type LogLevel = (typeof LOG_LEVELS)[number];
export type PaymentDriverName = (typeof PAYMENT_DRIVERS)[number];
export type SiteModeName = (typeof SITE_MODES)[number];
export type SmsDriverName = (typeof SMS_DRIVERS)[number];
export type StorageDriverName = (typeof STORAGE_DRIVERS)[number];
export type CdnDriverName = (typeof CDN_DRIVERS)[number];

// -  -  - field schemas -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  - 
const HEX_KEY_RE = /^[0-9a-fA-F]{64}$/u;
const ABS_PATH_RE = /^(?:\/|[A-Za-z]:[\\/])/u;
const HOSTNAME_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/u;

const hexKey = z
  .string()
  .regex(HEX_KEY_RE, "must be 64 hex characters (32 random bytes; see .env.example generator)");
const flag = z
  .enum(["0", "1"])
  .default("0")
  .transform((v) => v === "1");
const override = z
  .enum(["0", "1"])
  .optional()
  .transform((v) => (v === undefined ? undefined : v === "1"));
const text = z.string().trim().min(1);
const optText = text.optional();
const origin = z
  .url({ protocol: /^https?$/u })
  .refine(
    (v) => {
      try {
        return new URL(v).origin === v;
      } catch {
        return false;
      }
    },
    { message: "must be a bare origin: scheme://host[:port] — no path, no trailing slash" },
  );
const pgUrl = z.url({ protocol: /^postgres(?:ql)?$/u });
/** An internal base URL: http(s), a host, no path - it is a base the code appends a path to. */
const loopbackUrl = z
  .string()
  .refine((v) => {
    let u: URL;
    try {
      u = new URL(v);
    } catch {
      return false;
    }
    return (u.protocol === "http:" || u.protocol === "https:") && u.host !== "" && (u.pathname === "/" || u.pathname === "") && u.search === "";
  }, "must be an http(s) base URL without a path");

/** Every variable, exactly the list of the spec and root .env.example. */
export const envShape = {
  NODE_ENV: z.enum(NODE_ENVS).default("development"),
  APP_ENV: z.enum(APP_ENVS),
  LOG_LEVEL: z.enum(LOG_LEVELS).default("info"),

  SITE_ORIGIN: origin,
  ADMIN_ORIGIN: origin,
  // One storefront; legacy order channels are retained only as historical data.
  SITE_MODE: z.enum(SITE_MODES).default("main"),
  WEB_INTERNAL_URL: loopbackUrl.default("http://127.0.0.1:3000"),
  // Owner-authorized presentation exception, never valid for production or another host.
  ADMIN_TOTP_DISABLED: flag,
  TRUST_PROXY: flag,

  DATABASE_URL_WEB: pgUrl,
  DATABASE_URL_ADMIN: pgUrl,
  DATABASE_URL_WORKER: pgUrl,
  DATABASE_URL_MIGRATE: pgUrl,
  DATABASE_URL_TEST: pgUrl.optional(),
  // Two storefront instances share one Postgres, so the per-process pool must be sized down from
  // the driver default or the box runs out of backends. Digits only, at most 99.
  DB_POOL_MAX: z
    .string()
    .regex(/^\d{1,2}$/u, "must be an integer number of connections (1–99)")
    .transform(Number)
    .optional(),

  SESSION_PEPPER: hexKey,
  OTP_PEPPER: hexKey,
  QUOTE_SIGNING_KEY: hexKey,
  INTERNAL_SIGNING_KEY: hexKey,
  TOTP_ENC_KEY: hexKey,

  PAYMENT_DRIVER: z.enum(PAYMENT_DRIVERS).default("mock"),
  ZARINPAL_MERCHANT_ID: z.uuid().optional(),
  ZARINPAL_SANDBOX: flag,
  ZARINPAL_ACCESS_TOKEN: optText,   // refunds - panel OAuth token (next.zarinpal.com)
  ZARINPAL_TERMINAL_ID: optText,    // refunds - resolves a ref_id back to a session id

  // SnappPay - the instalment gateway of the second storefront. OAuth (username/password against
  // the client id/secret pair) then a token-per-request API; the category is the merchant's product
  // classification their panel assigns.
  SNAPPPAY_ENABLED: flag,
  SNAPPPAY_BASE_URL: z.url({ protocol: /^https?$/u }).optional(),
  SNAPPPAY_CLIENT_ID: optText,
  SNAPPPAY_CLIENT_SECRET: optText,
  SNAPPPAY_USERNAME: optText,
  SNAPPPAY_PASSWORD: optText,
  SNAPPPAY_CATEGORY: optText,

  SMS_DRIVER: z.enum(SMS_DRIVERS).default("mock"),
  SMS_API_KEY: optText,
  SMS_SENDER: optText,
  SMS_USERNAME: optText,
  SMS_PASSWORD: optText,
  SMS_OTP_TEMPLATE: optText,
  // FarazSMS: {"otp":"<pattern code>","order.paid":"…"} - a JSON map of template key → pattern code.
  SMS_PATTERNS: optText,
  SMS_UNIT_COST_TOMAN: z
    .string()
    .regex(/^\d{1,9}$/u, "must be an integer number of Toman (digits only)")
    .default("1500")
    .transform(Number),
  SMS_DAILY_BUDGET_TOMAN: z
    .string()
    .regex(/^\d{1,15}$/u, "must be an integer number of Toman (digits only)")
    .default("2000000")
    .transform(Number),

  STORAGE_DRIVER: z.enum(STORAGE_DRIVERS).default("fs"),
  MEDIA_DIR: text.default("./.media"),
  S3_ENDPOINT: z.url({ protocol: /^https?$/u }).optional(),
  S3_BUCKET: z
    .string()
    .regex(/^[a-z0-9.-]{3,63}$/u, "must be a valid bucket name")
    .optional(),
  S3_ACCESS_KEY: optText,
  S3_SECRET_KEY: optText,

  CDN_DRIVER: z.enum(CDN_DRIVERS).default("none"),
  ARVAN_API_KEY: optText,
  ARVAN_DOMAIN: z.string().regex(HOSTNAME_RE, "must be a hostname like namilux.ir").optional(),

  TELEGRAM_BOT_TOKEN: optText,
  TELEGRAM_CHAT_ID: z
    .string()
    .regex(/^-?\d{1,20}$/u, "must be a numeric Telegram chat id")
    .optional(),

  CHECKOUT_ENABLED: override,
  MAINTENANCE: override,
  SW_KILL: flag,

  NEXT_PUBLIC_BUILD_ID: z
    .string()
    .regex(/^[A-Za-z0-9._-]{1,64}$/u, "must be a short build identifier (git sha)")
    .default("dev"),
} as const;

export type EnvKey = keyof typeof envShape;
type EnvOutput = z.output<z.ZodObject<typeof envShape>>;

// -  -  - cross-field checks -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  - 
/**
 * Applied by every schema. Each check reads only keys that are present in the subset it runs on
 * (see rules: a driver key never travels without its dependants).
 */
export function crossChecks(v: Partial<EnvOutput>, ctx: z.RefinementCtx): void {
  const issue = (path: EnvKey, message: string): void => {
    ctx.addIssue({ code: "custom", path: [path], message });
  };
  const publicEnv = v.APP_ENV === "staging" || v.APP_ENV === "prod";

  if (v.ADMIN_TOTP_DISABLED === true &&
      ((v.APP_ENV !== "dev" && v.APP_ENV !== "staging") || v.ADMIN_ORIGIN !== "https://203.0.113.10:8100")) {
    issue("ADMIN_TOTP_DISABLED", "password-only login is restricted to the explicitly authorized test server");
  }

  if (publicEnv) {
    if (v.SITE_ORIGIN !== undefined && !v.SITE_ORIGIN.startsWith("https://")) {
      issue("SITE_ORIGIN", "must be https:// in staging/prod");
    }
    if (v.ADMIN_ORIGIN !== undefined && !v.ADMIN_ORIGIN.startsWith("https://")) {
      issue("ADMIN_ORIGIN", "must be https:// in staging/prod");
    }
    if (v.TRUST_PROXY === false) {
      issue("TRUST_PROXY", "must be 1 behind Caddy/CDN in staging/prod");
    }
    if (v.NEXT_PUBLIC_BUILD_ID === "dev") {
      issue("NEXT_PUBLIC_BUILD_ID", "must be injected at build (git sha) in staging/prod");
    }
    if (v.MEDIA_DIR !== undefined && !ABS_PATH_RE.test(v.MEDIA_DIR)) {
      issue("MEDIA_DIR", "must be an absolute path in staging/prod (the spec: /srv/namilux/media)");
    }
  }

  if (v.APP_ENV === "prod") {
    if (v.NODE_ENV !== undefined && v.NODE_ENV !== "production") {
      issue("NODE_ENV", "must be production when APP_ENV=prod");
    }
    if (v.PAYMENT_DRIVER === "mock") issue("PAYMENT_DRIVER", "mock driver is not allowed in prod");
    if (v.SMS_DRIVER === "mock") issue("SMS_DRIVER", "mock driver is not allowed in prod");
    if (v.ZARINPAL_SANDBOX === true) issue("ZARINPAL_SANDBOX", "must be 0 in prod");
    if (v.DATABASE_URL_TEST !== undefined) issue("DATABASE_URL_TEST", "must not be set in prod");
  }

  if (v.SITE_ORIGIN !== undefined && v.ADMIN_ORIGIN !== undefined && v.SITE_ORIGIN === v.ADMIN_ORIGIN) {
    issue("ADMIN_ORIGIN", "must differ from SITE_ORIGIN — the admin is a separate hostname");
  }

  if (v.PAYMENT_DRIVER === "zarinpal" && v.ZARINPAL_MERCHANT_ID === undefined) {
    issue("ZARINPAL_MERCHANT_ID", "required when PAYMENT_DRIVER=zarinpal");
  }

  if (v.PAYMENT_DRIVER === "snapppay" || v.SNAPPPAY_ENABLED === true) {
    for (const k of [
      "SNAPPPAY_BASE_URL",
      "SNAPPPAY_CLIENT_ID",
      "SNAPPPAY_CLIENT_SECRET",
      "SNAPPPAY_USERNAME",
      "SNAPPPAY_PASSWORD",
    ] as const) {
      if (v[k] === undefined) issue(k, "required when PAYMENT_DRIVER=snapppay");
    }
  }

  if (v.SMS_DRIVER !== undefined && v.SMS_DRIVER !== "mock") {
    if (v.SMS_API_KEY === undefined) issue("SMS_API_KEY", `required when SMS_DRIVER=${v.SMS_DRIVER}`);
    if (v.SMS_SENDER === undefined) issue("SMS_SENDER", `required when SMS_DRIVER=${v.SMS_DRIVER}`);
  }

  // Melipayamak authenticates with a username/password pair, not a key.
  if (v.SMS_DRIVER === "melipayamak") {
    if (v.SMS_USERNAME === undefined) issue("SMS_USERNAME", "required when SMS_DRIVER=melipayamak");
    if (v.SMS_PASSWORD === undefined) issue("SMS_PASSWORD", "required when SMS_DRIVER=melipayamak");
  }

  // On FarazSMS a free-text send waits for a human moderator, so a login code sent that way can
  // arrive minutes late or not at all. An OTP pattern is therefore not optional - refuse to start
  // rather than ship a login flow that silently does not work.
  if (v.SMS_DRIVER === "farazsms") {
    let otpPattern: unknown;
    if (v.SMS_PATTERNS !== undefined && v.SMS_PATTERNS.trim() !== "") {
      try {
        const parsed: unknown = JSON.parse(v.SMS_PATTERNS);
        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
          issue("SMS_PATTERNS", "must be a JSON object of template key → pattern code");
        } else {
          otpPattern = (parsed as Record<string, unknown>)["otp"];
        }
      } catch {
        issue("SMS_PATTERNS", "must be valid JSON");
      }
    }
    if (typeof otpPattern !== "string" || otpPattern === "") {
      issue("SMS_PATTERNS", 'must contain an "otp" pattern code — a free-text OTP is held for moderation on FarazSMS');
    }
  }

  if (v.STORAGE_DRIVER === "s3") {
    for (const k of ["S3_ENDPOINT", "S3_BUCKET", "S3_ACCESS_KEY", "S3_SECRET_KEY"] as const) {
      if (v[k] === undefined) issue(k, "required when STORAGE_DRIVER=s3");
    }
  }

  if (v.CDN_DRIVER === "arvan") {
    if (v.ARVAN_API_KEY === undefined) issue("ARVAN_API_KEY", "required when CDN_DRIVER=arvan");
    if (v.ARVAN_DOMAIN === undefined) issue("ARVAN_DOMAIN", "required when CDN_DRIVER=arvan");
  }

  if ((v.TELEGRAM_BOT_TOKEN === undefined) !== (v.TELEGRAM_CHAT_ID === undefined)) {
    issue(
      v.TELEGRAM_BOT_TOKEN === undefined ? "TELEGRAM_BOT_TOKEN" : "TELEGRAM_CHAT_ID",
      "TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must be set together",
    );
  }

  const seen = new Map<string, EnvKey>();
  for (const k of SECRET_KEYS) {
    const val = v[k];
    if (typeof val !== "string") continue;
    const norm = val.toLowerCase();
    const prev = seen.get(norm);
    if (prev !== undefined) issue(k, `must differ from ${prev} — every key is its own 32 random bytes`);
    else seen.set(norm, k);
  }
}

// -  -  - subsets (least privilege) -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  - 
const COMMON_KEYS = ["NODE_ENV", "APP_ENV", "LOG_LEVEL", "SITE_ORIGIN", "ADMIN_ORIGIN", "SITE_MODE", "NEXT_PUBLIC_BUILD_ID"] as const;
const S3_KEYS = ["STORAGE_DRIVER", "MEDIA_DIR", "S3_ENDPOINT", "S3_BUCKET", "S3_ACCESS_KEY", "S3_SECRET_KEY"] as const;
/**
 * The instalment gateway travels with PAYMENT_DRIVER wherever the card gateway does: the storefront
 * starts the payment, the admin refunds it and the worker settles/inquires - each must reach the
 * gateway that actually took the money, whichever site the order came from.
 */
const SNAPPPAY_KEYS = [
  "SNAPPPAY_ENABLED",
  "SNAPPPAY_BASE_URL",
  "SNAPPPAY_CLIENT_ID",
  "SNAPPPAY_CLIENT_SECRET",
  "SNAPPPAY_USERNAME",
  "SNAPPPAY_PASSWORD",
  "SNAPPPAY_CATEGORY",
] as const;

export const WEB_KEYS = [
  ...COMMON_KEYS,
  "TRUST_PROXY",
  "DATABASE_URL_WEB",
  "DB_POOL_MAX",
  "SESSION_PEPPER",
  "OTP_PEPPER",
  "QUOTE_SIGNING_KEY",
  "INTERNAL_SIGNING_KEY",
  "PAYMENT_DRIVER",
  "ZARINPAL_MERCHANT_ID",
  "ZARINPAL_SANDBOX",
  ...SNAPPPAY_KEYS,
  "SMS_DRIVER",
  "SMS_API_KEY",
  "SMS_SENDER",
  "SMS_USERNAME",
  "SMS_PASSWORD",
  "SMS_OTP_TEMPLATE",
  "SMS_PATTERNS",
  "SMS_UNIT_COST_TOMAN",
  "SMS_DAILY_BUDGET_TOMAN",
  ...S3_KEYS,
  "CHECKOUT_ENABLED",
  "MAINTENANCE",
  "SW_KILL",
] as const satisfies readonly EnvKey[];

export const ADMIN_KEYS = [
  ...COMMON_KEYS,
  "WEB_INTERNAL_URL",
  "ADMIN_TOTP_DISABLED",
  "TRUST_PROXY",
  "DATABASE_URL_ADMIN",
  "SESSION_PEPPER",
  "INTERNAL_SIGNING_KEY",
  "TOTP_ENC_KEY",
  "PAYMENT_DRIVER",
  "ZARINPAL_MERCHANT_ID",
  "ZARINPAL_SANDBOX",
  "ZARINPAL_ACCESS_TOKEN",
  "ZARINPAL_TERMINAL_ID",
  ...SNAPPPAY_KEYS,
  ...S3_KEYS,
] as const satisfies readonly EnvKey[];

export const WORKER_KEYS = [
  ...COMMON_KEYS,
  "WEB_INTERNAL_URL",
  "DATABASE_URL_WORKER",
  "INTERNAL_SIGNING_KEY",
  "PAYMENT_DRIVER",
  "ZARINPAL_MERCHANT_ID",
  "ZARINPAL_SANDBOX",
  "ZARINPAL_ACCESS_TOKEN",
  "ZARINPAL_TERMINAL_ID",
  ...SNAPPPAY_KEYS,
  "SMS_DRIVER",
  "SMS_API_KEY",
  "SMS_SENDER",
  "SMS_USERNAME",
  "SMS_PASSWORD",
  "SMS_OTP_TEMPLATE",
  "SMS_PATTERNS",
  "SMS_UNIT_COST_TOMAN",
  "SMS_DAILY_BUDGET_TOMAN",
  ...S3_KEYS,
  "CDN_DRIVER",
  "ARVAN_API_KEY",
  "ARVAN_DOMAIN",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_CHAT_ID",
] as const satisfies readonly EnvKey[];

// DECISION (M0): the seed needs BOTH URLs, not just the migrate one.
//   - DATABASE_URL_ADMIN (nl_admin: full DML, no DDL) is what `packages/seed/src/db.ts` opens; its
//     contract requires the admin role and explicitly forbids the DDL role, and the package
//     description says "Runs with DATABASE_URL_ADMIN". Seeding is DML, so least privilege (rule 5:
//     more secure first) says the DDL role must not be handed to it.
//   - DATABASE_URL_MIGRATE stays because `pnpm db:seed` is documented next to `pnpm db:migrate`
//     and the media/idempotency stages read the migration journal.
//ts SEED_KEYS vs seed/db.ts).
export const SEED_KEYS = [
  "NODE_ENV",
  "APP_ENV",
  "LOG_LEVEL",
  "SITE_ORIGIN",
  "DATABASE_URL_ADMIN",
  "DATABASE_URL_MIGRATE",
  ...S3_KEYS,
] as const satisfies readonly EnvKey[];

type Mask<K extends readonly EnvKey[]> = { [P in K[number]]: true };
function mask<K extends readonly EnvKey[]>(keys: K): Mask<K> {
  return Object.fromEntries(keys.map((k) => [k, true])) as Mask<K>;
}

const fullObject = z.object(envShape);

export const envSchema = fullObject.superRefine(crossChecks);
export const webEnvSchema = fullObject.pick(mask(WEB_KEYS)).superRefine(crossChecks);
export const adminEnvSchema = fullObject.pick(mask(ADMIN_KEYS)).superRefine(crossChecks);
export const workerEnvSchema = fullObject.pick(mask(WORKER_KEYS)).superRefine(crossChecks);
export const seedEnvSchema = fullObject.pick(mask(SEED_KEYS)).superRefine(crossChecks);

export type Env = z.output<typeof envSchema>;
export type WebEnv = z.output<typeof webEnvSchema>;
export type AdminEnv = z.output<typeof adminEnvSchema>;
export type WorkerEnv = z.output<typeof workerEnvSchema>;
export type SeedEnv = z.output<typeof seedEnvSchema>;

/** The keys @namilux/core reads (the spec: `env: Env` in quote/placeOrder/handleCallback/effectiveFlags). WebEnv ⊇ CoreEnv. */
export type CoreEnv = Pick<
  Env,
  | "APP_ENV"
  | "SITE_ORIGIN"
  | "PAYMENT_DRIVER"
  | "ZARINPAL_MERCHANT_ID"
  | "ZARINPAL_SANDBOX"
  | "QUOTE_SIGNING_KEY"
  | "CHECKOUT_ENABLED"
  | "MAINTENANCE"
  | "SMS_DRIVER"
  | "SMS_DAILY_BUDGET_TOMAN"
>;

// -  -  - loader -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  - 
export type EnvSource = Readonly<Record<string, string | undefined>>;
export type EnvIssue = { readonly path: string; readonly message: string };

export class EnvError extends Error {
  readonly issues: readonly EnvIssue[];
  constructor(issues: readonly EnvIssue[]) {
    super(`invalid environment: ${issues.map((i) => i.path).join(", ")}`);
    this.name = "EnvError";
    this.issues = issues;
  }
}

/** The only variable that may be named NEXT_PUBLIC_* (the spec item 4: no secrets in clients). */
const ALLOWED_PUBLIC: ReadonlySet<string> = new Set<string>(NEXT_PUBLIC_ALLOWLIST);

/** Trims every value; "" → undefined (dotenv gives `KEY=` as ""). Never mutates `source`. */
export function normalizeSource(source: EnvSource): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [key, raw] of Object.entries(source)) {
    if (raw === undefined) {
      out[key] = undefined;
      continue;
    }
    const trimmed = raw.trim();
    out[key] = trimmed === "" ? undefined : trimmed;
  }
  return out;
}

/**
 * normalizeSource → reject any NEXT_PUBLIC_* key outside NEXT_PUBLIC_ALLOWLIST (EnvError, path = that
 * key) → schema.safeParse → on failure EnvError with one issue per zod issue (path joined by ".",
 * zod's message; values are never copied into the message). Pure: no I/O, no exit.
 */
export function parseEnv<S extends z.ZodType>(schema: S, source: EnvSource = process.env): z.output<S> {
  const normalized = normalizeSource(source);

  // DECISION: the allow-list is checked on key *presence*, not on the value - `NEXT_PUBLIC_SMS_KEY=`
  // (empty) is still a variable someone meant to ship to the browser, so it fails loudly. This is the
  // more secure reading of "present in the source" (the spec item 4).
  const publicIssues: EnvIssue[] = Object.keys(normalized)
    .filter((key) => key.startsWith("NEXT_PUBLIC_") && !ALLOWED_PUBLIC.has(key))
    .map((path) => ({
      path,
      message: `not allowed: NEXT_PUBLIC_* is inlined into the browser bundle; only ${NEXT_PUBLIC_ALLOWLIST.join(", ")} may exist (the spec item 4)`,
    }));
  if (publicIssues.length > 0) throw new EnvError(publicIssues);

  const result = schema.safeParse(normalized);
  if (!result.success) {
    // Only the path and the rule are copied - never `normalized[path]` (rules: values never leak).
    throw new EnvError(
      result.error.issues.map((issue) => ({
        path: issue.path.length > 0 ? issue.path.map(String).join(".") : "(root)",
        message: issue.message,
      })),
    );
  }
  return result.data;
}

/**
 * parseEnv; on EnvError writes `[env] <PATH>: <message>` per issue and
 * `[env] see .env.example` to stderr, then `process.exit(1)`.
 */
export function loadEnv<S extends z.ZodType>(schema: S, source: EnvSource = process.env): z.output<S> {
  try {
    return parseEnv(schema, source);
  } catch (err) {
    if (err instanceof EnvError) {
      for (const issue of err.issues) process.stderr.write(`[env] ${issue.path}: ${issue.message}\n`);
      process.stderr.write("[env] see .env.example\n");
      process.exit(1);
    }
    throw err;
  }
}

// One parsed object per process (the spec: env is parsed once at startup).
let webCache: WebEnv | undefined;
let adminCache: AdminEnv | undefined;
let workerCache: WorkerEnv | undefined;
let seedCache: SeedEnv | undefined;
let fullCache: Env | undefined;

/** Memoised per process: the first call parses, later calls return the same object. */
export function webEnv(source?: EnvSource): WebEnv {
  webCache ??= loadEnv(webEnvSchema, source ?? process.env);
  return webCache;
}
export function adminEnv(source?: EnvSource): AdminEnv {
  adminCache ??= loadEnv(adminEnvSchema, source ?? process.env);
  return adminCache;
}
export function workerEnv(source?: EnvSource): WorkerEnv {
  workerCache ??= loadEnv(workerEnvSchema, source ?? process.env);
  return workerCache;
}
export function seedEnv(source?: EnvSource): SeedEnv {
  seedCache ??= loadEnv(seedEnvSchema, source ?? process.env);
  return seedCache;
}
export function fullEnv(source?: EnvSource): Env {
  fullCache ??= loadEnv(envSchema, source ?? process.env);
  return fullCache;
}
/** Clears the memoised objects (tests only). */
export function resetEnvCache(): void {
  webCache = undefined;
  adminCache = undefined;
  workerCache = undefined;
  seedCache = undefined;
  fullCache = undefined;
}

export const isDev = (e: Pick<Env, "APP_ENV">): boolean => e.APP_ENV === "dev";
export const isStaging = (e: Pick<Env, "APP_ENV">): boolean => e.APP_ENV === "staging";
export const isProd = (e: Pick<Env, "APP_ENV">): boolean => e.APP_ENV === "prod";
