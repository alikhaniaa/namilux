import { listNotFound } from "@namilux/core";
import { adminHandler } from "@/lib/http-handler";
import { db } from "@/lib/db";

export const GET = adminHandler({
  permission: "seo.write",
  run: ({ req }) => {
    const s = new URL(req.url).searchParams;
    const days = Number(s.get("days"));
    const page = Number(s.get("page"));
    return listNotFound(db, { days: Number.isInteger(days) && days > 0 ? days : 30, page: Number.isInteger(page) && page > 0 ? page : 1 });
  },
});
