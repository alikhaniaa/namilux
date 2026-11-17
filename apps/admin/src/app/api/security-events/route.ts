import { security } from "@namilux/core";
import type { SecurityEventKind } from "@namilux/core";
import { adminHandler } from "@/lib/http-handler";
import { db } from "@/lib/db";

export const GET = adminHandler({
  permission: "audit.read",
  run: ({ req }) => {
    const s = new URL(req.url).searchParams;
    const kind = s.get("kind");
    const from = s.get("from");
    const to = s.get("to");
    const page = Number(s.get("page"));
    const q: { kind?: SecurityEventKind; from?: string; to?: string; page?: number } = {};
    if (kind !== null) q.kind = kind as SecurityEventKind;
    if (from !== null) q.from = from;
    if (to !== null) q.to = to;
    if (Number.isInteger(page) && page > 0) q.page = page;
    return security.list(db, q);
  },
});
