import type { InvoiceView } from "@namilux/core";
import { faDigits, faInt, formatJalali, formatToman } from "@namilux/core/client";
import { PrintButton } from "./PrintButton";
import { Bdi } from "@/components/ui/Bdi";
import { t } from "@/i18n";

export function Invoice({ invoice }: { invoice: InvoiceView }): React.ReactNode {
  const unit = t("product.price.unit");
  const money = (n: number): string => `${formatToman(n)} ${unit}`;
  return (
    <article className="invoice-print grid gap-6 bg-surface p-5">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="grid gap-1">
          <h2 className="d-3">{t("invoice.title")}</h2>
          <p className="t-sm text-ink-2">
            {t("invoice.no")}: <bdi>{invoice.invoiceNo}</bdi>
          </p>
          <p className="t-sm text-ink-2">
            {t("invoice.date")}: {formatJalali(invoice.issuedAt, "long")}
          </p>
        </div>
        <PrintButton />
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        <section className="card grid gap-1 p-4 t-sm">
          <h3 className="font-semibold">{t("invoice.seller")}</h3>
          <p>{invoice.seller.legalName}</p>
          <p className="text-ink-2">{invoice.seller.address}</p>
          <p className="text-ink-2">
            <bdi>{faDigits(invoice.seller.phone)}</bdi>
          </p>
          {invoice.seller.economicCode !== "" ? (
            <p className="text-ink-2">
              {t("invoice.economicCode")}: <bdi>{faDigits(invoice.seller.economicCode)}</bdi>
            </p>
          ) : null}
          {invoice.seller.registrationNo !== "" ? (
            <p className="text-ink-2">
              {t("invoice.registrationNo")}: <bdi>{faDigits(invoice.seller.registrationNo)}</bdi>
            </p>
          ) : null}
          {invoice.seller.vatId !== "" ? (
            <p className="text-ink-2">
              {t("invoice.vatId")}: <bdi>{faDigits(invoice.seller.vatId)}</bdi>
            </p>
          ) : null}
        </section>
        <section className="card grid gap-1 p-4 t-sm">
          <h3 className="font-semibold">{t("invoice.buyer")}</h3>
          <p>{invoice.buyer.name}</p>
          <p className="text-ink-2">
            <bdi>{faDigits(invoice.buyer.phone)}</bdi>
          </p>
          <p className="text-ink-2">{invoice.buyer.address}</p>
        </section>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] t-sm">
          <thead className="bg-bg-soft t-xs text-ink-2">
            <tr>
              <th className="p-2 text-start">{t("invoice.row")}</th>
              <th className="p-2 text-start">{t("invoice.item")}</th>
              <th className="p-2 text-start">{t("invoice.qty")}</th>
              <th className="p-2 text-start">{t("invoice.unit")}</th>
              {invoice.vat > 0 ? <th className="p-2 text-start">{t("invoice.vat")}</th> : null}
              <th className="p-2 text-end">{t("invoice.lineTotal")}</th>
            </tr>
          </thead>
          <tbody>
            {invoice.lines.map((line, i) => (
              <tr key={`${line.name}-${String(i)}`} className="hairline-t">
                <td className="p-2 tnum">{faInt(i + 1)}</td>
                <td className="p-2">
                  <Bdi text={line.name} />
                  {line.sku !== null ? (
                    <span className="ms-2 t-xs text-ink-3">
                      <bdi dir="ltr">{line.sku}</bdi>
                    </span>
                  ) : null}
                </td>
                <td className="p-2 tnum">{faInt(line.qty)}</td>
                <td className="p-2 tnum">{formatToman(line.unit)}</td>
                {invoice.vat > 0 ? <td className="p-2 tnum">{formatToman(line.vat)}</td> : null}
                <td className="p-2 text-end tnum">{formatToman(line.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section className="ms-auto grid w-full max-w-sm gap-2 t-sm">
        <div className="flex justify-between">
          <span className="text-ink-2">{t("invoice.subtotal")}</span>
          <span className="tnum">{money(invoice.subtotal)}</span>
        </div>
        {invoice.discount > 0 ? (
          <div className="flex justify-between">
            <span className="text-ink-2">{t("invoice.discount")}</span>
            <span className="tnum">−{money(invoice.discount)}</span>
          </div>
        ) : null}
        <div className="flex justify-between">
          <span className="text-ink-2">{t("invoice.shipping")}</span>
          <span className="tnum">{invoice.shipping === 0 ? t("cart.summary.free") : money(invoice.shipping)}</span>
        </div>
        {invoice.vat > 0 ? (
          <div className="flex justify-between">
            <span className="text-ink-2">{t("invoice.vat")}</span>
            <span className="tnum">{money(invoice.vat)}</span>
          </div>
        ) : null}
        <div className="hairline-t flex justify-between pt-2 font-semibold">
          <span>{t("invoice.total")}</span>
          <span className="tnum">{money(invoice.grandTotal)}</span>
        </div>
        <p className="t-xs text-ink-3">
          {t("invoice.paid", { method: invoice.paid.method })}
          {invoice.paid.ref !== null ? (
            <>
              {" "}
              · <bdi dir="ltr">{faDigits(invoice.paid.ref)}</bdi>
            </>
          ) : null}{" "}
          · {formatJalali(invoice.paid.at, "long")}
        </p>
      </section>

      {invoice.notes.length > 0 ? (
        <ul className="grid gap-1 t-xs text-ink-3">
          {invoice.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}
