import "server-only";
import { getBanners, getNavData, getSettings, tags } from "@namilux/core";
import type { NavData } from "@namilux/core";
import { tagCatalog } from "@/lib/cache";
import { db } from "@/lib/db";
export type ShellNav = NavData & {
    promo: {
        text: string;
        href: string | null;
    }[];
    footer: {
        store: {
            address: string;
            phoneLand: string;
            phoneMobile: string;
            whatsapp: string;
            mapUrl: string;
            hoursNote: string;
        };
        seals: {
            enamad: string;
            samandehi: string;
        };
    };
};
/**
 * The nav and the promo line share one cache entry: they are rendered together in every response,
 * and a promo message going live must also be able to expire the header it sits above. The
 * `"use cache"` directive lives here rather than in a wrapper - see the DEVIATION in lib/cache.ts.
 *
 * DECISION: `getBanners` is called with no `at`, so the live window is evaluated at render time
 * inside the cached scope; `promo.bar.rotateSec` and the message list therefore change no later
 * than the "hours" lifetime, and an admin edit revalidates the `nav` tag immediately.
 */
export async function loadNav(): Promise<ShellNav> {
    "use cache";
    tagCatalog([tags.nav, tags.content]);
    // DECISION: `getSettings(db)` directly, not `loadSettings()`. Entering one `"use cache"` scope
    // from inside another makes Next join a promise across scopes - it reports the entry as "stuck on
    // shared state from the outer render scope" and the request hangs. `"use cache"` already dedupes
    // by arguments within a request, so the inner wrapper buys nothing here.
    const [nav, settings, promoBanners] = await Promise.all([
        getNavData(db),
        getSettings(db),
        getBanners(db, "promo_bar"),
    ]);
    const contact = settings["store.contact"];
    return {
        ...nav,
        promo: settings["promo.bar"].enabled
            ? promoBanners.map((b) => ({ text: b.title, href: b.ctaHref }))
            : [],
        footer: {
            store: {
                address: contact.address,
                phoneLand: contact.phoneLand,
                phoneMobile: contact.phoneMobile,
                whatsapp: contact.whatsapp,
                mapUrl: contact.mapUrl,
                hoursNote: settings["store.hours"].note,
            },
            // Each storefront is a separate domain, and both seals are issued PER DOMAIN: the instalment
            // site must show its own eNamad/Samandehi codes or the badge's own server refuses to draw it.
            // An empty code on either site means that site simply shows no seal (Footer drops it).
            seals: {
                enamad: settings["seals.enamad_code"],
                samandehi: settings["seals.samandehi_code"],
            },
        },
    };
}
