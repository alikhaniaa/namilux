"use client";
import { statusLabel } from "@/i18n/admin-labels";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Address, BackInStockRequest, Customer, LoyaltyLedgerEntry, OrderRow, Review } from "@namilux/core/client";

type SessionInfo = { id: string; createdAt: string; lastSeenAt: string; ipMasked: string; uaClass: string; current: boolean };
import { faDigits, faInt, formatJalali, formatToman } from "@namilux/core/client";
import { PointsAdjust } from "./PointsAdjust";
import { Button, Card, Input, StatusBadge } from "@/components/kit";
import { Tabs, toast } from "@/components/kit-client";
import { fa } from "@/i18n/fa";
import { ApiError, api } from "@/lib/api-client";

export type CustomerDetailData = {
  customer: Customer;
  orders: OrderRow[];
  addresses: Address[];
  ledger: LoyaltyLedgerEntry[];
  reviews: Review[];
  requests: BackInStockRequest[];
  sessions: SessionInfo[];
};

export function CustomerDetail({ data, canWrite, canPoints }: { data: CustomerDetailData; canWrite: boolean; canPoints: boolean }) {
  const router = useRouter();
  const c = data.customer;
  const [tab, setTab] = useState("orders");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  async function block(blocked: boolean): Promise<void> {
    setBusy(true);
    try {
      await api(`/api/customers/${c.id}/block`, { method: "POST", body: { blocked, ...(blocked ? { reason } : {}) } });
      toast(fa["common.saved"]);
      router.refresh();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : fa["common.error"], "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <div>
        <Tabs
          tabs={[
            { key: "orders", label: fa["customers.orders"], count: data.orders.length },
            { key: "addresses", label: fa["customers.addresses"], count: data.addresses.length },
            { key: "ledger", label: fa["customers.ledger"], count: data.ledger.length },
            { key: "reviews", label: fa["customers.reviews"], count: data.reviews.length },
            { key: "requests", label: fa["customers.requests"], count: data.requests.length },
            { key: "sessions", label: fa["customers.sessions"], count: data.sessions.length },
          ]}
          current={tab}
          onChange={setTab}
        />
        {tab === "orders" ? (
          <ul className="divide-y divide-[var(--line)] border border-[var(--line)] text-sm">
            {data.orders.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 p-2">
                <Link href={`/orders/${o.code}`} className="ltr hover:text-[var(--accent)]">
                  {o.code}
                </Link>
                <span className="text-xs text-[var(--ink-2)]">{formatJalali(o.placedAt, "short")}</span>
                <span>{formatToman(o.grandTotal)}</span>
                <StatusBadge>{fa[`orders.status.${o.status}`]}</StatusBadge>
              </li>
            ))}
            {data.orders.length === 0 ? <li className="p-4 text-center text-[var(--ink-2)]">{fa["table.empty"]}</li> : null}
          </ul>
        ) : null}
        {tab === "addresses" ? (
          <ul className="grid gap-2 md:grid-cols-2">
            {data.addresses.map((a) => (
              <li key={a.id} className="border border-[var(--line)] p-3 text-sm">
                <p className="font-medium">
                  {a.label} {a.isDefault ? <StatusBadge tone="ok">{fa["views.default"]}</StatusBadge> : null}
                </p>
                <p>
                  {a.recipientName} · <span className="ltr">{faDigits(a.recipientPhone)}</span>
                </p>
                <p className="text-[var(--ink-2)]">
                  {a.province} · {a.city} · {a.address}
                </p>
                <p className="text-xs text-[var(--ink-3)]">{faDigits(a.postcode)}</p>
              </li>
            ))}
            {data.addresses.length === 0 ? <li className="p-4 text-center text-sm text-[var(--ink-2)]">{fa["table.empty"]}</li> : null}
          </ul>
        ) : null}
        {tab === "ledger" ? (
          <ul className="divide-y divide-[var(--line)] border border-[var(--line)] text-sm">
            {data.ledger.map((l) => (
              <li key={l.id} className="flex items-center justify-between p-2">
                <span>
                  {l.reason} {l.note !== null ? <span className="text-xs text-[var(--ink-2)]">· {l.note}</span> : null}
                </span>
                <span className="text-xs text-[var(--ink-2)]">{formatJalali(l.createdAt, "short")}</span>
                <span className={`tabular-nums ${l.delta < 0 ? "text-[var(--danger)]" : "text-[var(--ok)]"}`}>{l.delta > 0 ? "+" : ""}{faInt(l.delta)}</span>
              </li>
            ))}
            {data.ledger.length === 0 ? <li className="p-4 text-center text-[var(--ink-2)]">{fa["table.empty"]}</li> : null}
          </ul>
        ) : null}
        {tab === "reviews" ? (
          <ul className="divide-y divide-[var(--line)] border border-[var(--line)] text-sm">
            {data.reviews.map((r) => (
              <li key={r.id} className="p-2">
                <span className="me-2 tabular-nums">★ {faInt(r.rating)}</span>
                <span className="font-medium">{r.title}</span> <StatusBadge>{fa[`reviews.status.${r.status}`]}</StatusBadge>
                <p className="text-xs text-[var(--ink-2)]">{r.body}</p>
              </li>
            ))}
            {data.reviews.length === 0 ? <li className="p-4 text-center text-[var(--ink-2)]">{fa["table.empty"]}</li> : null}
          </ul>
        ) : null}
        {tab === "requests" ? (
          <ul className="divide-y divide-[var(--line)] border border-[var(--line)] text-sm">
            {data.requests.map((r) => (
              <li key={r.id} className="flex items-center justify-between p-2">
                <Link href={`/products/${String(r.productId)}`} className="hover:text-[var(--accent)]">
                  مشاهدهٔ کالا
                </Link>
                <StatusBadge>{statusLabel(r.status)}</StatusBadge>
                <span className="text-xs text-[var(--ink-2)]">{formatJalali(r.createdAt, "short")}</span>
              </li>
            ))}
            {data.requests.length === 0 ? <li className="p-4 text-center text-[var(--ink-2)]">{fa["table.empty"]}</li> : null}
          </ul>
        ) : null}
        {tab === "sessions" ? (
          <ul className="divide-y divide-[var(--line)] border border-[var(--line)] text-sm">
            {data.sessions.map((s) => (
              <li key={s.id} className="flex items-center justify-between p-2">
                <span className="ltr text-xs">{s.ipMasked}</span>
                <span className="text-xs">{({ mobile: "گوشی", desktop: "رایانه", inapp: "مرورگر درون برنامه", pwa: "برنامهٔ نصب‌شده" })[s.uaClass] ?? "دستگاه"}</span>
                <span className="text-xs text-[var(--ink-2)]">{formatJalali(s.lastSeenAt, "short")}</span>
              </li>
            ))}
            {data.sessions.length === 0 ? <li className="p-4 text-center text-[var(--ink-2)]">{fa["table.empty"]}</li> : null}
          </ul>
        ) : null}
      </div>
      <div className="space-y-4">
        <Card title={fa["customers.name"]}>
          <dl className="grid grid-cols-2 gap-1 text-sm">
            <dt className="text-[var(--ink-2)]">{fa["customers.phone"]}</dt>
            <dd className="ltr">{faDigits(c.phone)}</dd>
            <dt className="text-[var(--ink-2)]">{fa["customers.email"]}</dt>
            <dd className="ltr text-xs">{c.email ?? fa["common.none"]}</dd>
            <dt className="text-[var(--ink-2)]">{fa["customers.tier"]}</dt>
            <dd>{fa[`customers.tier.${c.tier}`]}</dd>
            <dt className="text-[var(--ink-2)]">{fa["customers.points"]}</dt>
            <dd className="tabular-nums">{faInt(c.pointsBalance)}</dd>
            <dt className="text-[var(--ink-2)]">{fa["customers.spend"]}</dt>
            <dd className="tabular-nums">{formatToman(c.lifetimeSpend)}</dd>
            <dt className="text-[var(--ink-2)]">{fa["customers.joined"]}</dt>
            <dd className="text-xs">{formatJalali(c.createdAt, "short")}</dd>
            <dt className="text-[var(--ink-2)]">{fa["customers.optIn"]}</dt>
            <dd>{c.marketingOptIn ? fa["common.yes"] : fa["common.no"]}</dd>
          </dl>
          {canPoints ? (
            <div className="mt-3">
              <PointsAdjust customerId={c.id} />
            </div>
          ) : null}
        </Card>
        {canWrite ? (
          <Card title={c.isBlocked ? fa["customers.unblock"] : fa["customers.block"]}>
            {c.isBlocked ? (
              <>
                <p className="mb-2 text-xs text-[var(--danger)]">{c.blockReason}</p>
                <Button variant="outline" disabled={busy} onClick={() => void block(false)}>
                  {fa["customers.unblock"]}
                </Button>
              </>
            ) : (
              <div className="space-y-2">
                <Input placeholder={fa["customers.blockReason"]} value={reason} onChange={(e) => setReason(e.target.value)} />
                <Button variant="danger" disabled={busy || reason.trim().length < 3} onClick={() => void block(true)}>
                  {fa["customers.block"]}
                </Button>
              </div>
            )}
          </Card>
        ) : null}
      </div>
    </div>
  );
}
