import { notFound } from "next/navigation";
import { findCardSources, getCollectionAdmin, listCollections, mediaPreviews } from "@namilux/core";
import type { CollectionAdminInput } from "@namilux/core";
import { CollectionForm } from "@/components/collections/CollectionForm";
import { PageHeader } from "@/components/kit";
import { env } from "@/env";
import { fa } from "@/i18n/fa";
import { requirePermission } from "@/lib/authz";
import { db } from "@/lib/db";

const EMPTY: CollectionAdminInput = { slug: "", parentId: null, name: "", kind: "group", rule: null, productIds: [], coverMediaId: null, coverDarkMediaId: null, descriptionHtml: "", isNav: false, startsAt: null, endsAt: null, status: "draft", sort: 0, seoTitle: null, seoDescription: null, robots: "index, follow" };

export default async function CollectionPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("catalog.write");
  const { id } = await params;
  const all = await listCollections(db);
  const parents = all.map((c) => ({ id: c.id, name: c.name }));
  if (id === "new") {
    return (
      <div>
        <PageHeader title={fa["collections.new"]} />
        <CollectionForm initial={EMPTY} covers={{ light: null, dark: null }} parents={parents} productNames={{}} legacySlug={false} origin={env.SITE_ORIGIN} />
      </div>
    );
  }
  const cid = Number(id);
  if (!Number.isInteger(cid) || cid <= 0) notFound();
  const row = await getCollectionAdmin(db, cid);
  if (row === null) notFound();
  const { legacy, ...initial } = row;
  const [previews, cards] = await Promise.all([mediaPreviews(db, [initial.coverMediaId, initial.coverDarkMediaId]), (initial.productIds ?? []).length === 0 ? Promise.resolve([]) : findCardSources(db, initial.productIds ?? [])]);
  const productNames: Record<number, string> = {};
  for (const c of cards) productNames[c.id] = c.displayName;
  return (
    <div>
      <PageHeader title={initial.name} subtitle={initial.slug} />
      <CollectionForm
        initial={initial}
        covers={{ light: initial.coverMediaId ? (previews[initial.coverMediaId] ?? null) : null, dark: initial.coverDarkMediaId ? (previews[initial.coverDarkMediaId] ?? null) : null }}
        parents={parents}
        productNames={productNames}
        legacySlug={legacy}
        origin={env.SITE_ORIGIN}
      />
    </div>
  );
}
