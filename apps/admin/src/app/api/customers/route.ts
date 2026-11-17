import { channelScope, listCustomers } from "@namilux/core";
import type { CustomerQuery, CustomerTier } from "@namilux/core";
import { adminHandler } from "@/lib/http-handler";
import { db } from "@/lib/db";

const TIERS = new Set<CustomerTier>(["member", "silver", "gold", "diamond"]);

export const GET = adminHandler({
  permission: "customers.read",
  run: ({ req, staff }) => {
    const s = new URL(req.url).searchParams;
    const pageRaw = Number(s.get("page"));
    const pageSizeRaw = Number(s.get("pageSize"));
    const q: CustomerQuery = {
      page: Number.isInteger(pageRaw) && pageRaw > 0 ? pageRaw : 1,
      pageSize: pageSizeRaw === 100 ? 100 : pageSizeRaw === 200 ? 200 : 50,
    };
    const search = s.get("q");
    if (search !== null && search.trim() !== "") q.q = search;
    const tier = s.getAll("tier").filter((v): v is CustomerTier => TIERS.has(v as CustomerTier));
    if (tier.length > 0) q.tier = tier;
    const blocked = s.get("blocked");
    if (blocked === "1" || blocked === "0") q.blocked = blocked === "1";
    const optIn = s.get("optIn");
    if (optIn === "1" || optIn === "0") q.optIn = optIn === "1";
    // Confined to one storefront: only the people who bought there.
    const site = channelScope(staff);
    if (site !== null) q.channel = site;
    return listCustomers(db, q);
  },
});
