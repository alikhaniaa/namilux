import { z } from "zod";
import {
  ATTRIBUTE_KINDS,
  BASE_CURRENCIES,
  CATEGORY_STATUSES,
  COLLECTION_KINDS,
  COLLECTION_STATUSES,
  DISPLAY_NAME_MAX,
  IMAGE_ROLES,
  PRICE_BASES,
  PRODUCT_STATUSES,
  RELATION_KINDS,
  STOCK_POLICIES,
  VISIBILITIES,
} from "../constants";
import { htmlField, seoFields } from "./content";
import {
  clean,
  cleanFold,
  uniqueBy,
  zBool,
  zId,
  zInt,
  zIsoDateTime,
  zLatinKey,
  zLatinSlug,
  zPath,
  zSlug,
  zSort,
  zText,
  zTomanInput,
  zUlid,
  FA,
} from "./common";

export const modelCodeSchema = z.preprocess(
  (v) => {
    const c = cleanFold(v);
    return typeof c === "string" ? c.toUpperCase() : c;
  },
  z.string().regex(/^[A-Z0-9][A-Z0-9.\-/ ]{0,39}$/, FA.invalid),
);

export const colorHexSchema = z.preprocess(
  (v) => {
    const c = clean(v);
    return typeof c === "string" ? c.toLowerCase() : c;
  },
  z.string().regex(/^#[0-9a-f]{6}$/, FA.invalid),
);

export const productImageSchema = z
  .object({
    mediaId: zUlid,
    role: z.enum(IMAGE_ROLES),
    sort: zSort,
    alt: zText(200).default(""),
  })
  .strict();

export const productSpecSchema = z
  .object({
    groupName: zText(80).nullable().optional(),
    label: zText(120, 1),
    value: zText(500, 1),
    sort: zSort,
  })
  .strict();

// A newly added row may only carry the preceding row's group. Ignore it when both
// content fields are blank, but retain original row indices for incomplete-row errors.
const productSpecsInputSchema = z
  .array(productSpecSchema.extend({ label: zText(120), value: zText(500) }))
  .max(200, FA.tooLong)
  .superRefine((rows, ctx) => {
    rows.forEach((row, i) => {
      if (row.label === "" && row.value === "") return;
      if (row.label === "") {
        ctx.addIssue({ code: "custom", path: [i, "label"], message: "عنوان مشخصه را وارد کنید یا ردیف را حذف کنید." });
      }
      if (row.value === "") {
        ctx.addIssue({ code: "custom", path: [i, "value"], message: "مقدار مشخصه را وارد کنید یا ردیف را حذف کنید." });
      }
    });
  })
  .transform((rows) => rows.filter((row) => row.label !== "" || row.value !== ""));

export const productAttributeValueSchema = z
  .object({
    attributeId: zId,
    valueText: zText(200).nullable().optional(),
    valueNum: z.number().finite().nullable().optional(),
  })
  .strict()
  .refine((v) => (v.valueText != null && v.valueText !== "") || v.valueNum != null, { message: FA.required, path: ["valueText"] });

export const productRelationSchema = z
  .object({
    relatedId: zId,
    kind: z.enum(RELATION_KINDS),
    sort: zSort,
  })
  .strict();

export const productCategorySchema = z
  .object({
    id: zId,
    isPrimary: zBool.default(false),
  })
  .strict();

const saleRule = (price: number, compareAt: number | null | undefined) =>
  compareAt == null || (price > 0 && compareAt > price);

export const productAdminSchema = z
  .object({
    id: zId.optional(),
    slug: zSlug,
    name: zText(300, 1),
    displayName: zText(DISPLAY_NAME_MAX, 3),
    brandId: zId.nullable().optional(),
    modelId: zId.nullable().optional(),
    sku: zText(64).nullable().optional(),
    modelCode: modelCodeSchema.nullable().optional(),
    colorName: zText(40).nullable().optional(),
    colorHex: colorHexSchema.nullable().optional(),
    swatchMediaId: zUlid.nullable().optional(),
    status: z.enum(PRODUCT_STATUSES),
    visibility: z.enum(VISIBILITIES),
    price: zTomanInput,
    compareAtPrice: zTomanInput.nullable().optional(),
    costPrice: zTomanInput.nullable().optional(),
    // The instalment storefront's price. Only meaningful while `instalmentPriceManual` is on: with
    // the box unticked the server derives it from `price` and ignores whatever the field held.
    instalmentPrice: zTomanInput.nullable().optional(),
    instalmentPriceManual: zBool.default(false),
    // May the product be bought in instalments? OPTIONAL with no default on purpose: an ABSENT key
    // keeps the stored value (a form that predates the switch must not silently re-enable a
    // product), and a new product without it is eligible - the column default, which is also what
    // every pre-existing product was migrated to.
    instalmentEligible: zBool.optional(),
    priceBasis: z.enum(PRICE_BASES).default("manual"),
    basePrice: z.number().finite().nonnegative().nullable().optional(),
    baseCurrency: z.enum(BASE_CURRENCIES).nullable().optional(),
    stockPolicy: z.enum(STOCK_POLICIES).default("track"),
    allowBackorder: zBool.default(false),
    lowStockThreshold: zInt(0, 1000).default(3),
    maxPerOrder: zInt(1, 50).default(5),
    shortHtml: htmlField(5_000).default(""),
    descriptionHtml: htmlField(200_000).default(""),
    warrantyMonths: zInt(0, 120).nullable().optional(),
    warrantyText: zText(200).nullable().optional(),
    weightG: zInt(0, 1_000_000).nullable().optional(),
    lengthMm: zInt(0, 1_000_000).nullable().optional(),
    widthMm: zInt(0, 1_000_000).nullable().optional(),
    heightMm: zInt(0, 1_000_000).nullable().optional(),
    videoMediaId: zUlid.nullable().optional(),
    ...seoFields,
    categoryIds: z.array(productCategorySchema).max(20, FA.tooLong).default([]),
    collectionIds: z.array(zId).max(30, FA.tooLong).default([]),
    images: z.array(productImageSchema).max(30, FA.tooLong).default([]),
    specs: productSpecsInputSchema.default([]),
    attributes: z.array(productAttributeValueSchema).max(100, FA.tooLong).default([]),
    relations: z.array(productRelationSchema).max(60, FA.tooLong).default([]),
    publishedAt: zIsoDateTime.nullable().optional(),
  })
  .strict()
  .superRefine((p, ctx) => {
    if (!saleRule(p.price, p.compareAtPrice)) {
      ctx.addIssue({ code: "custom", path: ["compareAtPrice"], message: FA.invalid });
    }
    if (p.priceBasis === "fx" && !(p.basePrice != null && p.basePrice > 0 && p.baseCurrency)) {
      ctx.addIssue({ code: "custom", path: ["basePrice"], message: FA.required });
    }
    if (p.categoryIds.filter((c) => c.isPrimary).length > 1) {
      ctx.addIssue({ code: "custom", path: ["categoryIds"], message: FA.invalid });
    }
    if (!uniqueBy(p.categoryIds, (c) => c.id)) {
      ctx.addIssue({ code: "custom", path: ["categoryIds"], message: FA.invalid });
    }
    if (p.images.filter((i) => i.role === "primary").length > 1 || !uniqueBy(p.images, (i) => i.mediaId)) {
      ctx.addIssue({ code: "custom", path: ["images"], message: FA.invalid });
    }
    if (!uniqueBy(p.collectionIds, (i) => i)) {
      ctx.addIssue({ code: "custom", path: ["collectionIds"], message: FA.invalid });
    }
    if (!uniqueBy(p.attributes, (a) => a.attributeId)) {
      ctx.addIssue({ code: "custom", path: ["attributes"], message: FA.invalid });
    }
    if (!uniqueBy(p.relations, (r) => `${r.relatedId}:${r.kind}`) || (p.id != null && p.relations.some((r) => r.relatedId === p.id))) {
      ctx.addIssue({ code: "custom", path: ["relations"], message: FA.invalid });
    }
  });

export const setPriceSchema = z
  .object({
    price: zTomanInput,
    compareAtPrice: zTomanInput.nullable(),
    note: zText(200).optional(),
  })
  .strict()
  .refine((p) => saleRule(p.price, p.compareAtPrice), { message: FA.invalid, path: ["compareAtPrice"] });

export const stockAdjustSchema = z
  .object({
    delta: zInt(-10_000, 10_000).refine((d) => d !== 0, FA.invalid),
    reason: z.enum(["restock", "adjust", "return"]),
    note: zText(200).optional(),
  })
  .strict();

export const archiveProductSchema = z.object({ redirectTo: zPath.nullable() }).strict();

export const productFilterSchema = z
  .object({
    brandIds: z.array(zId).max(50).optional(),
    categoryIds: z.array(zId).max(50).optional(),
    collectionIds: z.array(zId).max(50).optional(),
    status: z.array(z.enum(PRODUCT_STATUSES)).max(3).optional(),
    stockState: z.enum(["in", "out", "low", "backorder"]).optional(),
    priceState: z.enum(["priced", "on_request", "sale"]).optional(),
    missing: z.array(z.enum(["image", "description", "spec", "seo"])).max(4).optional(),
    modelId: zId.optional(),
    q: zText(120).optional(),
  })
  .strict();

export const bulkPriceScopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("brand"), id: zId }).strict(),
  z.object({ kind: z.literal("category"), id: zId }).strict(),
  z.object({ kind: z.literal("collection"), id: zId }).strict(),
  z.object({ kind: z.literal("selection"), ids: z.array(zId).min(1, FA.required).max(2000, FA.tooLong) }).strict(),
  z.object({ kind: z.literal("filter"), filter: productFilterSchema }).strict(),
]);

