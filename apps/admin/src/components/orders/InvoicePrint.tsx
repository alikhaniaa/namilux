import type { InvoiceView } from "@namilux/core";
import { faDigits, faInt, formatJalali, formatToman } from "@namilux/core";
import { fa } from "@/i18n/fa";

export function InvoicePrint({ v }: { v: InvoiceView }) {
  return (
    <article className="mx-auto max-w-3xl bg-[var(--surface)] p-8 text-sm text-[var(--ink)] print:p-0" dir="rtl">
      <header className="flex items-start justify-between border-b border-[var(--line-strong)] pb-4">
        <div>
          <h1 className="text-lg font-semibold">{v.seller.legalName}</h1>
          <p>{v.seller.address}</p>
          <p className="ltr">{faDigits(v.seller.phone)}</p>
          <p className="text-xs">
            {v.seller.economicCode !== "" ? `${faDigits(v.seller.economicCode)} · ` : ""}
            {v.seller.registrationNo !== "" ? faDigits(v.seller.registrationNo) : ""}
          </p>
        </div>
        <div className="text-end">
          <p className="text-base font-semibold">{fa["orders.invoice"]}</p>
          <p className="ltr">{v.invoiceNo}</p>
          <p>{formatJalali(v.issuedAt, "long")}</p>
        </div>
      </header>
      <section className="my-4">
        <p className="font-medium">{v.buyer.name}</p>
        <p className="ltr">{faDigits(v.buyer.phone)}</p>
        <p>{v.buyer.address}</p>
      </section>
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-[var(--line-strong)] text-xs">
            <th className="p-1 text-start">#</th>
            <th className="p-1 text-start">{fa["orders.items"]}</th>
            <th className="p-1 text-start">{fa["manual.qty"]}</th>
            <th className="p-1 text-start">{fa["products.price"]}</th>
            <th className="p-1 text-start">{fa["orders.total"]}</th>
          </tr>
        </thead>
        <tbody>
          {v.lines.map((l, i) => (
            <tr key={i} className="border-b border-[var(--line)]">
              <td className="p-1">{faInt(i + 1)}</td>
              <td className="p-1">
                {l.name}
                {l.sku !== null ? <span className="ms-2 ltr text-xs">{l.sku}</span> : null}
              </td>
              <td className="p-1">{faInt(l.qty)}</td>
              <td className="p-1">{formatToman(l.unit)}</td>
              <td className="p-1">{formatToman(l.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <section className="ms-auto mt-4 w-72 space-y-1">
        <div className="flex justify-between">
          <span>{fa["orders.totals.subtotal"]}</span>
          <span>{formatToman(v.subtotal)}</span>
        </div>
        {v.discount > 0 ? (
          <div className="flex justify-between">
            <span>{fa["orders.totals.discount"]}</span>
            <span>−{formatToman(v.discount)}</span>
          </div>
        ) : null}
        <div className="flex justify-between">
          <span>{fa["orders.totals.shipping"]}</span>
          <span>{formatToman(v.shipping)}</span>
        </div>
        {v.vat > 0 ? (
          <div className="flex justify-between">
            <span>VAT</span>
            <span>{formatToman(v.vat)}</span>
          </div>
        ) : null}
        <div className="flex justify-between border-t border-[var(--line-strong)] pt-1 font-semibold">
          <span>{fa["orders.totals.grand"]}</span>
          <span>{formatToman(v.grandTotal)}</span>
        </div>
      </section>
      <footer className="mt-6 text-xs">
        <p>
          {fa["orders.payment"]}: {v.paid.method}
          {v.paid.ref !== null ? <span className="ltr"> · {v.paid.ref}</span> : null} · {formatJalali(v.paid.at, "short")}
        </p>
        {v.notes.map((n, i) => (
          <p key={i}>{n}</p>
        ))}
      </footer>
    </article>
  );
}
