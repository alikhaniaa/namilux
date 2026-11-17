import { notFound } from "next/navigation";
import { getMediaAdmin } from "@namilux/core";
import { MediaDetail } from "@/components/media/MediaDetail";
import { PageHeader } from "@/components/kit";
import { fa } from "@/i18n/fa";
import { requirePermission } from "@/lib/authz";
import { db } from "@/lib/db";

export default async function MediaDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("media.write");
  const { id } = await params;
  const m = await getMediaAdmin(db, id);
  if (m === null) notFound();
  return (
    <div className="max-w-4xl">
      <PageHeader title={fa["media.detail"]} subtitle={m.storageKey} />
      <MediaDetail media={m} />
    </div>
  );
}