export const bulkPriceOpSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("percent"), value: zInt(-90, 500) }).strict(),
  z.object({ kind: z.literal("fixed"), value: zInt(-10_000_000_000, 10_000_000_000) }).strict(),
  z.object({ kind: z.literal("set"), value: zTomanInput }).strict(),
  z.object({ kind: z.literal("round"), to: z.union([z.literal(10_000), z.literal(100_000)]) }).strict(),
]);

export const bulkPriceSchema = z
  .object({
    scope: bulkPriceScopeSchema,
    op: bulkPriceOpSchema,
    expected: z.array(z.object({ id: zId, price: zTomanInput, compareAt: zTomanInput.nullable() }).strict()).min(1).max(2000).optional(),
    applyTo: z.enum(["price", "compare_at", "both"]).default("price"),
    note: zText(200).optional(),
  })
  .strict();

export const csvRowSchema = z
  .object({
    id: zId.optional(),
    slug: zSlug.optional(),
    sku: zText(64).optional(),
    price: zTomanInput.optional(),
    compareAtPrice: zTomanInput.nullable().optional(),
    stockQty: zInt(0, 100_000).optional(),
    status: z.enum(PRODUCT_STATUSES).optional(),
    displayName: zText(DISPLAY_NAME_MAX).optional(),
  })
  .strict()
  .refine((r) => r.id != null || (r.slug != null && r.slug !== "") || (r.sku != null && r.sku !== ""), {
    message: FA.required,
    path: ["id"],
  });

