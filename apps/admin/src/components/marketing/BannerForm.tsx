"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { BannerInput } from "@namilux/core/client";
import { faDigits, BANNER_SLOTS, BANNER_THEMES, bannerSchema, enDigits } from "@namilux/core/client";
import { BannerPreview } from "./BannerPreview";
import { Form } from "@/components/forms/Form";
import { JalaliDate } from "@/components/forms/JalaliDate";
import { MediaPicker } from "@/components/forms/MediaPicker";
import { type MediaPick, thumbUrl } from "@/lib/media";
import { Button, Field, Input, Select, Switch } from "@/components/kit";
import { ConfirmButton, toast } from "@/components/kit-client";
import { fa } from "@/i18n/fa";
import { BANNER, BANNER_SLOT_HINT, BANNER_SLOT_LABEL, BANNER_THEME_LABEL } from "@/i18n/admin-guidance";
import { ApiError, api } from "@/lib/api-client";

type Media = Pick<MediaPick, "storageKey" | "image">;

export function BannerForm({ initial, media, backHref }: { initial: BannerInput; media: { light: Media | null; dark: Media | null }; backHref: string }) {
  const router = useRouter();
  const [pick, setPick] = useState<"light" | "dark" | null>(null);
  const [local, setLocal] = useState(media);
  const isNew = initial.id === undefined;

  async function remove(): Promise<void> {
    if (initial.id === undefined) return;
    try {
      await api(`/api/banners/${String(initial.id)}`, { method: "DELETE" });
      toast(fa["banners.deleted"]);
      router.push(backHref);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : fa["common.error"], "error");
    }
  }

  return (
    <Form<BannerInput>
      schemaKey="banner"
      schema={bannerSchema}
      initial={initial}
      action={isNew ? "/api/banners" : `/api/banners/${String(initial.id)}`}
      method={isNew ? "POST" : "PUT"}
      onSaved={() => {
        toast(fa["banners.saved"]);
        router.push(backHref);
      }}
      extraActions={!isNew ? <ConfirmButton label={fa["banners.delete"]} confirmLabel={fa["common.confirm"]} onConfirm={remove} /> : undefined}
    >
      {(f) => {
        const v = f.values;
        return (
          <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
            <div className="space-y-3">
              <div className="grid gap-3 md:grid-cols-2">
                <Field label={fa["banners.slot"]} {...(BANNER_SLOT_HINT[v.slot] === undefined ? {} : { hint: BANNER_SLOT_HINT[v.slot] })}>
                  <Select value={v.slot} onChange={(e) => f.set("slot", e.target.value)}>
                    {BANNER_SLOTS.map((s) => (
                      <option key={s} value={s}>
                        {BANNER_SLOT_LABEL[s] ?? s}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={fa["banners.theme"]} hint={BANNER.theme}>
                  <Select value={v.theme} onChange={(e) => f.set("theme", e.target.value)}>
                    {BANNER_THEMES.map((t) => (
                      <option key={t} value={t}>
                        {BANNER_THEME_LABEL[t] ?? t}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <Field label={fa["banners.title"]} hint={BANNER.title} error={f.errors.title ?? ""}>
                <Input value={v.title} onChange={(e) => f.set("title", e.target.value)} maxLength={120} />
              </Field>
              <Field label={fa["banners.subtitle"]} hint={BANNER.subtitle}>
                <Input value={v.subtitle ?? ""} onChange={(e) => f.set("subtitle", e.target.value === "" ? null : e.target.value)} maxLength={200} />
              </Field>
              <div className="grid gap-3 md:grid-cols-2">
                <Field label={fa["banners.ctaLabel"]} hint={BANNER.ctaLabel}>
                  <Input value={v.ctaLabel ?? ""} onChange={(e) => f.set("ctaLabel", e.target.value === "" ? null : e.target.value)} maxLength={40} />
                </Field>
                <Field label={fa["banners.ctaHref"]} hint={BANNER.ctaHref} error={f.errors.ctaHref ?? ""}>
                  <Input dir="ltr" value={v.ctaHref ?? ""} onChange={(e) => f.set("ctaHref", e.target.value === "" ? null : e.target.value)} maxLength={512} placeholder="/shop/" />
                </Field>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                {(["light", "dark"] as const).map((side) => {
                  const key = side === "light" ? "mediaLightId" : "mediaDarkId";
                  const m = local[side];
                  return (
                    <Field key={side} label={fa[side === "light" ? "banners.mediaLight" : "banners.mediaDark"]} {...(side === "light" ? { hint: BANNER.media } : {})} error={side === "light" ? (f.errors.mediaLightId ?? "") : ""} group>
                      <div className="flex items-center gap-2">
                        <div className="h-16 w-24 bg-[var(--bg)]">{m !== null ? <img src={thumbUrl(m)} alt="" className="h-16 w-24 object-cover" /> : null}</div>
                        <Button size="sm" variant="outline" onClick={() => setPick(side)}>
                          {fa["media.pick"]}
                        </Button>
                        {v[key] ? (
                          <Button size="sm" variant="ghost" onClick={() => { f.set(key, null); setLocal((l) => ({ ...l, [side]: null })); }}>
                            ×
                          </Button>
                        ) : null}
                      </div>
                    </Field>
                  );
                })}
              </div>
              <Field label={fa["banners.schedule"]} hint={BANNER.schedule} error={f.errors.endsAt ?? ""} group>
                <div className="grid grid-cols-2 gap-1">
                  <JalaliDate value={v.startsAt ?? null} onChange={(iso) => f.set("startsAt", iso)} withTime />
                  <JalaliDate value={v.endsAt ?? null} onChange={(iso) => f.set("endsAt", iso)} withTime />
                </div>
              </Field>
              <div className="grid gap-3 md:grid-cols-3">
                <Field label={fa["banners.targeting.collection"]} hint={BANNER.targetingCollection}>
                  <Input dir="ltr" value={v.targeting?.collectionSlug ?? ""} onChange={(e) => f.set("targeting", e.target.value === "" && !v.targeting?.brandSlug ? null : { ...(v.targeting ?? {}), collectionSlug: e.target.value === "" ? undefined : e.target.value })} />
                </Field>
                <Field label={fa["banners.targeting.brand"]} hint={BANNER.targetingBrand}>
                  <Input dir="ltr" value={v.targeting?.brandSlug ?? ""} onChange={(e) => f.set("targeting", e.target.value === "" && !v.targeting?.collectionSlug ? null : { ...(v.targeting ?? {}), brandSlug: e.target.value === "" ? undefined : e.target.value })} />
                </Field>
                <Field label={fa["cat.sort"]} hint={BANNER.sort}>
                  <Input dir="ltr" inputMode="numeric" value={faDigits(v.sort)} onChange={(e) => f.set("sort", Number(enDigits(e.target.value)) || 0)} />
                </Field>
              </div>
              <Switch label={fa["common.active"]} checked={v.isActive} onChange={(e) => f.set("isActive", e.target.checked)} />
              <p className="text-xs text-[var(--ink-2)]">{BANNER.active}</p>
            </div>
            <div>
              <BannerPreview title={v.title} subtitle={v.subtitle ?? null} ctaLabel={v.ctaLabel ?? null} imageUrl={local.light === null ? null : thumbUrl(local.light)} imageDarkUrl={local.dark === null ? null : thumbUrl(local.dark)} theme={v.theme} />
            </div>
            <MediaPicker
              open={pick !== null}
              onClose={() => setPick(null)}
              onSelect={(_ids, items) => {
                const it = items[0];
                if (pick !== null && it !== undefined) {
                  f.set(pick === "light" ? "mediaLightId" : "mediaDarkId", it.id);
                  setLocal((l) => ({ ...l, [pick]: { storageKey: it.storageKey, image: it.image } }));
                }
                setPick(null);
              }}
            />
          </div>
        );
      }}
    </Form>
  );
}
