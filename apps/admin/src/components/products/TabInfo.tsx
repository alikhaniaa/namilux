"use client";
import { useState } from "react";
import type { ProductAdminInput } from "@namilux/core/client";
import { PRODUCT_STATUSES, VISIBILITIES, enDigits, faDigits } from "@namilux/core/client";
import { ModelGroupPicker } from "./ModelGroupPicker";
import { BrandQuickCreate, CategoryQuickCreate } from "./QuickCreate";
import type { FormApi } from "@/components/forms/Form";
import { JalaliDate } from "@/components/forms/JalaliDate";
import { MediaPicker } from "@/components/forms/MediaPicker";
import { PersianText } from "@/components/forms/PersianText";
import { RichEditor } from "@/components/forms/RichEditor";
import { type TreeNode, TreePicker } from "@/components/forms/TreePicker";
import { Button, CheckList, Field, Input, Select } from "@/components/kit";
import { collectionKindLabel, fa } from "@/i18n/fa";
import { namePatch } from "@/lib/product-name";
import { insertNode, mergeOptions } from "@/lib/taxonomy";
import { automaticSlug } from "@/lib/product-slug";
import { ProductAddress } from "./ProductAddress";
import { ColorCodeInput } from "./ColorCodeInput";

export type InfoAux = {
  brands: { id: number; name: string }[];
  categories: TreeNode[];
  collections: { id: number; name: string; kind: string }[];
};

function intOrNull(raw: string, max: number): number | null {
  if (raw.trim() === "") return null;
  const n = Number(enDigits(raw));
  return Number.isInteger(n) && n >= 0 && n <= max ? n : null;
}

