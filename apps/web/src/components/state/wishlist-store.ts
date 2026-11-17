"use client";
import { MAX_WISHLIST_ITEMS } from "@namilux/core/client";
import { useCallback, useSyncExternalStore } from "react";
import { KEYS, readJson, writeJson } from "@/lib/storage-keys";
import type { WishLocal } from "@/lib/storage-keys";
import { toast } from "./toast-store";

const EMPTY: WishLocal = { v: 1, ids: [], updatedAt: new Date(0).toISOString() };

function isWishLocal(v: unknown): v is WishLocal {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Partial<WishLocal>;
  return o.v === 1 && Array.isArray(o.ids) && o.ids.every((n) => Number.isInteger(n)) && typeof o.updatedAt === "string";
}

let state: WishLocal | null = null;
let loggedIn = false;
const listeners = new Set<() => void>();

function read(): WishLocal {
  if (state !== null) return state;
  state = readJson(KEYS.wish, isWishLocal) ?? EMPTY;
  return state;
}

function commit(ids: number[]): void {
  state = { v: 1, ids, updatedAt: new Date().toISOString() };
  writeJson(KEYS.wish, state);
  for (const cb of listeners) cb();
  if (loggedIn) void syncWishlist("replace");
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  const onStorage = (e: StorageEvent): void => {
    if (e.key !== KEYS.wish && e.key !== null) return;
    state = null;
    cb();
  };
  addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    removeEventListener("storage", onStorage);
  };
}

/** Providers calls this once it knows whether a session exists (M2 wires the session prop). */
export function setWishlistSignedIn(value: boolean): void {
  loggedIn = value;
}

export function useWishlist(): { ids: number[]; has: (id: number) => boolean; toggle: (id: number) => void; count: number } {
  const snapshot = useSyncExternalStore(subscribe, read, () => EMPTY);
  const toggle = useCallback((id: number) => {
    const ids = read().ids;
    if (ids.includes(id)) {
      commit(ids.filter((x) => x !== id));
      return;
    }
    if (ids.length >= MAX_WISHLIST_ITEMS) {
      toast.show({ key: "product.compare.full", vars: { n: MAX_WISHLIST_ITEMS } });
      return;
    }
    commit([id, ...ids]);
    toast.show({ key: "toast.wishlisted" });
  }, []);
  return {
    ids: snapshot.ids,
    has: useCallback((id: number) => read().ids.includes(id), []),
    toggle,
    count: snapshot.ids.length,
  };
}

export async function syncWishlist(mode: "merge" | "replace"): Promise<void> {
  // The endpoint arrives at M2 (the spec `GET/PUT /api/me/wishlist`); a guest has nothing to mirror.
  if (!loggedIn) return;
  try {
    const current = read();
    // wishlistSyncSchema is strict { ids }; merge is a query flag (union with the server list).
    const res = await fetch(mode === "merge" ? "/api/me/wishlist/?merge=true" : "/api/me/wishlist/", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids: current.ids }),
    });
    if (!res.ok) return;
    const body = (await res.json()) as { ok: boolean; data?: { ids?: number[] } };
    if (body.ok && Array.isArray(body.data?.ids)) {
      state = { v: 1, ids: body.data.ids, updatedAt: new Date().toISOString() };
      writeJson(KEYS.wish, state);
      for (const cb of listeners) cb();
    }
  } catch {
    // Offline: the local list stays authoritative and the next toggle retries.
  }
}
