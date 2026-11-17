import { getAllBanners, getSettings } from "@namilux/core";
import { PromoBarEditor } from "@/components/marketing/PromoBarEditor";
import { PROMO_T } from "@/components/marketing/promo-bar-copy";
import { PageHeader } from "@/components/kit";
import { fa } from "@/i18n/fa";
import { requirePermission } from "@/lib/authz";
import { db } from "@/lib/db";

export default async function PromoPage() {
  await requirePermission("marketing.banners");
  // every promo_bar row: the editor must see switched-off, scheduled and expired messages too
  const [messages, settings] = await Promise.all([getAllBanners(db, "promo_bar"), getSettings(db)]);
  return (
    <div className="max-w-4xl">
      <PageHeader title={fa["nav.promo"]} subtitle={PROMO_T.pageSubtitle} />
      <PromoBarEditor messages={messages} settings={settings["promo.bar"]} />
    </div>
  );
}
