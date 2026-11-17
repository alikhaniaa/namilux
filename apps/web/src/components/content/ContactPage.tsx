import { faDigits, normalizePhone, whatsappUrl } from "@namilux/core/client";
import { shopPhones } from "@/components/shell/contact";
import type { PageView, StoreInfo } from "@namilux/core/client";
import { ContactForm } from "./ContactForm";
import { PageBody } from "./PageBody";
import { Icon } from "@/components/ui/Icon";
import { t } from "@/i18n";

export function ContactPage({ page, store }: { page: PageView; store: StoreInfo }): React.ReactNode {
  // A malformed or empty whatsapp setting must not throw inside a render path (same guard as the
  // home store chapter): `whatsappUrl` only accepts a normalized 09XXXXXXXXX number.
  const whatsapp = normalizePhone(store.whatsapp);
  const maps = store.mapsUrl.trim();

  return (
    <>
      {/* the spec: the single <h1> is the page's own title, and it comes from PageBody. */}
      <PageBody page={page} />

      <section className="wrap section grid gap-7 md:grid-cols-2">
        <div className="grid content-start gap-5">
          {/* DECISION: «تماس» is fa.ts's one label for calling (the spec, one label per action
              site-wide), so this card reuses `product.call` rather than adding a second word. */}
          <div className="grid gap-2">
            <h2 className="label-fa flex items-center gap-2 text-ink-3">
              <Icon name="phone" size={20} />
              {t("product.call")}
            </h2>
            <ul className="grid gap-1">
              {shopPhones(store).map((phone) => (
                <li key={phone.href} className="t-body"><a href={phone.href}><bdi dir="ltr">{phone.display}</bdi></a></li>
              ))}
            </ul>
          </div>

          <div className="grid gap-2">
            <h2 className="label-fa flex items-center gap-2 text-ink-3">
              <Icon name="location" size={20} />
              {store.name}
            </h2>
            <p className="t-body">{store.address}</p>
            {/* This link leaves the site, so it is an <a> with rel="noopener" - a Next <Link>
                carries neither target nor rel. */}
            {maps === "" ? null : (
              <a href={maps} target="_blank" rel="noopener noreferrer" className="link-under t-sm justify-self-start">
                {t("page.store.directions")}
              </a>
            )}
          </div>

          {store.hours.trim() === "" ? null : (
            <div className="grid gap-2">
              <h2 className="label-fa text-ink-3">{t("page.store.hours")}</h2>
              {/* Settings copy can still hold Latin digits; no number reaches the page unfolded. */}
              <p className="t-body">{faDigits(store.hours)}</p>
            </div>
          )}

          {whatsapp === null ? null : (
            <a
              href={whatsappUrl(whatsapp)}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn--secondary justify-self-start"
            >
              <Icon name="whatsapp" size={20} />
              {t("product.whatsapp")}
            </a>
          )}
        </div>

        <ContactForm />
      </section>
    </>
  );
}
