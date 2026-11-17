import { Plus } from "lucide-react";
import { listCoupons } from "@namilux/core";
import { Filters } from "@/components/data/Filters";
import { Pagination } from "@/components/data/Pagination";
import { CouponTable } from "@/components/marketing/CouponTable";
import { ButtonLink, PageHeader } from "@/components/kit";
import { fa } from "@/i18n/fa";
import { requirePermission } from "@/lib/authz";
import { db } from "@/lib/db";

type SP = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

export default async function CouponsPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requirePermission("marketing.coupons");
  const sp = await searchParams;
  const active = first(sp.active);
  const q = first(sp.q);
  const list = await listCoupons(db, { page: Math.max(1, Number(first(sp.page)) || 1), ...(q === undefined || q.trim() === "" ? {} : { q }), ...(active === "1" ? { active: true } : active === "0" ? { active: false } : {}) });
  return (
    <div>
      <PageHeader
        title={fa["nav.coupons"]} count={list.total}
        actions={
          <ButtonLink href="/marketing/coupons/new" icon={<Plus size={16} aria-hidden="true" />}>
            {fa["coupons.new"]}
          </ButtonLink>
        }
      />
      <Filters
        defs={[
          { key: "q", label: fa["common.search"], kind: "text" },
          { key: "active", label: fa["coupons.active"], kind: "bool" },
        ]}
      />
      <CouponTable items={list.items} />
      <Pagination page={list.page} pageSize={list.pageSize} total={list.total} />
    </div>
  );
}
