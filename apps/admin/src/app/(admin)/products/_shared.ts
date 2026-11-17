import "server-only";
import { findCardSources, getProductAdmin, listAttributes, listBrands, listCategoryTree, listCollections, listProductImagesAdmin } from "@namilux/core";
import type { CategoryTreeNode, ProductAdminInput, ProductAdminView, ProductImageAdminRow } from "@namilux/core";
import type { ProductFormAux } from "@/components/products/ProductForm";
import type { TreeNode } from "@/components/forms/TreePicker";
import { env } from "@/env";
import { db } from "@/lib/db";

function toTree(nodes: CategoryTreeNode[]): TreeNode[] {
  return nodes.filter((n) => n.status !== "archived").map((n) => ({ id: n.id, name: n.name, children: toTree(n.children) }));
}

export async function loadTaxonomy(): Promise<Pick<ProductFormAux, "brands" | "categories" | "collections" | "attributes">> {
  const [brands, tree, collections, attributes] = await Promise.all([listBrands(db), listCategoryTree(db), listCollections(db), listAttributes(db)]);
  return {
    brands: brands.map((b) => ({ id: b.id, name: b.name })),
    categories: toTree(tree),
    collections: collections.map((c) => ({ id: c.id, name: c.name, kind: c.kind })),
    attributes: attributes.map((a) => ({ id: a.id, key: a.key, label: a.label, kind: a.kind, unit: a.unit })),
  };
}

/**
 * `canCost` decides whether the form carries the cost key AT ALL. The value is not merely hidden:
 * an admin's payload has no `costPrice`, which the server reads as "leave the stored cost alone"
 * (core: writeValuesFor) and which `assertMayWriteCost` would refuse if it appeared.
 */
export function emptyProduct(canCost: boolean): ProductAdminInput {
  return {
    slug: "",
    name: "",
    displayName: "",
    brandId: null,
    modelId: null,
    sku: null,
    modelCode: null,
    colorName: null,
    colorHex: null,
    swatchMediaId: null,
    status: "draft",
    visibility: "public",
    price: 0,
    compareAtPrice: null,
    ...(canCost ? { costPrice: null } : {}),
    instalmentPrice: null,
    instalmentPriceManual: false,
    // A new product is instalment-eligible unless the editor unticks the box; the column default is
    // the same `true`, so the form and the database agree from the first save.
    instalmentEligible: true,
    priceBasis: "manual",
    basePrice: null,
    baseCurrency: null,
    stockPolicy: "track",
    allowBackorder: false,
    lowStockThreshold: 3,
    maxPerOrder: 5,
    shortHtml: "",
    descriptionHtml: "",
    warrantyMonths: null,
    warrantyText: null,
    weightG: null,
    lengthMm: null,
    widthMm: null,
    heightMm: null,
    videoMediaId: null,
    seoTitle: null,
    seoDescription: null,
    robots: "index, follow",
    categoryIds: [],
    collectionIds: [],
    images: [],
    specs: [],
    attributes: [],
    relations: [],
    publishedAt: null,
  };
}

export function viewToInput(
  v: ProductAdminView,
  images: ProductImageAdminRow[],
  attributeDefs: { id: number; key: string }[],
  canCost: boolean,
): ProductAdminInput {
  const r = v.row;
  const attrIds = new Map<string, number>(attributeDefs.map((a) => [a.key, a.id]));
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    displayName: r.displayName,
    brandId: r.brandId,
    modelId: r.modelId,
    sku: r.sku,
    modelCode: r.modelCode,
    colorName: r.colorName,
    colorHex: r.colorHex,
    swatchMediaId: r.swatchMediaId,
    status: r.status,
    visibility: r.visibility,
    price: r.price,
    compareAtPrice: r.compareAtPrice,
    ...(canCost ? { costPrice: r.costPrice } : {}),
    instalmentPrice: r.instalmentPrice,
    instalmentPriceManual: r.instalmentPriceManual,
    // The stored switch, so the price tab's checkbox shows the row's real state rather than a default.
    instalmentEligible: r.instalmentEligible,
    priceBasis: r.priceBasis,
    basePrice: r.basePrice,
    baseCurrency: (r.baseCurrency ?? null) as ProductAdminInput["baseCurrency"],
    stockPolicy: r.stockPolicy,
    allowBackorder: r.allowBackorder,
    lowStockThreshold: r.lowStockThreshold,
    maxPerOrder: r.maxPerOrder,
    shortHtml: r.shortHtml,
    descriptionHtml: r.descriptionHtml,
    warrantyMonths: r.warrantyMonths,
    warrantyText: r.warrantyText === "" ? null : r.warrantyText,
    weightG: r.weightG,
    lengthMm: r.lengthMm,
    widthMm: r.widthMm,
    heightMm: r.heightMm,
    videoMediaId: r.videoMediaId,
    seoTitle: r.seoTitle,
    seoDescription: r.seoDescription,
    robots: r.robots,
    categoryIds: v.full.categories.map((c) => ({ id: c.id, isPrimary: c.isPrimary })),
    collectionIds: v.full.collections.map((c) => c.id),
    images: images.map((im, i) => ({ mediaId: im.mediaId, role: im.role, sort: i, alt: im.alt })),
    specs: v.full.specs.map((s, i) => ({ groupName: s.groupName, label: s.label, value: s.value, sort: i })),
    attributes: v.full.attributes
      .filter((a) => attrIds.has(a.key))
      .map((a) => ({ attributeId: attrIds.get(a.key) ?? 0, valueText: a.valueText, valueNum: a.valueNum })),
    relations: v.full.relations.filter((rel) => rel.kind !== "same_model").map((rel, i) => ({ relatedId: rel.relatedId, kind: rel.kind as "related" | "accessory" | "replacement", sort: i })),
    publishedAt: r.publishedAt,
  };
}

export async function loadAux(view: ProductAdminView | null, images: ProductImageAdminRow[], canCost: boolean, canPrice: boolean): Promise<ProductFormAux> {
  const tax = await loadTaxonomy();
  // The price tab shows what the instalment site would list for this product, so the form carries
  // the panel's rule (commission + rounding step) and derives it live beside the fixed price.
  if (view === null) {
    return { ...tax, previews: {}, relationNames: {}, siblings: [], history: null, stock: null, legacySlug: false, origin: env.SITE_ORIGIN, canCost, canPrice, archived: false };
  }
  const previews: ProductFormAux["previews"] = {};
  for (const im of images) previews[im.mediaId] = im.preview;
  const relIds = view.full.relations.map((r) => r.relatedId);
  const [cards] = await Promise.all([relIds.length === 0 ? Promise.resolve([]) : findCardSources(db, relIds)]);
  const relationNames: Record<number, string> = {};
  for (const c of cards) relationNames[c.id] = c.displayName;
  return {
    ...tax,
    previews,
    relationNames,
    siblings: view.siblings,
    history: { priceHistory: view.priceHistory, movements: view.movements, reservations: view.reservations },
    stock: { stockQty: view.row.stockQty, reservedQty: view.full.reservedQty, availableQty: view.availableQty },
    legacySlug: view.row.legacyLastmod !== null,
    origin: env.SITE_ORIGIN,
    canCost,
    canPrice,
    archived: view.row.status === "archived",
  };
}

export { getProductAdmin, listProductImagesAdmin };
