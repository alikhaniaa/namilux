"use client";
import { actorLabel, movementLabel } from "@/i18n/admin-labels";
import Link from "next/link";
import { faInt, formatJalali, formatToman } from "@namilux/core/client";
import { EmptyRow, Table, Td, Th } from "@/components/kit";
import { fa } from "@/i18n/fa";

export type ProductHistory = {
  priceHistory: { id: number; price: number; compareAtPrice: number | null; note: string | null; createdAt: string; actor: { type: string } }[];
  movements: { delta: number; reason: string; orderId: string | null; note: string | null; createdAt: string }[];
  reservations: { orderId: string; qty: number; expiresAt: string }[];
};

export function TabHistory({ history }: { history: ProductHistory }) {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <section>
        <h3 className="mb-2 text-sm font-semibold">{fa["products.priceHistory"]}</h3>
        <Table minWidth={360}>
          <thead>
            <tr>
              <Th>{fa["common.date"]}</Th>
              <Th>{fa["products.price"]}</Th>
              <Th>{fa["products.compareAt"]}</Th>
              <Th>{fa["products.adjust.note"]}</Th>
            </tr>
          </thead>
          <tbody>
            {history.priceHistory.map((h) => (
              <tr key={h.id} className="border-t border-[var(--line)]">
                <Td className="text-xs">{formatJalali(h.createdAt, "short")}</Td>
                <Td>{formatToman(h.price)}</Td>
                <Td>{h.compareAtPrice === null ? "ثبت نشده" : formatToman(h.compareAtPrice)}</Td>
                <Td className="text-xs text-[var(--ink-2)]">
                  {h.note ?? ""} <span className="ltr text-[var(--ink-3)]">{actorLabel(h.actor.type)}</span>
                </Td>
              </tr>
            ))}
            {history.priceHistory.length === 0 ? <EmptyRow colSpan={4} text={fa["table.empty"]} /> : null}
          </tbody>
        </Table>
      </section>
      <section>
        <h3 className="mb-2 text-sm font-semibold">{fa["products.movements"]}</h3>
        <Table minWidth={360}>
          <thead>
            <tr>
              <Th>{fa["common.date"]}</Th>
              <Th>{fa["products.adjust.delta"]}</Th>
              <Th>{fa["products.adjust.reason"]}</Th>
              <Th>{fa["orders.code"]}</Th>
            </tr>
          </thead>
          <tbody>
            {history.movements.map((m, i) => (
              <tr key={`${m.createdAt}-${String(i)}`} className="border-t border-[var(--line)]">
                <Td className="text-xs">{formatJalali(m.createdAt, "short")}</Td>
                <Td className={m.delta < 0 ? "text-[var(--danger)]" : "text-[var(--ok)]"}>{m.delta > 0 ? "+" : ""}{faInt(m.delta)}</Td>
                <Td className="text-xs">
                  {movementLabel(m.reason)}
                  {m.note !== null ? <span className="text-[var(--ink-2)]"> · {m.note}</span> : null}
                </Td>
                <Td ltr className="text-xs">
                  {m.orderId === null ? "" : <Link href={`/orders?q=${encodeURIComponent(m.orderId)}`}>مشاهدهٔ سفارش</Link>}
                </Td>
              </tr>
            ))}
            {history.movements.length === 0 ? <EmptyRow colSpan={4} text={fa["table.empty"]} /> : null}
          </tbody>
        </Table>
      </section>
      <section className="lg:col-span-2">
        <h3 className="mb-2 text-sm font-semibold">{fa["products.reservations"]}</h3>
        <ul className="divide-y divide-[var(--line)] border border-[var(--line)] text-sm">
          {history.reservations.map((r) => (
            <li key={r.orderId} className="flex flex-wrap items-center justify-between gap-2 p-2">
              <Link href={`/orders?q=${encodeURIComponent(r.orderId)}`} className="ltr text-xs hover:text-[var(--accent)]">
                مشاهدهٔ سفارش
              </Link>
              <span>×{faInt(r.qty)}</span>
              <span className="text-xs text-[var(--ink-2)]">{formatJalali(r.expiresAt, "short")}</span>
            </li>
          ))}
          {history.reservations.length === 0 ? <li className="p-3 text-center text-[var(--ink-2)]">{fa["table.empty"]}</li> : null}
        </ul>
      </section>
    </div>
  );
}
