import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { concierge, contact, jobs, questions, reviews } from "@namilux/core";
import { AdminShell } from "@/components/shell/AdminShell";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/session";
import { env } from "@/env";

async function badgeCounts(): Promise<{ inbox: number; jobsFailed: number }> {
  const [c, q, m, r, s] = await Promise.all([
    concierge.counts(db).catch(() => ({ pending: 0 })),
    questions.counts(db).catch(() => ({ pending: 0 })),
    contact.list(db, { status: "pending", page: 1 }).catch(() => ({ total: 0 })),
    reviews.listAdmin(db, { status: "pending", page: 1 }).catch(() => ({ total: 0 })),
    jobs.stats(db).catch(() => ({ failed: 0, dead: 0 })),
  ]);
  return { inbox: c.pending + q.pending + m.total + r.total, jobsFailed: s.failed + s.dead };
}

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const staff = await requireStaff();
  // A one-time password is good for exactly one login. Until it is replaced, /login/change-password
  // is the only page this account may open - that screen sits outside this group so the redirect
  // cannot loop, and `adminHandler` refuses every write in the meantime, so the block is not
  // merely a redirect the client could skip.
  if (staff.mustChangePassword) redirect("/login/change-password");
  const counts = await badgeCounts();
  return (
    <AdminShell staff={staff} counts={counts} storeOrigin={env.SITE_ORIGIN}>
      {children}
    </AdminShell>
  );
}
