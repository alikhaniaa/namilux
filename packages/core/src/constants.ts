// ---------------------------------------------------------------- jobs
export const JOB_TYPES = [
  "sms.send",
  "telegram.notify",
  "reservation.expire",
  "order.expire",
  "stock.back_in_stock",
  "media.process",
  "og.generate",
  "cache.revalidate",
  "cdn.purge",
  "metrics.rollup",
  "loyalty.expire",
  "loyalty.tiers",
  "consistency.stock",
  "backup.report",
  "sms.campaign",
  "seo.crawl",
  "payment.settle",
  // Housekeeping: nothing else deletes a job row, so the table only ever grew (jobs.prune).
  "jobs.prune",
] as const;
export type JobType = (typeof JOB_TYPES)[number];

export const JOB_STATUSES = ["queued", "running", "done", "failed", "dead"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/** the spec - retry backoff in minutes for attempts 1..4; the 5th failure → dead. */
export const JOB_BACKOFF_MIN = [1, 5, 25, 125] as const;
export const JOB_MAX_ATTEMPTS_DEFAULT = 5;
export const WORKER_HEARTBEAT_STALE_SEC = 180;

// ---------------------------------------------------------------- sms / telegram
export const SMS_TEMPLATES = [
  "otp",
  "order.placed_pending",
  "order.paid",
  "order.shipped",
  "order.delivered",
  "order.expired",
  "order.cancelled",
  "product.back_in_stock",
  "concierge.reply",
  "contact.reply",
  "return.received",
  "loyalty.tier_up",
  "birthday.coupon",
  "customer.welcome",
  "campaign",
] as const;
export type SmsTemplate = (typeof SMS_TEMPLATES)[number];

export const SMS_STATUSES = ["queued", "sent", "failed"] as const;
export type SmsStatus = (typeof SMS_STATUSES)[number];

/** the spec - owner Telegram notification kinds. */
export const TELEGRAM_EVENTS = [
  "order.paid",
  "concierge.request",
  "contact.message",
  "stock.low",
  "otp.breaker",
  "admin.login",
  "backup.result",
  "security.alert",
] as const;
export type TelegramEvent = (typeof TELEGRAM_EVENTS)[number];

// ---------------------------------------------------------------- content
export const BANNER_SLOTS = [
  "promo_bar",
  "home_hero",
  "home_band",
  "category_tile",
  "plp_inline",
  "pdp_band",
  "ig_landing",
] as const;
export type BannerSlot = (typeof BANNER_SLOTS)[number];

export const BANNER_THEMES = ["light", "dark", "auto"] as const;
export type BannerTheme = (typeof BANNER_THEMES)[number];

export const MENU_KEYS = ["header", "drawer", "footer_shop", "footer_help", "tabbar"] as const;
export type MenuKey = (typeof MENU_KEYS)[number];

export const MENU_ITEM_KINDS = ["url", "collection", "brand", "category", "page"] as const;
export type MenuItemKind = (typeof MENU_ITEM_KINDS)[number];

export const PAGE_TEMPLATES = [
  "default",
  "contact",
  "store",
  "warranty",
  "returns",
  "installments",
  "faq",
  "privacy",
  "terms",
  // «دربارهٔ ما» - /about-us/, the legacy contract URL. See the DECISION at SINGLETON_TEMPLATES
  // (content/pages.ts) for why it is a value of its own and not a reuse of `contact` or `store`.
  "about",
] as const;
export type PageTemplate = (typeof PAGE_TEMPLATES)[number];

export const CONTENT_STATUSES = ["draft", "published", "archived"] as const;
export type ContentStatus = (typeof CONTENT_STATUSES)[number];

export const REDIRECT_SOURCES = ["legacy", "manual", "auto_archive"] as const;
export type RedirectSource = (typeof REDIRECT_SOURCES)[number];

export const REDIRECT_CODES = [301, 410] as const;
export type RedirectCode = (typeof REDIRECT_CODES)[number];

/** the spec - child sitemap names Google already knows, plus the new collection sitemap. */
export const SITEMAP_NAMES = [
  "post-sitemap.xml",
  "page-sitemap.xml",
  "product-sitemap1.xml",
  "product-sitemap2.xml",
  "product-sitemap3.xml",
  "category-sitemap.xml",
  "product_cat-sitemap.xml",
  "pa_brand-sitemap.xml",
  "collection-sitemap.xml",
] as const;
export type SitemapName = (typeof SITEMAP_NAMES)[number];

export const ROBOTS_VALUES = ["index, follow", "noindex, follow", "noindex, nofollow", "index, nofollow"] as const;
export type RobotsValue = (typeof ROBOTS_VALUES)[number];

// ---------------------------------------------------------------- auth
export const OTP_PURPOSES = ["login", "checkout", "verify_phone", "back_in_stock"] as const;
export type OtpPurpose = (typeof OTP_PURPOSES)[number];

// `owner` is the head admin (the shop owner) and `admin` is the day-to-day back-office role the
// owner creates; `instalments` runs the instalment storefront alone (its orders, customers and
// sales, nothing of the main site - ROLE_CHANNEL); the four older rows are kept because existing
// accounts may still point at them.
// The permission each row carries is in ../authz/permissions.ts - that table is the source of truth.
export const ROLE_NAMES = ["owner", "admin", "instalments", "manager", "orders", "content", "support", "viewer"] as const;
export type RoleName = (typeof ROLE_NAMES)[number];

export const ACTOR_TYPES = ["customer", "staff", "system", "worker"] as const;
export type ActorType = (typeof ACTOR_TYPES)[number];

export const OTP_CODE_LEN = 6;
export const OTP_CODE_TTL_SEC = 180;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_COOLDOWN_SEC = 60;
export const OTP_REVERIFY_WINDOW_MIN = 10;
export const SESSION_TOKEN_BYTES = 32;
export const SESSION_MAX_AGE_DAYS = 180;
export const SESSION_TOUCH_INTERVAL_MIN = 60;
export const SESSION_COOKIE = "nl_s";
export const STAFF_SESSION_COOKIE = "nl_a";
export const STAFF_CSRF_COOKIE = "nl_a_csrf";
export const STAFF_IDLE_MIN = 30;
export const STAFF_ABSOLUTE_HOURS = 12;
export const STAFF_FAILED_ATTEMPTS_LOCK = 5;
export const STAFF_LOCK_MIN = 15;
export const STAFF_PASSWORD_MIN_LEN = 12;
export const STAFF_INVITE_TTL_HOURS = 24;
export const SUDO_WINDOW_MIN = 5;

// ---------------------------------------------------------------- commerce
export const MOVEMENT_REASONS = ["sale", "restock", "adjust", "return", "cancel", "seed"] as const;
export type MovementReason = (typeof MOVEMENT_REASONS)[number];

/** Ledger notes of the one-click stock switch above the product tabs; the editor finds the last removal by its note. */
export const STOCK_NOTE_UNAVAILABLE = "ناموجود کردن کالا از پنل مدیریت";
export const STOCK_NOTE_AVAILABLE = "موجود کردن کالا از پنل مدیریت";
export const STOCK_RESTORE_MAX = 10_000;

export const ORDER_STATUSES = [
  "draft",
  "pending_payment",
  "paid",
  "processing",
  "shipped",
  "delivered",
  "cancelled",
  "refunded",
  "returned",
  "expired",
  "failed",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_SOURCES = ["web", "admin", "phone", "instagram", "whatsapp"] as const;
export type OrderSource = (typeof ORDER_SOURCES)[number];

/** the spec order_events.type - the canonical values (column is free text, these are the canon). */
export const ORDER_EVENT_TYPES = [
  "placed",
  "payment.initiated",
  "payment.redirected",
  "payment.succeeded",
  "payment.failed",
  "payment.settled",
  "payment.reversed",
  "status.paid",
  "status.processing",
  "status.shipped",
  "status.delivered",
  "status.cancelled",
  "status.refunded",
  "status.returned",
  "status.expired",
  "status.failed",
  "note",
  "sms.sent",
  "refund.requested",
  "refund.done",
  "items.edited",
  "address.edited",
] as const;
export type OrderEventType = (typeof ORDER_EVENT_TYPES)[number];

export const PAYMENT_STATUSES = ["initiated", "redirected", "succeeded", "failed", "expired"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PAYMENT_DRIVER_KEYS = ["zarinpal", "snapppay", "mock", "manual"] as const;
export type PaymentDriverKey = (typeof PAYMENT_DRIVER_KEYS)[number];

/** Payment methods a web customer may choose. `manual` is never offered to web. */
export const WEB_PAYMENT_METHODS = ["zarinpal", "snapppay"] as const;
export type WebPaymentMethod = (typeof WEB_PAYMENT_METHODS)[number];

export const MANUAL_PAYMENT_METHODS = ["card_to_card", "cash", "pos"] as const;
export type ManualPaymentMethod = (typeof MANUAL_PAYMENT_METHODS)[number];

export const REFUND_STATUSES = ["requested", "processing", "done", "failed"] as const;
export type RefundStatus = (typeof REFUND_STATUSES)[number];

export const SHIPMENT_CARRIERS = ["post", "tipax", "courier", "pickup", "other"] as const;
export type ShipmentCarrier = (typeof SHIPMENT_CARRIERS)[number];

export const SHIPMENT_STATUSES = ["preparing", "shipped", "delivered", "returned"] as const;
export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number];

export const SHIPPING_KINDS = ["free", "flat", "by_province", "pickup"] as const;
export type ShippingKind = (typeof SHIPPING_KINDS)[number];

export const SHIPPING_METHOD_KEYS = ["free_nationwide", "express_tehran", "pickup"] as const;
export type ShippingMethodKey = (typeof SHIPPING_METHOD_KEYS)[number];

export const COUPON_KINDS = ["percent", "fixed", "free_shipping"] as const;
export type CouponKind = (typeof COUPON_KINDS)[number];

export const CUSTOMER_TIERS = ["member", "silver", "gold", "diamond"] as const;
export type CustomerTier = (typeof CUSTOMER_TIERS)[number];

export const GENDERS = ["female", "male", "other"] as const;
export type Gender = (typeof GENDERS)[number];

export const LOYALTY_REASONS = ["earn", "redeem", "expire", "adjust", "referral", "birthday", "review"] as const;
export type LoyaltyReason = (typeof LOYALTY_REASONS)[number];

export const REVIEW_STATUSES = ["pending", "approved", "rejected"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export const QUESTION_STATUSES = ["pending", "answered", "hidden"] as const;
export type QuestionStatus = (typeof QUESTION_STATUSES)[number];

/** the spec - concierge price requests and contact messages are `questions` rows of these kinds. */
export const QUESTION_KINDS = ["question", "price", "contact"] as const;
export type QuestionKind = (typeof QUESTION_KINDS)[number];

export const BACK_IN_STOCK_STATUSES = ["waiting", "notified", "cancelled"] as const;
export type BackInStockStatus = (typeof BACK_IN_STOCK_STATUSES)[number];

export const REFERRAL_STATUSES = ["pending", "rewarded"] as const;
export type ReferralStatus = (typeof REFERRAL_STATUSES)[number];

export const QUOTE_TTL_MIN = 10;
export const PENDING_TTL_MIN_DEFAULT = 30;
export const MAX_CART_LINES = 20;
export const MAX_QTY_PER_LINE = 99;
export const MAX_PER_ORDER_DEFAULT = 5;
export const LOW_STOCK_THRESHOLD_DEFAULT = 3;
export const MAX_PENDING_ORDERS_PER_CUSTOMER = 5;
export const RETURN_WINDOW_DAYS = 7;
export const MAX_WISHLIST_ITEMS = 200;
export const MAX_COMPARE_MOBILE = 2;
export const MAX_COMPARE_DESKTOP = 4;

// ---------------------------------------------------------------- catalogue
export const PRODUCT_STATUSES = ["draft", "active", "archived"] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

export const VISIBILITIES = ["public", "hidden", "link_only"] as const;
export type Visibility = (typeof VISIBILITIES)[number];

export const CATEGORY_STATUSES = ["active", "hidden", "archived"] as const;
export type CategoryStatus = (typeof CATEGORY_STATUSES)[number];

export const COLLECTION_KINDS = ["group", "sub", "campaign", "gift", "season"] as const;
export type CollectionKind = (typeof COLLECTION_KINDS)[number];

export const COLLECTION_STATUSES = ["draft", "active", "archived"] as const;
export type CollectionStatus = (typeof COLLECTION_STATUSES)[number];

export const PRICE_BASES = ["manual", "fx"] as const;
export type PriceBasis = (typeof PRICE_BASES)[number];

export const BASE_CURRENCIES = ["EUR", "USD", "AED", "GBP"] as const;
export type BaseCurrency = (typeof BASE_CURRENCIES)[number];

export const STOCK_POLICIES = ["track", "untracked"] as const;
export type StockPolicy = (typeof STOCK_POLICIES)[number];

export const IMAGE_ROLES = ["primary", "gallery", "editorial"] as const;
export type ImageRole = (typeof IMAGE_ROLES)[number];

export const RELATION_KINDS = ["related", "accessory", "replacement", "same_model"] as const;
export type RelationKind = (typeof RELATION_KINDS)[number];

export const ATTRIBUTE_KINDS = ["text", "number", "bool", "color"] as const;
export type AttributeKind = (typeof ATTRIBUTE_KINDS)[number];

export const MEDIA_KINDS = ["image", "video", "file"] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

export const MEDIA_SOURCES = ["legacy", "admin", "seed"] as const;
export type MediaSource = (typeof MEDIA_SOURCES)[number];

/** the spec - the only upload MIME types the admin accepts (SVG is rejected on purpose). */
export const UPLOAD_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/avif", "video/mp4"] as const;
export type UploadMimeType = (typeof UPLOAD_MIME_TYPES)[number];
export const UPLOAD_MAX_BYTES = 25 * 1024 * 1024;

/** the spec SortKey - default "recommended" («پیشنهاد ما»), the spec F-009. */
export const SORT_KEYS = ["recommended", "price_asc", "price_desc", "newest", "discount", "bestselling"] as const;
export type SortKey = (typeof SORT_KEYS)[number];

export const AVAIL_FILTERS = ["in", "sale", "ready"] as const;
export type AvailFilter = (typeof AVAIL_FILTERS)[number];

export const PLP_DENSITIES = [3, 5] as const;
export type PlpDensity = (typeof PLP_DENSITIES)[number];
// DECISION: 30 / 200, not 24 / 500 - `catalog/list.ts` owns paging and its header fixes both
// (30 divides by 2, 3 and 5, so no density in the spec leaves a ragged last row; 200 is the
// crawler-trap guard its edge cases assert). `url/plp-state.ts` clamps `?page=` to the same
// ceiling, so a URL can no longer parse to a page the planner then 404s. Aligned at M1.
export const PLP_PAGE_SIZE = 30;
export const PLP_MAX_PAGE = 200;

export const PRODUCT_SCOPE_KINDS = ["all", "category", "brand", "collection", "sale", "new", "gifts", "ids"] as const;
export type ProductScopeKind = (typeof PRODUCT_SCOPE_KINDS)[number];

/** v2 §10.1 - display names are capped so a 2-line clamp never truncates. */
export const DISPLAY_NAME_MAX = 60;

// ---------------------------------------------------------------- system
export const EVENT_TYPES = ["pv", "atc", "checkout_step", "purchase", "install", "search", "concierge"] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const UA_CLASSES = ["mobile", "desktop", "inapp", "pwa"] as const;
export type UaClass = (typeof UA_CLASSES)[number];

/** the spec security_events.kind - the canonical values (column is free text). */
export const SECURITY_EVENT_KINDS = [
  "otp.locked",
  "otp.quota",
  "otp.breaker.captcha",
  "otp.breaker.pause",
  "staff.login.failed",
  "staff.login.locked",
  "staff.login.new_ip",
  "staff.sudo",
  "csp.report",
  "callback.forged",
  "callback.unknown_authority",
  "upload.rejected",
  "rate_limited",
  "csrf.rejected",
  "internal.unsigned",
  "quote.sig_invalid",
  "price.tamper",
  // the spec: the nightly consistency job alerts on stock drift (kind is `text`, not a closed
  // enum, in the spec - this row makes the drift alert the DECIDED, typed kind).
  "stock.drift",
] as const;
export type SecurityEventKind = (typeof SECURITY_EVENT_KINDS)[number];

export const EVENTS_RETENTION_MONTHS = 13;

// ---------------------------------------------------------------- cache tags (the spec tags) - static names
export const STATIC_TAGS = ["catalog", "settings", "content", "sitemap", "nav", "home"] as const;
export type StaticTag = (typeof STATIC_TAGS)[number];
export const SETTINGS_CACHE_TTL_MS = 30_000;

// ---------------------------------------------------------------- ids & codes
/** Unambiguous alphabet (no 0/O/1/I/L): order codes, coupons, referral codes. LIFT v1 orders.ts. */
export const UNAMBIGUOUS_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const ORDER_CODE_PREFIX = "NL-";
export const ORDER_CODE_LEN = 5;
export const ORDER_CODE_RE = /^NL-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{5}$/;
export const REFERRAL_CODE_LEN = 8;
export const COUPON_CODE_MIN_LEN = 8;
export const COUPON_CODE_MAX_LEN = 32;
export const ULID_LEN = 26;
export const ULID_RE = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;

// ---------------------------------------------------------------- storefront storage keys
export const LOCAL_KEYS = {
  cart: "nl.cart.v2",
  wishlist: "nl.wish.v1",
  recent: "nl.recent.v1",
  city: "nl.city.v1",
  theme: "nl.theme",
  density: "nl.density",
  coach: "nl.coach.v2",
} as const;
export type LocalKey = (typeof LOCAL_KEYS)[keyof typeof LOCAL_KEYS];

// ---------------------------------------------------------------- origins
export const CANONICAL_ORIGIN = "https://namilux.ir";
export const ENAMAD_IMG_ORIGIN = "https://trustseal.enamad.ir";
export const SAMANDEHI_IMG_ORIGIN = "https://logo.samandehi.ir";
export const ZARINPAL_ORIGINS = ["https://payment.zarinpal.com", "https://sandbox.zarinpal.com"] as const;
export const WHATSAPP_ORIGIN = "https://wa.me";
