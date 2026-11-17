import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import { t } from "@/i18n";

export function TrustList({
  warrantyMonths,
  storeAvailable,
  gateway = "zarinpal",
  paymentRow = true,
}: {
  warrantyMonths: number | null;
  storeAvailable: boolean;
  /** The site's gateway: the payment row names it (the instalment site never mentions ZarinPal). */
  gateway?: "zarinpal" | "snapppay";
  /** false drops the payment row - a product switched off for instalments makes no SnappPay claim. */
  paymentRow?: boolean;
}): React.ReactNode {
  // v2 §10.2: this is the PDP's home for authenticity and returns - the footer carries shipping.
  // A claim only appears when it is true: no warranty row without a warranty, no «موجود در
  // فروشگاه حضوری» unless the shop actually has it on the shelf.
  const rows: { key: string; node: React.ReactNode }[] = [
    { key: "authenticity", node: t("product.trust.authenticity") },
  ];
  if (warrantyMonths !== null && warrantyMonths > 0) {
    rows.push({
      key: "warranty",
      node: (
        <Link href="/warranty/" className="link-under">
          {t("product.trust.warranty", { n: warrantyMonths })}
        </Link>
      ),
    });
  }
  rows.push({
    key: "return",
    node: (
      <Link href="/shipping-returns/" className="link-under">
        {t("product.trust.return")}
      </Link>
    ),
  });
  if (paymentRow) rows.push({ key: "payment", node: t(gateway === "snapppay" ? "product.trust.payment.snapppay" : "product.trust.payment") });
  if (storeAvailable) rows.push({ key: "store", node: t("product.trust.store") });

  return (
    <ul className="trust-list grid gap-2">
      {rows.map((row) => (
        <li key={row.key} className="t-sm flex items-start gap-2">
          <span className="text-ok shrink-0">
            <Icon name="check" size={20} />
          </span>
          {row.node}
        </li>
      ))}
    </ul>
  );
}
