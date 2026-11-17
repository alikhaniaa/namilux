"use client";
import { robotsLabel } from "@/i18n/admin-labels";
import { ROBOTS_VALUES, faInt } from "@namilux/core/client";
import { Field, Input, Select, Textarea } from "@/components/kit";
import { fa } from "@/i18n/fa";

const TITLE_MAX = 60;
const DESC_MAX = 160;

export function SeoFields({
  values,
  onChange,
  errors = {},
  legacySlug = false,
  origin = "https://namilux.ir",
  address,
}: {
  values: { seoTitle: string; seoDescription: string; robots: string; slug: string; path: string };
  onChange: (v: Partial<{ seoTitle: string; seoDescription: string; robots: string; slug: string }>) => void;
  /** The form's validation messages, keyed like `values`; a form that passes none shows none. */
  errors?: Partial<Record<"seoTitle" | "seoDescription" | "robots" | "slug", string>>;
  entityKind: "product" | "category" | "brand" | "collection" | "post" | "page";
  legacySlug?: boolean;
  origin?: string;
  address?: React.ReactNode;
}) {
  const meter = (n: number, max: number): string => `${faInt(n)} / ${faInt(max)}`;
  // An imported row may carry Yoast's longer robots string; it stays selected, so saving never changes it silently.
  const storedRobots = (ROBOTS_VALUES as readonly string[]).includes(values.robots) ? null : values.robots;
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <div className="min-w-0 space-y-3">
        <Field label={fa["seo.title"]} hint={meter(values.seoTitle.length, TITLE_MAX)} error={errors.seoTitle ?? ""}>
          <Input value={values.seoTitle} onChange={(e) => onChange({ seoTitle: e.target.value })} className={values.seoTitle.length > TITLE_MAX ? "border-[var(--danger)]" : ""} />
        </Field>
        <Field label={fa["seo.description"]} hint={meter(values.seoDescription.length, DESC_MAX)} error={errors.seoDescription ?? ""}>
          <Textarea value={values.seoDescription} onChange={(e) => onChange({ seoDescription: e.target.value })} className={values.seoDescription.length > DESC_MAX ? "border-[var(--danger)]" : ""} />
        </Field>
        <Field label={fa["seo.robots"]} error={errors.robots ?? ""}>
          <Select value={values.robots} onChange={(e) => onChange({ robots: e.target.value })}>
            {storedRobots !== null ? <option value={storedRobots}>{robotsLabel(storedRobots)}</option> : null}
            {ROBOTS_VALUES.map((r) => (
              <option key={r} value={r}>
                {robotsLabel(r)}
              </option>
            ))}
          </Select>
        </Field>
        {address ?? <Field label={legacySlug ? fa["seo.legacySlug"] : fa["seo.slug"]} {...(legacySlug ? {} : { hint: fa["seo.slugRedirect"] })} error={errors.slug ?? ""}>
          <Input dir="ltr" value={values.slug} disabled={legacySlug} onChange={(e) => onChange({ slug: e.target.value })} />
        </Field>
        }
        <Field label={fa["seo.canonical"]}>
          <Input dir="ltr" readOnly value={`${origin}${values.path}`} />
        </Field>
      </div>
      <div className="min-w-0 space-y-2">
        <p className="text-xs text-[var(--ink-2)]">{fa["seo.serp"]}</p>
        <div className="border border-[var(--line)] bg-[var(--surface)] p-3" dir="rtl">
          <p className="ltr truncate text-xs text-[var(--ok)]">{`${origin}${values.path}`}</p>
          <p className="truncate text-base text-[var(--accent)]">{values.seoTitle || fa["seo.flag.title_missing"]}</p>
          <p className="line-clamp-2 text-xs text-[var(--ink-2)]">{values.seoDescription || fa["seo.flag.description_missing"]}</p>
        </div>
      </div>
    </div>
  );
}
