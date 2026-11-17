import { smsLog } from "@namilux/core";
import { adminHandler } from "@/lib/http-handler";
import { db } from "@/lib/db";

export const GET = adminHandler({
  permission: "audit.read",
  run: async ({ req }) => {
    const sp = new URL(req.url).searchParams;
    const page = Number(sp.get("page") ?? "1");
    const status = sp.get("status");
    const [list, spend] = await Promise.all([
      smsLog.list(db, {
        ...(sp.get("template") === null ? {} : { template: sp.get("template") ?? "" }),
        ...(status === "queued" || status === "sent" || status === "failed" ? { status } : {}),
        ...(sp.get("from") === null ? {} : { from: sp.get("from") ?? "" }),
        ...(sp.get("to") === null ? {} : { to: sp.get("to") ?? "" }),
        page: Number.isInteger(page) && page > 0 ? page : 1,
      }),
      smsLog.spend(db, new Date().toISOString().slice(0, 10)),
    ]);
    return { ...list, spend };
  },
});
