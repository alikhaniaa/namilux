import { pgEnum } from "drizzle-orm/pg-core";

// ── catalogue ──────────────────────────────────────────────────────────────────────────────────
export const categoryStatus = pgEnum("category_status", ["active", "hidden", "archived"]);
export type CategoryStatus = (typeof categoryStatus.enumValues)[number];

export const collectionKind = pgEnum("collection_kind", ["group", "sub", "campaign", "gift", "season"]);
export type CollectionKind = (typeof collectionKind.enumValues)[number];

export const collectionStatus = pgEnum("collection_status", ["draft", "active", "archived"]);
export type CollectionStatus = (typeof collectionStatus.enumValues)[number];

export const productStatus = pgEnum("product_status", ["draft", "active", "archived"]);
export type ProductStatus = (typeof productStatus.enumValues)[number];

export const productVisibility = pgEnum("product_visibility", ["public", "hidden", "link_only"]);
export type ProductVisibility = (typeof productVisibility.enumValues)[number];

export const priceBasis = pgEnum("price_basis", ["manual", "fx"]);
export type PriceBasis = (typeof priceBasis.enumValues)[number];

export const stockPolicy = pgEnum("stock_policy", ["track", "untracked"]);
export type StockPolicy = (typeof stockPolicy.enumValues)[number];

export const productImageRole = pgEnum("product_image_role", ["primary", "gallery", "editorial"]);
export type ProductImageRole = (typeof productImageRole.enumValues)[number];

export const attributeKind = pgEnum("attribute_kind", ["text", "number", "bool", "color"]);
export type AttributeKind = (typeof attributeKind.enumValues)[number];

export const productRelationKind = pgEnum("product_relation_kind", [
  "related",
  "accessory",
  "replacement",
  "same_model",
]);
export type ProductRelationKind = (typeof productRelationKind.enumValues)[number];

export const mediaKind = pgEnum("media_kind", ["image", "video", "file"]);
export type MediaKind = (typeof mediaKind.enumValues)[number];

export const mediaSource = pgEnum("media_source", ["legacy", "admin", "seed"]);
export type MediaSource = (typeof mediaSource.enumValues)[number];

// ── customers & auth ───────────────────────────────────────────────────────────────────────────
export const customerTier = pgEnum("customer_tier", ["member", "silver", "gold", "diamond"]);
export type CustomerTier = (typeof customerTier.enumValues)[number];

export const gender = pgEnum("gender", ["female", "male"]);
export type Gender = (typeof gender.enumValues)[number];

export const otpPurpose = pgEnum("otp_purpose", ["login", "checkout", "verify_phone", "back_in_stock"]);
export type OtpPurpose = (typeof otpPurpose.enumValues)[number];

export const actorType = pgEnum("actor_type", ["staff", "customer", "system", "worker"]);
export type ActorType = (typeof actorType.enumValues)[number];

// ── commerce ───────────────────────────────────────────────────────────────────────────────────
export const shippingKind = pgEnum("shipping_kind", ["free", "flat", "by_province", "pickup"]);
export type ShippingKind = (typeof shippingKind.enumValues)[number];

export const couponKind = pgEnum("coupon_kind", ["percent", "fixed", "free_shipping"]);
export type CouponKind = (typeof couponKind.enumValues)[number];

export const orderStatus = pgEnum("order_status", [
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
]);
export type OrderStatus = (typeof orderStatus.enumValues)[number];

export const orderSource = pgEnum("order_source", ["web", "admin", "phone", "instagram", "whatsapp", "store"]);
export type OrderSource = (typeof orderSource.enumValues)[number];

/**
 * Which of the two storefront instances an order/cart belongs to. Both sites run the same code
 * against this database; the channel decides the price shown and the gateway that may settle it
 * (core/channel.ts). `main` is the default so every existing row keeps its meaning.
 */
export const salesChannel = pgEnum("sales_channel", ["main", "instalments"]);
export type SalesChannel = (typeof salesChannel.enumValues)[number];

export const paymentStatus = pgEnum("payment_status", ["initiated", "redirected", "succeeded", "failed", "expired"]);
export type PaymentStatus = (typeof paymentStatus.enumValues)[number];

