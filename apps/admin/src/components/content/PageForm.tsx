"use client";
import { ExternalLink } from "lucide-react";
import { useRouter } from "next/navigation";
import type { PageInput } from "@namilux/core/client";
import { CONTENT_STATUSES, PAGE_TEMPLATES, pageSchema, pageUrl } from "@namilux/core/client";
import { Form } from "@/components/forms/Form";
import { PersianText } from "@/components/forms/PersianText";
import { RichEditor } from "@/components/forms/RichEditor";
import { SeoFields } from "@/components/forms/SeoFields";
import { ButtonLink, Field, Select } from "@/components/kit";
import { toast } from "@/components/kit-client";
import { fa, pageTemplateLabel } from "@/i18n/fa";
import { PAGE } from "@/i18n/admin-guidance";

function safePath(slug: string): string {
  try {
    return pageUrl(slug);
  } catch {
    return "/…/";
  }
}

export function PageForm({ initial, legacySlug, origin }: { initial: PageInput; legacySlug: boolean; origin: string }) {
  const router = useRouter();
  const isNew = initial.id === undefined;
  return (
    <Form<PageInput>
      schemaKey="page"
      schema={pageSchema}
      initial={initial}
      action={isNew ? "/api/pages" : `/api/pages/${String(initial.id)}`}
      method={isNew ? "POST" : "PUT"}
      draftKey={isNew ? "new" : String(initial.id)}
      onSaved={(data) => {
        toast(fa["pages.saved"]);
        const id = (data as { id?: number }).id;
        if (isNew && id !== undefined) router.push(`/content/pages/${String(id)}`);
        else router.refresh();
      }}
      extraActions={
        !isNew ? (
          <ButtonLink external variant="outline" href={`${origin}${safePath(initial.slug)}`} icon={<ExternalLink size={15} aria-hidden="true" />}>
            {fa["common.open"]}
          </ButtonLink>
        ) : undefined
      }
    >
      {(f) => {
        const v = f.values;
        return (
          <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
            <div className="space-y-4">
              <PersianText label={fa["posts.title"]} value={v.title} onChange={(s) => f.set("title", s)} max={200} error={f.errors.title ?? ""} />
              <RichEditor label={fa["posts.body"]} value={v.bodyHtml} onChange={(h) => f.set("bodyHtml", h)} />
            </div>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <Field label={fa["pages.template"]} hint={PAGE.template}>
                  <Select value={v.template} onChange={(e) => f.set("template", e.target.value)}>
                    {PAGE_TEMPLATES.map((t) => (
                      <option key={t} value={t}>
                        {pageTemplateLabel(t)}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={fa["common.status"]} hint={PAGE.status}>
                  <Select value={v.status} onChange={(e) => f.set("status", e.target.value)}>
                    {CONTENT_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {fa[`posts.status.${s}`]}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <SeoFields
                entityKind="page"
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
          </div>
        );
      }}
    </Form>
  );
}
