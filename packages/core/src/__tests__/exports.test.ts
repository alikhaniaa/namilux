import { describe, expect, it } from "vitest";
import * as server from "../index";
import * as client from "../client";

// The public names the spec fences, grouped by section. If the barrel drops one, this fails.
const SERVER_NAMES = [
  // errors / ids / config
  "AppError", "appError", "isAppError", "ERROR_CODES", "ERROR_FA", "ERROR_HTTP_STATUS", "ulid", "ulidTime", "shortCode",
  // persian
  "faDigits", "enDigits", "normalizePhone", "maskPhone", "phoneToE164", "phoneDisplay", "isPostcode", "normalizePostcode", "faNorm",
  // url / html
  "sanitizeHtml", "htmlToText",
  // settings
  "getSettings", "getSetting", "setSetting", "effectiveFlags", "DEFAULT_SETTINGS", "SETTINGS_KEYS",
  // auth
  "requestOtp", "verifyOtp", "createSession", "resolveSession", "revokeSession", "revokeAllSessions",
  "generateOtpCode", "otpQuota", "breaker", "staffLogin", "staffVerifyTotp", "staffResolve", "staffSudo",
  "totp", "verifyTotp", "hashPassword", "verifyPassword",
  // authz
  "ROLE_PERMISSIONS", "can", "assertCan", "SUDO_PERMISSIONS",
  // catalog
  "getProductBySlug", "getProductCards", "listProducts", "getCategoryByPath", "getBrandBySlug",
  "getCollectionBySlug", "getNavData", "buildSearchIndex", "getHomeData", "recommendedSort",
  "upsertProduct", "setPrice", "bulkPrice", "adjustStock", "archiveProduct",
  // pricing / inventory / orders / payments
  "computeTotals", "quote", "signQuote", "verifyQuoteSig", "evaluateCoupon", "availableStock",
  "reserve", "releaseReservations", "consumeReservations", "expireReservations", "placeOrder",
  "orderState", "handleCallback", "markPaidManually", "refund", "createManualOrder",
  "getOrderForCustomer", "trackOrder", "listOrders", "assignInvoiceNo", "shippingOptions", "etaForProvince",
  // customers / loyalty / requests / reviews
  "getCustomer", "updateProfile", "addresses", "cart", "wishlist", "loyalty", "backInStock",
  "concierge", "reviews", "questions",
  // content / seo / cache / analytics
  "getPostBySlug", "listPosts", "getPageBySlug", "getFaqs", "getMenus", "getBanners",
  "resolveRedirect", "recordNotFound", "buildMetadata", "jsonld", "buildSitemap", "sitemapIndex",
  "tags", "tagsForProductChange",
] as const;

// Symbols that MUST NOT appear on the client barrel - each drags in postgres/node:crypto/drizzle.
const SERVER_ONLY = [
  "createSession", "resolveSession", "requestOtp", "verifyOtp", "quote", "placeOrder",
  "getProductBySlug", "getSettings", "getHomeData", "handleCallback", "reserve", "audit", "security", "jobs",
] as const;

// A representative client-safe subset that the client barrel SHOULD expose.
const CLIENT_NAMES = [
  "AppError", "faDigits", "enDigits", "PROVINCE_CODES", "isProvinceCode", "loadProvinces", "tags",
] as const;

describe("@namilux/core barrel", () => {
  it("every export named in the spec exists on the server barrel", () => {
    const bag = server as Record<string, unknown>;
    const missing = SERVER_NAMES.filter((name) => bag[name] === undefined);
    expect(missing).toEqual([]);
  });

  it("client barrel exposes the client-safe subset and no server-only symbols", () => {
    const bag = client as Record<string, unknown>;
    const missing = CLIENT_NAMES.filter((name) => bag[name] === undefined);
    expect(missing).toEqual([]);
    const leaked = SERVER_ONLY.filter((name) => bag[name] !== undefined);
    expect(leaked).toEqual([]);
  });

  // Enforced by the M0 dedup (types live in src/types) and by tsc; a runtime test cannot see erased types.
  it.todo("no duplicate type definitions outside src/types (static rule - tsc/eslint)");
});
