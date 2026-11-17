import { notFound } from "next/navigation";
import { getBrandAdmin, mediaPreviews } from "@namilux/core";
import type { BrandAdminInput } from "@namilux/core";
import { BrandForm } from "@/components/brands/BrandForm";
import { PageHeader } from "@/components/kit";
import { env } from "@/env";
import { fa } from "@/i18n/fa";
import { requirePermission } from "@/lib/authz";
import { db } from "@/lib/db";

const EMPTY: BrandAdminInput = { slug: "", nameFa: "", nameEn: "", logoMediaId: null, storyHtml: "", claim: null, isActive: true, sort: 0, seoTitle: null, seoDescription: null, robots: "index, follow" };

export default async function BrandPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("catalog.write");
  const { id } = await params;
  if (id === "new") {
    return (
      <div>
        <PageHeader title={fa["brands.new"]} />
        <BrandForm initial={EMPTY} logo={null} legacySlug={false} origin={env.SITE_ORIGIN} />
      </div>
    );
  }
  const bid = Number(id);
  if (!Number.isInteger(bid) || bid <= 0) notFound();
  const row = await getBrandAdmin(db, bid);
  if (row === null) notFound();
  const { legacy, ...initial } = row;
  const previews = await mediaPreviews(db, [initial.logoMediaId]);
  const logo = initial.logoMediaId ? (previews[initial.logoMediaId] ?? null) : null;
  return (
    <div>
      <PageHeader title={initial.nameFa} subtitle={initial.nameEn} />
      <BrandForm initial={initial} logo={logo} legacySlug={legacy} origin={env.SITE_ORIGIN} />
    </div>
  );
}
