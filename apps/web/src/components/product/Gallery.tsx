"use client";
import type { ImageRef } from "@namilux/core/client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { Img } from "@/components/ui/Img";
import { Progress } from "@/components/ui/Progress";
import { t } from "@/i18n";
import { Lightbox } from "./Lightbox";

export function Gallery({
  images,
  video,
  name,
  productId,
}: {
  images: ImageRef[];
  // DECISION: the inline shape of the stub is kept verbatim. The header names `VideoRef`, but the
  // only exported VideoRef (catalog/media) is a media row (id/mime/poster: ImageRef) and
  // ProductDetail.video is a third shape ({ key, poster, durationMs }); the loader maps whichever it
  // holds onto a src + poster URL, which is all a <video> needs.
  video?: { src: string; poster?: string } | null;
  name: string;
  productId: number;
}): React.ReactNode {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const slideRefs = useRef<(HTMLElement | null)[]>([]);
  const [current, setCurrent] = useState(0);
  const [zoomed, setZoomed] = useState<number | null>(null);

  const slideCount = images.length + (video == null ? 0 : 1);

  // Which slide is on screen is read from the scroller itself, so a native swipe, a thumbnail and
  // the arrow keys all report through one path.
  useEffect(() => {
    const track = trackRef.current;
    if (track === null || slideCount === 0) return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const at = slideRefs.current.indexOf(entry.target as HTMLElement);
          if (at !== -1) setCurrent(at);
        }
      },
      { root: track, threshold: 0.6 },
    );
    for (const slide of slideRefs.current) if (slide !== null) observer.observe(slide);
    return () => {
      observer.disconnect();
    };
  }, [slideCount]);

  const goTo = useCallback((at: number): void => {
    const slide = slideRefs.current[at];
    if (slide == null) return;
    // `inline: "start"` is the logical axis: the browser resolves it against the RTL document, so
    // there is no scroll arithmetic and no physical direction anywhere.
    slide.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", inline: "start", block: "nearest" });
  }, []);

  const step = (delta: number): void => {
    goTo(Math.min(Math.max(current + delta, 0), slideCount - 1));
  };

  if (slideCount === 0) {
    // A product with no media still reserves the plate: the column beside it must not jump (CLS 0).
    return <div className="plate" aria-hidden="true" />;
  }

  return (
    // the spec: the gallery is the sticky half of the desktop split; the 54 / 46 grid itself
    // belongs to the page.
    <section className="gallery grid gap-3 lg:sticky lg:top-6 lg:self-start" aria-roledescription="carousel" aria-label={name}>
      <div className="gallery-main relative">
        <div
          ref={trackRef}
          className="gallery-track flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain lg:overflow-hidden"
          tabIndex={0}
          onKeyDown={(event) => {
            // The document is RTL: the next slide sits toward the inline-end, which is the left
            // arrow. Reading the pair from the writing direction is what makes the keys feel native.
            if (event.key === "ArrowLeft") {
              event.preventDefault();
              step(1);
            } else if (event.key === "ArrowRight") {
              event.preventDefault();
              step(-1);
            }
          }}
        >
          {images.map((image, i) => (
            <button
              key={image.key}
              type="button"
              ref={(el) => {
                slideRefs.current[i] = el;
              }}
              onClick={() => {
                setZoomed(i);
              }}
              aria-label={t("product.gallery.of", { i: i + 1, n: images.length })}
              className="plate w-full flex-none snap-start"
              // §11: the tile → PDP view transition lands on the first plate of the gallery.
              style={i === 0 ? { viewTransitionName: `p-${productId}` } : undefined}
            >
              <Img image={image} slot="pdp" alt={image.alt === "" ? name : image.alt} priority={i === 0} />
              {/* Affordance only - the whole plate is the labelled control. */}
              <span aria-hidden="true" className="chip-on-plate absolute end-2 bottom-2 grid size-[36px] place-items-center">
                <Icon name="zoom" size={20} />
              </span>
            </button>
          ))}
          {video == null ? null : (
            <div
              ref={(el) => {
                slideRefs.current[images.length] = el;
              }}
              className="plate w-full flex-none snap-start"
            >
              <video
                src={video.src}
                poster={video.poster}
                controls
                muted
                playsInline
                preload="none"
                aria-label={t("product.gallery.video")}
                className="size-full object-cover"
              />
            </div>
          )}
        </div>
        {slideCount > 1 ? (
          <>
            <button
              type="button"
              onClick={() => {
                step(-1);
              }}
              disabled={current === 0}
              aria-label={t("a11y.prevImage")}
              className="chip-on-plate absolute start-3 top-1/2 hidden size-[44px] -translate-y-1/2 place-items-center disabled:opacity-45 lg:grid"
            >
              <Icon name="chevron-e" className="rotate-180" />
            </button>
            <button
              type="button"
              onClick={() => {
                step(1);
              }}
              disabled={current === slideCount - 1}
              aria-label={t("a11y.nextImage")}
              className="chip-on-plate absolute end-3 top-1/2 hidden size-[44px] -translate-y-1/2 place-items-center disabled:opacity-45 lg:grid"
            >
              <Icon name="chevron-e" />
            </button>
          </>
        ) : null}
      </div>

      {/* Mobile: 2 px segments under the rail. Desktop: the thumbnail rail is the indicator. */}
      <div className="lg:hidden">
        <Progress total={slideCount} current={current} />
      </div>

      {/* UI v4: the thumbnails stand in a vertical rail at the inline-start of the main plate on
          desktop (components.css .gallery); hidden below lg where the segments are the indicator. */}
      {slideCount > 1 ? (
        <ul className="gallery-thumbs">
          {images.map((image, i) => (
            <li key={image.key}>
              <button
                type="button"
                onClick={() => {
                  goTo(i);
                }}
                aria-label={t("product.gallery.of", { i: i + 1, n: images.length })}
                aria-current={i === current ? "true" : undefined}
                className="plate block"
              >
                <Img image={image} slot="thumb" alt="" />
              </button>
            </li>
          ))}
          {video == null ? null : (
            <li>
              <button
                type="button"
                onClick={() => {
                  goTo(images.length);
                }}
                aria-label={t("product.gallery.video")}
                aria-current={current === images.length ? "true" : undefined}
                className="plate grid place-items-center"
              >
                <Icon name="zoom" size={20} />
              </button>
            </li>
          )}
        </ul>
      ) : null}

      <Lightbox
        images={images}
        index={zoomed ?? 0}
        open={zoomed !== null}
        onClose={() => {
          setZoomed(null);
        }}
      />
    </section>
  );
}