export function TabInfo({ f, aux, isNew, origin }: { f: FormApi<ProductAdminInput>; aux: InfoAux; isNew: boolean; origin: string }) {
  const v = f.values;
  const [pick, setPick] = useState<"swatch" | "video" | null>(null);
  const [newBrand, setNewBrand] = useState(false);
  const [newCategory, setNewCategory] = useState(false);
  // Options created from this form, merged over the server's list so the new choice is selectable
  // without a `router.refresh()` that would rebuild the page under the editor's unsaved values.
  const [addedBrands, setAddedBrands] = useState<{ id: number; name: string }[]>([]);
  const [addedCategories, setAddedCategories] = useState<{ node: TreeNode; parentId: number | null }[]>([]);
  const brands = mergeOptions(aux.brands, addedBrands);
  const categories = addedCategories.reduce((tree, c) => insertNode(tree, c.node, c.parentId), aux.categories);
  const selectedCats = v.categoryIds.map((c) => c.id);
  const primaryCat = v.categoryIds.find((c) => c.isPrimary)?.id ?? null;

  /**
   * ONE name box, bound to `displayName` - what the storefront prints. The legacy `name` column is
   * never shown; `namePatch` keeps the stored value on an edit and mirrors the typed name into it
   * for a new product (the write schema requires it non-empty), so nothing searchable is lost.
   */
  function onDisplayName(s: string): void {
    const patch = namePatch(isNew, s, v.name);
    f.set("displayName", patch.displayName);
    if (patch.name !== undefined) f.set("name", patch.name);
    const slug = automaticSlug(isNew, v.slug, v.displayName, v.modelCode ?? "", s, v.modelCode ?? "");
    if (slug !== v.slug) f.set("slug", slug);
  }

  function onBrand(id: number | null): void {
    if (id === (v.brandId ?? null)) return;
    f.set("brandId", id);
    // A model group belongs to exactly one brand: keeping the old selection would store a
    // cross-brand pair the picker could no longer offer, so changing the brand clears it.
    f.set("modelId", null);
  }

  function onBrandCreated(b: { id: number; name: string }): void {
    setAddedBrands((prev) => (prev.some((x) => x.id === b.id) ? prev : [...prev, b]));
    f.set("brandId", b.id);
    f.set("modelId", null);
  }

  function onCategoryCreated(c: { id: number; name: string; parentId: number | null }): void {
    setAddedCategories((prev) => [...prev.filter((x) => x.node.id !== c.id), { node: { id: c.id, name: c.name, children: [] }, parentId: c.parentId }]);
    if (v.categoryIds.some((x) => x.id === c.id)) return;
    // The new category is selected straight away; it becomes the primary one only if none was set.
    f.set("categoryIds", [...v.categoryIds, { id: c.id, isPrimary: !v.categoryIds.some((x) => x.isPrimary) }]);
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
      <div className="space-y-4">
        <div className="space-y-1">
          <PersianText label={fa["products.displayName"]} value={v.displayName} onChange={onDisplayName} preview="card" error={f.errors.displayName ?? f.errors.name ?? ""} />
          <p className="text-xs text-[var(--ink-2)]">{fa["products.name.hint"]}</p>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label={fa["products.brand"]} action={<Button size="sm" variant="outline" onClick={() => setNewBrand(true)}>{fa["tax.brand.new"]}</Button>}>
            <Select value={v.brandId === null || v.brandId === undefined ? "" : String(v.brandId)} onChange={(e) => onBrand(e.target.value === "" ? null : Number(e.target.value))}>
              <option value="">انتخاب کنید</option>
              {brands.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={fa["products.model"]} {...(v.brandId === null || v.brandId === undefined ? {} : { hint: fa["products.brandModel.hint"] })}>
            <ModelGroupPicker value={v.modelId ?? null} brandId={v.brandId ?? null} onChange={(id) => f.set("modelId", id)} />
          </Field>
          <Field label={fa["products.sku"]}>
            <Input dir="ltr" value={v.sku ?? ""} onChange={(e) => f.set("sku", e.target.value === "" ? null : e.target.value)} maxLength={64} />
          </Field>
          <Field label={fa["products.modelCode"]} error={f.errors.modelCode ?? ""}>
            <Input dir="ltr" value={v.modelCode ?? ""} onChange={(e) => {
              f.set("modelCode", e.target.value === "" ? null : e.target.value);
              const slug = automaticSlug(isNew, v.slug, v.displayName, v.modelCode ?? "", v.displayName, e.target.value);
              if (slug !== v.slug) f.set("slug", slug);
            }} maxLength={64} />
          </Field>
          <Field label={fa["products.color"]}>
            <Input value={v.colorName ?? ""} onChange={(e) => f.set("colorName", e.target.value === "" ? null : e.target.value)} maxLength={40} />
          </Field>
          <Field group label={fa["products.colorHex"]} error={f.errors.colorHex ?? ""}>
            <div className="space-y-2">
              <ColorCodeInput value={v.colorHex ?? null} onChange={(value) => f.set("colorHex", value)} />
              <Button size="sm" variant="outline" onClick={() => setPick("swatch")}>
                {fa["products.swatch"]}
              </Button>
            </div>
          </Field>
        </div>
        {isNew ? <ProductAddress f={f} origin={origin} /> : null}
        <RichEditor label={fa["products.short"]} value={v.shortHtml} onChange={(h) => f.set("shortHtml", h)} allowImages={false} />
        <RichEditor label={fa["products.description"]} value={v.descriptionHtml} onChange={(h) => f.set("descriptionHtml", h)} />
        <div className="grid gap-3 md:grid-cols-2">
          <Field label={fa["products.warranty"]}>
            <Input dir="ltr" inputMode="numeric" value={v.warrantyMonths === null || v.warrantyMonths === undefined ? "" : faDigits(v.warrantyMonths)} onChange={(e) => f.set("warrantyMonths", intOrNull(e.target.value, 120))} />
          </Field>
          <Field label={fa["products.warrantyText"]}>
            <Input value={v.warrantyText ?? ""} onChange={(e) => f.set("warrantyText", e.target.value === "" ? null : e.target.value)} maxLength={200} />
          </Field>
        </div>
        <details className="border border-[var(--line)] p-3">
          <summary className="cursor-pointer">وزن و ابعاد (اختیاری)</summary>
          <p className="my-3 text-sm text-[var(--ink-2)]">اگر کالا در فروشگاه نیست یا اندازه‌های دقیق را نمی‌دانید، این بخش را خالی بگذارید.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {([["weightG", "وزن (گرم)"], ["lengthMm", "طول (میلی‌متر)"], ["widthMm", "عرض (میلی‌متر)"], ["heightMm", "ارتفاع (میلی‌متر)"]] as const).map(([k, label]) => (
              <Field key={k} label={label}>
                <Input dir="ltr" inputMode="numeric" value={v[k] === null || v[k] === undefined ? "" : faDigits(v[k])} onChange={(e) => f.set(k, intOrNull(e.target.value, 1_000_000))} />
              </Field>
            ))}
          </div>
          <Button variant="ghost" size="sm" onClick={() => { for (const k of ["weightG", "lengthMm", "widthMm", "heightMm"] as const) f.set(k, null); }}>پاک کردن وزن و ابعاد</Button>
        </details>
        <Field label={fa["products.video"]}>
          <span className="flex items-center gap-2">
            <Input dir="ltr" readOnly value={v.videoMediaId ? "ویدئو انتخاب شده است" : "ویدئویی انتخاب نشده است"} className="flex-1" />
            <Button size="sm" variant="outline" onClick={() => setPick("video")}>
              {fa["media.pick"]}
            </Button>
            {v.videoMediaId ? (
              <Button size="sm" variant="ghost" aria-label="حذف ویدئو" onClick={() => f.set("videoMediaId", null)}>
                ×
              </Button>
            ) : null}
          </span>
        </Field>
      </div>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label={fa["products.status"]}>
            <Select value={v.status} onChange={(e) => f.set("status", e.target.value)}>
              {PRODUCT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {fa[`products.status.${s}`]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={fa["products.visibility"]}>
            <Select value={v.visibility} onChange={(e) => f.set("visibility", e.target.value)}>
              {VISIBILITIES.map((s) => (
                <option key={s} value={s}>
                  {fa[`products.visibility.${s}`]}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label={fa["products.publishedAt"]}>
          <JalaliDate value={v.publishedAt ?? null} onChange={(iso) => f.set("publishedAt", iso)} withTime />
        </Field>
        <Field
          group
          label={fa["products.categories"]}
          hint={fa["products.primaryCategory"]}
          error={f.errors.categoryIds ?? ""}
          action={
            <Button size="sm" variant="outline" onClick={() => setNewCategory(true)}>
              {fa["tax.category.new"]}
            </Button>
          }
        >
          <TreePicker
            tree={categories}
            selected={selectedCats}
            primary={primaryCat}
            onChange={(sel, primary) => f.set("categoryIds", sel.map((id) => ({ id, isPrimary: id === primary })))}
          />
        </Field>
        <Field label={fa["products.collections"]} group>
          <CheckList label={fa["products.collections"]} options={aux.collections.map((c) => ({ id: c.id, name: `${c.name} · ${collectionKindLabel(c.kind)}` }))} value={v.collectionIds} onChange={(ids) => f.set("collectionIds", ids)} />
        </Field>
      </div>
      <MediaPicker
        open={pick !== null}
        onClose={() => setPick(null)}
        kind={pick === "video" ? "video" : "image"}
        onSelect={(ids) => {
          const id = ids[0];
          if (id !== undefined) f.set(pick === "video" ? "videoMediaId" : "swatchMediaId", id);
          setPick(null);
        }}
      />
      {/* Both dialogs sit outside the Fields they serve: a dialog nested in a <label> would let a
          click inside it re-target the label's own control (kit.tsx Field). */}
      <BrandQuickCreate open={newBrand} onClose={() => setNewBrand(false)} onCreated={onBrandCreated} />
      <CategoryQuickCreate open={newCategory} onClose={() => setNewCategory(false)} onCreated={onCategoryCreated} tree={categories} defaultParent={primaryCat} />
    </div>
  );
}
