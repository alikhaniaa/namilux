import { getSettings, loyaltyRulesSchema, setSetting, tags } from "@namilux/core";
import { adminHandler } from "@/lib/http-handler";
import { db } from "@/lib/db";

export const GET = adminHandler({
  permission: "marketing.loyalty",
  run: async () => ({ rules: (await getSettings(db))["loyalty.rules"] }),
});

export const PUT = adminHandler({
  schema: loyaltyRulesSchema,
  permission: "marketing.loyalty",
  run: async ({ input, staff, ip }) => {
    await setSetting(db, "loyalty.rules", input, { type: "staff", id: staff.id, ip });
    return { ok: true, revalidate: [tags.settings] };
  },
});
