import { hostname } from "node:os";
import { JOB_TYPES } from "@namilux/core";
import { closeDb, createDb, pingDb } from "@namilux/db";
import {
  cdnDriver,
  paymentDrivers,
  smsDriver,
  storageDriver,
  telegramClient,
} from "@namilux/integrations";
import { env } from "./env";
import { startHealthz } from "./healthz";
import { log } from "./logger";
import { startRuntime } from "./runtime";
import type { Drivers } from "./runtime";
import { startScheduler } from "./scheduler";
import { SCHEDULES } from "./schedules";

const CONCURRENCY = 4;
const DB_CONNECT_TRIES = 5;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** `exactOptionalPropertyTypes` forbids passing an explicit `undefined` for an optional key. */
const opt = <K extends string>(key: K, value: string | undefined): Record<K, string> | Record<string, never> =>
  value === undefined ? {} : ({ [key]: value } as Record<K, string>);

function buildDrivers(): Drivers {
  const telegram = telegramClient(
    env.TELEGRAM_BOT_TOKEN !== undefined && env.TELEGRAM_CHAT_ID !== undefined
      ? { botToken: env.TELEGRAM_BOT_TOKEN, chatId: env.TELEGRAM_CHAT_ID }
      : null,
  );
  return {
    sms: smsDriver({
      SMS_DRIVER: env.SMS_DRIVER,
      ...opt("SMS_API_KEY", env.SMS_API_KEY),
      ...opt("SMS_SENDER", env.SMS_SENDER),
      // SMS_PATTERNS is what makes a send take the instant pattern route. Omitting it does not fail
      // loudly - every message quietly falls back to free text, which FarazSMS holds for a human
      // moderator and, on the shared service line, rejects. It was missing here until 7 Sep 2026.
      ...opt("SMS_PATTERNS", env.SMS_PATTERNS),
      ...(env.SMS_UNIT_COST_TOMAN !== undefined ? { SMS_UNIT_COST_TOMAN: env.SMS_UNIT_COST_TOMAN } : {}),
      MEDIA_DIR: env.MEDIA_DIR,
      APP_ENV: env.APP_ENV,
    }),
    cdn: cdnDriver({
      CDN_DRIVER: env.CDN_DRIVER,
      ...opt("ARVAN_API_KEY", env.ARVAN_API_KEY),
      ...opt("ARVAN_DOMAIN", env.ARVAN_DOMAIN),
    }),
    storage: storageDriver({
      STORAGE_DRIVER: env.STORAGE_DRIVER,
      MEDIA_DIR: env.MEDIA_DIR,
      ...opt("S3_ENDPOINT", env.S3_ENDPOINT),
      ...opt("S3_BUCKET", env.S3_BUCKET),
      ...opt("S3_ACCESS_KEY", env.S3_ACCESS_KEY),
      ...opt("S3_SECRET_KEY", env.S3_SECRET_KEY),
      SITE_ORIGIN: env.SITE_ORIGIN,
    }),
    telegram,
    payment: paymentDrivers(env),
  };
}

async function main(): Promise<void> {
  const workerId = `${hostname()}-${process.pid}`;
  const db = createDb("worker", { url: env.DATABASE_URL_WORKER });

  // Fail fast if the database never comes up - the orchestrator restarts the container.
  let connected = false;
  for (let attempt = 1; attempt <= DB_CONNECT_TRIES; attempt += 1) {
    try {
      await pingDb(db);
      connected = true;
      break;
    } catch (err) {
      log.warn({ attempt, err: err instanceof Error ? err.message : String(err) }, "database not ready");
      if (attempt < DB_CONNECT_TRIES) await sleep(2_000);
    }
  }
  if (!connected) {
    log.error({}, "database unreachable after retries; exiting");
    process.exit(1);
  }

  const drivers = buildDrivers();
  const { handlers } = await import("./handlers/index");

  const runtime = await startRuntime(
    { concurrency: CONCURRENCY, types: JOB_TYPES, workerId },
    { db, drivers, env, handlers, log },
  );
  const scheduler = startScheduler(db, SCHEDULES, log);
  const healthz = startHealthz(runtime.state, log);
  log.info({ workerId, concurrency: CONCURRENCY }, "worker started");

  let shuttingDown = false;
  async function shutdown(signal: string): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info({ signal }, "shutting down");
    scheduler.stop();
    await runtime.stop();
    await healthz.stop();
    await closeDb(db);
    log.info({}, "shutdown complete");
    process.exit(0);
  }
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

// A rejected promise nobody awaited (a fire-and-forget notification, a driver callback) is a bug to
// log, not a reason to drop every running job: without a listener Node exits the process.
process.on("unhandledRejection", (reason: unknown) => {
  log.error({ err: reason instanceof Error ? reason.stack ?? reason.message : String(reason) }, "unhandled rejection");
});
// A synchronous exception that escaped every handler leaves unknown state behind; exit and let
// systemd start a clean process (Restart=always).
process.on("uncaughtException", (err: Error) => {
  log.fatal({ err: err.stack ?? err.message }, "uncaught exception — exiting for a clean restart");
  process.exit(1);
});

main().catch((err: unknown) => {
  log.error({ err: err instanceof Error ? err.stack ?? err.message : String(err) }, "fatal startup error");
  process.exit(1);
});
