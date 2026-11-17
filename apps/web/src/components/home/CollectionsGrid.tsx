import { collectionUrl } from "@namilux/core/client";
import type { CollectionCard } from "@namilux/core/client";
import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import { Img } from "@/components/ui/Img";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { t } from "@/i18n";

export function CollectionsGrid({ collections }: { collections: CollectionCard[] }): React.ReactNode {
  // EDGE CASE: no live collections → render nothing rather than an empty grid.
  if (collections.length === 0) return null;

  return (
    <section id="collections" className="bg-soft below-fold scroll-mt-24">
      <div className="wrap section grid gap-6">
        <SectionHeader display title={t("home.collections.title")} />
        <ul className="collections-grid">
          {collections.map((collection) => {
            // DECISION: coverDark is only a fallback here, not a theme switch. The tile ground is
            // --plate, which is identical in both themes (§4), so one cover is correct in both and
            // the page stays a single cacheable payload.
            const cover = collection.cover ?? collection.coverDark;
            return (
              <li key={collection.id}>
                <Link href={collectionUrl(collection.slug)} className="collection-tile" data-reveal="photo">
                  {/* .plate is the 4:5 box and the product ground; an absent cover leaves it empty
                      rather than showing a broken image. */}
                  <span className="plate editorial-cover">
                    {cover === null ? null : <Img image={cover} slot="cover" alt="" sizes="(min-width:1024px) 20vw, 50vw" />}
                  </span>
                  <span className="collection-tile__scrim" aria-hidden="true" />
                  <span className="collection-tile__name">
                    <span>{collection.name}</span>
                    <span className="collection-tile__arrow" aria-hidden="true">
                      <Icon name="arrow-e" size={16} />
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
