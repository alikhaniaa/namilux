"use client";
import { ExternalLink } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { ProductAdminInput, ProductCard } from "@namilux/core/client";
import { STOCK_NOTE_UNAVAILABLE, STOCK_RESTORE_MAX, faInt, productAdminSchema } from "@namilux/core/client";
import { ProductActions } from "./ProductActions";
import { UnavailableAction } from "./UnavailableAction";
import { TabHistory, type ProductHistory } from "./TabHistory";
import { TabImages, type ImagePreview } from "./TabImages";
import { TabInfo, type InfoAux } from "./TabInfo";
import { TabPriceStock } from "./TabPriceStock";
import { TabRelations } from "./TabRelations";
import { TabSeo } from "./TabSeo";
import { TabSpecs, type AttributeDefLite } from "./TabSpecs";
import { Form } from "@/components/forms/Form";
import { Tabs, toast } from "@/components/kit-client";
import { ButtonLink } from "@/components/kit";
import { fa } from "@/i18n/fa";
import { PRODUCT_ADDRESS_LABEL } from "./ProductAddress";

export type ProductFormAux = InfoAux & {
  attributes: AttributeDefLite[];
  previews: ImagePreview;
  relationNames: Record<number, string>;
  siblings: ProductCard[];
  history: ProductHistory | null;
  stock: { stockQty: number; reservedQty: number; availableQty: number } | null;
  legacySlug: boolean;
  origin: string;
  /** `catalog.cost` - the head admin. Decides whether the price tab has a cost box at all. */
  canCost: boolean;
  canPrice: boolean;
  archived: boolean;
};

const TABS = ["info", "price", "images", "specs", "seo", "relations", "history"] as const;
type Tab = (typeof TABS)[number];
type FieldTab = Exclude<Tab, "history">;

/**
 * The tab that shows each top-level field, and the name a refused save gives it. Most tabs render
 * no error of their own, so a refused save used to say «موارد مشخص‌شده» while nothing was marked.
 */
const FIELDS: Record<string, [FieldTab, string]> = {
  name: ["info", fa["products.name"]],
  displayName: ["info", fa["products.displayName"]],
  brandId: ["info", fa["products.brand"]],
  modelId: ["info", fa["products.model"]],
  sku: ["info", fa["products.sku"]],
  modelCode: ["info", fa["products.modelCode"]],
  colorName: ["info", fa["products.color"]],
  colorHex: ["info", fa["products.colorHex"]],
  swatchMediaId: ["info", fa["products.swatch"]],
  status: ["info", fa["products.status"]],
  visibility: ["info", fa["products.visibility"]],
  shortHtml: ["info", fa["products.short"]],
  descriptionHtml: ["info", fa["products.description"]],
  warrantyMonths: ["info", fa["products.warranty"]],
  warrantyText: ["info", fa["products.warrantyText"]],
  weightG: ["info", fa["products.dims"]],
  lengthMm: ["info", fa["products.dims"]],
  widthMm: ["info", fa["products.dims"]],
  heightMm: ["info", fa["products.dims"]],
  videoMediaId: ["info", fa["products.video"]],
  categoryIds: ["info", fa["products.categories"]],
  collectionIds: ["info", fa["products.collections"]],
  publishedAt: ["info", fa["products.publishedAt"]],
  price: ["price", fa["products.price"]],
  compareAtPrice: ["price", fa["products.compareAt"]],
  costPrice: ["price", fa["products.cost"]],
  instalmentPrice: ["price", fa["products.instalmentPrice"]],
  instalmentPriceManual: ["price", fa["products.instalmentPriceManual"]],
  instalmentEligible: ["price", fa["products.instalmentEligible"]],
  priceBasis: ["price", fa["products.priceBasis"]],
  basePrice: ["price", fa["products.basePrice"]],
  baseCurrency: ["price", fa["products.baseCurrency"]],
  stockPolicy: ["price", fa["products.stockPolicy"]],
  allowBackorder: ["price", fa["products.backorder"]],
  lowStockThreshold: ["price", fa["products.lowStock"]],
  maxPerOrder: ["price", fa["products.maxPerOrder"]],
  images: ["images", "تصویر"],
  specs: ["specs", "مشخصه"],
  attributes: ["specs", "ویژگی"],
  relations: ["relations", "محصول مرتبط"],
  seoTitle: ["seo", fa["seo.title"]],
  seoDescription: ["seo", fa["seo.description"]],
  robots: ["seo", fa["seo.robots"]],
  slug: ["seo", PRODUCT_ADDRESS_LABEL],
};

type SaveProblem = { path: string; tab: FieldTab; text: string };

/** The form's errors as «tab › field: message»; a row of a list field carries its number. */
function saveProblems(errors: Record<string, string>): SaveProblem[] {
  return Object.entries(errors).map(([path, message]) => {
    const [head = "", row] = path.split(".");
    const [tab, label] = FIELDS[head] ?? ["info", "اطلاعات کالا"];
    const at = row !== undefined && /^\d+$/.test(row) ? ` ${faInt(Number(row) + 1)}` : "";
    return { path, tab, text: `${fa[`products.tab.${tab}`]} › ${label}${at}: ${message}` };
  });
}

