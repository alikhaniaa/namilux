import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Dispatch, SetStateAction } from "react";
import type * as ReactModule from "react";
import type * as ApiClientModule from "@/lib/api-client";
import type * as PriceSaveModule from "@/lib/price-save";
import { ApiError, api } from "@/lib/api-client";
import { patchPrices } from "@/lib/price-save";
import type { PriceRow } from "@/lib/pricing";
import { QuickPrices } from "../QuickPrices";

type RowApi = {
  commitPrice: (id: number, price: number, viaEnter: boolean) => string;
  retry: (id: number) => void;
};

const harness = vi.hoisted((): { rowApi: RowApi | null; statuses: Record<number, unknown> } => ({ rowApi: null, statuses: {} }));

// Exercise the component's real async saver with controllable responses. Hooks retain refs and
// expose its row actions; no DOM, server, or production data is needed to reproduce a racing save.
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof ReactModule>();
  return {
    ...actual,
    useEffect: () => {},
    useRef: <T,>(value: T) => ({ current: value }),
    useCallback: <T,>(callback: T) => callback,
    useMemo: <T,>(factory: () => T): T => {
      const value = factory();
      if (typeof value === "object" && value !== null &&
        "commitPrice" in value && typeof value.commitPrice === "function" &&
        "retry" in value && typeof value.retry === "function") harness.rowApi = value as RowApi;
      return value;
    },
    useState: <T,>(initial: T | (() => T)): [T, Dispatch<SetStateAction<T>>] => {
      let value = typeof initial === "function" ? (initial as () => T)() : initial;
      return [value, (next) => {
        value = typeof next === "function" ? (next as (previous: T) => T)(value) : next;
        if (typeof value === "object" && value !== null && !Array.isArray(value)) harness.statuses = value as Record<number, unknown>;
      }];
    },
  };
});

vi.mock("@/lib/api-client", async (importOriginal) => ({ ...await importOriginal<typeof ApiClientModule>(), api: vi.fn() }));
vi.mock("@/lib/price-save", async (importOriginal) => ({ ...await importOriginal<typeof PriceSaveModule>(), patchPrices: vi.fn() }));

function product(id: number, price: number, compareAtPrice: number | null = null): PriceRow {
  return { id, name: "کالا", displayName: "کالا", sku: null, modelCode: null, colorName: null, brandId: null, brandName: null,
    price, compareAtPrice, priceBasis: "manual", status: "active", priceUpdatedAt: null, available: true, imageKey: null, categoryIds: [] };
}

function mount(rows: PriceRow[]): RowApi {
  QuickPrices({ initialRows: rows, brands: [], categories: [], now: Date.now() });
  if (harness.rowApi === null) throw new Error("The pricing row actions were not initialized");
  return harness.rowApi;
}

