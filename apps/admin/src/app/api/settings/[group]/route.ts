import { z } from "zod";
import { SETTINGS_KEYS, appError, assertCan, getSettings, isMoneySettingsKey, setSetting, settingsKeySchemas } from "@namilux/core";
import type { SettingsKey, StaffUser } from "@namilux/core";
import { adminHandler } from "@/lib/http-handler";
import { db } from "@/lib/db";

function key(p: Record<string, string>): SettingsKey {
  const g = p.group ?? "";
  if (g === "commerce.installments" || g.endsWith("_instalments")) throw appError("NOT_FOUND");
  if (!(SETTINGS_KEYS as readonly string[]).includes(g)) throw appError("NOT_FOUND", { details: { entity: "settings-group" } });
  return g as SettingsKey;
}

/**
 * The groups that move money - VAT, the instalment commission and rounding, the loyalty rules - 
 * need `settings.money` on TOP of the ordinary settings permission, to read as well as to write.
 * The group is a path parameter, so the check lives here rather than in the handler's spec.
 */
function assertMayTouch(staff: StaffUser, k: SettingsKey): void {
  if (isMoneySettingsKey(k)) assertCan(staff, "settings.money");
}

export const GET = adminHandler({
  permission: "settings.read",
  run: async ({ params, staff }) => {
    const k = key(params);
    assertMayTouch(staff, k);
    const all = await getSettings(db);
    return { key: k, value: all[k] };
  },
});

export const PUT = adminHandler({
  schema: z.object({ value: z.unknown() }).strict(),
  permission: "settings.write",
  run: async ({ input, params, staff, ip }) => {
    const k = key(params);
    assertMayTouch(staff, k);
    const parsed = settingsKeySchemas[k].safeParse(input.value);
    if (!parsed.success) throw appError("VALIDATION", { details: parsed.error.issues });
    const { tags: changed } = await setSetting(db, k, parsed.data as never, { type: "staff", id: staff.id, ip });
    return { ok: true, tags: changed, revalidate: changed };
  },
});
