import { backInStock, concierge, contact, listReturns, questions, reviews } from "@namilux/core";
import { adminHandler } from "@/lib/http-handler";
import { db } from "@/lib/db";

export const GET = adminHandler({
  permission: "inbox.read",
  run: async ({ req }) => {
    const s = new URL(req.url).searchParams;
    const tab = s.get("tab") ?? "concierge";
    const pageRaw = Number(s.get("page"));
    const page = Number.isInteger(pageRaw) && pageRaw > 0 ? pageRaw : 1;
    const status = s.get("status");
    switch (tab) {
      case "counts": {
        const [c, q, m, r, ret] = await Promise.all([
          concierge.counts(db),
          questions.counts(db),
          contact.list(db, { status: "pending", page: 1 }),
          reviews.listAdmin(db, { status: "pending", page: 1 }),
          listReturns(db, { status: "pending", page: 1 }),
        ]);
        return { concierge: c.pending, questions: q.pending, contact: m.total, reviews: r.total, returns: ret.total };
      }
      case "questions":
        return questions.listAdmin(db, { kind: "question", ...(status === "pending" || status === "answered" || status === "hidden" ? { status } : {}), page });
      case "contact":
        return contact.list(db, { ...(status === "pending" || status === "answered" ? { status } : {}), page });
      case "backInStock":
        return backInStock.demand(db, { page });
      case "reviews":
        return reviews.listAdmin(db, { ...(status === "pending" || status === "approved" || status === "rejected" ? { status } : {}), page });
      case "returns":
        return listReturns(db, { ...(status === "pending" || status === "accepted" || status === "rejected" ? { status } : {}), page });
      default:
        return concierge.list(db, { ...(status === "pending" || status === "answered" || status === "hidden" ? { status: [status] } : {}), page, pageSize: 50 });
    }
  },
});
