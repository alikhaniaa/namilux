import { relations } from "drizzle-orm";
import {
  addresses,
  attributes,
  backInStockRequests,
  banners,
  brands,
  cartItems,
  carts,
  categories,
  collectionProducts,
  collections,
  couponRedemptions,
  coupons,
  customers,
  inventoryMovements,
  inventoryReservations,
  loyaltyLedger,
  media,
  orderEvents,
  orderItems,
  orders,
  payments,
  posts,
  priceAlerts,
  priceHistory,
  productAttributeValues,
  productCategories,
  productImages,
  productModels,
  productRelations,
  products,
  productSpecs,
  questions,
  referrals,
  refunds,
  reviews,
  sessions,
  shipments,
  staffRoles,
  staffSessions,
  staffUsers,
  webauthnCredentials,
  wishlists,
} from "./schema";

// ── catalogue ──────────────────────────────────────────────────────────────────────────────────

export const brandsRelations = relations(brands, ({ one, many }) => ({
  logo: one(media, { fields: [brands.logoMediaId], references: [media.id] }),
  products: many(products),
  models: many(productModels),
}));

export const categoriesRelations = relations(categories, ({ one, many }) => ({
  parent: one(categories, {
    fields: [categories.parentId],
    references: [categories.id],
    relationName: "categoryTree",
  }),
  children: many(categories, { relationName: "categoryTree" }),
  productCategories: many(productCategories),
}));

export const collectionsRelations = relations(collections, ({ one, many }) => ({
  parent: one(collections, {
    fields: [collections.parentId],
    references: [collections.id],
    relationName: "collectionTree",
  }),
  children: many(collections, { relationName: "collectionTree" }),
  cover: one(media, { fields: [collections.coverMediaId], references: [media.id], relationName: "collectionCover" }),
  coverDark: one(media, {
    fields: [collections.coverDarkMediaId],
    references: [media.id],
    relationName: "collectionCoverDark",
  }),
  collectionProducts: many(collectionProducts),
}));

export const collectionProductsRelations = relations(collectionProducts, ({ one }) => ({
  collection: one(collections, { fields: [collectionProducts.collectionId], references: [collections.id] }),
  product: one(products, { fields: [collectionProducts.productId], references: [products.id] }),
}));

export const productModelsRelations = relations(productModels, ({ one, many }) => ({
  brand: one(brands, { fields: [productModels.brandId], references: [brands.id] }),
  primaryProduct: one(products, {
    fields: [productModels.primaryProductId],
    references: [products.id],
    relationName: "modelPrimary",
  }),
  products: many(products, { relationName: "modelProducts" }),
}));

export const productsRelations = relations(products, ({ one, many }) => ({
  model: one(productModels, { fields: [products.modelId], references: [productModels.id], relationName: "modelProducts" }),
  brand: one(brands, { fields: [products.brandId], references: [brands.id] }),
  swatch: one(media, { fields: [products.swatchMediaId], references: [media.id], relationName: "productSwatch" }),
  video: one(media, { fields: [products.videoMediaId], references: [media.id], relationName: "productVideo" }),
  images: many(productImages),
  specs: many(productSpecs),
  productCategories: many(productCategories),
  attributeValues: many(productAttributeValues),
  relationsOut: many(productRelations, { relationName: "relOut" }),
  relationsIn: many(productRelations, { relationName: "relIn" }),
  collectionProducts: many(collectionProducts),
  priceHistory: many(priceHistory),
  movements: many(inventoryMovements),
  reservations: many(inventoryReservations),
  reviews: many(reviews),
  questions: many(questions),
  backInStockRequests: many(backInStockRequests),
  priceAlerts: many(priceAlerts),
  orderItems: many(orderItems),
}));

export const productCategoriesRelations = relations(productCategories, ({ one }) => ({
  product: one(products, { fields: [productCategories.productId], references: [products.id] }),
  category: one(categories, { fields: [productCategories.categoryId], references: [categories.id] }),
}));

export const productImagesRelations = relations(productImages, ({ one }) => ({
  product: one(products, { fields: [productImages.productId], references: [products.id] }),
  media: one(media, { fields: [productImages.mediaId], references: [media.id] }),
}));

export const productSpecsRelations = relations(productSpecs, ({ one }) => ({
  product: one(products, { fields: [productSpecs.productId], references: [products.id] }),
}));

export const attributesRelations = relations(attributes, ({ many }) => ({
  values: many(productAttributeValues),
}));

