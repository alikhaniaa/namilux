import { encPath, encSeg, ensureTrailingSlash, pathOnly } from "./encode";
import { ORDER_CODE_RE, WHATSAPP_ORIGIN } from "../constants";
import { iranPhoneToE164, phoneToE164 } from "../persian/phone";

export const ROUTES = {
  home: "/",
  shop: "/shop/",
  blog: "/blog/",
  discount: "/discount/",
  new: "/new/",
  gifts: "/gifts/",
  search: "/search/",
  cart: "/cart/",
  compare: "/compare/",
  wishlist: "/wishlist/",
  track: "/track/",
  billing: "/billing/",
  billingResult: "/billing/result/",
  gatewaySim: "/billing/gateway-sim/",
  account: "/account/",
  accountOrders: "/account/orders/",
  accountAddresses: "/account/addresses/",
  accountWishlist: "/account/wishlist/",
  accountClub: "/account/club/",
  accountProfile: "/account/profile/",
  ig: "/ig/",
  offline: "/offline/",
  searchIndex: "/search-index.json",
  manifest: "/manifest.webmanifest",
  sitemapIndex: "/sitemap_index.xml",
  robots: "/robots.txt",
} as const;

// DECISION: an empty/blank slug is rejected with RangeError instead of minting "//" (a
// protocol-relative URL · an open-redirect footgun) or "/product//". The spec lists no edge case for
// it, so the more secure reading wins.
const requireSlug = (slug: string, fn: string): string => {
  const s = slug.trim();
  if (s === "") throw new RangeError(`${fn}: slug must not be empty`);
  return s;
};

// DECISION: order codes interpolated into a PATH segment are validated against ORDER_CODE_RE
// (orderUrl/invoiceUrl/payUrl → RangeError, as the spec states for orderUrl); codes interpolated
// into a QUERY value (trackUrl/resultUrl) are percent-encoded with encSeg instead of throwing - 
// encSeg leaves a valid "NL-XXXXX" byte-identical, so the documented output is unchanged while
// hostile input can never break out of the parameter.
const requireCode = (code: string, fn: string): string => {
  if (!ORDER_CODE_RE.test(code)) throw new RangeError(`${fn}: invalid order code`);
  return code;
};

export const productUrl = (slug: string): string => `/product/${encSeg(requireSlug(slug, "productUrl"))}/`;

export const categoryUrl = (path: string): string => {
  let p = path.trim().replace(/\/{2,}/g, "/").replace(/^\/+/, "");
  // the "category/" prefix is stripped BEFORE the trailing slash, so "/category/" is recognised as
  // an empty path rather than as a category whose slug is "category".
  if (p === "category" || p.startsWith("category/")) p = p.slice("category".length).replace(/^\/+/, "");
  p = p.replace(/\/+$/, "");
  if (p === "") throw new RangeError("categoryUrl: path must not be empty");
  return `/category/${encPath(p)}/`;
};

export const brandUrl = (slug: string): string => `/brand/${encSeg(requireSlug(slug, "brandUrl"))}/`;

export const collectionUrl = (slug: string): string => `/collection/${encSeg(requireSlug(slug, "collectionUrl"))}/`;

export const postUrl = (slug: string): string => `/${encSeg(requireSlug(slug, "postUrl"))}/`;

export const pageUrl = (slug: string): string => `/${encSeg(requireSlug(slug, "pageUrl"))}/`;

export const orderUrl = (code: string): string => `${ROUTES.accountOrders}${requireCode(code, "orderUrl")}/`;

export const invoiceUrl = (code: string): string => `${ROUTES.accountOrders}${requireCode(code, "invoiceUrl")}/invoice/`;

export const trackUrl = (code?: string): string => (code ? `${ROUTES.track}?o=${encSeg(code)}` : ROUTES.track);

export const payUrl = (code: string): string => `/pay/${requireCode(code, "payUrl")}/`;

export const resultUrl = (code: string, ok: boolean, test?: boolean): string =>
  `${ROUTES.billingResult}?o=${encSeg(code)}&s=${ok ? "ok" : "fail"}${test ? "&t=1" : ""}`;

