import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import type { IconName } from "@/components/ui/Icon";
import { t } from "@/i18n";
import type { FaKey } from "@/i18n";

export function AccountEmpty({ icon, title, body, shop = true }: { icon: IconName; title: FaKey; body?: FaKey; shop?: boolean }): React.ReactNode {
  return <div className="account-empty"><span className="account-empty__icon"><Icon name={icon} size={24} /></span><h2>{t(title)}</h2>{body === undefined ? null : <p>{t(body)}</p>}{shop ? <Link href="/shop/" className="btn btn--secondary">{t("account.browse")}<Icon name="arrow-e" size={16} /></Link> : null}</div>;
}
