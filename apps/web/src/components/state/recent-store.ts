"use client";
import { useSyncExternalStore } from "react";
import { KEYS, readJson, writeJson } from "@/lib/storage-keys";
import type { RecentLocal } from "@/lib/storage-keys";

const MAX_RECENT = 12;
const EMPTY: RecentLocal = { v: 1, ids: [] };
const EMPTY_IDS: number[] = [];

function isRecentLocal(v: unknown): v is RecentLocal {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Partial<RecentLocal>;
  return o.v === 1 && Array.isArray(o.ids) && o.ids.every((n) => Number.isInteger(n));
}

let state: RecentLocal | null = null;
const listeners = new Set<() => void>();

function read(): RecentLocal {
  if (state !== null) return state;
  state = readJson(KEYS.recent, isRecentLocal) ?? EMPTY;
  return state;
}

export function pushRecent(id: number): void {
  if (!Number.isInteger(id) || id <= 0) return;
  const ids = read().ids;
  // Newest first, deduped; re-viewing a product moves it to the front rather than adding a copy.
  if (ids[0] === id) return;
  state = { v: 1, ids: [id, ...ids.filter((x) => x !== id)].slice(0, MAX_RECENT) };
  writeJson(KEYS.recent, state);
  for (const cb of listeners) cb();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  const onStorage = (e: StorageEvent): void => {
    if (e.key !== KEYS.recent && e.key !== null) return;
    state = null;
    cb();
  };
  addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    removeEventListener("storage", onStorage);
  };
}

export function useRecent(): number[] {
  return useSyncExternalStore(
    subscribe,
    () => read().ids,
    () => EMPTY_IDS,
  );
}
