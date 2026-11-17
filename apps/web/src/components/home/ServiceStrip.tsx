import { pageUrl } from "@namilux/core/client";
import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import type { IconName } from "@/components/ui/Icon";
import { t } from "@/i18n";
import type { FaKey } from "@/i18n";

// v2 §10.2: each promise has one home. This strip is that home for all three TOGETHER - no other
// module may repeat the set (the PDP trust list and the footer each carry one of them alone).
// The two page links are minted by the url layer, never hand-written.
const ITEMS: { key: FaKey; icon: IconName; href: string | null }[] = [
  { key: "home.service.shipping", icon: "truck", href: pageUrl("shipping-returns") },
  { key: "home.service.authenticity", icon: "shield", href: pageUrl("warranty") },
  // null = the concierge promise IS the WhatsApp conversation, so its href is the prop.
  { key: "home.service.concierge", icon: "chat", href: null },
];

const ROW = "t-sm flex items-center justify-center gap-2 text-ink-2";

export function ServiceStrip({ whatsappHref }: { whatsappHref: string }): React.ReactNode {
  return (
    // The strip is the --bg-soft step of the §9.1 rhythm; block tier spacing (24 / 32).
    <section data-reveal>
      <ul className="wrap service-strip">
        {ITEMS.map((item) => {
          const label = t(item.key);
          const inner = (
            <>
              <Icon name={item.icon} size={20} />
              {label}
            </>
          );
          if (item.href !== null) {
            return (
              <li key={item.key}>
                <Link href={item.href} className={`${ROW} link-under`}>
                  {inner}
                </Link>
              </li>
            );
          }
          // DECISION: with no WhatsApp number configured the promise is still stated, as text - 
          // a dead link on the most-seen module of the site is worse than a plain sentence.
          return (
            <li key={item.key}>
              {whatsappHref === "" ? (
                <span className={ROW}>{inner}</span>
              ) : (
                <a href={whatsappHref} target="_blank" rel="noopener noreferrer" className={`${ROW} link-under`}>
                  {inner}
                </a>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
