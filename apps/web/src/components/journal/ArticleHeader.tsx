import { formatJalali } from "@namilux/core/client";
import type { PostView } from "@namilux/core/client";
import { Img } from "@/components/ui/Img";
import { t } from "@/i18n";

export function ArticleHeader({ post }: { post: PostView }): React.ReactNode {
  return (
    <header className="grid gap-5">
      {/* Scroll-driven reading progress: pure CSS (animation-timeline), a no-op in engines without it. */}
      <div className="article-progress" aria-hidden="true" />
      {post.cover === null ? null : (
        // Full-bleed: the cover is the article's hero, so it escapes the 1280 content grid.
        <div className="plate plate--wide plate--wide-to-ultra">
          <Img image={post.cover} slot="hero" alt="" priority />
        </div>
      )}
      <div className="wrap grid gap-3">
        <h1 className="d-1">{post.title}</h1>
        <p className="t-xs text-ink-3">
          {formatJalali(post.publishedAt, "long")} · {t("journal.readTime", { n: post.readMinutes })}
        </p>
      </div>
    </header>
  );
}
