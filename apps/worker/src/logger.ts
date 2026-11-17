import pino from "pino";

/**
 * Keys whose value must never appear in a log line. pino redaction is path-based, so each sensitive
 * key is listed at the top level and one level under a `payload`/`vars`/`detail` wrapper - the
 * shapes handlers actually build. `*` wildcards would be broader but pino forbids a wildcard as the
 * final path segment combined with a leading `*`, so the explicit two-level list is the safe form.
 */
const SENSITIVE_KEYS = [
  "phone",
  "to",
  "mobile",
  "code",
  "otp",
  "token",
  "botToken",
  "apiKey",
  "secret",
  "password",
  "pan",
  "card",
  "cvv",
  "address",
  "postcode",
  "authorization",
  "cookie",
  "session",
  "pepper",
  "body",
];

const redactPaths = SENSITIVE_KEYS.flatMap((k) => [k, `payload.${k}`, `vars.${k}`, `detail.${k}`, `job.payload.${k}`]);

const level = process.env.LOG_LEVEL ?? "info";

export const log = pino({
  base: { app: "worker" },
  level,
  redact: { paths: redactPaths, censor: "[redacted]" },
});

export type Logger = {
  info(o: object, msg?: string): void;
  warn(o: object, msg?: string): void;
  error(o: object, msg?: string): void;
};