export const refundStatus = pgEnum("refund_status", ["requested", "processing", "done", "failed"]);
export type RefundStatus = (typeof refundStatus.enumValues)[number];

export const shipmentCarrier = pgEnum("shipment_carrier", ["post", "tipax", "courier", "pickup", "other"]);
export type ShipmentCarrier = (typeof shipmentCarrier.enumValues)[number];

export const shipmentStatus = pgEnum("shipment_status", ["preparing", "shipped", "delivered", "returned"]);
export type ShipmentStatus = (typeof shipmentStatus.enumValues)[number];

export const movementReason = pgEnum("movement_reason", ["sale", "restock", "adjust", "return", "cancel", "seed"]);
export type MovementReason = (typeof movementReason.enumValues)[number];

// ── loyalty & requests ─────────────────────────────────────────────────────────────────────────
export const loyaltyReason = pgEnum("loyalty_reason", [
  "earn",
  "redeem",
  "expire",
  "adjust",
  "referral",
  "birthday",
  "review",
]);
export type LoyaltyReason = (typeof loyaltyReason.enumValues)[number];

export const referralStatus = pgEnum("referral_status", ["pending", "rewarded"]);
export type ReferralStatus = (typeof referralStatus.enumValues)[number];

export const stockRequestStatus = pgEnum("stock_request_status", ["waiting", "notified", "cancelled"]);
export type StockRequestStatus = (typeof stockRequestStatus.enumValues)[number];

export const reviewStatus = pgEnum("review_status", ["pending", "approved", "rejected"]);
export type ReviewStatus = (typeof reviewStatus.enumValues)[number];

export const questionKind = pgEnum("question_kind", ["question", "price", "contact"]);
export type QuestionKind = (typeof questionKind.enumValues)[number];

export const questionStatus = pgEnum("question_status", ["pending", "answered", "hidden"]);
export type QuestionStatus = (typeof questionStatus.enumValues)[number];

// ── content ────────────────────────────────────────────────────────────────────────────────────
export const contentStatus = pgEnum("content_status", ["draft", "published", "archived"]);
export type ContentStatus = (typeof contentStatus.enumValues)[number];

export const pageTemplate = pgEnum("page_template", [
  "default",
  "contact",
  "store",
  "warranty",
  "returns",
  "installments",
  "faq",
  "privacy",
  "terms",
  // «دربارهٔ ما» (/about-us/, a legacy contract URL). A value of its own rather than a reuse:
  // `contact` and `store` are SINGLETON templates already claimed by /contact-us/ and /store/
  // (core/content/pages.SINGLETON_TEMPLATES), so reusing either would make the About page a
  // CONFLICT the moment it published, and `default` renders prose with no structured section.
  // Added by migration 0005 with ALTER TYPE … ADD VALUE, so an existing database keeps its rows.
  "about",
]);
export type PageTemplate = (typeof pageTemplate.enumValues)[number];

export const bannerSlot = pgEnum("banner_slot", [
  "promo_bar",
  "home_hero",
  "home_band",
  "category_tile",
  "plp_inline",
  "pdp_band",
  "ig_landing",
]);
export type BannerSlot = (typeof bannerSlot.enumValues)[number];

export const bannerTheme = pgEnum("banner_theme", ["light", "dark", "auto"]);
export type BannerTheme = (typeof bannerTheme.enumValues)[number];

export const redirectSource = pgEnum("redirect_source", ["legacy", "manual", "auto_archive"]);
export type RedirectSource = (typeof redirectSource.enumValues)[number];

// ── system ─────────────────────────────────────────────────────────────────────────────────────
export const jobStatus = pgEnum("job_status", ["queued", "running", "done", "failed", "dead"]);
export type JobStatus = (typeof jobStatus.enumValues)[number];

export const smsStatus = pgEnum("sms_status", ["queued", "sent", "failed"]);
export type SmsStatus = (typeof smsStatus.enumValues)[number];

export const uaClass = pgEnum("ua_class", ["mobile", "desktop", "inapp", "pwa"]);
export type UaClass = (typeof uaClass.enumValues)[number];
