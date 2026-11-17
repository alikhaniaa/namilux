import { MAX_CART_LINES, MAX_QTY_PER_LINE } from "@namilux/core/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KEYS } from "@/lib/storage-keys";
import type { CartLocal } from "@/lib/storage-keys";

import type * as CartStore from "../cart-store";

type Store = typeof CartStore;

/** Just enough of the Storage interface for readJson/writeJson, plus a switch to make it throw. */
function fakeStorage(): Storage & { fail: boolean } {
  const map = new Map<string, string>();
  return {
    fail: false,
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem(key: string) {
      if (this.fail) throw new Error("SecurityError");
      return map.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      if (this.fail) throw new Error("QuotaExceededError");
      map.set(key, value);
    },
    removeItem: (key: string) => void map.delete(key),
  };
}

let storage: ReturnType<typeof fakeStorage>;
let handlers: ((e: { key: string | null }) => void)[];

/** Load a fresh copy of the module so its cached snapshot and `loggedIn` flag start clean. */
async function load(seed?: unknown): Promise<Store> {
  vi.resetModules();
  storage = fakeStorage();
  handlers = [];
  if (seed !== undefined) storage.setItem(KEYS.cart, JSON.stringify(seed));
  vi.stubGlobal("localStorage", storage);
  vi.stubGlobal("navigator", { setAppBadge: vi.fn(), clearAppBadge: vi.fn() });
  vi.stubGlobal("addEventListener", (type: string, cb: (e: { key: string | null }) => void) => {
    if (type === "storage") handlers.push(cb);
  });
  vi.stubGlobal("removeEventListener", (_type: string, cb: (e: { key: string | null }) => void) => {
    handlers = handlers.filter((h) => h !== cb);
  });
  return await import("../cart-store");
}

