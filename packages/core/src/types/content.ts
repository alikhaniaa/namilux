import type {
  BannerSlot,
  BannerTheme,
  ContentStatus,
  EventType,
  JobStatus,
  JobType,
  MenuItemKind,
  OrderStatus,
  PageTemplate,
  RedirectCode,
  RedirectSource,
  SitemapName,
  UaClass,
} from "./enums";
import type { Actor, ImageRef, IsoDate, IsoDateTime, SeoFields, Toman, Ulid } from "./common";
import type { SalesChannel } from "../channel";

export type { PostInput, PageInput, FaqInput, MenuInput, MenuItemInput, RedirectInput } from "../validation/content";
export type { BannerInput } from "../validation/marketing";
export type { BeaconInput } from "../validation/analytics";

export type PostCard = {
  id: number;
  slug: string;
  title: string;
  excerpt: string;
  cover: ImageRef | null;
  publishedAt: IsoDateTime;
  readMinutes: number;
  tags: string[];
};

export type PostView = PostCard & {
  bodyHtml: string;
  authorName: string;
  status: ContentStatus;
  relatedProductIds: number[];
  seo: SeoFields;
  updatedAt: IsoDateTime;
};

export type PageView = {
  id: number;
  slug: string;
  title: string;
  bodyHtml: string;
  template: PageTemplate;
  status: ContentStatus;
  seo: SeoFields;
  updatedAt: IsoDateTime;
};

export type Faq = { id: number; groupKey: string; question: string; answerHtml: string; sort: number; isActive: boolean };

// DECISION (M1): a stored menu row carries no `count` and no `image` - both are produced by
// `catalog/nav.resolveMenuItem` and live on `ResolvedMenuItem`. Leaving them optional here made
// `Omit<MenuItem, "children"> & { count: number | null }` collapse `count` to `number`, so a
// resolved row could not say "this target has no count" without a type assertion.
export type MenuItem = {
  label: string;
  href: string;
  kind: MenuItemKind;
  ref?: string;
  children?: MenuItem[];
  badge?: string;
};

export type Banner = {
  id: number;
  slot: BannerSlot;
  title: string;
  subtitle: string | null;
  ctaLabel: string | null;
  ctaHref: string | null;
  mediaLight: ImageRef | null;
  mediaDark: ImageRef | null;
  theme: BannerTheme;
  startsAt: IsoDateTime | null;
  endsAt: IsoDateTime | null;
  isActive: boolean;
  sort: number;
  targeting: { collectionSlug?: string; brandSlug?: string } | null;
};

export type Redirect = {
  id: number;
  fromPath: string;
  toPath: string;
  code: RedirectCode;
  source: RedirectSource;
  hits: number;
  lastHitAt: IsoDateTime | null;
  isActive: boolean;
};

export type SitemapEntry = { loc: string; lastmod: IsoDateTime | null; images?: string[] };
export type SitemapIndexEntry = { name: SitemapName; lastmod: IsoDateTime };

export type MetaInput = {
  path: string;
  title: string | null;
  description: string | null;
  robots: string;
  ogType: "website" | "article" | "product";
  ogImage: string | null;
  origin: string;
  siteName: string;
  titleTemplate: string;
  publishedAt?: IsoDateTime;
  modifiedAt?: IsoDateTime;
};

/** Structural subset of Next's Metadata (see rules). */
export type Metadata = {
  title: string;
  description?: string;
  alternates: { canonical: string };
  robots: string;
  openGraph: {
    title: string;
    description?: string;
    // DECISION (M1): "product" is a real Open Graph type and `MetaInput.ogType` already offers it;
    // without it here a PDP would have to be published as og:type=website, which is what the legacy
    // crawl did NOT do. Widened rather than mapped, so the two ends stay the same three values.
    type: "website" | "article" | "product";
    url: string;
    siteName: string;
    locale: "fa_IR";
    images: { url: string; width?: number; height?: number; alt?: string }[];
    publishedTime?: string;
    modifiedTime?: string;
  };
  twitter: { card: "summary_large_image"; title: string; description?: string; images: string[] };
  other?: Record<string, string>;
};

export type BeaconEvent = {
  type: EventType;
  path: string;
  ref: string | null;
  productId: number | null;
  sessionHash: string;
  uaClass: UaClass;
  props: Record<string, string | number | boolean> | null;
  ts: IsoDateTime;
};

export type DashboardRange = "today" | "7d" | "30d" | { from: IsoDate; to: IsoDate };

/** One day of the dashboard's sales chart (Tehran calendar day, placed orders that were paid). */
export type DashboardDay = { day: IsoDate; revenue: Record<SalesChannel, Toman>; orders: number };

export type DashboardData = {
  range: DashboardRange;
  /** The storefront every figure below is confined to, or null for both (see authz ROLE_CHANNEL). */
  channel: SalesChannel | null;
  revenue: { today: Toman; d7: Toman; d30: Toman };
  /** The selected range and the equally long period right before it - the deltas on the KPI cards. */
  period: { revenue: Toman; orders: number; aov: Toman; previous: { revenue: Toman; orders: number; aov: Toman } };
  /** Sales of the selected range per storefront (both are zero-filled). */
  byChannel: Record<SalesChannel, { revenue: Toman; orders: number }>;
  /** The last 30 Tehran days, oldest first, zero-filled. */
  series: DashboardDay[];
  ordersByStatus: Partial<Record<OrderStatus, number>>;
  aov: Toman;
  conversion: number;
  topProducts: { productId: number; displayName: string; qty: number; revenue: Toman }[];
  lowStock: { productId: number; displayName: string; available: number }[];
  inbox: { concierge: number; questions: number; reviews: number; returns: number; contact: number };
  otp: { sendsToday: number; smsSpendToday: Toman; budget: Toman };
  jobs: { failed: number; dead: number; queued: number };
  lastBackupAt: IsoDateTime | null;
  workerHeartbeatAt: IsoDateTime | null;
  revalidateQueue: number;
};

export type Job = {
  id: Ulid;
  type: JobType;
  payload: Record<string, unknown>;
  status: JobStatus;
  runAt: IsoDateTime;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  lockedBy: string | null;
  lockedAt: IsoDateTime | null;
  uniqueKey: string | null;
  createdAt: IsoDateTime;
  finishedAt: IsoDateTime | null;
};

export type AuditRow = {
  id: number;
  actor: Actor;
  action: string;
  entity: string;
  entityId: string;
  before: unknown;
  after: unknown;
  createdAt: IsoDateTime;
};

export type SecurityEvent = {
  id: number;
  kind: string;
  ip: string | null;
  actor: string | null;
  detail: Record<string, unknown>;
  createdAt: IsoDateTime;
};

export type NotFoundRow = { path: string; hits: number; referrers: string[]; lastHitAt: IsoDateTime };

export type SeoSnapshot = {
  path: string;
  title: string | null;
  description: string | null;
  canonical: string | null;
  robots: string | null;
  schemaTypes: string[];
  crawledAt: IsoDateTime;
};
