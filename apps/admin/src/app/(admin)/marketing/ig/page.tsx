import { IgLandingEditor } from "@/components/marketing/IgLandingEditor";
import { PageHeader } from "@/components/kit";
import { fa } from "@/i18n/fa";
import { requirePermission } from "@/lib/authz";
import { db } from "@/lib/db";
import { listIgCards } from "@/lib/ig-service";

export default async function IgPage() {
  await requirePermission("marketing.banners");
  // Every card in the slot, inactive and scheduled ones included: the save replaces the slot with
  // exactly what the editor holds, so a card the editor never shows would be deleted by it.
  const cards = await listIgCards(db);
  return (
    <div>
      <PageHeader title={fa["nav.ig"]} subtitle={fa["ig.cards"]} />
      <IgLandingEditor cards={cards} />
    </div>
  );
}
