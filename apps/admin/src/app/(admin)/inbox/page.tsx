import { backInStock, concierge, contact, faInt, listReturns, questions, reviews } from "@namilux/core";
import { Pagination } from "@/components/data/Pagination";
import { BackInStockDemand } from "@/components/inbox/BackInStockDemand";
import { ConciergeList } from "@/components/inbox/ConciergeList";
import { ContactList } from "@/components/inbox/ContactList";
import { type InboxTab, InboxTabs } from "@/components/inbox/InboxTabs";
import { QuestionList } from "@/components/inbox/QuestionList";
import { ReturnsTable } from "@/components/orders/ReturnsTable";
import { ReviewModeration } from "@/components/reviews/ReviewModeration";
import { PageHeader } from "@/components/kit";
import { fa } from "@/i18n/fa";
import { requirePermission } from "@/lib/authz";
import { db } from "@/lib/db";
import { can } from "@namilux/core";

type SP = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);
const TABS: InboxTab[] = ["concierge", "questions", "contact", "backInStock", "reviews", "returns"];

export default async function InboxPage({ searchParams }: { searchParams: Promise<SP> }) {
  const staff = await requirePermission("inbox.read");
  const sp = await searchParams;
  const tabRaw = first(sp.tab);
  const tab: InboxTab = TABS.includes(tabRaw as InboxTab) ? (tabRaw as InboxTab) : "concierge";
  const page = Math.max(1, Number(first(sp.page)) || 1);
  const showAll = first(sp.all) === "1";
  const pendingOnly = showAll ? {} : { status: "pending" as const };

  const [c, q, m, r, ret] = await Promise.all([
    concierge.counts(db).catch(() => ({ pending: 0, snoozed: 0, today: 0 })),
    questions.counts(db).catch(() => ({ pending: 0 })),
    contact.list(db, { status: "pending", page: 1 }).catch(() => ({ total: 0 })),
    reviews.listAdmin(db, { status: "pending", page: 1 }).catch(() => ({ total: 0 })),
    listReturns(db, { status: "pending", page: 1 }).catch(() => ({ total: 0 })),
  ]);
  const counts = { concierge: c.pending, questions: q.pending, contact: m.total, reviews: r.total, returns: ret.total };

  let body: React.ReactNode = null;
  let paging: { page: number; pageSize: number; total: number } | null = null;
  if (tab === "concierge") {
    const list = await concierge.list(db, { page, pageSize: 50, ...(showAll ? {} : { status: ["pending"] }) });
    body = <ConciergeList items={list.items} />;
    paging = list;
  } else if (tab === "questions") {
    const list = await questions.listAdmin(db, { page, kind: "question", ...pendingOnly });
    body = <QuestionList items={list.items} />;
    paging = list;
  } else if (tab === "contact") {
    const list = await contact.list(db, { page, ...pendingOnly });
    body = <ContactList items={list.items} />;
    paging = list;
  } else if (tab === "backInStock") {
    const list = await backInStock.demand(db, { page });
    body = <BackInStockDemand items={list.items} />;
    paging = list;
  } else if (tab === "reviews") {
    const list = await reviews.listAdmin(db, { page, ...pendingOnly });
    body = <ReviewModeration items={list.items} />;
    paging = list;
  } else {
    const list = await listReturns(db, { page, ...pendingOnly });
    body = <ReturnsTable items={list.items} canDecide={can(staff, "orders.refund")} />;
    paging = list;
  }

  return (
    <div>
      <PageHeader
        title={fa["nav.inbox"]}
        actions={
          <a href={`/inbox?tab=${tab}${showAll ? "" : "&all=1"}`} className="text-xs text-[var(--ink-2)] hover:text-[var(--accent)]">
            {showAll ? fa["inbox.status.pending"] : fa["common.all"]}
          </a>
        }
      />
      <InboxTabs current={tab} counts={counts} />
      <div className="mt-3">{body}</div>
      {paging !== null && paging.total > paging.pageSize ? <Pagination page={paging.page} pageSize={paging.pageSize} total={paging.total} /> : null}
      <p className="mt-2 text-[11px] text-[var(--ink-3)]">{fa["table.total"].replace("{n}", faInt(paging?.total ?? 0))}</p>
    </div>
  );
}
