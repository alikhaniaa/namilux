export * from "./constants";
// The two storefront instances are a presentation fact for the admin too (the orders list shows
// which site an order came from), and the module is nothing but constants - safe for a client bundle.
export * from "./channel";
export { AppError, isAppError, ERROR_FA, ERROR_HTTP_STATUS } from "./errors";
export type { ErrorCode, ApiOk, ApiErr, ApiResponse } from "./errors";
export * from "./types";
export * from "./persian";
export * from "./url";
export * from "./money";
export * from "./validation";
export { tags } from "./cache/tags";
// The trust-seal badges are built in the shell (a server component that imports the client subset)
// and on the checkout page, from one 4000-character free-text setting each. Pure string parsing,
// no database, no environment - see settings/seals.ts for why it may not be done twice.
export { SEAL_HOSTS, enamadSeal, parseSeal, samandehiSeal } from "./settings/seals";
export type { SealEmbed, SealKind } from "./settings/seals";
export { redeemValue, pointsQuote, pointsToggleFa } from "./pricing/points";
// The storefront names the products that block an instalment basket (checkout + cart) - the rule
// itself is enforced server-side; the client only reads the reason and the ids back.
export { INSTALMENT_INELIGIBLE, INSTALMENT_INELIGIBLE_FA, instalmentBlockers } from "./pricing/instalment-eligibility";
export type { InstalmentIneligibleDetails } from "./pricing/instalment-eligibility";
export { badgesFor, discountPercent, isOnRequest, isOnSale, isLowStock, isNew, availableQty, isAvailable, isShowcaseCard } from "./catalog/cards";
// DECISION: the rendition→URL helpers are pure and first-party-only, and `ui/Img.tsx` is a client
// component that may not reach a server module - so the client subset carries them.
export { imgSrc, imgSrcSet, largestRendition, mediaUrl, MEDIA_PUBLIC_PREFIX } from "./catalog/media";
// The PLP chip layer is pure and the client renders it: `activeFilterChips` and `pruneFacets`
// own the URL grammar for a filter, so a chip can never build a URL the parser reads back
// differently. `facetScopeKey` is the cache key the same components quote.
export { activeFilterChips, attributeValueKey, facetScopeKey, pruneFacets, AVAIL_KEYS } from "./catalog/facets";
// A FAQ row is rendered by a client component (product/ProductAccordions) - type only.
export type { FaqItem } from "./content/faq";
// The announcement-bar editor checks each field before saving with the same rules and Persian
// sentences the server rejects with - pure string/date logic, no database.
export * from "./content/promo-copy";
export { shippingOptions, etaForProvince, cheapestOption } from "./pricing/shipping";
// The pricing screens compute a new price from an old one in the browser (a live preview, the
// «×۱۰?» guard) with the very functions the server applies - pure arithmetic, no database.
export { applyOperation, planPrice, typedPrice, isPriceJump, priceChangePercent, PRICE_JUMP_RATIO } from "./catalog/price-ops";
export type { BulkPriceOperation, PriceState, SkipReason } from "./catalog/price-ops";
// The head admin's price tab prints the margin beside the cost box. Pure arithmetic over two
// numbers - the enforcement that puts the cost there in the first place is server-side.
export { margin } from "./authz/redact";
export { etaZone, etaDays, isProvinceCode, PROVINCE_CODES } from "./geo/provinces";
export type { Province, ProvinceCode, EtaZone } from "./geo/provinces";
// type-only: erased at compile time, so the dataset stays out of the static graph
import type { Province } from "./geo/provinces";
/** Lazy loader so the 2,705-city dataset stays out of the first-load bundle. */
export async function loadProvinces(): Promise<readonly Province[]> {
  const m = await import("./geo/provinces");
  return m.PROVINCES;
}
