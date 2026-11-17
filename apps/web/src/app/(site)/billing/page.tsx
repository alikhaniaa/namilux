import { addresses, enamadSeal, getSettings, listActiveShippingMethods, noindexMeta, samandehiSeal } from "@namilux/core";
import type { SealEmbed } from "@namilux/core";
import type { Metadata } from "next";
import { CheckoutPage } from "@/components/checkout/CheckoutPage";
import { env } from "@/env";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/session";
import { loadFlags } from "@/server/loaders/settings";
import { t } from "@/i18n";
// Reads runtime data (session/searchParams), so it is never prerendered (cacheComponents).
export const instant = false;
export function generateMetadata(): Metadata {
    const meta = noindexMeta(t("checkout.title"));
    return { title: meta.title, robots: meta.robots };
}
type Seal = SealEmbed | null;
export default async function BillingRoute(): Promise<React.ReactNode> {
    const user = await currentUser();
    const settings = await getSettings(db);
    // loadFlags() is the pair - the stored settings AND the CHECKOUT_ENABLED / MAINTENANCE variables.
    // Reading `effectiveFlags(settings, {})` here made the environment override invisible on the one
    // page that decides whether the shopper is shown a checkout form at all.
    const flags = await loadFlags();
    const methods = await listActiveShippingMethods(db);
    const list = user !== null ? await addresses.list(db, user.customerId) : [];
    const seals: {
        enamad: Seal;
        samandehi: Seal;
    } = {
        enamad: enamadSeal(settings["seals.enamad_code"]),
        samandehi: samandehiSeal(settings["seals.samandehi_code"]),
    };
    // `data-checkout` is what the shell reads to strip the footer down to the seals and the store's
    // numbers (components.css); the layout itself stays free of request state. A <div>, not a second
    // <main>: the shell already owns <main id="main">.
    return (<div className="wrap checkout pt-6 pb-12 md:pt-10 md:pb-16" data-checkout>
      <h1 className="d-2 text-ink mb-6">{t("checkout.title")}</h1>
      <CheckoutPage user={user !== null ? { id: user.customerId, firstName: user.firstName, lastName: user.lastName, phone: user.phone } : null} addresses={list} methods={methods} flags={{ checkoutEnabled: flags.checkoutEnabled }} snappEnabled={env.SNAPPPAY_ENABLED} seals={seals} pointsAvailable={user?.pointsBalance ?? 0}/>
    </div>);
}
