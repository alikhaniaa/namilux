import type {
  AttributeKind,
  CollectionKind,
  CollectionStatus,
  CategoryStatus,
  ImageRole,
  MenuKey,
  MovementReason,
  PriceBasis,
  ProductScopeKind,
  ProductStatus,
  RelationKind,
  StockPolicy,
  Visibility,
} from "../constants";
import type { Actor, Badge, Crumb, ImageRef, IsoDateTime, SeoFields, Toman } from "./common";
import type { Banner, MenuItem, PostCard } from "./content";
import type { PlpState } from "../url/plp-state";

export type {
  ProductAdminInput,
  BulkPriceOp,
  StockAdjustInput,
  CategoryAdminInput,
  BrandAdminInput,
  CollectionAdminInput,
  AttributeAdminInput,
  CollectionRule,
  CsvRow,
} from "../validation/catalog-admin";

export type ProductBrandRef = { slug: string; name: string; nameEn: string };

export type VariantSwatch = {
  productId: number;
  slug: string;
  colorName: string;
  colorHex: string | null;
  swatch: ImageRef | null;
  image: ImageRef | null;
  available: boolean;
  onRequest: boolean;
};

export type ProductCard = {
  id: number;
  slug: string;
  displayName: string;
  // DECISION: nullable - the spec leaves brand_id NULL on 33 legacy products, and catalog/cards.ts
  // records the same resolution in its header. A sentinel with an empty slug would let a caller
  // emit /brand// (an SEO-contract violation), so the absence is typed, not encoded.
  brand: ProductBrandRef | null;
  modelCode?: string;
  price: Toman;
  compareAt?: Toman;
  onRequest: boolean;
  // DECISION: boolean, like VariantSwatch.available above and catalog/cards.ts contract - the
  // storefront must never receive a stock quantity (the spec, cards.ts rules).
  available: boolean;
  lowStock: boolean;
  badges: Badge[];
  image?: ImageRef;
  images2?: ImageRef;
  variants: VariantSwatch[];
  colorName?: string;
  rating?: { avg: number; count: number };
  /**
   * Set ONLY by the instalment storefront (apps/web server/channel-price): `false` when the admin
   * switched the product off for instalments (products.instalment_eligible). Such a card is also
   * repriced to 0 / `onRequest` there, so no surface prints an instalment price or offers «افزودن
   * به سبد» for it; this flag is what lets the copy say why. Absent = not applicable (main site).
   */
  instalmentEligible?: boolean;
  /** sort helpers - never rendered */
  publishedAt: IsoDateTime | null;
  salesRank: number;
};

export type SpecRow = { label: string; value: string };
export type SpecGroup = { name: string | null; rows: SpecRow[] };

export type Dims = { widthMm: number; heightMm: number; lengthMm: number; weightG: number | null };

export type ProductCollectionRef = { slug: string; name: string; kind: CollectionKind };

export type ProductDetail = ProductCard & {
  name: string;
  sku: string | null;
  shortHtml: string;
  descriptionHtml: string;
  specs: SpecGroup[];
  dims?: Dims;
  warrantyMonths?: number;
  warrantyText?: string;
  categories: Crumb[];
  collections: ProductCollectionRef[];
  related: ProductCard[];
  accessories: ProductCard[];
  siblings: ProductCard[];
  gallery: ImageRef[];
  video?: { key: string; poster: ImageRef | null; durationMs: number | null };
  maxPerOrder: number;
  allowBackorder: boolean;
  status: ProductStatus;
  visibility: Visibility;
  seo: SeoFields;
  jsonld: object;
};

export type ProductScope = {
  kind: ProductScopeKind;
  id?: number;
  slug?: string;
  ids?: number[];
};

export type ProductQuery = { scope: ProductScope } & PlpState;

// DECISION: the facet shapes below are the contract of catalog/facets.ts verbatim (group names in
// the singular, `total`, and the `hex`/`swatch` a colour chip needs to draw itself). The earlier
// plural/`values` variant here could not carry either, and the spec names `Facets` without a shape,
// so the owning file's header wins. types/* stays the single declaration site (src/index.ts rule).
// `AttributeKind` already comes from ./enums (imported above) - do not redeclare it here.
export type FacetOption = { value: string; label: string; count: number; hex?: string; swatch?: ImageRef };
export type AttributeFacet = { key: string; label: string; unit: string | null; kind: AttributeKind; options: FacetOption[] };

export type Facets = {
  brand: FacetOption[];
  collection: FacetOption[];
  color: FacetOption[];
  price: { min: Toman; max: Toman };
  avail: { in: number; sale: number; ready: number };
  attrs: AttributeFacet[];
  total: number;
};

export type ListProductsResult = {
  items: ProductCard[];
  total: number;
  facets: Facets;
  page: number;
  pageSize: number;
};

export type CategoryChild = { id: number; name: string; path: string; count: number };

export type CategoryView = {
  id: number;
  slug: string;
  path: string;
  name: string;
  descriptionHtml: string;
  status: CategoryStatus;
  inSitemap: boolean;
  crumbs: Crumb[];
  children: CategoryChild[];
  parentId: number | null;
  seo: SeoFields;
};

export type BrandView = {
  id: number;
  slug: string;
  nameFa: string;
  nameEn: string;
  claim: string | null;
  storyHtml: string;
  logo: ImageRef | null;
  isActive: boolean;
  productCount: number;
  buyableCount: number;
  seo: SeoFields;
};

export type CollectionCard = {
  id: number;
  slug: string;
  name: string;
  kind: CollectionKind;
  cover: ImageRef | null;
  coverDark: ImageRef | null;
  count: number;
};

