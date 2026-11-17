"use client";
import type { ProductAdminInput } from "@namilux/core/client";
import type { FormApi } from "@/components/forms/Form";
import { Button, Field, Input } from "@/components/kit";
import { alternativeSlug } from "@/lib/product-slug";

export const PRODUCT_ADDRESS_LABEL = "نشانی صفحهٔ کالا در سایت";

export function ProductAddress({ f, origin, locked = false }: { f: FormApi<ProductAdminInput>; origin: string; locked?: boolean }) {
  const error = f.errors.slug ?? "";
  return (
    <div className="min-w-0 space-y-2">
      <Field label={PRODUCT_ADDRESS_LABEL} error={error} hint={locked
        ? "نشانی این کالا از فروشگاه قبلی حفظ شده و قابل تغییر نیست."
        : f.values.id === undefined
          ? "از نام و مدل کالا خودکار پر می‌شود. هر کالا باید نشانی مخصوص به خودش را داشته باشد."
          : "هر کالا باید نشانی مخصوص به خودش را داشته باشد. با تغییر آن، نشانی قبلی همچنان باز می‌شود."}>
        <Input dir="auto" value={f.values.slug} disabled={locked} maxLength={200} onChange={(e) => f.set("slug", e.target.value)} />
      </Field>
      <p dir="ltr" className="break-all text-start text-xs text-[var(--ink-2)]">{origin.replace(/\/$/, "")}/product/{f.values.slug || "…"}/</p>
      {!locked && error !== "" && f.values.slug !== "" ? (
        <Button size="sm" variant="outline" onClick={() => f.set("slug", alternativeSlug(f.values.slug))}>افزودن شماره به نشانی و تلاش دوباره</Button>
      ) : null}
    </div>
  );
}
