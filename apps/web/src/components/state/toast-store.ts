"use client";
import { useSyncExternalStore } from "react";
import type { FaKey } from "@/i18n";

export type ToastItem = {
  id: string;
  key: FaKey;
  vars?: Record<string, string | number>;
  image?: string;
  action?: { key: FaKey; href?: string; onClick?: () => void };
  ttlMs: number;
};

const MAX_TOASTS = 2;
const DEFAULT_TTL_MS = 2600;
/** Design audit 2 Sep 2026: a toast that carries an action («مشاهدهٔ سبد») needs time to be acted on. */
const ACTION_TTL_MS = 5500;

let items: readonly ToastItem[] = [];
const listeners = new Set<() => void>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function emit(next: readonly ToastItem[]): void {
  items = next;
  for (const cb of listeners) cb();
}

function nextId(): string {
  // Not a security token, only a React key - crypto.randomUUID keeps it collision-free without
  // Math.random.
  return crypto.randomUUID();
}

function scheduleDismiss(id: string, ttlMs: number): void {
  const timer = setTimeout(() => {
    timers.delete(id);
    emit(items.filter((t) => t.id !== id));
  }, ttlMs);
  timers.set(id, timer);
}

export const toast = {
  show(t: Omit<ToastItem, "id" | "ttlMs"> & { ttlMs?: number }): void {
    const item: ToastItem = { ...t, id: nextId(), ttlMs: t.ttlMs ?? (t.action === undefined ? DEFAULT_TTL_MS : ACTION_TTL_MS) };
    // Oldest first out once the stack is full - the newest message is the one the tap produced.
    const kept = items.slice(Math.max(0, items.length - (MAX_TOASTS - 1)));
    for (const dropped of items.slice(0, items.length - kept.length)) {
      const timer = timers.get(dropped.id);
      if (timer !== undefined) {
        clearTimeout(timer);
        timers.delete(dropped.id);
      }
    }
    emit([...kept, item]);
    scheduleDismiss(item.id, item.ttlMs);
  },
  dismiss(id: string): void {
    const timer = timers.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      timers.delete(id);
    }
    emit(items.filter((t) => t.id !== id));
  },
  /** Pause on hover / focus: the host calls these around the visible stack. */
  hold(id: string): void {
    const timer = timers.get(id);
    if (timer === undefined) return;
    clearTimeout(timer);
    timers.delete(id);
  },
  release(id: string): void {
    const item = items.find((t) => t.id === id);
    if (item === undefined || timers.has(id)) return;
    scheduleDismiss(id, item.ttlMs);
  },
};

const EMPTY: readonly ToastItem[] = [];

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useToasts(): ToastItem[] {
  return useSyncExternalStore(
    subscribe,
    () => items,
    () => EMPTY,
  ) as ToastItem[];
}