export type CollectionView = CollectionCard & {
  descriptionHtml: string;
  status: CollectionStatus;
  parentId: number | null;
  children: CollectionCard[];
  startsAt: IsoDateTime | null;
  endsAt: IsoDateTime | null;
  seo: SeoFields;
};

// DECISION (M1): these are the contract of `catalog/nav.ts` verbatim. The earlier shapes here
// (`nameFa`/`logo`/`cover`, counts `{all,ready,sale,new}`, bare `MenuItem`) could not carry the
// `href` every shell row needs - and an emitted URL must come from `url/routes.ts`, not be rebuilt
// at each call site. The owning module's header wins; types/* stays the one
// declaration site (src/index.ts rule).
export type NavBrand = {
  slug: string;
  name: string;
  nameEn: string;
  count: number;
  image: ImageRef | null;
  href: string;
};
export type NavCollectionChild = { slug: string; name: string; count: number; href: string };
export type NavCollection = {
  slug: string;
  name: string;
  count: number;
  image: ImageRef | null;
  href: string;
  children: NavCollectionChild[];
};
export type NavCounts = { products: number; buyable: number; onSale: number; brands: number };

/** A menu row with its target and label already resolved against the catalogue. */
export type ResolvedMenuItem = Omit<MenuItem, "children"> & {
  href: string;
  count: number | null;
  image: ImageRef | null;
  children: ResolvedMenuItem[];
};

export type NavData = {
  menus: Record<MenuKey, ResolvedMenuItem[]>;
  brands: NavBrand[];
  collections: NavCollection[];
  counts: NavCounts;
  generatedAt: IsoDateTime;
};

/** the spec - the client search index row; keys are deliberately short (≈120 KB gz budget). */
export type SearchIndexEntry = {
  id: number;
  slug: string;
  dn: string;
  b: string;
  m?: string;
  p: Toman;
  s: boolean;
  i?: string;
  c: string[];
};

// DECISION (M1): the three shapes below are the contract of `catalog/home.ts` verbatim - the
// module that assembles them. The earlier variants here could not carry what the spec and that
// header require (`promoBar` for the header line, `generatedAt` for the cache stamp, the store
// `hours` NOTE «همه‌روزه ۱۰ تا ۲۱» that settings actually stores, the short address of the store
// chapter) and carried two fields nothing produces (a chapter has no product rail in the spec, and
// no setting or banner holds a store photograph - the store picture is design photography in
// apps/web). The owning module's header wins, as it already did for `Facets` and `NavData` above;
// types/* stays the one declaration site (src/index.ts rule). Two substitutions are deliberate:
// `brand` is the canonical `BrandView` (the chapter renders the brand's claim, which the header's
// `BrandSummary` - declared in catalog/brands.ts - does not carry) and `collections` stays
// `CollectionCard[]` because types/* must not import from ../catalog. Recorded in
// the spec.
export type StoreInfo = {
  name: string;
  address: string;
  addressShort: string;
  hours: string;
  phoneMobile: string;
  phoneLand: string;
  whatsapp: string;
  mapsUrl: string;
  instagram: string;
};

export type BrandChapter = { brand: BrandView; banner: Banner | null };

export type HomeData = {
  hero: Banner | null;
  promoBar: Banner[];
  readyRail: ProductCard[];
  chapters: BrandChapter[];
  collections: CollectionCard[];
  saleGrid: ProductCard[];
  journal: PostCard[];
  store: StoreInfo;
  generatedAt: IsoDateTime;
};

export type AttributeDef = {
  id: number;
  key: string;
  label: string;
  unit: string | null;
  kind: AttributeKind;
  isFilterable: boolean;
  isComparable: boolean;
  sort: number;
};

export type ProductImageRow = { id: number; media: ImageRef; role: ImageRole; sort: number; alt: string };
export type ProductRelationRow = { relatedId: number; kind: RelationKind; sort: number };

export type PriceHistoryRow = {
  id: number;
  productId: number;
  price: Toman;
  compareAtPrice: Toman | null;
  actor: Actor;
  note: string | null;
  createdAt: IsoDateTime;
};

export type InventoryMovementRow = {
  id: number;
  productId: number;
  delta: number;
  reason: MovementReason;
  orderId: string | null;
  actor: Actor;
  note: string | null;
  createdAt: IsoDateTime;
};

/** Admin-only pricing snapshot (includes cost) - never returned by web loaders. */
export type ProductPricing = {
  price: Toman;
  compareAtPrice: Toman | null;
  costPrice: Toman | null;
  priceBasis: PriceBasis;
  basePrice: number | null;
  baseCurrency: string | null;
  priceUpdatedAt: IsoDateTime | null;
  stockPolicy: StockPolicy;
  stockQty: number;
  reserved: number;
};

export type BulkPricePreviewRow = {
  id: number;
  displayName: string;
  before: { price: number; compareAt: number | null };
  after: { price: number; compareAt: number | null };
  saleEnded: boolean;
};
export type BulkPriceSkipReason = "on_request" | "negative" | "compare_below_price" | "fx_basis" | "unchanged";
export type BulkPricePreview = {
  dryRun: true;
  count: number;
  rows: BulkPricePreviewRow[];
  skipped: { id: number; displayName: string; reason: BulkPriceSkipReason }[];
};
export type BulkPriceResult = { dryRun: false; updated: number; skipped: number; tags: string[]; jobIds: string[] };

export type ImportReport = {
  dryRun: boolean;
  created: number;
  updated: number;
  unchanged: number;
  errors: { row: number; message: string }[];
};
