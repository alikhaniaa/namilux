"use client";
import { MAX_COMPARE_DESKTOP, MAX_COMPARE_MOBILE } from "@namilux/core/client";
import { useCallback, useSyncExternalStore } from "react";
import { KEYS, readJson, writeJson } from "@/lib/storage-keys";
import type { CompareLocal } from "@/lib/storage-keys";
import { toast } from "./toast-store";

const EMPTY: CompareLocal = { v: 1, ids: [] };
const EMPTY_IDS: number[] = [];
// the spec breakpoints: md = 768.
const MD = "(min-width: 768px)";

function isCompareLocal(v: unknown): v is CompareLocal {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Partial<CompareLocal>;
  return o.v === 1 && Array.isArray(o.ids) && o.ids.every((n) => Number.isInteger(n));
}

let state: CompareLocal | null = null;
const listeners = new Set<() => void>();

function read(): CompareLocal {
  if (state !== null) return state;
  // Stored ids may exceed the current viewport's cap (saved on desktop, opened on a phone); the cap
  // is enforced on `toggle`, and the extra ids stay so the desktop list survives a phone visit.
  state = readJson(KEYS.compare, isCompareLocal) ?? EMPTY;
  return state;
}

function maxForViewport(): number {
  try {
    return matchMedia(MD).matches ? MAX_COMPARE_DESKTOP : MAX_COMPARE_MOBILE;
  } catch {
    return MAX_COMPARE_MOBILE;
  }
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  const onStorage = (e: StorageEvent): void => {
    if (e.key !== KEYS.compare && e.key !== null) return;
    state = null;
    cb();
  };
  const mq = typeof matchMedia === "function" ? matchMedia(MD) : null;
  addEventListener("storage", onStorage);
  mq?.addEventListener("change", cb);
  return () => {
    listeners.delete(cb);
    removeEventListener("storage", onStorage);
    mq?.removeEventListener("change", cb);
  };
}

export function useCompare(): { ids: number[]; has: (id: number) => boolean; toggle: (id: number) => boolean; count: number; max: number } {
  const snapshot = useSyncExternalStore(
    subscribe,
    () => read().ids,
    () => EMPTY_IDS,
  );
  const max = useSyncExternalStore(subscribe, maxForViewport, () => MAX_COMPARE_MOBILE);

  const toggle = useCallback((id: number): boolean => {
    const ids = read().ids;
    if (ids.includes(id)) {
      state = { v: 1, ids: ids.filter((x) => x !== id) };
      writeJson(KEYS.compare, state);
      for (const cb of listeners) cb();
      return false;
    }
    if (ids.length >= maxForViewport()) {
      toast.show({ key: "product.compare.full", vars: { n: maxForViewport() } });
      return false;
    }
    state = { v: 1, ids: [...ids, id] };
    writeJson(KEYS.compare, state);
    for (const cb of listeners) cb();
    return true;
  }, []);

  return {
    ids: snapshot,
    has: useCallback((id: number) => read().ids.includes(id), []),
    toggle,
    count: snapshot.length,
    max,
  };
}
