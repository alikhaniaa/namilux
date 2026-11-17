import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { faInt, getCustomer, listOrdersForCustomer } from "@namilux/core";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/session";
import { OrderList } from "@/components/account/OrderList";
import { AccountEmpty } from "@/components/account/AccountEmpty";
import { Icon } from "@/components/ui/Icon";
import type { IconName } from "@/components/ui/Icon";
import { t } from "@/i18n";

import type { FaKey } from "@/i18n";

const LINKS: { href: string; key: FaKey; hint: FaKey; icon: IconName }[] = [
  { href: "/account/addresses/", key: "account.addresses", hint: "account.addresses.hint", icon: "location" },
  { href: "/account/wishlist/", key: "account.wishlist", hint: "account.wishlist.hint", icon: "heart" },
  { href: "/account/requests/", key: "account.requests", hint: "account.requests.hint", icon: "chat" },
];

export default async function AccountHome(): Promise<React.ReactNode> {
  // cacheComponents: this page is personal (cookie session) and has no searchParams - declare the dynamic hole before any data read.
  await connection();
  const user = await currentUser();
  if (user === null) redirect("/account/login/");
  const [customer, orders] = await Promise.all([getCustomer(db, user.customerId), listOrdersForCustomer(db, user.customerId, 1)]);
  const name = customer?.firstName?.trim() ?? "";
  return (
    <div className="account-dashboard">
      <section className="account-welcome">
        <div>
          <span className="account-eyebrow">{t("account.title")}</span>
          <h2>{name === "" ? t("account.hello") : t("account.greeting", { name })}</h2>
          <Link href="/shop/">{t("account.backToShop")}<Icon name="arrow-e" size={16} /></Link>
        </div>
        <div className="account-summary">
          <Link href="/account/orders/"><strong>{faInt(orders.total)}</strong><span>{t("account.orders")}</span></Link>
          <Link href="/account/club/"><strong>{faInt(customer?.pointsBalance ?? 0)}</strong><span>{t("club.points")}</span></Link>
        </div>
      </section>
      {name === "" ? (
        <div className="account-profile-prompt">
          <Icon name="user" size={24} /><div><strong>{t("account.completeProfile")}</strong><p>{t("account.completeProfile.body")}</p></div>
          <Link href="/account/profile/">{t("account.editProfile")}<Icon name="chevron-e" size={16} /></Link>
        </div>
      ) : null}
      <section className="account-panel">
        <div className="account-panel__heading"><h2>{t("account.recentOrders")}</h2><Link href="/account/orders/">{t("account.allOrders")}<Icon name="chevron-e" size={16} /></Link></div>
        {orders.items.length === 0 ? <AccountEmpty icon="bag" title="account.emptyOrders.title" body="account.emptyOrders.body" /> : <OrderList orders={orders.items.slice(0, 3)} page={1} total={Math.min(orders.total, 3)} />}
      </section>
      <section aria-label={t("account.quickAccess")} className="account-shortcuts">
        {LINKS.map((item) => (
          <Link key={item.href} href={item.href}>
            <span className="account-shortcut-icon"><Icon name={item.icon} size={24} /></span>
            <strong>{t(item.key)}</strong><p>{t(item.hint)}</p><Icon name="arrow-e" size={16} />
          </Link>
        ))}
      </section>
    </div>
  );
}
