import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import { t } from "@/i18n";
export function InstalmentBar({ enabled }: { enabled: boolean }): React.ReactNode {
  if (!enabled) return null;
  return <aside className="frame instalment-bar hairline-b" aria-label={t("instalments.bar")}>
    <Link className="wrap instalment-bar__row" href="/shop/">
      <span className="instalment-bar__mark" aria-hidden="true"><Icon name="shop" size={16} /></span>
      <span className="instalment-bar__text">{t("instalments.bar")}</span>
      <span className="instalment-bar__sub">{t("instalments.bar.here")}</span>
      <span className="instalment-bar__cta">{t("instalments.cta")}<Icon name="arrow-e" size={16} /></span>
    </Link>
  </aside>;
}
