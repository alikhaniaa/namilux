import { AppError, ERROR_FA, channelScope, dashboard, dashboardRangeSchema, funnel, sources, topPages, uaClasses, zeroResultSearches } from "@namilux/core";
import { adminHandler } from "@/lib/http-handler";
import { db } from "@/lib/db";
import { env } from "@/env";

function parseRange(raw: string | null): unknown {
  if (raw === null || raw === "") return "7d";
  const m = /^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/.exec(raw);
  return m === null ? raw : { from: m[1], to: m[2] };
}

// Sales and revenue: the head admin only. `analytics.read` is not `settings.read` - an admin edits
// the store's settings all day and must still never see what the shop earned.
export const GET = adminHandler({
  permission: "analytics.read",
  run: async ({ req, staff }) => {
    const sp = new URL(req.url).searchParams;
    const range = dashboardRangeSchema.safeParse(parseRange(sp.get("range")));
    if (!range.success) throw new AppError("VALIDATION", 400, ERROR_FA.VALIDATION);
    const view = sp.get("view") ?? "dashboard";
    // Confined to one storefront: that site's sales figures, and nothing built from traffic events,
    // which are not per site.
    const scope = channelScope(staff);
    if (scope !== null && view !== "dashboard") throw new AppError("FORBIDDEN", 403, ERROR_FA.FORBIDDEN);
    switch (view) {
      case "funnel":
        return { funnel: await funnel(db, range.data) };
      case "pages":
        return { pages: await topPages(db, range.data) };
      case "search":
        return { search: await zeroResultSearches(db, range.data) };
      case "sources":
        return { sources: await sources(db, range.data) };
      case "devices":
        return { devices: await uaClasses(db, range.data) };
      default:
        return {
          dashboard: await dashboard(db, range.data, { now: new Date(), smsDailyBudget: Number(process.env.SMS_DAILY_BUDGET_TOMAN ?? 2_000_000) || 2_000_000, ...(scope === null ? {} : { channel: scope }) }),
          origin: env.SITE_ORIGIN,
        };
    }
  },
});
