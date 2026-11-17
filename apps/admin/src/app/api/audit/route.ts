import { audit } from "@namilux/core";
import { adminHandler } from "@/lib/http-handler";
import { db } from "@/lib/db";

export const GET = adminHandler({
  permission: "audit.read",
  run: ({ req }) => {
    const s = new URL(req.url).searchParams;
    const q: { entity?: string; entityId?: string; actorId?: string; from?: string; to?: string; page?: number } = {};
    for (const k of ["entity", "entityId", "actorId", "from", "to"] as const) {
      const v = s.get(k);
      if (v !== null) q[k] = v;
    }
    const page = Number(s.get("page"));
    if (Number.isInteger(page) && page > 0) q.page = page;
    return audit.list(db, q);
  },
});
