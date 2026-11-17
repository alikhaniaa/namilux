import Link from "next/link";
import { notFound } from "next/navigation";
import { couponUsage, faInt, findCardSources, formatJalali, formatToman, getCoupon, listBrands, listCategoryTree, listCollections } from "@namilux/core";
import type { CategoryTreeNode, CouponAdminInput } from "@namilux/core";
import { CouponForm } from "@/components/marketing/CouponForm";
import { Card, PageHeader } from "@/components/kit";
import { fa } from "@/i18n/fa";
import { requirePermission } from "@/lib/authz";
import { db } from "@/lib/db";

const EMPTY: CouponAdminInput = { code: "", kind: "percent", value: 10, minSubtotal: 0, maxDiscount: null, startsAt: null, endsAt: null, usageLimit: null, usagePerCustomer: 1, firstOrderOnly: false, customerId: null, applies: {}, excludes: {}, stackableWithPoints: true, isActive: true };

function flat(nodes: CategoryTreeNode[], depth = 0): { id: number; name: string }[] {
  return nodes.flatMap((n) => [{ id: n.id, name: `${"· ".repeat(depth)}${n.name}` }, ...flat(n.children, depth + 1)]);
}

export default async function CouponPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("marketing.coupons");
  const { id } = await params;
  const [brands, tree, collections] = await Promise.all([listBrands(db), listCategoryTree(db), listCollections(db)]);
  const options = { brands: brands.map((b) => ({ id: b.id, name: b.name })), categories: flat(tree), collections: collections.map((c) => ({ id: c.id, name: c.name })) };
  if (id === "new") {
    return (
      <div>
        <PageHeader title={fa["coupons.new"]} />
        <CouponForm initial={EMPTY} options={options} productNames={{}} />
      </div>
    );
  }
  const cid = Number(id);
  if (!Number.isInteger(cid) || cid <= 0) notFound();
  const coupon = await getCoupon(db, cid);
  if (coupon === null) notFound();
  const usage = await couponUsage(db, cid);
  const pids = [...(coupon.applies.productIds ?? []), ...(coupon.excludes.productIds ?? [])];
  const cards = pids.length === 0 ? [] : await findCardSources(db, pids);
  const productNames: Record<number, string> = {};
  for (const c of cards) productNames[c.id] = c.displayName;
  const initial: CouponAdminInput = {
    id: coupon.id,
    code: coupon.code,
    kind: coupon.kind,
    value: coupon.value,
    minSubtotal: coupon.minSubtotal,
    maxDiscount: coupon.maxDiscount,
    startsAt: coupon.startsAt,
    endsAt: coupon.endsAt,
    usageLimit: coupon.usageLimit,
    usagePerCustomer: coupon.usagePerCustomer,
    firstOrderOnly: coupon.firstOrderOnly,
    customerId: coupon.customerId,
    applies: coupon.applies,
    excludes: coupon.excludes,
    stackableWithPoints: coupon.stackableWithPoints,
    isActive: coupon.isActive,
  };
  return (
    <div className="space-y-6">
      <PageHeader title={coupon.code} subtitle={`${fa["coupons.used"]}: ${faInt(coupon.usedCount)}`} />
      <CouponForm initial={initial} options={options} productNames={productNames} />
      <Card title={fa["coupons.usage"]}>
        <ul className="divide-y divide-[var(--line)] text-sm">
          {usage.map((u) => (
            <li key={`${u.orderCode}-${u.at}`} className="flex items-center justify-between py-1">
              <Link href={`/orders/${u.orderCode}`} className="ltr hover:text-[var(--accent)]">
                {u.orderCode}
              </Link>
              <span>{formatToman(u.amount)}</span>
              <span className="text-xs text-[var(--ink-2)]">{formatJalali(u.at, "short")}</span>
            </li>
          ))}
          {usage.length === 0 ? <li className="py-3 text-center text-[var(--ink-2)]">{fa["table.empty"]}</li> : null}
        </ul>
      </Card>
    </div>
  );
}