const stored = (): CartLocal | null => {
  const raw = storage.getItem(KEYS.cart);
  return raw === null ? null : (JSON.parse(raw) as CartLocal);
};

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("cart store", () => {
  it("add increments and caps per line", async () => {
    const { cartStore } = await load();

    cartStore.add(101);
    cartStore.add(101);
    expect(cartStore.lines()).toEqual([expect.objectContaining({ id: 101, qty: 2 })]);
    expect(cartStore.count()).toBe(2);

    // Above the per-line cap the quantity is clamped, never rejected (edge cases).
    cartStore.add(101, 500);
    expect(cartStore.lines()[0]?.qty).toBe(MAX_QTY_PER_LINE);

    // setQty clamps the same way, and qty ≤ 0 removes the line instead of storing a zero.
    cartStore.setQty(101, MAX_QTY_PER_LINE + 40);
    expect(cartStore.lines()[0]?.qty).toBe(MAX_QTY_PER_LINE);
    cartStore.setQty(101, 0);
    expect(cartStore.lines()).toEqual([]);
  });

  it("caps the number of lines", async () => {
    const { cartStore } = await load();
    for (let id = 1; id <= MAX_CART_LINES + 5; id++) cartStore.add(id);
    expect(cartStore.lines()).toHaveLength(MAX_CART_LINES);
    // The line that would have been 21st is refused; the 20 already there are untouched.
    expect(cartStore.lines().map((l) => l.id)).toEqual(
      Array.from({ length: MAX_CART_LINES }, (_, i) => i + 1),
    );
  });

  it("persists the v2 shape", async () => {
    const { cartStore } = await load();
    cartStore.add(7, 3);

    const disk = stored();
    expect(disk?.v).toBe(2);
    expect(disk?.lines).toEqual([{ id: 7, qty: 3, addedAt: expect.any(String) as unknown }]);
    expect(Number.isNaN(Date.parse(disk?.updatedAt ?? ""))).toBe(false);
    // the spec: no prices in the store - the cart page re-quotes.
    expect(JSON.stringify(disk)).not.toMatch(/price|total|amount/i);
  });

  it("drops an unknown/v1 shape", async () => {
    // A v1 cart, the shape that shipped before KEYS.cart was versioned to v2.
    const { cartStore } = await load({ v: 1, items: [{ productId: 3, quantity: 2 }] });
    expect(cartStore.lines()).toEqual([]);

    // So does a v2 envelope carrying a malformed line - the guard is all-or-nothing, not per-line.
    const second = await load({ v: 2, lines: [{ id: "3", qty: 1, addedAt: "x" }], updatedAt: "x" });
    expect(second.cartStore.lines()).toEqual([]);
  });

  it("keeps the cart in memory when localStorage is unavailable", async () => {
    const { cartStore } = await load();
    storage.fail = true;
    cartStore.add(9, 2);
    // The write is swallowed (private mode), but the page view still has its cart.
    expect(cartStore.count()).toBe(2);
  });

  it("cross-tab storage event syncs", async () => {
    const { cartStore } = await load();
    cartStore.add(5);

    const seen = vi.fn();
    const unsubscribe = cartStore.subscribe(seen);
    expect(handlers).toHaveLength(1);

    // Another tab writes, then the browser delivers a storage event to this one.
    storage.setItem(
      KEYS.cart,
      JSON.stringify({ v: 2, lines: [{ id: 5, qty: 4, addedAt: "2026-08-26T00:00:00.000Z" }], updatedAt: "2026-08-26T00:00:00.000Z" }),
    );
    handlers[0]?.({ key: KEYS.cart });

    expect(seen).toHaveBeenCalled();
    expect(cartStore.count()).toBe(4);

    // An unrelated key does not invalidate the snapshot.
    const before = cartStore.lines();
    handlers[0]?.({ key: KEYS.wish });
    expect(cartStore.lines()).toBe(before);

    unsubscribe();
    expect(handlers).toHaveLength(0);
  });

  it("merge after login adopts the server snapshot", async () => {
    const { cartStore, setCartSignedIn, syncWithServer } = await load();
    cartStore.add(1, 2);
    cartStore.add(2, 1);

    // The server owns the merge; the client sends its lines and adopts the answer.
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        data: { lines: [{ id: 1, qty: 5, addedAt: "2026-08-26T00:00:00.000Z" }, { id: 2, qty: 1, addedAt: "2026-08-26T00:00:00.000Z" }] },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    setCartSignedIn(true);
    await syncWithServer("merge");

    const [url, init] = fetchMock.mock.calls[0] as [string, { method: string; body: string }];
    // merge is a query flag; the body follows the endpoint's strict cartSyncSchema
    // { lines:[{productId,qty}], updatedAt } (the spec, /api/me/cart route).
    expect(url).toBe("/api/me/cart/?merge=true");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body)).toMatchObject({ lines: [{ productId: 1, qty: 2 }, { productId: 2, qty: 1 }] });

    expect(cartStore.count()).toBe(6);
    expect(stored()?.lines).toHaveLength(2);
  });


  it("serializes sync requests and does not overwrite an edit made while syncing", async () => {
    const { cartStore, setCartSignedIn, syncWithServer } = await load();
    cartStore.add(1, 1);
    let finish!: (value: unknown) => void;
    const fetchMock = vi.fn().mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }))
      .mockResolvedValue({ ok: true, json: async () => ({ ok: true, data: { lines: [{ id: 1, qty: 3, addedAt: "2026-08-26T00:00:00.000Z" }] } }) });
    vi.stubGlobal("fetch", fetchMock);
    setCartSignedIn(true);
    const first = syncWithServer("merge");
    cartStore.setQty(1, 3);
    await syncWithServer("merge");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    finish({ ok: true, json: async () => ({ ok: true, data: { lines: [{ id: 1, qty: 1, addedAt: "2026-08-26T00:00:00.000Z" }] } }) });
    await first;
    expect(cartStore.lines()[0]?.qty).toBe(3);
    await vi.advanceTimersByTimeAsync(800);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const sent = JSON.parse((fetchMock.mock.calls[1]?.[1] as { body: string }).body) as { lines: { qty: number }[] };
    expect(sent.lines[0]?.qty).toBe(3);
  });

  it("a guest never calls the sync endpoint", async () => {
    const { cartStore, syncWithServer } = await load();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    cartStore.add(1);
    await vi.advanceTimersByTimeAsync(2000);
    await syncWithServer("replace");

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