function deferredSave() {
  let resolve: (value: { updated: number }) => void = () => {};
  let reject: (reason: unknown) => void = () => {};
  const promise = new Promise<{ updated: number }>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const drain = () => new Promise<void>((resolve) => setImmediate(resolve));
const conflict = (ids: number[]) => new ApiError("CONFLICT", "قیمت تغییر کرده است", { ids });
const prices = (price: number, compareAtPrice: number | null = null) => ({ price, compareAtPrice });

beforeEach(() => {
  vi.clearAllMocks();
  harness.rowApi = null;
  harness.statuses = {};
  vi.mocked(patchPrices).mockResolvedValue({ updated: 1 });
});

describe("quick price saves under concurrent edits", () => {
  it("does not replay a newer queued edit over a conflicting server price", async () => {
    const first = deferredSave();
    vi.mocked(patchPrices).mockReturnValueOnce(first.promise);
    vi.mocked(api).mockResolvedValue({ rows: [product(1, 120)] });
    const rows = mount([product(1, 100)]);
    rows.commitPrice(1, 105, true);
    rows.commitPrice(1, 110, true);
    first.reject(conflict([1]));
    await drain();
    expect(patchPrices).toHaveBeenCalledTimes(1);
    expect(harness.statuses[1]).toEqual({ kind: "conflict" });
  });

  it.each([
    { original: product(2, 200), refreshed: product(2, 220) },
    { original: product(2, 200, 250), refreshed: product(2, 200, 270) },
  ])("protects other queued rows when the conflict refresh reveals a changed baseline", async ({ original, refreshed }) => {
    const first = deferredSave();
    vi.mocked(patchPrices).mockReturnValueOnce(first.promise);
    vi.mocked(api).mockResolvedValue({ rows: [product(1, 120), refreshed] });
    const rows = mount([product(1, 100), original]);
    rows.commitPrice(1, 105, true);
    rows.commitPrice(2, 210, true);
    first.reject(conflict([1]));
    await drain();
    expect(patchPrices).toHaveBeenCalledTimes(1);
    expect(harness.statuses[2]).toEqual({ kind: "conflict" });
  });

  it("coalesces local edits and advances their baseline after a confirmed save", async () => {
    const first = deferredSave();
    vi.mocked(patchPrices).mockReturnValueOnce(first.promise);
    const rows = mount([product(1, 100)]);
    rows.commitPrice(1, 105, true);
    rows.commitPrice(1, 110, true);
    rows.commitPrice(1, 115, true);
    first.resolve({ updated: 1 });
    await drain();
    expect(patchPrices).toHaveBeenCalledTimes(2);
    expect(vi.mocked(patchPrices).mock.calls[1]?.[0]).toEqual([{ id: 1, before: prices(105), after: prices(115) }]);
    expect(harness.statuses[1]).toMatchObject({ kind: "saved" });
  });

  it("retries an uncontested row from a rejected batch without losing its newer local edit", async () => {
    const first = deferredSave();
    const batch = deferredSave();
    vi.mocked(patchPrices).mockReturnValueOnce(first.promise).mockReturnValueOnce(batch.promise);
    vi.mocked(api).mockResolvedValue({ rows: [product(1, 101), product(2, 205), product(3, 300)] });
    const rows = mount([product(1, 100), product(2, 200), product(3, 300)]);
    rows.commitPrice(1, 101, true);
    rows.commitPrice(2, 210, true);
    rows.commitPrice(3, 310, true);
    first.resolve({ updated: 1 });
    await drain();
    rows.commitPrice(3, 320, true);
    batch.reject(conflict([2]));
    await drain();
    expect(patchPrices).toHaveBeenCalledTimes(3);
    expect(vi.mocked(patchPrices).mock.calls[2]?.[0]).toEqual([{ id: 3, before: prices(300), after: prices(320) }]);
    expect(harness.statuses[2]).toEqual({ kind: "conflict" });
    expect(harness.statuses[3]).toMatchObject({ kind: "saved" });
  });

  it("stops the conflicting row when refreshing its price also fails", async () => {
    const first = deferredSave();
    vi.mocked(patchPrices).mockReturnValueOnce(first.promise);
    vi.mocked(api).mockRejectedValue(new Error("offline"));
    const rows = mount([product(1, 100)]);
    rows.commitPrice(1, 105, true);
    rows.commitPrice(1, 110, true);
    first.reject(conflict([1]));
    await drain();
    expect(patchPrices).toHaveBeenCalledTimes(1);
    expect(harness.statuses[1]).toEqual({ kind: "conflict" });
  });

  it("retains the latest edit for an explicit retry after a network failure", async () => {
    const first = deferredSave();
    vi.mocked(patchPrices).mockReturnValueOnce(first.promise);
    const rows = mount([product(1, 100)]);
    rows.commitPrice(1, 105, true);
    rows.commitPrice(1, 110, true);
    first.reject(new Error("offline"));
    await drain();
    expect(patchPrices).toHaveBeenCalledTimes(1);
    expect(harness.statuses[1]).toMatchObject({ kind: "error", after: prices(110) });
    rows.retry(1);
    await drain();
    expect(vi.mocked(patchPrices).mock.calls[1]?.[0]).toEqual([{ id: 1, before: prices(100), after: prices(110) }]);
  });

  it("keeps a newer large-price confirmation visible when an earlier save finishes", async () => {
    const first = deferredSave();
    vi.mocked(patchPrices).mockReturnValueOnce(first.promise);
    const rows = mount([product(1, 100)]);
    rows.commitPrice(1, 105, true);
    expect(rows.commitPrice(1, 1000, true)).toBe("ask");
    first.resolve({ updated: 1 });
    await drain();
    expect(patchPrices).toHaveBeenCalledTimes(1);
    expect(harness.statuses[1]).toEqual({ kind: "ask", price: 1000, why: "jump" });
  });
});
