import type { ProductCard as ProductCardData } from "@namilux/core/client";
import Link from "next/link";
import { RelatedRail } from "@/components/product/RelatedRail";
import { t } from "@/i18n";
import type { FaKey } from "@/i18n";

export type EmptyStateRail =
  | { title: FaKey; items: ProductCardData[] }
  | { title: FaKey; collections: { slug: string; name: string; href: string }[] };

export function EmptyState({
  title,
  body,
  vars,
  primary,
  secondary,
  rail,
  headingLevel = 1,
}: {
  title: FaKey;
  body: FaKey;
  vars?: Record<string, string | number>;
  primary: { key: FaKey; href: string };
  secondary?: { key: FaKey; href: string };
  rail: EmptyStateRail;
  headingLevel?: 1 | 2;
  texture?: "vase" | "ochre" | "pampas" | "curtain" | "stems";
}): React.ReactNode {
  const Heading = headingLevel === 1 ? "h1" : "h2";
  return (
    <div className="grid gap-6">
      <div className="wrap grid justify-items-center gap-4 py-8 text-center md:py-10">
        <Heading className="d-3">{t(title, vars)}</Heading>
        {/* One sentence, measured at 46ch: an empty state that explains itself at length reads as
            an apology. */}
        <p className="t-body max-w-[46ch] text-ink-2">{t(body, vars)}</p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Link href={primary.href} className="btn btn--primary">
            {t(primary.key)}
          </Link>
          {secondary === undefined ? null : (
            <Link href={secondary.href} className="link-under t-sm">
              {t(secondary.key)}
            </Link>
          )}
        </div>
      </div>

      {/* §7.6 rules: an empty state ALWAYS ends in a rail - the way out matters more than the
          explanation. Collections are the way out when there are no products to show. */}
      {"items" in rail ? (
        <RelatedRail title={rail.title} items={rail.items} />
      ) : rail.collections.length === 0 ? null : (
        <section className="section wrap grid gap-4">
          <h2 className="d-3">{t(rail.title)}</h2>
          <ul className="flex flex-wrap gap-2">
            {rail.collections.map((c) => (
              <li key={c.slug}>
                <Link href={c.href} className="chip">
                  {c.name}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
