import { listReturns } from "@namilux/core";
import { adminHandler } from "@/lib/http-handler";
import { siteFor } from "@/lib/scope";
import { db } from "@/lib/db";

export const GET = adminHandler({
  permission: "orders.read",
  run: ({ req, staff }) => {
    const sp = new URL(req.url).searchParams;
    const status = sp.get("status");
    const page = Number(sp.get("page") ?? "1");
    const channel = siteFor(staff, sp.get("channel"));
    return listReturns(db, {
      ...(status === "pending" || status === "accepted" || status === "rejected" ? { status } : {}),
      ...(channel === undefined ? {} : { channel }),
      page: Number.isInteger(page) && page > 0 ? page : 1,
    });
  },
});
