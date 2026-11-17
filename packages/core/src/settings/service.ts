import { eq, settings as settingsTable } from "@namilux/db";
import type { Db } from "@namilux/db";
import { audit } from "../audit";
import { SETTINGS_CACHE_TTL_MS } from "../constants";
import { appError } from "../errors";
import type { Actor, EffectiveFlags } from "../types";
import { DEFAULT_SETTINGS, SETTINGS_KEYS, parseSettingValue } from "./schema";
import type { Settings, SettingsKey } from "./schema";

/** `EffectiveFlags` (types/settings.ts) plus the message shown while maintenance mode is on. */
export type EffectiveFlagsResult = EffectiveFlags & { maintenanceMessage: string };

// The tag strings are literals rather than an import from ../cache (which depends on this module);
// they equal `tags.settings`, `tags.home`, `tags.nav`, and cache/__tests__/tags.test.ts guards them.
const TAG_SETTINGS = "settings";
const TAG_HOME = "home";
const TAG_NAV = "nav";

/**
 * DECISION: "home"/"nav" are both attached to every `store.*` / `promo.*` / `seo.*` key. The
 * contract writes them as one pair for the three prefixes; over-invalidating a cached page is
 * cheap, serving a stale header/home after a settings write is not.
 */
const HOME_NAV_PREFIXES = ["store.", "promo.", "seo."] as const;

type Memo = { value: Settings; expiresAt: number };

let memo: Memo | undefined;

/**
 * DECISION: `console.warn` with an eslint exception - `packages/core` is pure and has no logger
 * (pino belongs to the apps, the spec), and the header requires the storefront to survive a row that
 * no longer parses. Only the key and the reason are logged, never the stored value (the spec: never
 * log request bodies); the key is JSON-escaped so a hostile row cannot forge log lines.
 */
function warnSettings(message: string): void {
  // eslint-disable-next-line no-console -- see the DECISION above: core has no logger and this path must not throw
  console.warn(`[settings] ${message}`);
}

function isSettingsKey(key: string): key is SettingsKey {
  return (SETTINGS_KEYS as readonly string[]).includes(key);
}

/** Structural equality over JSON values (jsonb round-trips reorder object keys, so no stringify). */
function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, i) => sameJson(item, b[i]));
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const leftKeys = Object.keys(left);
  if (leftKeys.length !== Object.keys(right).length) return false;
  return leftKeys.every(
    (key) => Object.prototype.hasOwnProperty.call(right, key) && sameJson(left[key], right[key]),
  );
}

function mergeRows(rows: readonly { key: string; valueJson: unknown }[]): Settings {
  // DECISION: the defaults are deep-cloned into every load so a consumer that mutates the object it
  // got from getSettings can never corrupt DEFAULT_SETTINGS for the rest of the process.
  const merged = structuredClone(DEFAULT_SETTINGS) as Record<SettingsKey, unknown>;
  for (const row of rows) {
    if (!isSettingsKey(row.key)) {
      // `invoice.seq.<jalali year>` rows are the gapless invoice counters (orders/repo.nextInvoiceNo), not settings.
      if (row.key.startsWith("invoice.seq.")) continue;
      warnSettings(`unknown key ${JSON.stringify(row.key)} in the settings table — ignored`);
      continue;
    }
    try {
      merged[row.key] = parseSettingValue(row.key, row.valueJson);
    } catch {
      // EDGE CASE: a stored value that no longer parses → default + warn, never a crash.
      warnSettings(`stored value of ${JSON.stringify(row.key)} does not parse — using the default`);
    }
  }
  return merged as Settings;
}

export async function getSettings(db: Db): Promise<Settings> {
  const now = Date.now();
  if (memo !== undefined && now < memo.expiresAt) return memo.value;
  const rows = await db
    .select({ key: settingsTable.key, valueJson: settingsTable.valueJson })
    .from(settingsTable);
  const value = mergeRows(rows);
  memo = { value, expiresAt: now + SETTINGS_CACHE_TTL_MS };
  return value;
}

