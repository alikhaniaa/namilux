"use client";
import { ApiError, api } from "./api-client";
import type { Prices } from "./pricing";

/** One row of a price save: the price it was typed over, and the price it becomes. */
export type PriceEdit = { id: number; before: Prices; after: Prices };

/** A hand edit - a few rows, no second factor (PATCH /api/products/prices). */
export function patchPrices(rows: PriceEdit[], note?: string): Promise<{ updated: number }> {
  return api<{ updated: number }>("/api/products/prices", { method: "PATCH", body: { rows, ...(note === undefined ? {} : { note }) } });
}

/** A bulk save - a formula's result or a pasted list; asks for the second factor (PUT). */
export function putPrices(rows: PriceEdit[], note: string): Promise<{ updated: number }> {
  return api<{ updated: number }>("/api/products/prices", { method: "PUT", body: { rows, note } });
}

/**
 * The rows a save was refused over: someone else repriced them after this screen loaded them. Null
 * for any other failure.
 */
export function conflictIds(e: unknown): number[] | null {
  if (!(e instanceof ApiError) || e.code !== "CONFLICT") return null;
  const d = e.details;
  if (typeof d !== "object" || d === null || !("ids" in d) || !Array.isArray(d.ids)) return [];
  return d.ids.filter((id): id is number => typeof id === "number");
}
