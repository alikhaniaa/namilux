export * from "./media";
export * from "./cards";
export * from "./sort";
export * from "./models";
export * from "./facets";
export * from "./list";
export * from "./categories";
export * from "./brands";
export * from "./collections";
export * from "./attributes";
export * from "./search-index";
export * from "./home";
export * from "./nav";
export * from "./bulk-price";
export * from "./price-sheet";
export * from "./import-csv";
export * from "./archive";
export * from "./products.service";
export type {
  ProductRow,
  ProductAdminRow,
  ProductImageRow,
  SpecRow,
  ProductCategoryRef,
  ProductCollectionRef,
  ProductAttributeRow,
  ProductRelationRow,
  ProductFull,
  PriceHistoryRow,
  MovementRow,
} from "./products.repo";
// DECISION (M8 admin): read-only card-source lookup by ids, used by admin editors to label picked products.
export { findCardSources } from "./products.repo";
// The pricing section resolves «همهٔ نتایج این فیلتر» with the product list's own predicate.
export { adminProductIds } from "./products.repo";
// 4 Sep 2026: the build's generateStaticParams for /product/[slug] (apps/web/src/server/static-params.ts).
export { listPublicSlugs } from "./products.repo";
// the SnappPay feed pages through every public product (server/snapppay-feed.ts)
export { listPublicIds, listSnapppayFeedProducts } from "./products.repo";
// The instalment rule lives in the panel; changing it re-derives every non-manual row (the admin's
// settings route calls this and then revalidates the catalogue, exactly like a bulk price change).
export { recomputeInstalmentPrices } from "./products.repo";
export type { InstalmentPriceFields } from "./products.repo";
export * from "./media-admin";
export * from "./fx";
export * from "./models-admin";
export * from "./snapppay-feed";
