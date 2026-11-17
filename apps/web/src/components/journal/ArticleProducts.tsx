import type { ProductCard } from "@namilux/core/client";
import { RelatedRail } from "@/components/product/RelatedRail";

export function ArticleProducts({ items }: { items: ProductCard[] }): React.ReactNode {
  // The journal is 150 posts averaging 3,724 words and it ranks; this rail is the only thing that
  // turns that traffic into a shop visit.
  return <RelatedRail title="journal.products" items={items} />;
}
