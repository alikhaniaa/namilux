import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, hasTestDb, truncateAll } from "@namilux/db/test";
import type { TestDb } from "@namilux/db/test";
import type { Env } from "@namilux/config";
import { products, shippingMethods } from "@namilux/db";
import { ulid } from "../../ids";
import { DEFAULT_SETTINGS } from "../../settings/schema";
import {
  availableOf,
  buildQuoteLines,
  computeTotals,
  dedupeLines,
  quote,
  toPricedLines,
  type QuoteProduct,
} from "../quote";
import { verifyQuoteSig } from "../sign";
import { DEFAULT_INSTALMENTS_RULE } from "../instalments";

const KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const env = { QUOTE_SIGNING_KEY: KEY } as unknown as Env;

function qp(over: Partial<QuoteProduct> & Pick<QuoteProduct, "id">): QuoteProduct {
  return {
    name: "کالا",
    displayName: "کالا",
    slug: `p-${over.id}`,
    price: 10_000_000,
    compareAt: null,
    instalmentPrice: null,
    instalmentPriceManual: false,
    instalmentEligible: true,
    status: "active",
    visibility: "public",
    stockPolicy: "track",
    stockQty: 5,
    reserved: 0,
    allowBackorder: false,
    maxPerOrder: 5,
    lowStockThreshold: 3,
    brandId: null,
    categoryIds: [],
    collectionIds: [],
    imageKey: null,
    sku: null,
    modelCode: null,
    colorName: null,
    warrantyMonths: null,
    ...over,
  };
}

describe("pricing/computeTotals", () => {
  it("caps a fixed coupon larger than subtotal so grandTotal equals shipping", () => {
    const t = computeTotals({
      lines: [{ productId: 1, unitPrice: 2_000_000, qty: 1, compareAt: null }],
      coupon: { couponId: 1, code: "X", kind: "fixed", value: 3_000_000, maxDiscount: null, minSubtotal: 0, eligibleProductIds: "all", stackableWithPoints: true },
      pointsValue: 0,
      shipping: 350_000,
    });
    expect(t.discount).toBe(2_000_000);
    expect(t.grandTotal).toBe(350_000);
  });
  it("free_shipping coupon → discount 0 and shipping 0", () => {
    const t = computeTotals({
      lines: [{ productId: 1, unitPrice: 2_000_000, qty: 1, compareAt: null }],
      coupon: { couponId: 1, code: "F", kind: "free_shipping", value: 0, maxDiscount: null, minSubtotal: 0, eligibleProductIds: "all", stackableWithPoints: true },
      pointsValue: 0,
      shipping: 350_000,
    });
    expect(t.discount).toBe(0);
    expect(t.shipping).toBe(0);
    expect(t.freeShipping).toBe(true);
  });
});

