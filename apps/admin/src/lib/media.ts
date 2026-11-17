import { imgSrc, mediaUrl } from "@namilux/core/client";
import type { ImageRef } from "@namilux/core/client";

const ORIGIN = (process.env.NEXT_PUBLIC_SITE_ORIGIN ?? "").replace(/\/$/, "");

/** Absolute URL of a rendition (webp) at the given width. */
export function adminImg(ref: ImageRef, width: number): string {
  return `${ORIGIN}${imgSrc(ref, width)}`;
}

/** Absolute URL of a raw storage key (master file). */
export function adminMedia(storageKey: string): string {
  return `${ORIGIN}${mediaUrl(storageKey)}`;
}

/** What the media picker and grids carry around: enough to draw a thumbnail without another fetch. */
export type MediaPick = { id: string; storageKey: string; alt: string; image: ImageRef | null; kind: "image" | "video" | "file" };

/** Thumbnail src: the 320px rendition when the image was processed, else the master file. */
export function thumbUrl(m: Pick<MediaPick, "image" | "storageKey">): string {
  return m.image !== null ? adminImg(m.image, 320) : adminMedia(m.storageKey);
}
