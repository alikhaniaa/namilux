import { notFound } from "next/navigation";
import { getPageAdmin } from "@namilux/core";
import type { PageInput } from "@namilux/core";
import { PageForm } from "@/components/content/PageForm";
import { PageHeader } from "@/components/kit";
import { env } from "@/env";
import { fa } from "@/i18n/fa";
import { requirePermission } from "@/lib/authz";
import { db } from "@/lib/db";

const EMPTY: PageInput = { slug: "", title: "", bodyHtml: "", template: "default", status: "draft", seoTitle: null, seoDescription: null, robots: "index, follow" };

export default async function StaticPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("content.write");
  const { id } = await params;
  if (id === "new") {
    return (
      <div>
        <PageHeader title={fa["pages.new"]} />
        <PageForm initial={EMPTY} legacySlug={false} origin={env.SITE_ORIGIN} />
      </div>
    );
  }
  const pid = Number(id);
  if (!Number.isInteger(pid) || pid <= 0) notFound();
  const row = await getPageAdmin(db, pid);
  if (row === null) notFound();
  const { legacy, ...initial } = row;
  return (
    <div>
      <PageHeader title={initial.title} subtitle={initial.slug} />
      <PageForm initial={initial} legacySlug={legacy} origin={env.SITE_ORIGIN} />
    </div>
  );
}
