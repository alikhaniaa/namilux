import { normalizePhone, whatsappUrl } from "@namilux/core/client";
import type { ImageRef, StoreInfo } from "@namilux/core/client";
import { Icon } from "@/components/ui/Icon";
import { Img } from "@/components/ui/Img";
import { t } from "@/i18n";

export function StoreChapter({ store, photo }: { store: StoreInfo; photo?: ImageRef }): React.ReactNode {
  // DECISION: the photograph is a separate optional prop, not a StoreInfo field. The header lists
  // `photo?: ImageRef` but no settings key and no banner slot holds a store picture (see the
  // DECISION at the StoreInfo declaration in core/types) - the Tehran storefront photo is design
  // photography owned by apps/web, so the page hands it in.
  // A malformed or empty whatsapp setting must not throw inside a render path: whatsappUrl only
  // accepts a normalized 09XXXXXXXXX number.
  const whatsapp = normalizePhone(store.whatsapp);
  const maps = store.mapsUrl.trim();

  return (
    <section data-reveal className={`frame store-chapter below-fold${photo === undefined ? " store-chapter--text" : " chapter"}`} aria-label={t("nav.store")}>
      {photo === undefined ? null : (
        <div className="relative aspect-[4/5] w-full overflow-hidden md:aspect-[21/9]">
          <Img image={photo} slot="band" alt="" className="band__img absolute inset-0 h-full w-full object-cover" />
        </div>
      )}

      <div className="wrap store-chapter__grid">
        <div className="grid gap-3">
          <p className="label-fa text-frame-ink-2">{t("home.store.kicker")}</p>
          <h2 className="d-2 text-frame-ink">{store.name}</h2>

          {/* v2 §9.4: the physical shop is the trust asset - the address is copy, not a map widget. */}
          <p className="t-lead max-w-[52ch] text-frame-ink-2">{store.address}</p>
          {store.hours === "" ? null : (
            <p className="t-sm text-frame-ink-2">
              {t("page.store.hours")} · {store.hours}
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3 md:justify-end md:self-end">
          {/* The recipe classes are used directly because these two leave the site: a Next <Link>
              carries no target/rel, and an external tab needs rel="noopener". */}
          {maps === "" ? null : (
            <a href={maps} target="_blank" rel="noopener noreferrer" className="btn btn--primary">
              <Icon name="location" size={20} />
              {t("home.store.cta")}
            </a>
          )}
          {whatsapp === null ? null : (
            <a
              href={whatsappUrl(whatsapp)}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn--secondary"
            >
              <Icon name="whatsapp" size={20} />
              {t("product.whatsapp")}
            </a>
          )}
        </div>
      </div>
    </section>
  );
}