function SaveProblems({ problems, onTab }: { problems: SaveProblem[]; onTab: (tab: FieldTab) => void }) {
  const box = useRef<HTMLElement>(null);
  const key = problems.map((p) => p.path).join(",");
  // «ذخیره» sits under the open tab; bring the list into view when a save is refused.
  useEffect(() => {
    if (key !== "") box.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [key]);
  if (problems.length === 0) return null;
  return (
    <section ref={box} role="alert" className="space-y-2 border border-[var(--danger)] p-4 text-sm">
      <p className="font-medium text-[var(--danger)]">ذخیره انجام نشد. این موارد را اصلاح کنید:</p>
      <ul className="space-y-1">
        {problems.map((p) => (
          <li key={p.path}>
            <button type="button" className="text-start underline underline-offset-4" onClick={() => onTab(p.tab)}>
              {p.text}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** What «موجود کردن» offers to put back: the quantity the last «ناموجود کردن» removed (movements are newest first), else one. */
function restoreQty(history: ProductHistory | null): number {
  const removed = history?.movements.find((m) => m.note === STOCK_NOTE_UNAVAILABLE && m.delta < 0);
  return removed === undefined ? 1 : Math.min(-removed.delta, STOCK_RESTORE_MAX);
}

export function ProductForm({ initial, aux, readOnly = false }: { initial: ProductAdminInput; aux: ProductFormAux; readOnly?: boolean }) {
  const router = useRouter();
  const sp = useSearchParams();
  const fromUrl = sp.get("tab");
  const [tab, setTab] = useState<Tab>(TABS.includes(fromUrl as Tab) ? (fromUrl as Tab) : "info");
  const isNew = initial.id === undefined;

  return (
    <Form<ProductAdminInput>
      schemaKey="product"
      schema={productAdminSchema}
      initial={initial}
      action={isNew ? "/api/products" : `/api/products/${String(initial.id)}`}
      method={isNew ? "POST" : "PUT"}
      draftKey={isNew ? "new" : String(initial.id)}
      readOnly={readOnly}
      onSaved={(data) => {
        const id = (data as { id?: number }).id;
        toast(isNew ? fa["products.created"] : fa["products.saved"]);
        if (isNew && id !== undefined) router.push(`/products/${String(id)}`);
        else router.refresh();
      }}
      extraActions={
        !isNew && initial.id !== undefined ? (
          <>
            <ButtonLink external variant="outline" href={`${aux.origin}/product/${encodeURIComponent(initial.slug)}/`} icon={<ExternalLink size={15} aria-hidden="true" />}>
              {fa["products.view"]}
            </ButtonLink>
            <ProductActions id={initial.id} archived={aux.archived} />
          </>
        ) : undefined
      }
    >
      {(f) => {
        const problems = saveProblems(f.errors);
        return (
          <div className="space-y-4">
            {readOnly ? <p className="ui-note">{fa["products.readOnly"]}</p> : null}
            {initial.id !== undefined && !aux.archived && !readOnly ? (
              <UnavailableAction
                id={initial.id}
                unavailable={initial.stockPolicy === "track" && !initial.allowBackorder && aux.stock?.stockQty === 0}
                restoreQty={restoreQty(aux.history)}
                dirty={f.dirty}
                submitting={f.submitting}
              />
            ) : null}
            <SaveProblems problems={problems} onTab={setTab} />
            <Tabs
              tabs={TABS.filter((t) => t !== "history" || aux.history !== null).map((t) => ({ key: t, label: fa[`products.tab.${t}`], alert: problems.some((p) => p.tab === t) }))}
              current={tab}
              onChange={(k) => setTab(k as Tab)}
            />
            {/* Read-only: one disabled fieldset silences every control in the tab; the tabs themselves stay usable. */}
            <fieldset disabled={readOnly} className="ui-fieldset">
              {tab === "info" ? <TabInfo f={f} aux={aux} isNew={isNew} origin={aux.origin} /> : null}
              {tab === "price" ? <TabPriceStock f={f} canCost={aux.canCost} canPrice={aux.canPrice} stock={aux.stock} /> : null}
              {tab === "images" ? <TabImages f={f} previews={aux.previews} /> : null}
              {tab === "specs" ? <TabSpecs f={f} attributes={aux.attributes} /> : null}
              {tab === "seo" ? <TabSeo f={f} legacySlug={aux.legacySlug} origin={aux.origin} /> : null}
              {tab === "relations" ? <TabRelations f={f} names={aux.relationNames} siblings={aux.siblings} /> : null}
              {tab === "history" && aux.history !== null ? <TabHistory history={aux.history} /> : null}
            </fieldset>
          </div>
        );
      }}
    </Form>
  );
}
