"use client";
import type { ProductAdminInput } from "@namilux/core/client";
import { productUrl } from "@namilux/core/client";
import type { FormApi } from "@/components/forms/Form";
import { SeoFields } from "@/components/forms/SeoFields";
import { ProductAddress } from "./ProductAddress";

function safePath(slug: string): string {
  try {
    return productUrl(slug);
  } catch {
    return "/product/…/";
  }
}

export function TabSeo({ f, legacySlug, origin }: { f: FormApi<ProductAdminInput>; legacySlug: boolean; origin: string }) {
  const v = f.values;
  return (
    <div className="max-w-2xl">
      <SeoFields
        entityKind="product"
        address={<ProductAddress f={f} origin={origin} locked={legacySlug} />}
        legacySlug={legacySlug}
        origin={origin}
        values={{ seoTitle: v.seoTitle ?? "", seoDescription: v.seoDescription ?? "", robots: v.robots ?? "index, follow", slug: v.slug, path: safePath(v.slug) }}
        errors={f.errors}
        onChange={(p) => {
          if (p.seoTitle !== undefined) f.set("seoTitle", p.seoTitle === "" ? null : p.seoTitle);
          if (p.seoDescription !== undefined) f.set("seoDescription", p.seoDescription === "" ? null : p.seoDescription);
          if (p.robots !== undefined) f.set("robots", p.robots);
          if (p.slug !== undefined) f.set("slug", p.slug);
        }}
      />
    </div>
  );
}
