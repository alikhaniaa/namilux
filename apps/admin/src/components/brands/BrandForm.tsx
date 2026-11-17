"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { BrandAdminInput } from "@namilux/core/client";
import { faDigits, brandAdminSchema, brandUrl, enDigits } from "@namilux/core/client";
import { Form } from "@/components/forms/Form";
import { MediaPicker } from "@/components/forms/MediaPicker";
import { type MediaPick, thumbUrl } from "@/lib/media";
import { PersianText } from "@/components/forms/PersianText";
import { RichEditor } from "@/components/forms/RichEditor";
import { SeoFields } from "@/components/forms/SeoFields";
import { Button, Field, Input, Switch } from "@/components/kit";
import { ConfirmButton, toast } from "@/components/kit-client";
import { fa } from "@/i18n/fa";
import { ApiError, api } from "@/lib/api-client";

function safePath(slug: string): string {
  try {
    return brandUrl(slug);
  } catch {
    return "/brand/…/";
  }
}

export function BrandForm({ initial, logo, legacySlug, origin }: { initial: BrandAdminInput; logo: Pick<MediaPick, "storageKey" | "image"> | null; legacySlug: boolean; origin: string }) {
  const router = useRouter();
  const [pick, setPick] = useState(false);
  const [logoPreview, setLogoPreview] = useState(logo);
  const [redirectTo, setRedirectTo] = useState("/shop/");
  const isNew = initial.id === undefined;

  async function archive(): Promise<void> {
    if (initial.id === undefined) return;
    try {
      await api(`/api/brands/${String(initial.id)}`, { method: "POST", body: { archive: true, redirectTo: redirectTo.trim() === "" ? null : redirectTo.trim() } });
      toast(fa["common.saved"]);
      router.push("/brands");
    } catch (e) {
      toast(e instanceof ApiError ? e.message : fa["common.error"], "error");
    }
  }

  return (
    <Form<BrandAdminInput>
      schemaKey="brand"
      schema={brandAdminSchema}
      initial={initial}
      action={isNew ? "/api/brands" : `/api/brands/${String(initial.id)}`}
      method={isNew ? "POST" : "PUT"}
      onSaved={(data) => {
        toast(fa["brands.saved"]);
        const id = (data as { id?: number }).id;
        if (isNew && id !== undefined) router.push(`/brands/${String(id)}`);
        else router.refresh();
      }}
      extraActions={
        !isNew ? (
          <span className="flex items-center gap-1">
            <Input dir="ltr" className="h-9 w-40 text-xs" value={redirectTo} onChange={(e) => setRedirectTo(e.target.value)} />
            <ConfirmButton label={fa["common.archive"]} confirmLabel={fa["common.confirm"]} onConfirm={archive} />
          </span>
        ) : undefined
      }
    >
      {(f) => {
        const v = f.values;
        return (
          <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
            <div className="space-y-4">
              <div className="grid gap-3 md:grid-cols-2">
                <PersianText label={fa["brands.nameFa"]} value={v.nameFa} onChange={(s) => f.set("nameFa", s)} max={60} error={f.errors.nameFa ?? ""} />
                <Field label={fa["brands.nameEn"]} error={f.errors.nameEn ?? ""}>
                  <Input dir="ltr" value={v.nameEn} onChange={(e) => f.set("nameEn", e.target.value)} maxLength={60} />
                </Field>
              </div>
              <Field label={fa["brands.claim"]}>
                <Input value={v.claim ?? ""} onChange={(e) => f.set("claim", e.target.value === "" ? null : e.target.value)} maxLength={120} />
              </Field>
              <RichEditor label={fa["brands.story"]} value={v.storyHtml} onChange={(h) => f.set("storyHtml", h)} />
            </div>
            <div className="space-y-4">
              <Field label={fa["brands.logo"]}>
                <div className="flex items-center gap-2">
                  <div className="h-16 w-24 bg-[var(--bg)]">{logoPreview !== null ? <img src={thumbUrl(logoPreview)} alt="" className="h-16 w-24 object-contain" /> : null}</div>
                  <Button size="sm" variant="outline" onClick={() => setPick(true)}>
                    {fa["media.pick"]}
                  </Button>
                  {v.logoMediaId ? (
                    <Button size="sm" variant="ghost" onClick={() => { f.set("logoMediaId", null); setLogoPreview(null); }}>
                      ×
                    </Button>
                  ) : null}
                </div>
              </Field>
              <div className="flex items-center gap-4">
                <Switch label={fa["brands.active"]} checked={v.isActive} onChange={(e) => f.set("isActive", e.target.checked)} />
                <label className="flex items-center gap-2 text-sm">
                  {fa["cat.sort"]}
                  <Input dir="ltr" inputMode="numeric" className="h-8 w-16" value={faDigits(v.sort)} onChange={(e) => f.set("sort", Number(enDigits(e.target.value)) || 0)} />
                </label>
              </div>
              <SeoFields
                entityKind="brand"
                legacySlug={legacySlug}
                origin={origin}
                values={{ seoTitle: v.seoTitle ?? "", seoDescription: v.seoDescription ?? "", robots: v.robots ?? "index, follow", slug: v.slug, path: safePath(v.slug) }}
                onChange={(p) => {
                  if (p.seoTitle !== undefined) f.set("seoTitle", p.seoTitle === "" ? null : p.seoTitle);
                  if (p.seoDescription !== undefined) f.set("seoDescription", p.seoDescription === "" ? null : p.seoDescription);
                  if (p.robots !== undefined) f.set("robots", p.robots);
                  if (p.slug !== undefined) f.set("slug", p.slug);
                }}
              />
            </div>
            <MediaPicker
              open={pick}
              onClose={() => setPick(false)}
              onSelect={(_ids, items) => {
                const it = items[0];
                if (it !== undefined) {
                  f.set("logoMediaId", it.id);
                  setLogoPreview({ storageKey: it.storageKey, image: it.image });
                }
                setPick(false);
              }}
            />
          </div>
        );
      }}
    </Form>
  );
}
