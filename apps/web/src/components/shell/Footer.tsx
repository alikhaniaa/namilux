import { enamadSeal, GATEWAY_FOR_CHANNEL, samandehiSeal } from "@namilux/core/client";
import type { MenuItem } from "@namilux/core";
import Link from "next/link";
import { shopPhones } from "./contact";
import { NewsletterForm } from "./NewsletterForm";
import { TrustSealsFooter } from "./TrustSealsFooter";
import { Wordmark } from "./Wordmark";
import { Icon } from "@/components/ui/Icon";
import { t } from "@/i18n";
import type { FaKey } from "@/i18n";
import { CHANNEL } from "@/lib/channel";
const COLUMNS: {
    key: string;
    title: FaKey;
}[] = [
    { key: "footer_shop", title: "footer.shop" },
    { key: "footer_help", title: "footer.help" },
    { key: "about", title: "footer.about" },
    { key: "account", title: "footer.account" },
];
export function Footer({ menus, store, seals, instagram, }: {
    menus: Record<string, MenuItem[]>;
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
    /** Instagram handle from settings store.social (empty = no row). */
    instagram?: string;
}): React.ReactNode {
    const ig = (instagram ?? "").trim().replace(/^@/, "");
    // Landline first, then the mobile - one rule for the whole storefront (shell/contact.ts).
    const phones = shopPhones(store);
    return (<footer className="frame site-footer">
      {/* Newsletter / SMS opt-in with its stated benefit. */}
      <div className="wrap footer-optin grid gap-4 md:grid-cols-2 md:items-end">
        <div className="grid gap-1">
          <h2 className="label-fa text-frame-ink">{t("footer.newsletter.title")}</h2>
          <p className="t-sm text-frame-ink-2">{t("footer.newsletter.body")}</p>
        </div>
        <NewsletterForm />
      </div>
      <div className="wrap hairline-t footer-block grid gap-8 md:grid-cols-4">
        {COLUMNS.map((col) => {
            const items = menus[col.key] ?? [];
            if (items.length === 0)
                return null;
            return (<nav key={col.key}>
              <h2 className="label-fa text-frame-ink">{t(col.title)}</h2>
              <ul className="mt-3 grid gap-2">
                {items.map((item) => (<li key={item.href}>
                    <Link href={item.href} className="t-sm text-frame-ink-2">
                      {item.label}
                    </Link>
                  </li>))}
              </ul>
            </nav>);
        })}
      </div>

      {/* Store block - the only place the address and the two numbers appear in the shell. */}
      <div className="wrap hairline-t footer-block footer-store grid gap-4 md:grid-cols-2">
        <div className="grid gap-2">
          <h2 className="label-fa text-frame-ink">{t("footer.store")}</h2>
          {store.mapUrl === "" ? (<p className="t-sm text-frame-ink-2">{store.address}</p>) : (<a href={store.mapUrl} target="_blank" rel="noopener noreferrer" className="t-sm flex items-start gap-2 text-frame-ink-2">
              <Icon name="location" size={20}/>
              {store.address}
            </a>)}
          <p className="t-sm text-frame-ink-2">{store.hoursNote}</p>
        </div>
        <div className="grid content-start gap-2">
          {/* Persian digits for the reader, E.164 inside the href so the dialer understands it - 
            built by core's `iranTelUrl`, which takes the landline as well as the mobile and
            answers null for a setting nobody could dial. */}
          {phones.map((phone) => (<a key={phone.href} href={phone.href} className="t-sm flex items-center gap-2 text-frame-ink-2">
              <Icon name="phone" size={20}/>
              <bdi dir="ltr">{phone.display}</bdi>
            </a>))}
          <a href={`https://wa.me/${store.whatsapp}`} target="_blank" rel="noopener noreferrer" className="t-sm flex items-center gap-2 text-frame-ink-2">
            <Icon name="whatsapp" size={20}/>
            {t("product.whatsapp")}
          </a>
          {ig === "" ? null : (<a href={`https://instagram.com/${encodeURIComponent(ig)}`} target="_blank" rel="noopener noreferrer" className="t-sm flex items-center gap-2 text-frame-ink-2">
              <Icon name="instagram" size={20}/>
              {t("footer.instagram")}
            </a>)}
          {/* v2 §10.2 - each promise has exactly one home in the shell; these two live here. */}
          <p className="t-sm text-frame-ink-2">{t("footer.shipping")}</p>
          <p className="t-sm text-frame-ink-2">{t("footer.authenticity")}</p>
          {null}
        </div>
      </div>

      <div className="wrap">
        <TrustSealsFooter
    // Both badges need TWO values, and the setting holds whatever the owner pasted - the
    // whole snippet or the pair. `@namilux/core` reads it; TrustSealsFooter still re-checks
    // the host of everything it is handed.
    enamad={enamadSeal(seals.enamad)} samandehi={samandehiSeal(seals.samandehi)} gateway={GATEWAY_FOR_CHANNEL[CHANNEL]}/>
      </div>

    <div className="wrap hairline-t flex items-center justify-between gap-4 py-5">
        <Wordmark size="sm"/>
        <p className="t-xs text-frame-ink-2">{t("footer.copyright", { year: "۱۴۰۵" })}</p>
      </div>
    </footer>);
}
