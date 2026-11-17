import { getOrderForCustomer, invoiceView } from "@namilux/core";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Invoice } from "@/components/account/Invoice";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/session";
import { loadSettings } from "@/server/loaders/settings";
import { t } from "@/i18n";
import { connection } from "next/server";

export default async function InvoiceRoute({ params }: { params: Promise<{ code: string }> }): Promise<React.ReactNode> {
  // cacheComponents: this page is personal (cookie session) and has no searchParams - declare the dynamic hole before any data read.
  await connection();
  const code = decodeURIComponent((await params).code).toUpperCase();
  const user = await currentUser();
  if (user === null) redirect(`/account/login/?next=/account/orders/${encodeURIComponent(code)}/invoice/`);
  const order = await getOrderForCustomer(db, code, user.customerId);
  if (order === null) notFound();
  if (order.invoiceNo === null) {
    return (
      <div className="empty">
        <p>{t("invoice.notAvailable")}</p>
        <Link href={`/account/orders/${encodeURIComponent(code)}/`} className="btn btn--secondary">
          {t("shell.back")}
        </Link>
      </div>
    );
  }
  const settings = await loadSettings();
  const invoice = await invoiceView(db, order.id, { settings });
  return <Invoice invoice={invoice} />;
}
