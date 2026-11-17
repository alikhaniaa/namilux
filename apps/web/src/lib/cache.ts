import "server-only";
import { AppError } from "@namilux/core";
import { isCacheTag, tags as coreTags } from "@namilux/core/cache";
import { cacheLife, cacheTag, revalidateTag } from "next/cache";

export const LIFE = {
  minutes: { stale: 60, revalidate: 300, expire: 3600 },
  hours: { stale: 300, revalidate: 3600, expire: 86400 },
  days: { stale: 3600, revalidate: 86400, expire: 604800 },
} as const;

export type Life = keyof typeof LIFE;

/** Applies the family tag, the caller's tags and the lifetime to the enclosing `"use cache"` scope. */
function apply(family: string, tags: readonly string[], life: Life): void {
  cacheLife(LIFE[life]);
  cacheTag(family);
  for (const tag of tags) cacheTag(tag);
}

export function tagCatalog(tags: readonly string[] = [], life: Life = "hours"): void {
  apply(coreTags.catalog, tags, life);
}

export function tagContent(tags: readonly string[] = [], life: Life = "hours"): void {
  apply(coreTags.content, tags, life);
}

export function tagSettings(): void {
  apply(coreTags.settings, [], "minutes");
}

export async function revalidateTags(tags: string[]): Promise<void> {
  // Reachable from POST /api/internal/revalidate (HMAC-signed, but still outside input): only tag
  // names the core tag grammar recognises may reach Next's cache.
  const bad = tags.filter((tag) => !isCacheTag(tag));
  if (bad.length > 0) {
    throw new AppError("VALIDATION", 400, "درخواست نامعتبر است", { tags: bad });
  }
  // DECISION: Next 16.3 requires a second argument on revalidateTag (the docs were written against
  // the single-argument form). `{ expire: 0 }` is the closest equivalent: the entry may not be
  // served stale at all, so an admin price edit reaches the PDP on the next request (the spec M4 gate).
  for (const tag of tags) revalidateTag(tag, { expire: 0 });
}