export const csvImportSchema = z
  .object({
    rows: z.array(csvRowSchema).min(1, FA.required).max(5000, FA.tooLong),
    dryRun: zBool.default(true),
  })
  .strict();

export const categoryAdminSchema = z
  .object({
    id: zId.optional(),
    // `null` (a root category), never `undefined`: upsertCategory branches on `!== null`, so an
    // omitted key used to be treated as a parent id and looked up.
    parentId: zId.nullable().default(null),
    slug: zSlug,
    name: zText(120, 1),
    descriptionHtml: htmlField(50_000).default(""),
    status: z.enum(CATEGORY_STATUSES),
    inSitemap: zBool.default(true),
    sort: zSort,
    ...seoFields,
  })
  .strict();

export const brandAdminSchema = z
  .object({
    id: zId.optional(),
    slug: zLatinSlug,
    nameFa: zText(60, 1),
    nameEn: zText(60, 1),
    logoMediaId: zUlid.nullable().optional(),
    storyHtml: htmlField(50_000).default(""),
    claim: zText(120).nullable().optional(),
    isActive: zBool.default(true),
    sort: zSort,
    ...seoFields,
  })
  .strict();

export const collectionRuleSchema = z
  .object({
    brandIds: z.array(zId).max(50).optional(),
    categoryIds: z.array(zId).max(50).optional(),
    priceMin: zTomanInput.optional(),
    priceMax: zTomanInput.optional(),
    onSale: zBool.optional(),
    inStock: zBool.optional(),
    tags: z.array(zText(40, 1)).max(20).optional(),
  })
  .strict()
  .refine((r) => r.priceMin == null || r.priceMax == null || r.priceMin <= r.priceMax, {
    message: FA.invalid,
    path: ["priceMax"],
  });

