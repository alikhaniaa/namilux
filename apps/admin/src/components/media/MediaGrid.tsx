"use client";
import { mediaKindLabel } from "@/i18n/admin-labels";
import Link from "next/link";
import { thumbUrl } from "@/lib/media";
import { Filters } from "@/components/data/Filters";
import { Pagination } from "@/components/data/Pagination";
import { EmptyState, StatusBadge } from "@/components/kit";
import { fa } from "@/i18n/fa";

export type MediaGridRow = { id: string; kind: "image" | "video" | "file"; storageKey: string; alt: string; quarantined: boolean; reason: string | null; processed: boolean; source: string; image: Parameters<typeof thumbUrl>[0]["image"] };

export function MediaGrid({ items, page, pageSize, total }: { items: MediaGridRow[]; page: number; pageSize: number; total: number }) {
  return (
    <div>
      <Filters
        defs={[
          { key: "kind", label: fa["media.kind"], kind: "select", options: [{ value: "image", label: fa["media.kind.image"] }, { value: "video", label: fa["media.kind.video"] }] },
          { key: "quarantined", label: fa["media.filter.quarantined"], kind: "bool" },
          { key: "unused", label: fa["media.filter.unused"], kind: "bool" },
          { key: "q", label: fa["common.search"], kind: "text" },
        ]}
      />
      {items.length === 0 ? (
        <EmptyState text={fa["table.empty"]} />
      ) : (
        <div className="media-grid">
          {items.map((m) => (
            <Link key={m.id} href={`/media/${m.id}`} className="media-tile" title={m.alt}>
              <span className="media-tile__img">
                {m.kind === "image" ? <img src={thumbUrl(m)} alt={m.alt} loading="lazy" /> : <span className="media-tile__kind">{mediaKindLabel(m.kind)}</span>}
              </span>
              <span className="media-tile__foot">
                <span className="media-tile__name">{m.alt || m.storageKey.split("/").at(-1)}</span>
                {m.quarantined ? <StatusBadge tone="warn">{fa["media.quarantined"]}</StatusBadge> : !m.processed ? <StatusBadge tone="muted">{fa["media.pending"]}</StatusBadge> : null}
              </span>
            </Link>
          ))}
        </div>
      )}
      <Pagination page={page} pageSize={pageSize} total={total} />
    </div>
  );
}
