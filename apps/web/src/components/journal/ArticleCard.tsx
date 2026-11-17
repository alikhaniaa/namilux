import { faDigits, formatJalali, postUrl, truncateWords } from "@namilux/core/client";
import type { PostCard } from "@namilux/core/client";
import Link from "next/link";
import { Img } from "@/components/ui/Img";
import { t } from "@/i18n";

const EXCERPT_WORDS = 22;

export function ArticleCard({ post }: { post: PostCard }): React.ReactNode {
  return (
    <article className="journal-card grid gap-3">
      <Link href={postUrl(post.slug)} className="grid gap-3">
        {/* Every card gets a 16:9 cover; a post without one keeps the plate so the rhythm of a
            three-card row does not break. */}
        <span className="plate plate--wide editorial-cover">
          {post.cover === null ? null : <Img image={post.cover} slot="cover" alt="" />}
        </span>
        <h3 className="d-3">{faDigits(post.title)}</h3>
      </Link>
      <p className="t-sm text-ink-2">{faDigits(truncateWords(post.excerpt, EXCERPT_WORDS))}</p>
      <p className="t-xs text-ink-3">
        {formatJalali(post.publishedAt, "short")} · {t("journal.readTime", { n: post.readMinutes })}
      </p>
    </article>
  );
}