export const collectionAdminSchema = z
  .object({
    id: zId.optional(),
    slug: zLatinSlug,
    // Same rule as a category's parent, and `rule` likewise: upsertCollection compares both against
    // `null`, so an omitted key has to arrive as `null`.
    parentId: zId.nullable().default(null),
    name: zText(80, 1),
    kind: z.enum(COLLECTION_KINDS),
    rule: collectionRuleSchema.nullable().default(null),
    productIds: z.array(zId).max(2000, FA.tooLong).optional(),
    coverMediaId: zUlid.nullable().optional(),
    coverDarkMediaId: zUlid.nullable().optional(),
    descriptionHtml: htmlField(50_000).default(""),
    isNav: zBool.default(false),
    startsAt: zIsoDateTime.nullable().optional(),
    endsAt: zIsoDateTime.nullable().optional(),
    status: z.enum(COLLECTION_STATUSES),
    sort: zSort,
    ...seoFields,
  })
  .strict()
  .refine((c) => !c.startsAt || !c.endsAt || c.endsAt > c.startsAt, { message: FA.invalid, path: ["endsAt"] });

export const attributeAdminSchema = z
  .object({
    id: zId.optional(),
    key: zLatinKey,
    label: zText(60, 1),
    unit: zText(16).nullable().optional(),
    kind: z.enum(ATTRIBUTE_KINDS),
    isFilterable: zBool.default(false),
    isComparable: zBool.default(false),
    sort: zSort,
  })
  .strict();

export const mediaAltSchema = z.object({ alt: zText(200) }).strict();
export const idParamSchema = z.object({ id: zId }).strict();

export type ProductAdminInput = z.infer<typeof productAdminSchema>;
export type SetPriceInput = z.infer<typeof setPriceSchema>;
export type StockAdjustInput = z.infer<typeof stockAdjustSchema>;
export type ArchiveProductInput = z.infer<typeof archiveProductSchema>;
export type ProductFilter = z.infer<typeof productFilterSchema>;
export type BulkPriceOp = z.infer<typeof bulkPriceSchema>;
export type CsvRow = z.infer<typeof csvRowSchema>;
export type CsvImportInput = z.infer<typeof csvImportSchema>;
export type CategoryAdminInput = z.infer<typeof categoryAdminSchema>;
export type BrandAdminInput = z.infer<typeof brandAdminSchema>;
export type CollectionRule = z.infer<typeof collectionRuleSchema>;
export type CollectionAdminInput = z.infer<typeof collectionAdminSchema>;
export type AttributeAdminInput = z.infer<typeof attributeAdminSchema>;
