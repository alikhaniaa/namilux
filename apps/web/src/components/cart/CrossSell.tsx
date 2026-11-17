"use client";
import { formatToman, mediaUrl, productUrl } from "@namilux/core/client";
import { t } from "@/i18n";
import { Bdi } from "@/components/ui/Bdi";
import { useSearchIndex } from "@/components/search/useSearchIndex";

export function CrossSell({ ids }: { ids: number[] }): React.ReactNode {
  const { index } = useSearchIndex(ids.length > 0);
  if (ids.length === 0) return null;
  const items = (index ?? []).filter((e) => ids.includes(e.id)).slice(0, 8);
  if (items.length === 0) return null;
  return (
    <section className="mt-6">
      <h2 className="d-3 text-ink mb-3">{t("cart.crossSell")}</h2>
      <div className="flex gap-3 overflow-x-auto">
        {items.map((e) => (
          <a key={e.id} href={productUrl(e.slug)} className="shrink-0" style={{ inlineSize: "9rem" }}>
            <div className="plate mb-2" style={{ aspectRatio: "4 / 5" }} aria-hidden="true">
              {e.i === undefined ? null : <img src={mediaUrl(e.i)} alt="" width={144} height={180} loading="lazy" decoding="async" />}
            </div>
            <Bdi text={e.dn} className="t-caption text-ink" />
            <div className="tnum text-ink-2 t-caption">
              {e.p === 0 ? t("product.onRequest") : `${formatToman(e.p)} ${t("product.price.unit")}`}
            </div>
          </a>
        ))}
      </div>
    </section>
  );
}
