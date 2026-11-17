import { imgSrc, imgSrcSet } from "@namilux/core/client";
import type { ImageRef } from "@namilux/core/client";

export type ImgSlot = "tile" | "pdp" | "thumb" | "hero" | "band" | "cover" | "og";

/** the spec delivery table - one entry per slot, so a caller never hand-writes `sizes`. */
const SIZES: Record<ImgSlot, string> = {
  tile: "(min-width:1180px) 25vw, (min-width:768px) 33vw, 50vw",
  pdp: "(min-width:1024px) 54vw, 100vw",
  thumb: "56px",
  hero: "100vw",
  band: "100vw",
  cover: "(min-width:768px) 33vw, 100vw",
  og: "1200px",
};

/** The width the <img> fallback asks for when the browser ignores srcset (old Safari, email). */
const FALLBACK_WIDTH: Record<ImgSlot, number> = {
  tile: 480,
  pdp: 960,
  thumb: 112,
  hero: 1280,
  band: 1280,
  cover: 640,
  og: 1200,
};

export function Img({
  image,
  slot,
  alt,
  priority = false,
  className,
  sizes,
}: {
  image: ImageRef;
  slot: ImgSlot;
  alt: string;
  priority?: boolean;
  className?: string;
  sizes?: string;
}): React.ReactNode {
  const avif = imgSrcSet(image, "avif");
  const webp = imgSrcSet(image, "webp");
  const resolvedSizes = sizes ?? SIZES[slot];

  return (
    <picture>
      {avif === "" ? null : <source type="image/avif" srcSet={avif} sizes={resolvedSizes} />}
      {webp === "" ? null : <source type="image/webp" srcSet={webp} sizes={resolvedSizes} />}
      <img
        src={imgSrc(image, FALLBACK_WIDTH[slot])}
        alt={alt}
        width={image.width}
        height={image.height}
        // The box is reserved from the stored intrinsic size, so the layout never shifts.
        loading={priority ? "eager" : "lazy"}
        decoding={priority ? "sync" : "async"}
        fetchPriority={priority ? "high" : "auto"}
        className={className}
        style={image.lqip === undefined ? undefined : { backgroundImage: `url(${image.lqip})`, backgroundSize: "cover" }}
      />
    </picture>
  );
}
