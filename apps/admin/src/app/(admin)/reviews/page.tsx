import { reviews } from "@namilux/core";
import { Filters } from "@/components/data/Filters";
import { Pagination } from "@/components/data/Pagination";
import { ReviewModeration } from "@/components/reviews/ReviewModeration";
import { PageHeader } from "@/components/kit";
import { fa } from "@/i18n/fa";
import { requirePermission } from "@/lib/authz";
import { db } from "@/lib/db";

type SP = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

export default async function ReviewsPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requirePermission("inbox.read");
  const sp = await searchParams;
  const status = first(sp.status);
  const productId = Number(first(sp.productId));
  const list = await reviews.listAdmin(db, {
    page: Math.max(1, Number(first(sp.page)) || 1),
    ...(status === "pending" || status === "approved" || status === "rejected" ? { status } : {}),
    ...(Number.isInteger(productId) && productId > 0 ? { productId } : {}),
  });
  return (
    <div>
      <PageHeader title={fa["reviews.title"]} count={list.total} />
      <Filters defs={[{ key: "status", label: fa["common.status"], kind: "select", options: (["pending", "approved", "rejected"] as const).map((s) => ({ value: s, label: fa[`reviews.status.${s}`] })) }]} />
      <ReviewModeration items={list.items} />
      <Pagination page={list.page} pageSize={list.pageSize} total={list.total} />
    </div>
  );
}