export const searchUrl = (q: string): string => `${ROUTES.search}?q=${encSeg(q)}`;

// DECISION: `base` is passed through ensureTrailingSlash and the separator is "&" when it already
// carries a query · this module exists so a hand-built base can never produce "/shop?page=2" (which
// would break the spec trailing-slash contract) or "/shop/?a=1?page=2".
export const pageN = (base: string, n: number): string => {
  const b = ensureTrailingSlash(base);
  if (!Number.isFinite(n)) return b;
  const page = Math.trunc(n);
  if (page <= 1) return b;
  return `${b}${b.includes("?") ? "&" : "?"}page=${page}`;
};

// DECISION: the "/media/" prefix is written literally here rather than imported from
// catalog/media.ts (MEDIA_PUBLIC_PREFIX) · url/* must stay dependency-free and media.ts already
// re-exports this function, so importing back would be a cycle.
export const mediaUrl = (key: string): string => {
  const k = key.trim().replace(/^\/+/, "");
  // DECISION: reject traversal, backslashes, whitespace, query/hash and any "scheme:" prefix so a
  // storage key can never escape the first-party /media/ origin (the spec src whitelist). The exact
  // key charset is not re-validated here: the key comes from the media pipeline, not from a user.
  if (k === "" || k.includes("..") || k.includes("\\") || /[?#\s]/.test(k) || /^[a-z][a-z0-9+.-]*:/i.test(k)) {
    throw new RangeError("mediaUrl: invalid storage key");
  }
  return `/media/${k}`;
};

export const absUrl = (origin: string, path: string): string => {
  if (!path.startsWith("/")) throw new RangeError('absUrl: path must start with "/"');
  return `${origin.replace(/\/+$/, "")}${path}`;
};

export const whatsappUrl = (phone: string, text?: string): string => {
  const e164 = phoneToE164(phone);
  const digits = e164.startsWith("+") ? e164.slice(1) : e164;
  const base = `${WHATSAPP_ORIGIN}/${digits}`;
  return text ? `${base}?text=${encSeg(text)}` : base;
};

export const telUrl = (phone: string): string => `tel:${phoneToE164(phone)}`;

/**
 * `tel:` for a number that may be a landline · the shop's «۰۲۱…» line · or `null` when settings
 * hold nothing dialable. `telUrl` cannot serve it: `phoneToE164` throws on anything but a
 * normalized mobile, which is why the contact page printed the landline as plain text.
 */
export const iranTelUrl = (phone: string): string | null => {
  const e164 = iranPhoneToE164(phone);
  return e164 === null ? null : `tel:${e164}`;
};

export function conciergeText(i: { displayName: string; sku: string | null; url: string }): string {
  const sku = i.sku?.trim() ?? "";
  const subject = sku === "" ? i.displayName : `${i.displayName} (${sku})`;
  return `سلام، دربارهٔ ${subject} سؤال دارم · ${i.url}`;
}

export function orderWhatsappText(i: { code: string }): string {
  return `سلام، دربارهٔ سفارش ${i.code} سؤال دارم`;
}

const MY_ACCOUNT_PREFIX = "/my-account/";

// DECISION: the second path segment is matched as a PREFIX ("/my-account/orders/…" → orders) rather
// than by exact equality, so WooCommerce's deeper account URLs land on the right page; every edge
// case the spec lists is unchanged by this.
export function legacyMyAccountRedirect(path: string): string | null {
  const p = ensureTrailingSlash(pathOnly(path));
  if (!p.startsWith(MY_ACCOUNT_PREFIX)) return null;
  const seg = p.slice(MY_ACCOUNT_PREFIX.length).split("/")[0] ?? "";
  if (seg === "orders") return ROUTES.accountOrders;
  if (seg === "edit-address") return ROUTES.accountAddresses;
  return ROUTES.account;
}

const LEGACY_PAGE_RE = /^(\/(?:[^?#]*\/)?)page\/(\d+)\/?$/;

export function legacyPaginationRedirect(path: string): string | null {
  const m = LEGACY_PAGE_RE.exec(pathOnly(path));
  if (!m) return null;
  return pageN(m[1] ?? "/", Number.parseInt(m[2] ?? "0", 10));
}