export async function getSetting<K extends SettingsKey>(db: Db, key: K): Promise<Settings[K]> {
  const all = await getSettings(db);
  return all[key];
}

export async function setSetting<K extends SettingsKey>(
  db: Db,
  key: K,
  value: Settings[K],
  actor: Actor,
): Promise<{ tags: string[] }> {
  // DECISION: the permission itself (settings.write) is the caller's job per rules, but the actor
  // *type* is re-checked here - a customer or worker principal must never reach the settings table
  // even if a handler forgets to authorize (the spec: deny by default).
  if (actor.type !== "staff" && actor.type !== "system") throw appError("FORBIDDEN");

  const next = parseSettingValue(key, value); // unknown key / bad value → AppError VALIDATION
  const stored = await db
    .select({ valueJson: settingsTable.valueJson })
    .from(settingsTable)
    .where(eq(settingsTable.key, key))
    .limit(1);

  let before: Settings[K] = DEFAULT_SETTINGS[key];
  const row = stored[0];
  if (row !== undefined) {
    let parsed = false;
    try {
      before = parseSettingValue(key, row.valueJson);
      parsed = true;
    } catch {
      warnSettings(`stored value of ${JSON.stringify(key)} does not parse — overwriting it`);
    }
    // EDGE CASE: identical to what is stored → no-op, no audit row, nothing to revalidate.
    // DECISION: only when the stored row actually parsed; a corrupt row is always rewritten, and an
    // absent row is always written (the effective value must stop depending on DEFAULT_SETTINGS).
    if (parsed && sameJson(before, next)) return { tags: [] };
  }

  // DECISION: `updated_at` is left to the `set_updated_at` trigger the settings table carries
  // (migrations/0001_init.sql [M2]) - one source of truth for the timestamp.
  const updatedBy = actor.id ?? actor.type;
  // DECISION: the upsert and its audit row share one transaction, so a settings change can never be
  // persisted without its audit trail. audit.log receives the tx as its `db` (audit rules).
  await db.transaction(async (tx) => {
    await tx
      .insert(settingsTable)
      .values({ key, valueJson: next, updatedBy })
      .onConflictDoUpdate({ target: settingsTable.key, set: { valueJson: next, updatedBy } });
    await audit.log(tx, actor, "settings.update", "settings", key, before, next);
  });

  invalidateSettingsCache();
  const extra = HOME_NAV_PREFIXES.some((prefix) => key.startsWith(prefix));
  return { tags: extra ? [TAG_SETTINGS, TAG_HOME, TAG_NAV] : [TAG_SETTINGS] };
}

export function invalidateSettingsCache(): void {
  memo = undefined;
}

export function effectiveFlags(
  settings: Settings,
  // DECISION: the header types both as `string`, but the spec makes packages/config/src/env.ts the
  // owner of env parsing and its `override` schema already narrows "0"/"1" to a boolean, which is what
  // apps/web/src/server/loaders/settings.ts hands over. Both forms are accepted (a raw process.env
  // string still works) and coerced below; `| undefined` is explicit for exactOptionalPropertyTypes.
  env: { CHECKOUT_ENABLED?: boolean | string | undefined; MAINTENANCE?: boolean | string | undefined },
): EffectiveFlagsResult {
  const maintenanceSetting = settings["commerce.maintenance"];
  return {
    checkoutEnabled: override(env.CHECKOUT_ENABLED) ?? settings["commerce.checkout_enabled"],
    maintenance: override(env.MAINTENANCE) ?? maintenanceSetting.enabled,
    maintenanceMessage: maintenanceSetting.message,
  };
}

/**
 * DECISION: only the four documented spellings override (`true`/"1"/"true" on, `false`/"0"/"false"
 * off); anything else - including "" or "yes" - is ignored and the stored setting wins, so a typo in
 * an emergency variable can never silently open checkout (the spec: unknown input is never coerced).
 */
function override(value: boolean | string | undefined): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (value === "1" || value === "true") return true;
  if (value === "0" || value === "false") return false;
  return undefined;
}
