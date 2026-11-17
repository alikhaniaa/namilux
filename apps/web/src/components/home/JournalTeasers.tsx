import { ROUTES } from "@namilux/core/client";
import type { PostCard } from "@namilux/core/client";
import { ArticleCard } from "@/components/journal/ArticleCard";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { t } from "@/i18n";

export function JournalTeasers({ posts }: { posts: PostCard[] }): React.ReactNode {
  // EDGE CASE: fewer than three posts is fine (the grid shortens); none at all renders nothing.
  if (posts.length === 0) return null;

  return (
    <section className="bg-soft below-fold">
      <div className="wrap section grid gap-5">
        <SectionHeader display title={t("home.journal.title")} href={ROUTES.blog} />
        {/* The 16:9 cover, the Jalali date and the read time belong to journal/ArticleCard - this
            module only decides how many teasers stand beside each other. */}
        <ul className="grid gap-5 md:grid-cols-3">
          {posts.map((post) => (
            <li key={post.id}>
              <ArticleCard post={post} />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
