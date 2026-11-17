import { listOrders } from "@namilux/core";
import type { OrderQuery, OrderSource, OrderStatus, StaffUser } from "@namilux/core";
import { adminHandler } from "@/lib/http-handler";
import { siteFor } from "@/lib/scope";
import { db } from "@/lib/db";

const STATUSES = new Set<OrderStatus>(["draft", "pending_payment", "paid", "processing", "shipped", "delivered", "cancelled", "failed", "expired"]);
const SOURCES = new Set<OrderSource>(["web", "phone", "instagram", "whatsapp", "admin"]);

function parseQuery(u: URL, staff: StaffUser): OrderQuery {
  const s = u.searchParams;
  const pageRaw = Number(s.get("page"));
  const pageSizeRaw = Number(s.get("pageSize"));
  const q: OrderQuery = {
    page: Number.isInteger(pageRaw) && pageRaw > 0 ? pageRaw : 1,
    pageSize: pageSizeRaw === 100 ? 100 : pageSizeRaw === 200 ? 200 : 50,
  };
  const search = s.get("q");
  if (search !== null && search.trim() !== "") q.q = search;
  const status = s.getAll("status").filter((v): v is OrderStatus => STATUSES.has(v as OrderStatus));
  if (status.length > 0) q.status = status;
  const source = s.getAll("source").filter((v): v is OrderSource => SOURCES.has(v as OrderSource));
  if (source.length > 0) q.source = source;
  // A staff member confined to one storefront gets that storefront, whatever the URL asked for.
  const channel = siteFor(staff, s.get("channel"));
  if (channel !== undefined) q.channel = channel;
  const from = s.get("from");
  if (from !== null) q.from = from;
  const to = s.get("to");
  if (to !== null) q.to = to;
  return q;
}

export const GET = adminHandler({
  permission: "orders.read",
  run: ({ req, staff }) => listOrders(db, parseQuery(new URL(req.url), staff)),
});