describe("pricing/buildQuoteLines", () => {
  const GLOBAL = 5;
  it.each([
    { status: "draft" as const },
    { status: "archived" as const },
    { visibility: "hidden" as const },
  ])("does not disclose private product details through a guessed cart ID: %o", (hidden) => {
    const product = qp({ id: 99, displayName: "Private launch", imageKey: "private-image", price: 9_999_999, ...hidden });
    const result = buildQuoteLines([{ productId: 99, qty: 1 }], [product], GLOBAL, "main", DEFAULT_INSTALMENTS_RULE);
    expect(result.lines[0]).toEqual({ productId: 99, name: "", image: null, unitPrice: 0, qty: 0, lineTotal: 0, available: 0, status: "removed" });
  });
  it("marks a price-0 product removed/on_request; archived/draft/hidden removed; link_only ok", () => {
    const products = [
      qp({ id: 1, price: 0 }),
      qp({ id: 2, status: "archived" }),
      qp({ id: 3, status: "draft" }),
      qp({ id: 4, visibility: "hidden" }),
      qp({ id: 5, visibility: "link_only" }),
    ];
    const { lines, warnings } = buildQuoteLines(products.map((p) => ({ productId: p.id, qty: 1 })), products, GLOBAL, "main", DEFAULT_INSTALMENTS_RULE);
    const removedReason = (productId: number): string | undefined => {
      const w = warnings.find((x) => x.kind === "removed" && x.productId === productId);
      return w !== undefined && w.kind === "removed" ? w.reason : undefined;
    };
    expect(removedReason(1)).toBe("on_request");
    expect(removedReason(2)).toBe("archived");
    expect(removedReason(3)).toBe("hidden");
    expect(removedReason(4)).toBe("hidden");
    expect(lines.find((l) => l.productId === 5)?.status).toBe("ok");
  });

  it("instalment site: a switched-off product is removed as instalment_ineligible, an eligible one is priced", () => {
    const products = [qp({ id: 1 }), qp({ id: 2, instalmentEligible: false })];
    const { lines, warnings } = buildQuoteLines(products.map((p) => ({ productId: p.id, qty: 1 })), products, GLOBAL, "instalments", DEFAULT_INSTALMENTS_RULE);
    // 10,000,000 / 0.9 rounded up to 10,000 - the instalment price, not the fixed one.
    expect(lines.find((l) => l.productId === 1)).toMatchObject({ status: "ok", unitPrice: 11_120_000, lineTotal: 11_120_000 });
    expect(lines.find((l) => l.productId === 2)).toMatchObject({ status: "removed", qty: 0, lineTotal: 0 });
    expect(warnings).toEqual([{ kind: "removed", productId: 2, reason: "instalment_ineligible" }]);
    // The removed line never reaches the totals.
    expect(toPricedLines(lines, products).map((l) => l.productId)).toEqual([1]);
  });

  it("main site (card): the instalment switch is ignored - an ineligible product is still sold", () => {
    const products = [qp({ id: 1, instalmentEligible: false })];
    const { lines, warnings } = buildQuoteLines([{ productId: 1, qty: 2 }], products, GLOBAL, "main", DEFAULT_INSTALMENTS_RULE);
    expect(lines[0]).toMatchObject({ status: "ok", unitPrice: 10_000_000, lineTotal: 20_000_000 });
    expect(warnings).toEqual([]);
  });

  it("instalment site: an on-request / archived product keeps its own reason even when also switched off", () => {
    const products = [qp({ id: 1, price: 0, instalmentEligible: false }), qp({ id: 2, status: "archived", instalmentEligible: false })];
    const { warnings } = buildQuoteLines(products.map((p) => ({ productId: p.id, qty: 1 })), products, GLOBAL, "instalments", DEFAULT_INSTALMENTS_RULE);
    expect(warnings.map((w) => (w.kind === "removed" ? w.reason : w.kind))).toEqual(["on_request", "archived"]);
  });

  it("reduces qty 7 to 5 for max_per_order 5 with a qty_reduced warning", () => {
    const p = qp({ id: 1, maxPerOrder: 5, stockQty: 99 });
    const { lines, warnings } = buildQuoteLines([{ productId: 1, qty: 7 }], [p], GLOBAL, "main", DEFAULT_INSTALMENTS_RULE);
    expect(lines[0]).toMatchObject({ qty: 5, status: "qty_reduced" });
    expect(warnings).toContainEqual({ kind: "qty_reduced", productId: 1, from: 7, to: 5, reason: "max_per_order" });
  });

  it("reduces qty 3 to 2 for stock 2 without backorder; keeps 3 with allow_backorder", () => {
    const tracked = qp({ id: 1, stockQty: 2 });
    expect(buildQuoteLines([{ productId: 1, qty: 3 }], [tracked], GLOBAL, "main", DEFAULT_INSTALMENTS_RULE).lines[0]).toMatchObject({ qty: 2, status: "qty_reduced" });
    const backorder = qp({ id: 1, stockQty: 2, allowBackorder: true });
    expect(buildQuoteLines([{ productId: 1, qty: 3 }], [backorder], GLOBAL, "main", DEFAULT_INSTALMENTS_RULE).lines[0]).toMatchObject({ qty: 3, status: "ok" });
  });

  it("stock 0 and stock 5 with 5 reserved are removed/out_of_stock; untracked accepts any qty", () => {
    expect(buildQuoteLines([{ productId: 1, qty: 1 }], [qp({ id: 1, stockQty: 0 })], GLOBAL, "main", DEFAULT_INSTALMENTS_RULE).warnings[0]).toMatchObject({ reason: "out_of_stock" });
    expect(buildQuoteLines([{ productId: 1, qty: 1 }], [qp({ id: 1, stockQty: 5, reserved: 5 })], GLOBAL, "main", DEFAULT_INSTALMENTS_RULE).warnings[0]).toMatchObject({ reason: "out_of_stock" });
    expect(buildQuoteLines([{ productId: 1, qty: 5 }], [qp({ id: 1, stockPolicy: "untracked", stockQty: 0 })], GLOBAL, "main", DEFAULT_INSTALMENTS_RULE).lines[0]).toMatchObject({ qty: 5, status: "ok" });
  });

  it("caps QuoteLine.available at maxPerOrder and keeps unitPrice on removed lines", () => {
    const line = buildQuoteLines([{ productId: 1, qty: 1 }], [qp({ id: 1, stockQty: 99, maxPerOrder: 5 })], GLOBAL, "main", DEFAULT_INSTALMENTS_RULE).lines[0];
    expect(line!.available).toBe(5);
    const removed = buildQuoteLines([{ productId: 1, qty: 1 }], [qp({ id: 1, price: 0 })], GLOBAL, "main", DEFAULT_INSTALMENTS_RULE).lines[0];
    expect(removed).toMatchObject({ status: "removed", qty: 0, lineTotal: 0, unitPrice: 0 });
  });

  it("availableOf: untracked huge, tracked stock − reserved never negative", () => {
    expect(availableOf(qp({ id: 1, stockPolicy: "untracked" }))).toBe(Number.MAX_SAFE_INTEGER);
    expect(availableOf(qp({ id: 1, stockQty: 5, reserved: 2 }))).toBe(3);
    expect(availableOf(qp({ id: 1, stockQty: 3, reserved: 9 }))).toBe(0);
  });

  it("toPricedLines keeps only ok/qty_reduced lines with DB prices", () => {
    const ps = [qp({ id: 1, stockQty: 99, compareAt: 12_000_000 }), qp({ id: 2, price: 0 })];
    const { lines } = buildQuoteLines([{ productId: 1, qty: 2 }, { productId: 2, qty: 1 }], ps, GLOBAL, "main", DEFAULT_INSTALMENTS_RULE);
    const priced = toPricedLines(lines, ps);
    expect(priced).toEqual([{ productId: 1, unitPrice: 10_000_000, qty: 2, compareAt: 12_000_000 }]);
  });

  it("dedupeLines sums duplicate ids, rejects 21 distinct ids and rejects qty 0 / −1 / 1.5", () => {
    expect(dedupeLines([{ productId: 1, qty: 2 }, { productId: 1, qty: 3 }])).toEqual([{ productId: 1, qty: 5 }]);
    const many = Array.from({ length: 21 }, (_, i) => ({ productId: i + 1, qty: 1 }));
    expect(() => dedupeLines(many)).toThrow();
    expect(() => dedupeLines([{ productId: 1, qty: 0 }])).toThrow();
    expect(() => dedupeLines([{ productId: 1, qty: -1 }])).toThrow();
    expect(() => dedupeLines([{ productId: 1, qty: 1.5 }])).toThrow();
  });
});

