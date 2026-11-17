"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowUp, ImagePlus, Plus, X } from "lucide-react";
import type { Banner } from "@namilux/core/client";

import { MediaPicker } from "@/components/forms/MediaPicker";
import { type MediaPick, thumbUrl } from "@/lib/media";
import { Button, Input, Switch } from "@/components/kit";
import { toast } from "@/components/kit-client";
import { fa } from "@/i18n/fa";
import { IG } from "@/i18n/admin-guidance";
import { ApiError, api } from "@/lib/api-client";
import { adminImg } from "@/lib/media";

type Card = { id?: number; title: string; subtitle: string | null; ctaHref: string | null; mediaLightId: string | null; preview: string | null; isActive: boolean };

export function IgLandingEditor({ cards }: { cards: (Banner & { mediaLightId: string | null })[] }) {
  const router = useRouter();
  const [rows, setRows] = useState<Card[]>(cards.map((c) => ({ id: c.id, title: c.title, subtitle: c.subtitle, ctaHref: c.ctaHref, mediaLightId: c.mediaLightId, preview: c.mediaLight === null ? null : adminImg(c.mediaLight, 320), isActive: c.isActive })));
  const [pick, setPick] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(): Promise<void> {
    setBusy(true);
    try {
      const result = await api<{ ids: number[] }>("/api/ig", {
        method: "PUT",
        body: {
          cards: rows.map((r, i) => ({
            ...(r.id === undefined ? {} : { id: r.id }),
            slot: "ig_landing",
            title: r.title,
            subtitle: r.subtitle === "" ? null : r.subtitle,
            ctaLabel: r.ctaHref ? fa["common.open"] : null,
            ctaHref: r.ctaHref === "" ? null : r.ctaHref,
            mediaLightId: r.mediaLightId,
            theme: "auto",
            isActive: r.isActive,
            sort: i,
          })),
        },
      });
      setRows((saved) => saved.map((row, index) => {
        const id = result.ids[index];
        return id === undefined ? row : { ...row, id };
      }));
      toast(fa["ig.saved"]);
      router.refresh();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : fa["common.error"], "error");
    } finally {
      setBusy(false);
    }
  }
  const upd = (i: number, patch: Partial<Card>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <fieldset disabled={busy} className="m-0 min-w-0 space-y-4 border-0 p-0">
      <p className="text-xs text-[var(--ink-2)]">{IG.help}</p>
      <ul className="ig-grid">
        {rows.map((r, i) => (
          <li key={r.id ?? `n${String(i)}`} className="ig-card">
            <button type="button" className="ig-card__media" data-empty={r.preview === null || undefined} aria-label={IG.image} title={IG.image} onClick={() => setPick(i)}>
              {r.preview !== null ? (
                <img src={r.preview} alt="" />
              ) : (
                <span className="ig-card__placeholder">
                  <ImagePlus size={26} aria-hidden="true" />
                  {fa["ig.image"]}
                </span>
              )}
            </button>
            <Input value={r.title} maxLength={120} placeholder={fa["banners.title"]} aria-label={IG.title} onChange={(e) => upd(i, { title: e.target.value })} />
            <Input value={r.subtitle ?? ""} maxLength={200} placeholder={fa["banners.subtitle"]} aria-label={IG.subtitle} onChange={(e) => upd(i, { subtitle: e.target.value })} />
            <Input dir="ltr" value={r.ctaHref ?? ""} placeholder={IG.hrefExample} aria-label={IG.href} onChange={(e) => upd(i, { ctaHref: e.target.value })} />
            <div className="ig-card__foot">
              <Switch label={fa["common.active"]} checked={r.isActive} onChange={(e) => upd(i, { isActive: e.target.checked })} />
              <span className="flex gap-1">
                <Button size="icon-sm" variant="ghost" disabled={i === 0} aria-label={IG.moveUp} title={IG.moveUp} onClick={() => setRows((rs) => { const n = [...rs]; const a = n[i]; const b = n[i - 1]; if (a && b) { n[i] = b; n[i - 1] = a; } return n; })}>
                  <ArrowUp size={16} aria-hidden="true" />
                </Button>
                <Button size="icon-sm" variant="ghost" className="ig-card__remove" aria-label={IG.remove} title={IG.remove} onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>
                  <X size={16} aria-hidden="true" />
                </Button>
              </span>
            </div>
          </li>
        ))}
        <li>
          <button type="button" className="ig-add" disabled={rows.length >= 60} onClick={() => setRows((rs) => [...rs, { title: "", subtitle: null, ctaHref: null, mediaLightId: null, preview: null, isActive: true }])}>
            <Plus size={22} aria-hidden="true" />
            {fa["ig.add"]}
          </button>
        </li>
      </ul>
      <div className="flex gap-2">
        <Button disabled={busy || rows.some((r) => r.title.trim() === "" || r.mediaLightId === null)} onClick={() => void save()}>
          {fa["common.save"]}
        </Button>
      </div>
      <MediaPicker
        open={pick !== null}
        onClose={() => setPick(null)}
        onSelect={(_ids, items: MediaPick[]) => {
          const it = items[0];
          if (pick !== null && it !== undefined) upd(pick, { mediaLightId: it.id, preview: thumbUrl(it) });
          setPick(null);
        }}
      />
    </fieldset>
  );
}
