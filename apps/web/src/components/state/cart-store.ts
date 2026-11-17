"use client";
import { MAX_CART_LINES, MAX_QTY_PER_LINE } from "@namilux/core/client";
import { useCallback, useSyncExternalStore } from "react";
import { KEYS, readJson, writeJson } from "@/lib/storage-keys";
import type { CartLocal } from "@/lib/storage-keys";
import { toast } from "./toast-store";

const EMPTY: CartLocal = { v: 2, lines: [], updatedAt: new Date(0).toISOString() };

function isCartLocal(v: unknown): v is CartLocal {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Partial<CartLocal>;
  return (
    o.v === 2 &&
    Array.isArray(o.lines) &&
    typeof o.updatedAt === "string" &&
    o.lines.every(
      (l) => typeof l?.id === "number" && Number.isInteger(l.id) && typeof l.qty === "number" && typeof l.addedAt === "string",
    )
  );
}

let state: CartLocal | null = null;
const listeners = new Set<() => void>();
let syncTimer: ReturnType<typeof setTimeout> | null = null;
let syncing = false;
let loggedIn = false;

function read(): CartLocal {
  if (state !== null) return state;
  state = readJson(KEYS.cart, isCartLocal) ?? EMPTY;
  return state;
}

function badge(count: number): void {
  // the spec - only meaningful in the installed app; absent elsewhere.
  try {
    if (count > 0) void navigator.setAppBadge?.(count);
    else void navigator.clearAppBadge?.();
  } catch {
    /* unsupported */
  }
}

function commit(lines: CartLocal["lines"]): void {
  state = { v: 2, lines, updatedAt: new Date().toISOString() };
  writeJson(KEYS.cart, state);
  for (const cb of listeners) cb();
  badge(lines.reduce((n, l) => n + l.qty, 0));
  if (loggedIn) queueSync();
}

function queueSync(): void {
  if (syncTimer !== null) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    syncTimer = null;
    void syncWithServer("replace");
  }, 800);
}

function subscribeCart(cb: () => void): () => void {
  listeners.add(cb);
  const onStorage = (e: StorageEvent): void => {
    if (e.key !== KEYS.cart && e.key !== null) return;
    state = null; // re-read what the other tab wrote
    cb();
  };
  addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    removeEventListener("storage", onStorage);
  };
}

export const cartStore = {
  get: read,
  subscribe: subscribeCart,
  add(id: number, qty = 1): void {
    const lines = [...read().lines];
    const i = lines.findIndex((l) => l.id === id);
    if (i === -1) {
      if (lines.length >= MAX_CART_LINES) {
        toast.show({ key: "cart.qtyReduced", vars: { n: MAX_CART_LINES } });
        return;
      }
      lines.push({ id, qty: Math.min(Math.max(1, qty), MAX_QTY_PER_LINE), addedAt: new Date().toISOString() });
    } else {
      const line = lines[i];
      if (line === undefined) return;
      const next = Math.min(line.qty + qty, MAX_QTY_PER_LINE);
      if (next === line.qty) toast.show({ key: "cart.qtyReduced", vars: { n: MAX_QTY_PER_LINE } });
      lines[i] = { ...line, qty: next };
    }
    commit(lines);
  },
  setQty(id: number, qty: number): void {
    if (qty <= 0) {
      cartStore.remove(id);
      return;
    }
    const clamped = Math.min(qty, MAX_QTY_PER_LINE);
    if (clamped !== qty) toast.show({ key: "cart.qtyReduced", vars: { n: clamped } });
    commit(read().lines.map((l) => (l.id === id ? { ...l, qty: clamped } : l)));
  },
  remove(id: number): void {
    commit(read().lines.filter((l) => l.id !== id));
  },
  clear(): void {
    commit([]);
  },
  count(): number {
    return read().lines.reduce((n, l) => n + l.qty, 0);
  },
  lines(): CartLocal["lines"] {
    return read().lines;
  },
};

/** Providers calls this once it knows whether a session exists (M2 wires the session prop). */
export function setCartSignedIn(value: boolean): void {
  loggedIn = value;
}

export function useCart(): {
  lines: CartLocal["lines"];
  count: number;
  add: (id: number, qty?: number) => void;
  setQty: (id: number, qty: number) => void;
  remove: (id: number) => void;
  clear: () => void;
  syncing: boolean;
} {
  const snapshot = useSyncExternalStore(subscribeCart, read, () => EMPTY);
  return {
    lines: snapshot.lines,
    count: snapshot.lines.reduce((n, l) => n + l.qty, 0),
    add: useCallback((id: number, qty?: number) => cartStore.add(id, qty), []),
    setQty: useCallback((id: number, qty: number) => cartStore.setQty(id, qty), []),
    remove: useCallback((id: number) => cartStore.remove(id), []),
    clear: useCallback(() => cartStore.clear(), []),
    syncing,
  };
}

export async function syncWithServer(mode: "merge" | "replace"): Promise<void> {
  // The endpoint arrives at M2 (the spec `GET/PUT /api/me/cart`); until a session exists there is
  // nothing to mirror, so the guest path is a no-op rather than a failed request on every change.
  if (!loggedIn) return;
  if (syncing) { queueSync(); return; }
  syncing = true;
  for (const cb of listeners) cb();
  try {
    const current = read();
    // The endpoint's cartSyncSchema is strict { lines:[{productId,qty}], updatedAt }; merge is a query flag.
    const res = await fetch(mode === "merge" ? "/api/me/cart/?merge=true" : "/api/me/cart/", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        lines: current.lines.map((l) => ({ productId: l.id, qty: l.qty })),
        updatedAt: current.updatedAt,
      }),
    });
    if (!res.ok) return;
    const body = (await res.json()) as { ok: boolean; data?: { lines?: CartLocal["lines"] } };
    if (body.ok && Array.isArray(body.data?.lines) && read() === current) {
      state = { v: 2, lines: body.data.lines, updatedAt: new Date().toISOString() };
      writeJson(KEYS.cart, state);
      badge(state.lines.reduce((n, l) => n + l.qty, 0));
    }
  } catch {
    // Offline: the local cart is the source of truth and the next change retries.
  } finally {
    syncing = false;
    for (const cb of listeners) cb();
  }
}
