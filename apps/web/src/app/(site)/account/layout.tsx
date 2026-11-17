import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import Link from "next/link";
import { getCustomer, phoneDisplay } from "@namilux/core";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/session";
import { AccountHeading, AccountNav } from "@/components/account/AccountNav";
import { LogoutButton } from "@/components/account/LogoutButton";
import { Icon } from "@/components/ui/Icon";
import { t } from "@/i18n";
export const metadata: Metadata = { title: "حساب کاربری", robots: { index: false, follow: false } };
// DECISION: cacheComponents - the cookie read happens inside its own <Suspense> boundary so the static
// chrome (heading) prerenders and only the personal part streams (Next: blocking-prerender-dynamic).
async function AccountChrome({ children }: {
    children: React.ReactNode;
}): Promise<React.ReactNode> {
    const user = await currentUser();
    const customer = user === null ? null : await getCustomer(db, user.customerId);
    if (user === null)
        return <div className="account-guest"><h1 className="sr-only">{t("account.title")}</h1>{children}</div>;
    const name = [customer?.firstName, customer?.lastName].filter(Boolean).join(" ") || t("account.member");
    const ordersCount = (customer?.ordersCount ?? 0);
    return (<div className="account-shell">
      <aside className="account-sidebar">
        <div className="account-identity">
          <span className="account-avatar"><Icon name="user" size={24}/></span>
          <div><strong>{name}</strong><bdi>{phoneDisplay(customer?.phone ?? user.phone)}</bdi></div>
          <Link href="/account/profile/" aria-label={t("account.editProfile")} className="account-identity__edit"><Icon name="chevron-e" size={16}/></Link>
        </div>
        <AccountNav counts={{ orders: ordersCount }}/>
        <div className="account-sidebar__footer"><LogoutButton /></div>
      </aside>
      <div className="account-workspace">
        <AccountHeading />
        <div className="account__body">{children}</div>
      </div>
    </div>);
}
/**
 * DECISION (4 Sep 2026, performance review): the account routes are served under the nonce CSP
 * (proxy.ts DYNAMIC_PREFIXES). A nonce only works when the whole document - Next's bootstrap and
 * inline data scripts included - is rendered for the request that carries it. A prerendered shell
 * bakes the nonce of whichever render produced it, so the browser then blocks every script and
 * nothing hydrates (found by the 4 Sep e2e run once browsers stopped taking the blocking "bot"
 * path). `instant = false` plus a request-time read before the first markup makes the route block
 * instead of shipping a shell; these pages are `no-store` anyway.
 */
export const instant = false;
export default async function AccountLayout({ children }: {
    children: React.ReactNode;
}): Promise<React.ReactNode> {
    await connection();
    return (<section className="account">
      <Suspense fallback={<div className="account__body" aria-busy="true"/>}>
        <AccountChrome>{children}</AccountChrome>
      </Suspense>
    </section>);
}
