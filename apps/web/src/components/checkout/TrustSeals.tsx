import type { SealEmbed } from "@namilux/core/client";
import { t } from "@/i18n";

type Seal = SealEmbed | null;

/**
 * `referrerPolicy="origin"` on both badges, on the anchor as well as the image - the seal's own
 * server decides whether to draw the badge from the Referer of the request, and answers one without
 * a Referer with the "not registered" mark. "origin" sends the site root and nothing else, which
 * matters here: the checkout URL must never leave the site. Same rule as shell/TrustSealsFooter.tsx,
 * and `code` is the attribute eNamad's own embed carries on the <img>.
 */
function SealMark({ seal, label }: { seal: SealEmbed; label: string }): React.ReactNode {
  return (
    <a href={seal.href} target="_blank" rel="noopener" referrerPolicy="origin">
      <img
        src={seal.img}
        alt={label}
        height={48}
        referrerPolicy="origin"
        {...(seal.code === null ? {} : { code: seal.code })}
      />
    </a>
  );
}

export function TrustSeals({ enamad, samandehi }: { enamad: Seal; samandehi: Seal }): React.ReactNode {
  return (
    <div className="flex flex-col gap-2 items-start">
      <p className="t-caption text-ink-2">{t("cart.trust")}</p>
      <div className="flex gap-3 items-center">
        {enamad === null ? null : <SealMark seal={enamad} label={t("footer.seal.enamad")} />}
        {samandehi === null ? null : <SealMark seal={samandehi} label={t("footer.seal.samandehi")} />}
      </div>
    </div>
  );
}