export const productAttributeValuesRelations = relations(productAttributeValues, ({ one }) => ({
  product: one(products, { fields: [productAttributeValues.productId], references: [products.id] }),
  attribute: one(attributes, { fields: [productAttributeValues.attributeId], references: [attributes.id] }),
}));

export const productRelationsRelations = relations(productRelations, ({ one }) => ({
  product: one(products, { fields: [productRelations.productId], references: [products.id], relationName: "relOut" }),
  related: one(products, { fields: [productRelations.relatedId], references: [products.id], relationName: "relIn" }),
}));

export const priceHistoryRelations = relations(priceHistory, ({ one }) => ({
  product: one(products, { fields: [priceHistory.productId], references: [products.id] }),
}));

export const mediaRelations = relations(media, ({ one, many }) => ({
  uploadedBy: one(staffUsers, { fields: [media.uploadedByStaffId], references: [staffUsers.id] }),
  productImages: many(productImages),
}));

// ── customers & auth ───────────────────────────────────────────────────────────────────────────

export const customersRelations = relations(customers, ({ one, many }) => ({
  referredBy: one(customers, {
    fields: [customers.referredById],
    references: [customers.id],
    relationName: "customerReferral",
  }),
  referred: many(customers, { relationName: "customerReferral" }),
  addresses: many(addresses),
  sessions: many(sessions),
  cart: one(carts, { fields: [customers.id], references: [carts.customerId] }),
  wishlists: many(wishlists),
  orders: many(orders),
  loyaltyLedger: many(loyaltyLedger),
  reviews: many(reviews),
  questions: many(questions),
  backInStockRequests: many(backInStockRequests),
  personalCoupons: many(coupons),
  couponRedemptions: many(couponRedemptions),
  referralsMade: many(referrals, { relationName: "referrer" }),
  referralReceived: one(referrals, { fields: [customers.id], references: [referrals.refereeId], relationName: "referee" }),
}));

export const addressesRelations = relations(addresses, ({ one }) => ({
  customer: one(customers, { fields: [addresses.customerId], references: [customers.id] }),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  customer: one(customers, { fields: [sessions.customerId], references: [customers.id] }),
}));

export const staffRolesRelations = relations(staffRoles, ({ many }) => ({
  users: many(staffUsers),
}));

export const staffUsersRelations = relations(staffUsers, ({ one, many }) => ({
  role: one(staffRoles, { fields: [staffUsers.roleId], references: [staffRoles.id] }),
  sessions: many(staffSessions),
  credentials: many(webauthnCredentials),
}));

export const staffSessionsRelations = relations(staffSessions, ({ one }) => ({
  staff: one(staffUsers, { fields: [staffSessions.staffId], references: [staffUsers.id] }),
}));

export const webauthnCredentialsRelations = relations(webauthnCredentials, ({ one }) => ({
  staff: one(staffUsers, { fields: [webauthnCredentials.staffId], references: [staffUsers.id] }),
}));

// ── commerce ───────────────────────────────────────────────────────────────────────────────────

export const cartsRelations = relations(carts, ({ one, many }) => ({
  customer: one(customers, { fields: [carts.customerId], references: [customers.id] }),
  items: many(cartItems),
}));

export const cartItemsRelations = relations(cartItems, ({ one }) => ({
  cart: one(carts, { fields: [cartItems.cartId], references: [carts.id] }),
  product: one(products, { fields: [cartItems.productId], references: [products.id] }),
}));

export const wishlistsRelations = relations(wishlists, ({ one }) => ({
  customer: one(customers, { fields: [wishlists.customerId], references: [customers.id] }),
  product: one(products, { fields: [wishlists.productId], references: [products.id] }),
}));

export const couponsRelations = relations(coupons, ({ one, many }) => ({
  customer: one(customers, { fields: [coupons.customerId], references: [customers.id] }),
  createdBy: one(staffUsers, { fields: [coupons.createdByStaffId], references: [staffUsers.id] }),
  redemptions: many(couponRedemptions),
}));

export const couponRedemptionsRelations = relations(couponRedemptions, ({ one }) => ({
  coupon: one(coupons, { fields: [couponRedemptions.couponId], references: [coupons.id] }),
  order: one(orders, { fields: [couponRedemptions.orderId], references: [orders.id] }),
  customer: one(customers, { fields: [couponRedemptions.customerId], references: [customers.id] }),
}));

// ── orders ─────────────────────────────────────────────────────────────────────────────────────

