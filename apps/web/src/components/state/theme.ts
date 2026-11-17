"use client";
import { useCallback, useSyncExternalStore } from "react";
import { KEYS } from "@/lib/storage-keys";

export type Theme = "light" | "dark" | "system";

const THEMES: readonly Theme[] = ["light", "dark", "system"];
const listeners = new Set<() => void>();

function isTheme(v: unknown): v is Theme {
  return typeof v === "string" && (THEMES as readonly string[]).includes(v);
}

export function getTheme(): Theme {
  try {
    const raw = localStorage.getItem(KEYS.theme);
    return isTheme(raw) ? raw : "system";
  } catch {
    // private mode / blocked storage: the system preference is still honoured by the pre-paint script
    return "system";
  }
}

function prefersDark(): boolean {
  try {
    return matchMedia("(prefers-color-scheme: dark)").matches;
  } catch {
    return false;
  }
}

/** The single place `html.dark` is toggled after the pre-paint script in app/layout.tsx. */
function apply(theme: Theme): void {
  const dark = theme === "dark" || (theme === "system" && prefersDark());
  document.documentElement.classList.toggle("dark", dark);
}

/**
 * Re-applies the saved choice after hydration. Next renders a not-found page through the
 * `<html id="__next_error__">` shell and then re-renders `<html>` with the layout's attributes,
 * which drops the `dark` class the pre-paint script had added - the 404 flashed porcelain in dark
 * mode (design audit 2 Sep 2026). Providers calls this once on mount; it is idempotent.
 */
export function syncTheme(): void {
  apply(getTheme());
}

export function setTheme(t: Theme): void {
  try {
    if (t === "system") localStorage.removeItem(KEYS.theme);
    else localStorage.setItem(KEYS.theme, t);
  } catch {
    /* storage unavailable - the flip below still applies for this page view */
  }
  apply(t);
  for (const cb of listeners) cb();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  // Another tab changing the theme, and the OS changing its preference while on "system".
  const onStorage = (e: StorageEvent): void => {
    if (e.key !== KEYS.theme && e.key !== null) return;
    apply(getTheme());
    cb();
  };
  const mq = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : null;
  const onScheme = (): void => {
    if (getTheme() === "system") apply("system");
    cb();
  };
  addEventListener("storage", onStorage);
  mq?.addEventListener("change", onScheme);
  return () => {
    listeners.delete(cb);
    removeEventListener("storage", onStorage);
    mq?.removeEventListener("change", onScheme);
  };
}

export function useTheme(): { theme: Theme; setTheme: (t: Theme) => void } {
  // Server snapshot is "system": the pre-paint script has already put the right class on <html>,
  // so the first client render agrees with the markup and nothing flashes.
  const serverTheme = (): Theme => "system";
  const theme = useSyncExternalStore(subscribe, getTheme, serverTheme);
  return { theme, setTheme: useCallback((t: Theme) => setTheme(t), []) };
}
