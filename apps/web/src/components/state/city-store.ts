"use client";
import { useCallback, useSyncExternalStore } from "react";
import { KEYS, readJson, writeJson } from "@/lib/storage-keys";
import type { CityLocal } from "@/lib/storage-keys";

function isCityLocal(v: unknown): v is CityLocal {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Partial<CityLocal>;
  return o.v === 1 && typeof o.province === "string" && typeof o.city === "string";
}

let state: CityLocal | null | undefined;
const listeners = new Set<() => void>();

function read(): CityLocal | null {
  if (state === undefined) state = readJson(KEYS.city, isCityLocal);
  return state;
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  const onStorage = (e: StorageEvent): void => {
    if (e.key !== KEYS.city && e.key !== null) return;
    state = undefined;
    cb();
  };
  addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    removeEventListener("storage", onStorage);
  };
}

export function useCity(): { city: CityLocal | null; setCity: (c: CityLocal) => void } {
  const city = useSyncExternalStore(subscribe, read, () => null);
  const setCity = useCallback((c: CityLocal) => {
    state = c;
    writeJson(KEYS.city, c);
    for (const cb of listeners) cb();
  }, []);
  return { city, setCity };
}
