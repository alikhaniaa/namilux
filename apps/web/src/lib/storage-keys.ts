export const KEYS = { cart: "nl.cart.v2", wish: "nl.wish.v1", recent: "nl.recent.v1", city: "nl.city.v1", theme: "nl.theme", density: "nl.density", coach: "nl.coach.v2", compare: "nl.compare.v1", utm: "nl.utm", heroSeen: "nl.hero.seen" } as const;
export type CartLocal = { v: 2; lines: { id: number; qty: number; addedAt: string }[]; updatedAt: string };
export type WishLocal = { v: 1; ids: number[]; updatedAt: string };
export type RecentLocal = { v: 1; ids: number[] };            // max 12, newest first
export type CityLocal = { v: 1; province: string; city: string };
export type CompareLocal = { v: 1; ids: number[] };           // max 4
export function readJson<T>(key: string, guard: (v: unknown) => v is T): T | null { try { const raw = localStorage.getItem(key); if (!raw) return null; const v = JSON.parse(raw) as unknown; return guard(v) ? v : null; } catch { return null; } }
export function writeJson(key: string, value: unknown): void { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* quota / private mode: ignore */ } }
