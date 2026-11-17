"use client";
import { useState } from "react";
import type { ProductAdminInput } from "@namilux/core/client";
import { faInt } from "@namilux/core/client";
import { MediaPicker } from "@/components/forms/MediaPicker";
import { MediaThumb } from "@/components/media/MediaThumb";
import type { MediaPick } from "@/lib/media";
import type { FormApi } from "@/components/forms/Form";
import { Button, Input, Select } from "@/components/kit";
import { toast } from "@/components/kit-client";
import { fa } from "@/i18n/fa";

type Img = ProductAdminInput["images"][number];
export type ImagePreview = Record<string, { storageKey: string; image: MediaPick["image"]; processed?: boolean }>;

const MAX_IMAGES = 30;
/** No i18n key exists yet for the gallery cap; inline Persian for now (Opus consolidates later). */
const FULL_FA = "حداکثر ۳۰ تصویر";

export function TabImages({ f, previews }: { f: FormApi<ProductAdminInput>; previews: ImagePreview }) {
  const [open, setOpen] = useState(false);
  const [local, setLocal] = useState<ImagePreview>(previews);
  const images = f.values.images;
  const full = images.length >= MAX_IMAGES;

  function update(next: Img[]): void {
    f.set("images", next.map((im, i) => ({ ...im, sort: i })));
  }
  /** Exactly one explicit primary: choosing it on a row demotes whoever held it before. */
  function setRole(i: number, role: Img["role"]): void {
    update(images.map((x, j) => (j === i ? { ...x, role } : role === "primary" && x.role === "primary" ? { ...x, role: "gallery" } : x)));
  }
  function remove(i: number): void {
    const next = images.filter((_, j) => j !== i);
    // Removing the primary must not leave the gallery without one: promote the first survivor.
    if (images[i]?.role === "primary") {
      const first = next[0];
      if (first !== undefined) next[0] = { ...first, role: "primary" };
    }
    update(next);
  }
  function move(i: number, dir: -1 | 1): void {
    const j = i + dir;
    if (j < 0 || j >= images.length) return;
    const next = [...images];
    const a = next[i];
    const b = next[j];
    if (a === undefined || b === undefined) return;
    next[i] = b;
    next[j] = a;
    update(next);
  }

  return (
    <div className="space-y-3">
      <ul className="space-y-2">
        {images.map((im, i) => {
          const p = local[im.mediaId] ?? previews[im.mediaId];
          const label = faInt(i + 1);
          return (
            <li key={im.mediaId} className="flex flex-wrap items-center gap-3 border border-[var(--line)] p-2">
              <div className="h-16 w-16 shrink-0 bg-[var(--bg)]">
                <MediaThumb media={p} alt={im.alt} />
              </div>
              <div className="grid flex-1 gap-2 md:grid-cols-[12rem_1fr]">
                <div className="flex items-center gap-3">
                  <label className="flex shrink-0 items-center gap-1 text-sm">
                    <input type="radio" name="product-primary-image" className="h-4 w-4" checked={im.role === "primary"} onChange={() => setRole(i, "primary")} />
                    <span>{fa["products.images.primary"]}</span>
                  </label>
                  <Select className="flex-1" aria-label={fa["products.images.role"]} value={im.role} onChange={(e) => setRole(i, e.target.value as Img["role"])}>
                    <option value="primary">{fa["products.images.primary"]}</option>
                    <option value="gallery">{fa["products.images.gallery"]}</option>
                    <option value="editorial">{fa["products.images.editorial"]}</option>
                  </Select>
                </div>
                <Input
                  aria-label={fa["products.images.alt"]}
                  placeholder={fa["products.images.alt"]}
                  value={im.alt}
                  onChange={(e) => update(images.map((x, j) => (j === i ? { ...x, alt: e.target.value } : x)))}
                  maxLength={200}
                />
              </div>
              <div className="flex shrink-0 gap-1">
                <Button size="sm" variant="ghost" onClick={() => move(i, -1)} disabled={i === 0} title={fa["products.images.up"]} aria-label={`${fa["products.images.up"]} (${label})`}>
                  ↑
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => move(i, 1)}
                  disabled={i === images.length - 1}
                  title={fa["products.images.down"]}
                  aria-label={`${fa["products.images.down"]} (${label})`}
                >
                  ↓
                </Button>
                <Button size="sm" variant="ghost" onClick={() => remove(i)} title={fa["products.images.remove"]} aria-label={`${fa["products.images.remove"]} (${label})`}>
                  {fa["products.images.remove"]}
                </Button>
              </div>
            </li>
          );
        })}
        {images.length === 0 ? <li className="p-4 text-center text-sm text-[var(--ink-2)]">{fa["table.empty"]}</li> : null}
      </ul>
      <div className="flex items-center gap-3">
        <Button variant="outline" onClick={() => setOpen(true)} disabled={full} title={full ? FULL_FA : undefined}>
          {fa["products.images.add"]}
        </Button>
        <span className="text-xs text-[var(--ink-2)]">
          {faInt(images.length)} / {faInt(MAX_IMAGES)}
        </span>
        {full ? <span className="text-xs text-[var(--ink-2)]">{FULL_FA}</span> : null}
      </div>
      <MediaPicker
        open={open}
        onClose={() => setOpen(false)}
        multiple
        onSelect={(ids, items) => {
          const existing = new Set(images.map((x) => x.mediaId));
          const freshIds = [...new Set(ids)].filter((id) => !existing.has(id));
          const accepted = freshIds.slice(0, Math.max(0, MAX_IMAGES - images.length));
          if (accepted.length < freshIds.length) toast(FULL_FA, "error");

          const add: ImagePreview = {};
          for (const id of accepted) {
            const it = items.find((x) => x.id === id);
            if (it === undefined) continue;
            // A row that is still processing has `image === null`; keep that fact so the cell renders the
            // processing placeholder instead of requesting a master file the worker has not published yet.
            add[id] = { storageKey: it.storageKey, image: it.image, processed: it.processed ?? (it.image !== null) };
          }
          setLocal((l) => ({ ...l, ...add }));

          const hasPrimary = images.some((x) => x.role === "primary");
          const fresh = accepted.map(
            (id, k): Img => ({
              mediaId: id,
              role: !hasPrimary && k === 0 ? "primary" : "gallery",
              sort: images.length + k,
              alt: items.find((x) => x.id === id)?.alt ?? "",
            }),
          );
          if (fresh.length > 0) update([...images, ...fresh]);
          setOpen(false);
        }}
      />
    </div>
  );
}
