import { MONEY_SETTINGS_KEYS, can, getSettings } from "@namilux/core";
import { adminHandler } from "@/lib/http-handler";
import { db } from "@/lib/db";

// The whole settings map in one response - so the three money groups (VAT, the instalment
// commission and rounding, the loyalty rules) are dropped for a reader without `settings.money`
// rather than travelling to a browser that is not allowed to open their pages.
export const GET = adminHandler({
  permission: "settings.read",
  run: async ({ staff }) => {
    const all = await getSettings(db);
    if (can(staff, "settings.money")) return all;
    const redacted: Record<string, unknown> = { ...all };
    for (const key of MONEY_SETTINGS_KEYS) delete redacted[key];
    return redacted;
  },
});
