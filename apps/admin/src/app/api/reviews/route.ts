import { reviews } from "@namilux/core";
import { adminHandler } from "@/lib/http-handler";
import { db } from "@/lib/db";

export const GET = adminHandler({
  permission: "inbox.read",
  run: ({ req }) => {
    const sp = new URL(req.url).searchParams;
    const status = sp.get("status");
    const productId = Number(sp.get("productId"));
    const page = Number(sp.get("page") ?? "1");
    return reviews.listAdmin(db, {
      ...(status === "pending" || status === "approved" || status === "rejected" ? { status } : {}),
      ...(Number.isInteger(productId) && productId > 0 ? { productId } : {}),
      page: Number.isInteger(page) && page > 0 ? page : 1,
    });
  },
});
