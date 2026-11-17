import { ROLE_PERMISSIONS } from "@namilux/core/authz";
import { describe, expect, it, vi } from "vitest";
import { assertMayWritePrice, hasProtectedPriceChange } from "../product-price-permission";

// The helper is server-side, exactly like every other lib/* the API routes import.
vi.mock("server-only", () => ({}));

const staff = (role: keyof typeof ROLE_PERMISSIONS, isActive = true) => ({ role, isActive });

/** A priced product, on sale, instalment price DERIVED (not pinned), eligible, manual basis. */
const STORED = {
  price: 12_000_000,
  compareAtPrice: 15_000_000,
  instalmentPrice: 13_200_000,
  instalmentPriceManual: false,
  instalmentEligible: true,
  priceBasis: "manual" as const,
  basePrice: null,
  baseCurrency: null,
};

/** What the product form sends back for STORED when only text changed. */
const INPUT = {
  price: 12_000_000,
  compareAtPrice: 15_000_000,
  instalmentPrice: null,
  instalmentPriceManual: false,
  instalmentEligible: true,
  priceBasis: "manual" as const,
  basePrice: null,
  baseCurrency: null,
};

describe("hasProtectedPriceChange - create", () => {
  it("reads the unpriced default a new product starts in as no change", () => {
    expect(hasProtectedPriceChange({ price: 0 }, null)).toBe(false);
    expect(hasProtectedPriceChange({ price: 0, instalmentEligible: true }, null)).toBe(false);
    expect(
      hasProtectedPriceChange(
        { price: 0, compareAtPrice: null, instalmentPrice: null, instalmentPriceManual: false, priceBasis: "manual", basePrice: null, baseCurrency: null },
        null,
      ),
    ).toBe(false);
  });

  it("reads every commercial value a create could carry as a change", () => {
    const bodies = [
      { price: 1 },
      { price: 12_000_000 },
      { price: 0, compareAtPrice: 1_000_000 },
      { price: 0, instalmentPriceManual: true, instalmentPrice: 13_000_000 },
      { price: 0, instalmentPriceManual: true },
      { price: 0, instalmentEligible: false },
      { price: 0, priceBasis: "fx" as const, basePrice: 380, baseCurrency: "EUR" },
      { price: 0, basePrice: 380 },
    ];
    for (const body of bodies) expect(hasProtectedPriceChange(body, null), JSON.stringify(body)).toBe(true);
  });
});

