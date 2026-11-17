import { notFound } from "next/navigation";
import { getBannerAdmin, mediaPreviews } from "@namilux/core";
import type { BannerInput } from "@namilux/core";
import { BannerForm } from "@/components/marketing/BannerForm";
import { PageHeader } from "@/components/kit";
import { fa } from "@/i18n/fa";
import { requirePermission } from "@/lib/authz";
import { db } from "@/lib/db";

const EMPTY: BannerInput = { slot: "home_hero", title: "", subtitle: null, ctaLabel: null, ctaHref: null, mediaLightId: null, mediaDarkId: null, theme: "auto", startsAt: null, endsAt: null, isActive: true, sort: 0, targeting: null };

export default async function BannerPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("marketing.banners");
  const { id } = await params;
  if (id === "new") {
    return (
      <div>
        <PageHeader title={fa["banners.new"]} />
        <BannerForm initial={EMPTY} media={{ light: null, dark: null }} backHref="/marketing/banners" />
      </div>
    );
  }
  const bid = Number(id);
  if (!Number.isInteger(bid) || bid <= 0) notFound();
  const initial = await getBannerAdmin(db, bid);
  if (initial === null) notFound();
  const previews = await mediaPreviews(db, [initial.mediaLightId, initial.mediaDarkId]);
  return (
    <div>
      <PageHeader title={initial.title} subtitle={initial.slot} />
      <BannerForm initial={initial} media={{ light: initial.mediaLightId ? (previews[initial.mediaLightId] ?? null) : null, dark: initial.mediaDarkId ? (previews[initial.mediaDarkId] ?? null) : null }} backHref="/marketing/banners" />
    </div>
  );
}