describe.skipIf(!hasTestDb())("pricing/quote — integration", () => {
  let handle: TestDb;
  beforeAll(async () => {
    handle = await createTestDb();
  });
  afterEach(async () => {
    await truncateAll(handle.db);
  });
  afterAll(async () => {
    await handle.close();
  });

  async function makeProduct(over: Partial<{ price: number; stockQty: number; instalmentEligible: boolean }> = {}): Promise<number> {
    const [p] = await handle.db
      .insert(products)
      .values({
        slug: `q-${ulid()}`,
        name: "کالا",
        displayName: "کالا",
        status: "active",
        visibility: "public",
        price: over.price ?? 41_500_000,
        stockQty: over.stockQty ?? 3,
        ...(over.instalmentEligible !== undefined ? { instalmentEligible: over.instalmentEligible } : {}),
      })
      .returning({ id: products.id });
    return p!.id;
  }

  async function seedShipping(): Promise<void> {
    await handle.db.insert(shippingMethods).values({ key: "free_nationwide", name: "ارسال رایگان", kind: "free", rateJson: {}, etaMinDays: 2, etaMaxDays: 7, isActive: true, sort: 0 });
  }

  it("returns a signed quote whose sig verifies and whose expiresAt ≈ now + 10 min", async () => {
    const id = await makeProduct({ price: 41_500_000, stockQty: 3 });
    await seedShipping();
    const q = await quote(handle.db, { lines: [{ productId: id, qty: 1 }] }, { settings: DEFAULT_SETTINGS, env, channel: "main" });
    expect(q.subtotal).toBe(41_500_000);
    expect(q.grandTotal).toBe(41_500_000);
    expect(q.shippingKey).toBe("free_nationwide");
    expect(verifyQuoteSig(q, q.sig, KEY)).toBe(true);
    const drift = Math.abs(Date.parse(q.expiresAt) - (Date.now() + 600_000));
    expect(drift).toBeLessThan(10_000);
  });

  it("guest quote with a coupon code → coupon { error: 'UNAUTHORIZED' } and discount 0", async () => {
    const id = await makeProduct();
    const q = await quote(handle.db, { lines: [{ productId: id, qty: 1 }], couponCode: "WELCOME10" }, { settings: DEFAULT_SETTINGS, env, channel: "main" });
    expect(q.coupon).toEqual({ error: "UNAUTHORIZED" });
    expect(q.discount).toBe(0);
    expect(q.warnings.some((w) => w.kind === "coupon_not_applied")).toBe(true);
  });

  it("instalment quote of a mixed basket drops the switched-off product; the main quote keeps both", async () => {
    const eligible = await makeProduct({ price: 9_000_000 });
    const blocked = await makeProduct({ price: 9_000_000, instalmentEligible: false });
    await seedShipping();
    const lines = [{ productId: eligible, qty: 1 }, { productId: blocked, qty: 1 }];

    const inst = await quote(handle.db, { lines }, { settings: DEFAULT_SETTINGS, env, channel: "instalments" });
    expect(inst.lines.find((l) => l.productId === blocked)?.status).toBe("removed");
    expect(inst.warnings).toContainEqual({ kind: "removed", productId: blocked, reason: "instalment_ineligible" });
    expect(inst.subtotal).toBe(10_000_000); // only the eligible product, at its instalment price

    const main = await quote(handle.db, { lines }, { settings: DEFAULT_SETTINGS, env, channel: "main" });
    expect(main.lines.every((l) => l.status === "ok")).toBe(true);
    expect(main.subtotal).toBe(18_000_000);
  });

  it("all lines removed → subtotal 0, grandTotal 0, sig present", async () => {
    const id = await makeProduct({ price: 0 }); // on-request → removed
    const q = await quote(handle.db, { lines: [{ productId: id, qty: 1 }] }, { settings: DEFAULT_SETTINGS, env, channel: "main" });
    expect(q.subtotal).toBe(0);
    expect(q.grandTotal).toBe(0);
    expect(q.lines[0]?.status).toBe("removed");
    expect(verifyQuoteSig(q, q.sig, KEY)).toBe(true);
  });
});