describe("hasProtectedPriceChange - update", () => {
  it("sees an unchanged payload as no change", () => {
    expect(hasProtectedPriceChange(INPUT, STORED)).toBe(false);
  });

  it("treats the fixed and the sale price as values, not keys", () => {
    expect(hasProtectedPriceChange({ ...INPUT, price: 13_000_000 }, STORED)).toBe(true);
    expect(hasProtectedPriceChange({ ...INPUT, price: 0 }, STORED)).toBe(true);
    expect(hasProtectedPriceChange({ ...INPUT, compareAtPrice: 16_000_000 }, STORED)).toBe(true);
    expect(hasProtectedPriceChange({ ...INPUT, compareAtPrice: null }, STORED)).toBe(true);
    // An ABSENT nullable key is written as null, so it clears a stored sale price…
    const { compareAtPrice: _sale, ...withoutSale } = INPUT;
    expect(hasProtectedPriceChange(withoutSale, STORED)).toBe(true);
    // …and is harmless when there was nothing to clear.
    expect(hasProtectedPriceChange(withoutSale, { ...STORED, compareAtPrice: null })).toBe(false);
    expect(hasProtectedPriceChange({ ...INPUT, compareAtPrice: 16_000_000 }, { ...STORED, compareAtPrice: null })).toBe(true);
  });

  it("ignores the instalment price while it is DERIVED, and guards it while it is pinned", () => {
    // The stored 13,200,000 is a function of `price`; an unpinned form does not own that number.
    expect(hasProtectedPriceChange({ ...INPUT, instalmentPrice: null }, STORED)).toBe(false);
    expect(hasProtectedPriceChange({ ...INPUT, instalmentPrice: 99_999_999 }, STORED)).toBe(false);
    // Pinning it makes the value the form's - and flips what the instalment site lists.
    expect(hasProtectedPriceChange({ ...INPUT, instalmentPriceManual: true, instalmentPrice: 13_200_000 }, STORED)).toBe(true);
    expect(hasProtectedPriceChange({ ...INPUT, instalmentPriceManual: true, instalmentPrice: null }, STORED)).toBe(true);

    const pinned = { ...STORED, instalmentPriceManual: true, instalmentPrice: 14_000_000 };
    expect(hasProtectedPriceChange({ ...INPUT, instalmentPriceManual: true, instalmentPrice: 14_000_000 }, pinned)).toBe(false);
    expect(hasProtectedPriceChange({ ...INPUT, instalmentPriceManual: true, instalmentPrice: 15_000_000 }, pinned)).toBe(true);
    // An absent manual price is written as 0 - on request - not left alone.
    const { instalmentPrice: _pinnedPrice, ...withoutPinned } = INPUT;
    expect(hasProtectedPriceChange({ ...withoutPinned, instalmentPriceManual: true }, pinned)).toBe(true);
    // Unpinning re-derives the value even when the pinned number is echoed back.
    expect(hasProtectedPriceChange({ ...INPUT, instalmentPriceManual: false, instalmentPrice: 14_000_000 }, pinned)).toBe(true);
  });

  it("lets an absent instalmentEligible preserve the stored value", () => {
    const { instalmentEligible: _eligible, ...withoutEligibility } = INPUT;
    expect(hasProtectedPriceChange(withoutEligibility, STORED)).toBe(false);
    expect(hasProtectedPriceChange(withoutEligibility, { ...STORED, instalmentEligible: false })).toBe(false);
    expect(hasProtectedPriceChange({ ...INPUT, instalmentEligible: true }, { ...STORED, instalmentEligible: false })).toBe(true);
    expect(hasProtectedPriceChange({ ...INPUT, instalmentEligible: false }, STORED)).toBe(true);
    expect(hasProtectedPriceChange({ ...INPUT, instalmentEligible: true }, STORED)).toBe(false);
  });

  it("guards the price basis and its FX inputs", () => {
    const fx = { ...STORED, priceBasis: "fx" as const, basePrice: 380, baseCurrency: "EUR" };
    expect(hasProtectedPriceChange({ ...INPUT, priceBasis: "fx", basePrice: 380, baseCurrency: "EUR" }, fx)).toBe(false);
    expect(hasProtectedPriceChange({ ...INPUT, priceBasis: "fx", basePrice: 400, baseCurrency: "EUR" }, fx)).toBe(true);
    expect(hasProtectedPriceChange({ ...INPUT, priceBasis: "fx", basePrice: 380, baseCurrency: "USD" }, fx)).toBe(true);
    expect(hasProtectedPriceChange({ ...INPUT, priceBasis: "manual", basePrice: 380, baseCurrency: "EUR" }, fx)).toBe(true);
    expect(hasProtectedPriceChange({ ...INPUT, priceBasis: "fx", basePrice: 380, baseCurrency: "EUR" }, STORED)).toBe(true);
  });
});

describe("assertMayWritePrice", () => {
  const changed = { ...INPUT, price: 13_000_000 };

  it("refuses a commercial change for content, the role with catalog.write but no catalog.price", () => {
    expect(ROLE_PERMISSIONS.content).toContain("catalog.write");
    expect(ROLE_PERMISSIONS.content).not.toContain("catalog.price");
    let caught: { code?: string; fa?: string } | null = null;
    try {
      assertMayWritePrice(staff("content"), changed, STORED);
    } catch (e) {
      caught = e as { code?: string; fa?: string };
    }
    expect(caught?.code).toBe("FORBIDDEN");
    expect(caught?.fa).toContain("قیمت");
    // A create with a price is the same refusal.
    expect(() => assertMayWritePrice(staff("content"), { price: 1 }, null)).toThrow();
  });

  it("lets content save a payload whose price values did not move", () => {
    expect(() => assertMayWritePrice(staff("content"), INPUT, STORED)).not.toThrow();
    expect(() => assertMayWritePrice(staff("content"), { price: 0 }, null)).not.toThrow();
  });

  it("lets the pricing roles move a price, and an inactive account never", () => {
    for (const role of ["owner", "admin", "manager"] as const) {
      expect(ROLE_PERMISSIONS[role], role).toContain("catalog.price");
      expect(() => assertMayWritePrice(staff(role), changed, STORED), role).not.toThrow();
      expect(() => assertMayWritePrice(staff(role), { price: 1 }, null), role).not.toThrow();
    }
    expect(() => assertMayWritePrice(staff("admin", false), changed, STORED)).toThrow();
  });
});
