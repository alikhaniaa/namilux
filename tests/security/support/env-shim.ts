/** Test shim for the apps' `@/env` modules: a superset object read straight from process.env, so `apps/web` and `apps/admin` server modules (rate-limit table, CSRF check) can be imported under vitest without each app's zod-validated env loader. */
const e = process.env;
export const env = {
  NODE_ENV: e["NODE_ENV"] ?? "test",
  APP_ENV: e["APP_ENV"] ?? "dev",
  SITE_ORIGIN: e["SITE_ORIGIN"] ?? "http://localhost:3000",
  ADMIN_ORIGIN: e["ADMIN_ORIGIN"] ?? "http://localhost:3100",
  SMS_DRIVER: e["SMS_DRIVER"] ?? "mock",
  PAYMENT_DRIVER: e["PAYMENT_DRIVER"] ?? "mock",
  INTERNAL_SIGNING_KEY: e["INTERNAL_SIGNING_KEY"] ?? "",
  SESSION_PEPPER: e["SESSION_PEPPER"] ?? "",
  TRUST_PROXY: e["TRUST_PROXY"] ?? "false",
};
