import { notFound } from "next/navigation";
import { findCardSources, getPostAdmin, mediaPreviews } from "@namilux/core";
import type { PostInput } from "@namilux/core";
import { PostForm } from "@/components/content/PostForm";
import { PageHeader } from "@/components/kit";
import { env } from "@/env";
import { fa } from "@/i18n/fa";
import { requirePermission } from "@/lib/authz";
import { db } from "@/lib/db";

const EMPTY: PostInput = { slug: "", title: "", excerpt: "", bodyHtml: "", coverMediaId: null, tags: [], status: "draft", publishedAt: null, relatedProductIds: [], seoTitle: null, seoDescription: null, robots: "index, follow" };

export default async function PostPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("content.write");
  const { id } = await params;
  if (id === "new") {
    return (
      <div>
        <PageHeader title={fa["posts.new"]} />
        <PostForm initial={EMPTY} cover={null} relatedNames={{}} legacySlug={false} origin={env.SITE_ORIGIN} />
      </div>
    );
  }
  const pid = Number(id);
  if (!Number.isInteger(pid) || pid <= 0) notFound();
  const row = await getPostAdmin(db, pid);
  if (row === null) notFound();
  const { legacy, ...initial } = row;
  const [previews, cards] = await Promise.all([mediaPreviews(db, [initial.coverMediaId]), initial.relatedProductIds.length === 0 ? Promise.resolve([]) : findCardSources(db, initial.relatedProductIds)]);
  const relatedNames: Record<number, string> = {};
  for (const c of cards) relatedNames[c.id] = c.displayName;
  return (
    <div>
      <PageHeader title={initial.title} subtitle={initial.slug} />
      <PostForm initial={initial} cover={initial.coverMediaId ? (previews[initial.coverMediaId] ?? null) : null} relatedNames={relatedNames} legacySlug={legacy} origin={env.SITE_ORIGIN} />
    </div>
  );
}
