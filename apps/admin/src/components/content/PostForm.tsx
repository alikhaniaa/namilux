"use client";
import { ExternalLink } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { PostInput } from "@namilux/core/client";
import { CONTENT_STATUSES, postSchema, postUrl } from "@namilux/core/client";
import { ProductPicker } from "@/components/products/ProductPicker";
import { Form } from "@/components/forms/Form";
import { JalaliDate } from "@/components/forms/JalaliDate";
import { MediaPicker } from "@/components/forms/MediaPicker";
import { type MediaPick, thumbUrl } from "@/lib/media";
import { PersianText } from "@/components/forms/PersianText";
import { RichEditor } from "@/components/forms/RichEditor";
import { SeoFields } from "@/components/forms/SeoFields";
import { Button, ButtonLink, Field, Input, Select, StatusBadge, Textarea } from "@/components/kit";
import { ConfirmButton, toast } from "@/components/kit-client";
import { fa } from "@/i18n/fa";
import { POST } from "@/i18n/admin-guidance";
import { ApiError, api } from "@/lib/api-client";

function safePath(slug: string): string {
  try {
    return postUrl(slug);
  } catch {
    return "/…/";
  }
}

export function PostForm({ initial, cover, relatedNames, legacySlug, origin }: { initial: PostInput; cover: Pick<MediaPick, "storageKey" | "image"> | null; relatedNames: Record<number, string>; legacySlug: boolean; origin: string }) {
  const router = useRouter();
  const [pick, setPick] = useState(false);
  const [coverPreview, setCoverPreview] = useState(cover);
  const [names, setNames] = useState(relatedNames);
  const [tag, setTag] = useState("");
  const isNew = initial.id === undefined;

  async function archive(): Promise<void> {
    if (initial.id === undefined) return;
    try {
      await api(`/api/posts/${String(initial.id)}`, { method: "POST", body: { archive: true } });
      toast(fa["common.saved"]);
      router.push("/content/posts");
    } catch (e) {
      toast(e instanceof ApiError ? e.message : fa["common.error"], "error");
    }
  }

  return (
    <Form<PostInput>
      schemaKey="post"
      schema={postSchema}
      initial={initial}
      action={isNew ? "/api/posts" : `/api/posts/${String(initial.id)}`}
      method={isNew ? "POST" : "PUT"}
      draftKey={isNew ? "new" : String(initial.id)}
      onSaved={(data) => {
        toast(fa["posts.saved"]);
        const id = (data as { id?: number }).id;
        if (isNew && id !== undefined) router.push(`/content/posts/${String(id)}`);
        else router.refresh();
      }}
      extraActions={
        !isNew ? (
          <>
            <ButtonLink external variant="outline" href={`${origin}${safePath(initial.slug)}`} icon={<ExternalLink size={15} aria-hidden="true" />}>
              {fa["posts.preview"]}
            </ButtonLink>
            <ConfirmButton label={fa["common.archive"]} confirmLabel={fa["common.confirm"]} onConfirm={archive} />
          </>
        ) : undefined
      }
    >
      {(f) => {
        const v = f.values;
        return (
          <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
            <div className="min-w-0 space-y-4">
              <PersianText label={fa["posts.title"]} value={v.title} onChange={(s) => f.set("title", s)} max={200} error={f.errors.title ?? ""} />
              <Field label={fa["posts.excerpt"]} hint={POST.excerpt}>
                <Textarea rows={2} value={v.excerpt} onChange={(e) => f.set("excerpt", e.target.value)} maxLength={500} />
              </Field>
              <RichEditor label={fa["posts.body"]} value={v.bodyHtml} onChange={(h) => f.set("bodyHtml", h)} />
              <SeoFields
                entityKind="post"
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
            <div className="min-w-0 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <Field label={fa["common.status"]} hint={POST.status}>
                  <Select value={v.status} onChange={(e) => f.set("status", e.target.value)}>
                    {CONTENT_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {fa[`posts.status.${s}`]}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={fa["posts.author"]} hint={POST.author}>
                  <Input value={v.authorName ?? ""} onChange={(e) => f.set("authorName", e.target.value === "" ? undefined : e.target.value)} maxLength={80} />
                </Field>
              </div>
              <Field label={fa["posts.schedule"]} hint={POST.schedule} group>
                <JalaliDate value={v.publishedAt ?? null} onChange={(iso) => f.set("publishedAt", iso)} withTime />
              </Field>
              <Field label={fa["posts.cover"]} hint={POST.cover} group>
                <div className="flex items-center gap-2">
                  <div className="h-20 w-32 bg-[var(--bg)]">{coverPreview !== null ? <img src={thumbUrl(coverPreview)} alt="" className="h-20 w-32 object-cover" /> : null}</div>
                  <Button size="sm" variant="outline" onClick={() => setPick(true)}>
                    {fa["media.pick"]}
                  </Button>
                  {v.coverMediaId ? (
                    <Button size="sm" variant="ghost" onClick={() => { f.set("coverMediaId", null); setCoverPreview(null); }}>
                      ×
                    </Button>
                  ) : null}
                </div>
              </Field>
              <Field label={fa["posts.tags"]} hint={POST.tags} group>
                <div className="flex flex-wrap items-center gap-1">
                  {v.tags.map((t) => (
                    <button key={t} type="button" onClick={() => f.set("tags", v.tags.filter((x) => x !== t))}>
                      <StatusBadge>{t} ×</StatusBadge>
                    </button>
                  ))}
                  <Input
                    className="h-8 w-32"
                    aria-label={POST.tagInput}
                    value={tag}
                    onChange={(e) => setTag(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && tag.trim() !== "") {
                        e.preventDefault();
                        if (!v.tags.includes(tag.trim())) f.set("tags", [...v.tags, tag.trim()]);
                        setTag("");
                      }
                    }}
                  />
                </div>
              </Field>
              <Field label={POST.relatedLabel} hint={POST.related} group>
                <div className="flex flex-wrap items-center gap-1">
                  {v.relatedProductIds.map((id) => (
                    <button key={id} type="button" onClick={() => f.set("relatedProductIds", v.relatedProductIds.filter((x) => x !== id))}>
                      <StatusBadge>{names[id] ?? "کالای انتخاب‌شده"} ×</StatusBadge>
                    </button>
                  ))}
                  <ProductPicker
                    onPick={(p) => {
                      setNames((n) => ({ ...n, [p.id]: p.displayName }));
                      if (!v.relatedProductIds.includes(p.id) && v.relatedProductIds.length < 12) f.set("relatedProductIds", [...v.relatedProductIds, p.id]);
                    }}
                  />
                </div>
              </Field>
            </div>
            <MediaPicker
              open={pick}
              onClose={() => setPick(false)}
              onSelect={(_ids, items) => {
                const it = items[0];
                if (it !== undefined) {
                  f.set("coverMediaId", it.id);
                  setCoverPreview({ storageKey: it.storageKey, image: it.image });
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
