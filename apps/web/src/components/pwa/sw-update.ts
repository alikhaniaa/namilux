"use client";
import { useSyncExternalStore } from "react";

let waiting: ServiceWorker | null = null;
const listeners = new Set<() => void>();

export function setWaitingWorker(w: ServiceWorker | null): void {
  waiting = w;
  for (const cb of listeners) cb();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useWaitingWorker(): ServiceWorker | null {
  return useSyncExternalStore(
    subscribe,
    () => waiting,
    () => null,
  );
}

export function applyUpdate(w: ServiceWorker): void {
  w.postMessage({ type: "SKIP_WAITING" });
}
