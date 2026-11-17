"use client";
import { mediaKindLabel } from "@/i18n/admin-labels";
import { useCallback, useEffect, useRef, useState } from "react";
import { Uploader } from "@/components/media/Uploader";
import { MediaThumb } from "@/components/media/MediaThumb";
import { Button, Input } from "@/components/kit";
import { Dialog } from "@/components/kit-client";
import { fa } from "@/i18n/fa";
import { api } from "@/lib/api-client";
import { type MediaPick } from "@/lib/media";

export type { MediaPick } from "@/lib/media";
export { thumbUrl } from "@/lib/media";

/** `/api/media` rows: MediaPick plus the flags that say whether the worker has finished with the file. */
export type MediaItem = MediaPick & { processed?: boolean; quarantined?: boolean };

/** One page of GET /api/media (MEDIA_PAGE_SIZE in core). */
const PAGE_SIZE = 60;

export function MediaPicker({
  open,
  onClose,
  multiple = false,
  kind = "image",
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  multiple?: boolean;
  kind?: "image" | "video";
  onSelect: (ids: string[], items: MediaItem[]) => void;
}) {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<MediaItem[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  // Every row ever loaded is remembered (latest wins) so a multi-page selection still hands the caller a
  // full preview record, and so a just-uploaded id can keep an optimistic "processing" entry.
  const cache = useRef<Map<string, MediaItem>>(new Map());
  // Monotonic request id: a slow answer for an older query/page must never overwrite the latest state.
  const seq = useRef(0);

  const load = useCallback(
    async (over?: { page?: number; q?: string }): Promise<void> => {
      const nextPage = over?.page ?? page;
      const nextQ = over?.q ?? q;
      const my = ++seq.current;
      try {
        const r = await api<{ items: MediaItem[]; total: number }>(`/api/media?kind=${kind}&q=${encodeURIComponent(nextQ)}&page=${String(nextPage)}`);
        if (my !== seq.current) return;
        setItems(r.items);
        setTotal(r.total);
        for (const it of r.items) cache.current.set(it.id, it);
      } catch {
        if (my !== seq.current) return;
        setItems([]);
        setTotal(0);
      }
    },
    [kind, q, page],
  );

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const toggle = (id: string): void => {
    if (!multiple) {
      setPicked([id]);
      return;
    }
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  };

  /**
   * Uploads are newest-first, so they surface on page 1. Keep the new ids selected (union with the
   * existing selection in multiple mode) and seed a processing placeholder until the list catches up:
   * the row exists, but `renditions_json` is still null, so there is no thumbnail to fetch yet.
   */
  const onUploaded = (ids: string[]): void => {
    for (const id of ids) {
      if (!cache.current.has(id)) cache.current.set(id, { id, storageKey: "", alt: "", image: null, kind: "image", processed: false });
    }
    setPicked((p) => (multiple ? [...p, ...ids.filter((id) => !p.includes(id))] : ids.slice(-1)));
    setPage(1);
    void load({ page: 1 });
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={fa["media.pickTitle"]}
      wide
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {fa["common.cancel"]}
          </Button>
          <Button
            disabled={picked.length === 0}
            onClick={() => {
              onSelect(
                picked,
                picked.map((id) => cache.current.get(id) ?? items.find((i) => i.id === id)).filter((i): i is MediaItem => i !== undefined),
              );
              setPicked([]);
              onClose();
            }}
          >
            {fa["media.select"]}
          </Button>
        </>
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <Input className="w-64" placeholder={fa["common.search"]} value={q} onChange={(e) => setQ(e.target.value)} />
        <Uploader compact onUploaded={onUploaded} />
        <span className="text-xs text-[var(--ink-2)]">{fa["table.total"].replace("{n}", String(total))}</span>
        {picked.length > 0 ? <span className="text-xs text-[var(--ink-2)]">{fa["table.selected"].replace("{n}", String(picked.length))}</span> : null}
      </div>
      <div className="grid max-h-[55vh] grid-cols-3 gap-2 overflow-y-auto md:grid-cols-6">
        {items.map((m) => {
          const selected = picked.includes(m.id);
          return (
            <button
              key={m.id}
              type="button"
              className={`aspect-square border-2 bg-[var(--plate)] ${selected ? "border-[var(--accent)]" : "border-transparent"}`}
              aria-pressed={selected}
              aria-label={m.alt !== "" ? m.alt : m.id}
              onClick={() => toggle(m.id)}
              title={m.alt}
            >
              {m.kind === "image" ? <MediaThumb media={m} alt={m.alt} /> : <span className="text-xs">{mediaKindLabel(m.kind)}</span>}
            </button>
          );
        })}
        {items.length === 0 ? <p className="col-span-full py-6 text-center text-sm text-[var(--ink-2)]">{fa["table.empty"]}</p> : null}
      </div>
      {total > items.length ? (
        <div className="flex justify-between text-xs">
          <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            {fa["table.prev"]}
          </Button>
          <Button size="sm" variant="ghost" disabled={page * PAGE_SIZE >= total} onClick={() => setPage((p) => p + 1)}>
            {fa["table.next"]}
          </Button>
        </div>
      ) : null}
    </Dialog>
  );
}
