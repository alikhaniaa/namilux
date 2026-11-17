import type { SealEmbed } from "@namilux/core/client";
import { SEAL_ORIGINS } from "@/security/headers";
import { t } from "@/i18n";

type Seal = SealEmbed | null;

/** The seals are the only cross-origin images the CSP allows; verify the host here as well. */
function allowed(url: string): boolean {
  try {
    return (SEAL_ORIGINS as readonly string[]).includes(new URL(url).origin);
  } catch {
    return false;
  }
}

function valid(seal: Seal): seal is SealEmbed {
  return seal !== null && allowed(seal.img) && allowed(seal.href);
}

/**
 * `referrerPolicy="origin"`, not "no-referrer": eNamad's server decides whether to draw the badge
 * from the Referer of the image request, and a request with none is answered with the "not
 * registered" mark. "origin" sends the site root and nothing else - no path, no query - which is
 * the least the badge can be shown for. It goes on the ANCHOR as well as the image, because the
 * verification page reads the same header; both are in eNamad's own embed.
 *
 * `code` is likewise the attribute eNamad's embed puts on the `<img>`; it is `null` for Samandehi,
 * whose snippet has none, and is rendered verbatim (the parser only ever reads alphanumerics).
 */
function SealMark({ seal, label }: { seal: SealEmbed; label: string }): React.ReactNode {
  return (
    <a href={seal.href} target="_blank" rel="noopener" referrerPolicy="origin" aria-label={label}>
      <img
        src={seal.img}
        alt={label}
        width={80}
        height={80}
        loading="lazy"
        referrerPolicy="origin"
        {...(seal.code === null ? {} : { code: seal.code })}
      />
    </a>
  );
}

export function TrustSealsFooter({
  enamad,
  samandehi,
  gatewayMark = true,
  gateway = "zarinpal",
}: {
  enamad: Seal;
  samandehi: Seal;
  gatewayMark?: boolean;
  /** The site's gateway, so the instalment site never names ZarinPal. */
  gateway?: "zarinpal" | "snapppay";
}): React.ReactNode {
  const e = valid(enamad) ? enamad : null;
  const s = valid(samandehi) ? samandehi : null;
  if (e === null && s === null) return null;
  return (
    <div className="flex flex-col items-center gap-3 py-6 text-center">
      <div className="flex flex-wrap items-center justify-center gap-4">
        {e === null ? null : <SealMark seal={e} label={t("footer.seal.enamad")} />}
        {s === null ? null : <SealMark seal={s} label={t("footer.seal.samandehi")} />}
      </div>
      {gatewayMark ? <span className="t-xs text-frame-ink-2">{t(gateway === "snapppay" ? "footer.seal.gateway.snapppay" : "footer.seal.gateway")}</span> : null}
    </div>
  );
}
