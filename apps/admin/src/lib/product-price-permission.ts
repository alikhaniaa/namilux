import "server-only";
import { can } from "@namilux/core/authz";
import { appError } from "@namilux/core/errors";
import type { StaffUser } from "@namilux/core";

/**
 * Field-level enforcement for the COMMERCIAL price fields of a product: the selling price, the sale
 * ("was") price, the instalment price with its manual pin, the price basis with its FX inputs, and
 * instalment eligibility.
 *
 * The product create/update routes assert `catalog.write`, but pricing is a SEPARATE permission - 
 * `catalog.price`, the one /api/products/[id]/price asserts - and the `content` role holds only the
 * former. A hidden form field has never been the protection in this panel, so the same body that
 * hydrates the price tab must be refused on the write as well: without this guard a hand-made
 * POST/PUT prices a product straight past the price route. A content editor keeps editing text,
 * images and specs as long as no price value moves.
 */
const PRICE_FA = "تغییر قیمت فروش و اقساط فقط با دسترسی قیمت‌گذاری امکان‌پذیر است";

/**
 * The price-bearing fields of a product, as they arrive from either side:
 *   • the admin payload (`productAdminSchema`), where an absent optional key means "the form did
 *     not carry it" - and the core's `writeValuesFor` decides what absence writes;
 *   • a stored row (`getProductAdmin().row`), where every column has a value.
 */
export type ProductPriceFields = {
  price: number;
  compareAtPrice?: number | null | undefined;
  instalmentPrice?: number | null | undefined;
  instalmentPriceManual?: boolean | undefined;
  instalmentEligible?: boolean | undefined;
  priceBasis?: "manual" | "fx" | undefined;
  basePrice?: number | null | undefined;
  baseCurrency?: string | null | undefined;
};

/**
 * A price state resolved the way the write path will store it, so a comparison is between values
 * and never between "absent" and "unchanged".
 *   • an absent nullable column writes `null` (the write clears it), so it reads as null here too;
 *   • an absent `instalmentEligible` PRESERVES the stored value, and a new product defaults to
 *     eligible (`writeValuesFor`), so it is resolved before the comparison;
 *   • an absent `instalmentPrice` is 0 while the manual flag is on, and the DERIVED value while it
 *     is off - `null` marks "derived", because that number is a function of `price` and the shop's
 *     instalment rule, not of anything the payload typed.
 */
type PriceState = {
  price: number;
  compareAtPrice: number | null;
  instalmentPriceManual: boolean;
  instalmentPrice: number | null;
  instalmentEligible: boolean;
  priceBasis: "manual" | "fx";
  basePrice: number | null;
  baseCurrency: string | null;
};

/** The price state a brand-new product lands in when the payload says nothing commercial. */
const NEW_PRODUCT_PRICE: PriceState = {
  price: 0,
  compareAtPrice: null,
  instalmentPriceManual: false,
  instalmentPrice: null,
  instalmentEligible: true,
  priceBasis: "manual",
  basePrice: null,
  baseCurrency: null,
};

/** What the write path will actually store for this payload (core: `writeValuesFor`). */
function writtenPriceState(input: ProductPriceFields, stored: ProductPriceFields | null): PriceState {
  const manual = input.instalmentPriceManual ?? false;
  return {
    price: input.price,
    compareAtPrice: input.compareAtPrice ?? null,
    instalmentPriceManual: manual,
    instalmentPrice: manual ? (input.instalmentPrice ?? 0) : null,
    instalmentEligible: input.instalmentEligible ?? stored?.instalmentEligible ?? true,
    priceBasis: input.priceBasis ?? "manual",
    basePrice: input.basePrice ?? null,
    baseCurrency: input.baseCurrency ?? null,
  };
}

/** The stored row in the same shape; an unpinned instalment price is the last DERIVED value. */
function storedPriceState(stored: ProductPriceFields): PriceState {
  const manual = stored.instalmentPriceManual ?? false;
  return {
    price: stored.price,
    compareAtPrice: stored.compareAtPrice ?? null,
    instalmentPriceManual: manual,
    instalmentPrice: manual ? (stored.instalmentPrice ?? 0) : null,
    instalmentEligible: stored.instalmentEligible ?? true,
    priceBasis: stored.priceBasis ?? "manual",
    basePrice: stored.basePrice ?? null,
    baseCurrency: stored.baseCurrency ?? null,
  };
}

/**
 * True when this payload moves a commercial price value: on a CREATE (`stored === null`) when it
 * departs from the unpriced default a brand-new product has, on an UPDATE when it differs from the
 * stored row. The caller must pass `null` for a create and the stored row for an update - never a
 * row loaded by a client-supplied id, or a hand-made payload can choose its own baseline.
 */
export function hasProtectedPriceChange(input: ProductPriceFields, stored: ProductPriceFields | null): boolean {
  const after = writtenPriceState(input, stored);
  const before = stored === null ? NEW_PRODUCT_PRICE : storedPriceState(stored);
  return (
    after.price !== before.price ||
    after.compareAtPrice !== before.compareAtPrice ||
    after.instalmentPriceManual !== before.instalmentPriceManual ||
    after.instalmentPrice !== before.instalmentPrice ||
    after.instalmentEligible !== before.instalmentEligible ||
    after.priceBasis !== before.priceBasis ||
    after.basePrice !== before.basePrice ||
    after.baseCurrency !== before.baseCurrency
  );
}

/**
 * The write-side guard. Staff without `catalog.price` may still save a product - but only while the
 * commercial values stay exactly where they were; the moment a payload moves one, the write is
 * refused rather than quietly dropped, so the caller never believes a price was saved.
 */
export function assertMayWritePrice(
  staff: Pick<StaffUser, "role" | "isActive">,
  input: ProductPriceFields,
  stored: ProductPriceFields | null,
): void {
  if (can(staff, "catalog.price")) return;
  if (!hasProtectedPriceChange(input, stored)) return;
  throw appError("FORBIDDEN", { fa: PRICE_FA });
}
