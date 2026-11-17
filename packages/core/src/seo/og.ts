import { createHash } from "node:crypto";
import { eq, media } from "@namilux/db";
import type { Db } from "@namilux/db";
import { jobs } from "../jobs";

export type OgTarget =
  | { kind: "product"; id: number }
  | { kind: "brand"; id: number }
  | { kind: "collection"; id: number }
  | { kind: "category"; id: number }
  | { kind: "post"; slug: string }
  | { kind: "site" };

/**
 * DECISION: storage keys are ASCII (STORAGE_KEY_RE), but a post slug is decoded Persian. A Persian
 * slug is therefore hashed (sha1, 16 hex) into the key; an already-ASCII slug is used verbatim so
 * the common case stays readable. The mapping is deterministic, so the storefront metadata and the
 * worker og.generate handler compute the same key.
 */
function slugToken(slug: string): string {
  return /^[a-z0-9._-]+$/.test(slug) ? slug : createHash("sha1").update(slug).digest("hex").slice(0, 16);
}

/** Deterministic og:image storage key. Prefixes mirror seed/images/manifest.ogKeyFor (p/b/c/site). */
export function ogKeyFor(t: OgTarget): string {
  switch (t.kind) {
    case "product":
      return `og/p/${t.id}.jpg`;
    case "brand":
      return `og/b/${t.id}.jpg`;
    case "collection":
      return `og/c/${t.id}.jpg`;
    case "category":
      return `og/cat/${t.id}.jpg`;
    case "post":
      return `og/post/${slugToken(t.slug)}.jpg`;
    case "site":
      return "og/site.jpg";
  }
}

/**
 * The og:image key for an entity; enqueues one og.generate job (deduped by the key) when the card
 * has not been rendered yet. The storefront never blocks on generation - it uses the site default
 * until the card lands and the page tag is revalidated.
 */
export async function ensureOg(db: Db, t: OgTarget): Promise<{ key: string; exists: boolean }> {
  const key = ogKeyFor(t);
  const rows = await db.select({ id: media.id }).from(media).where(eq(media.storageKey, key)).limit(1);
  const exists = rows[0] !== undefined;
  if (!exists) await jobs.enqueue(db, "og.generate", t, { uniqueKey: key });
  return { key, exists };
}

export function ogUrl(key: string, mediaUrl: (k: string) => string): string {
  return mediaUrl(key);
}