export const ordersRelations = relations(orders, ({ one, many }) => ({
  customer: one(customers, { fields: [orders.customerId], references: [customers.id] }),
  items: many(orderItems),
  events: many(orderEvents),
  payments: many(payments),
  refunds: many(refunds),
  shipments: many(shipments),
  reservations: many(inventoryReservations),
  movements: many(inventoryMovements),
  couponRedemption: one(couponRedemptions, { fields: [orders.id], references: [couponRedemptions.orderId] }),
  loyaltyLedger: many(loyaltyLedger),
  reviews: many(reviews),
}));

export const orderItemsRelations = relations(orderItems, ({ one }) => ({
  order: one(orders, { fields: [orderItems.orderId], references: [orders.id] }),
  product: one(products, { fields: [orderItems.productId], references: [products.id] }),
}));

export const orderEventsRelations = relations(orderEvents, ({ one }) => ({
  order: one(orders, { fields: [orderEvents.orderId], references: [orders.id] }),
}));

export const paymentsRelations = relations(payments, ({ one, many }) => ({
  order: one(orders, { fields: [payments.orderId], references: [orders.id] }),
  refunds: many(refunds),
}));

export const refundsRelations = relations(refunds, ({ one }) => ({
  payment: one(payments, { fields: [refunds.paymentId], references: [payments.id] }),
  order: one(orders, { fields: [refunds.orderId], references: [orders.id] }),
  byStaff: one(staffUsers, { fields: [refunds.byStaffId], references: [staffUsers.id] }),
}));

export const shipmentsRelations = relations(shipments, ({ one }) => ({
  order: one(orders, { fields: [shipments.orderId], references: [orders.id] }),
}));

export const inventoryMovementsRelations = relations(inventoryMovements, ({ one }) => ({
  product: one(products, { fields: [inventoryMovements.productId], references: [products.id] }),
  order: one(orders, { fields: [inventoryMovements.orderId], references: [orders.id] }),
}));

export const inventoryReservationsRelations = relations(inventoryReservations, ({ one }) => ({
  product: one(products, { fields: [inventoryReservations.productId], references: [products.id] }),
  order: one(orders, { fields: [inventoryReservations.orderId], references: [orders.id] }),
}));

// ── loyalty ────────────────────────────────────────────────────────────────────────────────────

export const loyaltyLedgerRelations = relations(loyaltyLedger, ({ one }) => ({
  customer: one(customers, { fields: [loyaltyLedger.customerId], references: [customers.id] }),
  order: one(orders, { fields: [loyaltyLedger.orderId], references: [orders.id] }),
}));

export const referralsRelations = relations(referrals, ({ one }) => ({
  referrer: one(customers, { fields: [referrals.referrerId], references: [customers.id], relationName: "referrer" }),
  referee: one(customers, { fields: [referrals.refereeId], references: [customers.id], relationName: "referee" }),
  order: one(orders, { fields: [referrals.orderId], references: [orders.id] }),
}));

// ── requests ───────────────────────────────────────────────────────────────────────────────────

export const backInStockRequestsRelations = relations(backInStockRequests, ({ one }) => ({
  product: one(products, { fields: [backInStockRequests.productId], references: [products.id] }),
  customer: one(customers, { fields: [backInStockRequests.customerId], references: [customers.id] }),
}));

export const priceAlertsRelations = relations(priceAlerts, ({ one }) => ({
  product: one(products, { fields: [priceAlerts.productId], references: [products.id] }),
  customer: one(customers, { fields: [priceAlerts.customerId], references: [customers.id] }),
}));

export const reviewsRelations = relations(reviews, ({ one }) => ({
  product: one(products, { fields: [reviews.productId], references: [products.id] }),
  customer: one(customers, { fields: [reviews.customerId], references: [customers.id] }),
  order: one(orders, { fields: [reviews.orderId], references: [orders.id] }),
}));

export const questionsRelations = relations(questions, ({ one }) => ({
  product: one(products, { fields: [questions.productId], references: [products.id] }),
  customer: one(customers, { fields: [questions.customerId], references: [customers.id] }),
  answeredBy: one(staffUsers, { fields: [questions.answeredByStaffId], references: [staffUsers.id] }),
}));

// ── content ────────────────────────────────────────────────────────────────────────────────────

export const postsRelations = relations(posts, ({ one }) => ({
  cover: one(media, { fields: [posts.coverMediaId], references: [media.id] }),
  author: one(staffUsers, { fields: [posts.authorStaffId], references: [staffUsers.id] }),
}));

export const bannersRelations = relations(banners, ({ one }) => ({
  mediaLight: one(media, { fields: [banners.mediaLightId], references: [media.id], relationName: "bannerLight" }),
  mediaDark: one(media, { fields: [banners.mediaDarkId], references: [media.id], relationName: "bannerDark" }),
}));
