import type { Banner } from "@namilux/core/client";
import Link from "next/link";
import { Img } from "@/components/ui/Img";

export function EditorialBand({ banner }: { banner: Banner | null }): React.ReactNode {
  // A band with no image is not a band - it would be a graphite rectangle with a sentence in it.
  if (banner === null || banner.mediaLight === null) return null;

  return (
    <section className="frame chapter below-fold">
      <div className="wrap grid items-center gap-6 md:grid-cols-2">
        <div className="band__img plate">
          <Img image={banner.mediaLight} slot="band" alt={banner.title} />
        </div>
        <div className="grid gap-4">
          <h2 className="d-2 text-frame-ink">{banner.title}</h2>
          {banner.subtitle === null ? null : <p className="t-lead text-frame-ink-2">{banner.subtitle}</p>}
          {banner.ctaHref === null || banner.ctaLabel === null ? null : (
            // On the frame the primary button inverts to frame-ink - the accent is
            // reserved for the buy box, and a band must not compete with it.
            <Link href={banner.ctaHref} className="btn btn--primary justify-self-start">
              {banner.ctaLabel}
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}
