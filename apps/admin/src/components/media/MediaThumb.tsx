"use client";
import { useEffect, useState } from "react";
import { fa } from "@/i18n/fa";
import { cn } from "@/lib/utils";
import { type MediaPick, thumbUrl } from "@/lib/media";

/**
 * The fields a thumbnail needs. `processed === false` means the media row exists but the worker has not
 * written `renditions_json` yet (POST /api/media/upload answers `{ mediaId, status: "processing" }`),
 * so the 320px rendition does not exist and neither does a reliable master URL under `tmp/`.
 */
export type MediaThumbItem = Pick<MediaPick, "image" | "storageKey"> & { processed?: boolean };

/** No i18n key exists yet for an undecodable thumbnail; inline Persian for now (Opus consolidates later). */
const BROKEN_FA = "پیش‌نمایش در دسترس نیست";

/**
 * One square thumbnail with a graceful placeholder: processing rows and images whose URL 404s (or whose
 * bytes are not decodable) render a labelled placeholder instead of the browser's broken-image glyph.
 */
export function MediaThumb({
  media,
  alt,
  className,
  imgClassName,
}: {
  /** `undefined` when no preview record was carried along at all. */
  media: MediaThumbItem | undefined;
  alt?: string;
  className?: string;
  imgClassName?: string;
}) {
  const [broken, setBroken] = useState(false);
  const src = media === undefined || media.processed === false ? null : thumbUrl(media);

  // A new src deserves a fresh attempt: without this, a re-uploaded/reprocessed image keeps its placeholder.
  useEffect(() => {
    setBroken(false);
  }, [src]);

  const label = src === null && media !== undefined ? fa["media.processing"] : BROKEN_FA;
  const ariaLabel = alt !== undefined && alt !== "" ? `${alt}: ${label}` : label;

  if (src === null || broken) {
    return (
      <span
        role="img"
        aria-label={ariaLabel}
        title={label}
        className={cn(
          "flex h-full w-full items-center justify-center bg-[var(--bg)] p-1 text-center text-[10px] leading-tight text-[var(--ink-2)]",
          className,
        )}
      >
        {label}
      </span>
    );
  }

  return <img src={src} alt={alt ?? ""} loading="lazy" onError={() => setBroken(true)} className={cn("h-full w-full object-contain", className, imgClassName)} />;
}
