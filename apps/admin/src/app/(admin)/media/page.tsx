import { MEDIA_PAGE_SIZE, listMedia } from "@namilux/core";
import { MediaGrid } from "@/components/media/MediaGrid";
import { NormalizationQa } from "@/components/media/NormalizationQa";
import { Uploader } from "@/components/media/Uploader";
import { PageHeader } from "@/components/kit";
import { fa } from "@/i18n/fa";
import { requirePermission } from "@/lib/authz";
import { db } from "@/lib/db";

type SP = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

export default async function MediaPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requirePermission("media.write");
  const sp = await searchParams;
  const kind = first(sp.kind);
  const q: Parameters<typeof listMedia>[1] = { page: Math.max(1, Number(first(sp.page)) || 1) };
  const search = first(sp.q);
  if (search !== undefined && search.trim() !== "") q.q = search;
  if (kind === "image" || kind === "video" || kind === "file") q.kind = kind;
  if (first(sp.quarantined) === "1") q.quarantined = true;
  if (first(sp.unused) === "1") q.unused = true;
  const [list, qa] = await Promise.all([listMedia(db, q), listMedia(db, { quarantined: true, page: 1 })]);
  return (
    <div>
      <PageHeader title={fa["media.title"]} />
      <Uploader />
      {qa.items.length > 0 ? (
        <section className="my-4">
          <NormalizationQa items={qa.items} />
        </section>
      ) : null}
      <MediaGrid items={list.items} page={list.page} pageSize={MEDIA_PAGE_SIZE} total={list.total} />
    </div>
  );
}
