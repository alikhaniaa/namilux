"use client";
import { statusLabel } from "@/i18n/admin-labels";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { CollectionAdminInput } from "@namilux/core/client";
import { faDigits, COLLECTION_KINDS, COLLECTION_STATUSES, collectionAdminSchema, collectionUrl, enDigits, faInt } from "@namilux/core/client";
import { ProductPicker } from "@/components/products/ProductPicker";
import { Form } from "@/components/forms/Form";
import { JalaliDate } from "@/components/forms/JalaliDate";
import { MediaPicker } from "@/components/forms/MediaPicker";
import { type MediaPick, thumbUrl } from "@/lib/media";
import { PersianText } from "@/components/forms/PersianText";
import { RichEditor } from "@/components/forms/RichEditor";
import { RuleBuilder } from "@/components/forms/RuleBuilder";
import { SeoFields } from "@/components/forms/SeoFields";
import { Button, Checkbox, Field, Input, Select, StatusBadge } from "@/components/kit";
import { toast } from "@/components/kit-client";
import { fa } from "@/i18n/fa";

type Media = Pick<MediaPick, "storageKey" | "image">;

function safePath(slug: string): string {
  try {
    return collectionUrl(slug);
  } catch {
    return "/collection/…/";
  }
}

export function CollectionForm({ initial, covers, parents, productNames, legacySlug, origin }: { initial: CollectionAdminInput; covers: { light: Media | null; dark: Media | null }; parents: { id: number; name: string }[]; productNames: Record<number, string>; legacySlug: boolean; origin: string }) {
  const router = useRouter();
  const [pick, setPick] = useState<"light" | "dark" | null>(null);
  const [local, setLocal] = useState(covers);
  const [names, setNames] = useState(productNames);
  const [mode, setMode] = useState<"manual" | "rule">(initial.rule ? "rule" : "manual");
  const isNew = initial.id === undefined;

  return (
    <Form<CollectionAdminInput>
      schemaKey="collection"
      schema={collectionAdminSchema}
      initial={initial}
      action={isNew ? "/api/collections" : `/api/collections/${String(initial.id)}`}
      method={isNew ? "POST" : "PUT"}
      onSaved={(data) => {
        toast(fa["collections.saved"]);
        const id = (data as { id?: number }).id;
        if (isNew && id !== undefined) router.push(`/collections/${String(id)}`);
        else router.refresh();
      }}
    >
      {(f) => {
        const v = f.values;
        const ids = v.productIds ?? [];
        return (
          <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
            <div className="space-y-4">
              <div className="grid gap-3 md:grid-cols-3">
                <PersianText label={fa["common.name"]} value={v.name} onChange={(s) => f.set("name", s)} max={80} error={f.errors.name ?? ""} />
                <Field label={fa["collections.kind"]}>
                  <Select value={v.kind} onChange={(e) => f.set("kind", e.target.value)}>
                    {COLLECTION_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {fa[`collections.kind.${k}`]}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={fa["collections.parent"]}>
                  <Select value={v.parentId === null || v.parentId === undefined ? "" : String(v.parentId)} onChange={(e) => f.set("parentId", e.target.value === "" ? null : Number(e.target.value))}>
                    <option value="">انتخاب کنید</option>
                    {parents.filter((p) => p.id !== v.id).map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <Field label={fa["collections.mode"]}>
                <Select value={mode} onChange={(e) => { const m = e.target.value as "manual" | "rule"; setMode(m); if (m === "manual") f.set("rule", null); else f.set("rule", v.rule ?? {}); }}>
                  <option value="manual">{fa["collections.mode.manual"]}</option>
                  <option value="rule">{fa["collections.mode.rule"]}</option>
                </Select>
              </Field>
              {mode === "rule" ? (
                <RuleBuilder value={v.rule ?? {}} onChange={(r) => f.set("rule", r)} />
              ) : (
                <Field label={fa["collections.products"]} hint={`${fa["collections.count"]}: ${faInt(ids.length)}`}>
                  <div className="flex flex-wrap items-center gap-1">
                    {ids.map((id) => (
                      <button key={id} type="button" onClick={() => f.set("productIds", ids.filter((x) => x !== id))}>
                        <StatusBadge>{names[id] ?? "کالای انتخاب‌شده"} ×</StatusBadge>
                      </button>
                    ))}
                    <ProductPicker
                      label={fa["collections.addProduct"]}
                      onPick={(p) => {
                        setNames((n) => ({ ...n, [p.id]: p.displayName }));
                        if (!ids.includes(p.id)) f.set("productIds", [...ids, p.id]);
                      }}
                    />
                  </div>
                </Field>
              )}
              <RichEditor label={fa["cat.description"]} value={v.descriptionHtml} onChange={(h) => f.set("descriptionHtml", h)} allowImages={false} />
            </div>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                {(["light", "dark"] as const).map((side) => {
                  const key = side === "light" ? "coverMediaId" : "coverDarkMediaId";
                  const m = local[side];
                  return (
                    <Field key={side} label={fa[side === "light" ? "collections.cover" : "collections.coverDark"]}>
                      <div className="space-y-1">
                        <div className="h-20 w-full bg-[var(--bg)]">{m !== null ? <img src={thumbUrl(m)} alt="" className="h-20 w-full object-cover" /> : null}</div>
                        <span className="flex gap-1">
                          <Button size="sm" variant="outline" onClick={() => setPick(side)}>
                            {fa["media.pick"]}
                          </Button>
                          {v[key] ? (
                            <Button size="sm" variant="ghost" onClick={() => { f.set(key, null); setLocal((l) => ({ ...l, [side]: null })); }}>
                              ×
                            </Button>
                          ) : null}
                        </span>
                      </div>
                    </Field>
                  );
                })}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label={fa["collections.status"]}>
                  <Select value={v.status} onChange={(e) => f.set("status", e.target.value)}>
                    {COLLECTION_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {statusLabel(s)}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={fa["cat.sort"]}>
                  <Input dir="ltr" inputMode="numeric" value={faDigits(v.sort)} onChange={(e) => f.set("sort", Number(enDigits(e.target.value)) || 0)} />
                </Field>
              </div>
              <Checkbox label={fa["collections.isNav"]} checked={v.isNav} onChange={(e) => f.set("isNav", e.target.checked)} />
              <Field label={`${fa["collections.startsAt"]} / ${fa["collections.endsAt"]}`} error={f.errors.endsAt ?? ""}>
                <div className="grid grid-cols-2 gap-1">
                  <JalaliDate value={v.startsAt ?? null} onChange={(iso) => f.set("startsAt", iso)} withTime />
                  <JalaliDate value={v.endsAt ?? null} onChange={(iso) => f.set("endsAt", iso)} withTime />
                </div>
              </Field>
              <SeoFields
                entityKind="collection"
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
              open={pick !== null}
              onClose={() => setPick(null)}
              onSelect={(_ids, items) => {
                const it = items[0];
                if (pick !== null && it !== undefined) {
                  f.set(pick === "light" ? "coverMediaId" : "coverDarkMediaId", it.id);
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
