"use client";
import type { Review } from "@namilux/core/client";
import { faInt, formatJalali } from "@namilux/core/client";
import Link from "next/link";
import { useState } from "react";
import { useUser } from "@/components/state/providers";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { t } from "@/i18n";
import type { FaKey } from "@/i18n";

type Sort = "newest" | "helpful" | "rating_desc" | "rating_asc";
const SORTS: Sort[] = ["newest", "helpful", "rating_desc", "rating_asc"];
const SORT_KEY: Record<Sort, FaKey> = {
  newest: "product.reviews.sort.newest",
  helpful: "product.reviews.sort.helpful",
  rating_desc: "product.reviews.sort.rating_desc",
  rating_asc: "product.reviews.sort.rating_asc",
};
type Paged = { items: Review[]; total: number; page: number; pageSize: number };
type Envelope<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };

function Stars({ rating }: { rating: number }): React.ReactNode {
  return (
    <span className="inline-flex gap-0.5" aria-label={t("product.reviews.avg", { n: rating })}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} className={i <= rating ? "text-ink" : "text-ink-4"} aria-hidden="true">
          <Icon name="star" size={16} />
        </span>
      ))}
    </span>
  );
}

export function ReviewList({ productId, initial, total }: { productId: number; initial: Review[]; total: number }): React.ReactNode {
  const user = useUser();
  const [items, setItems] = useState<Review[]>(initial);
  const [count, setCount] = useState(total);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<Sort>("newest");
  const [busy, setBusy] = useState(false);
  const [voted, setVoted] = useState<Set<string>>(() => new Set());
  const base = `/api/products/${String(productId)}/reviews/`;

  const load = async (nextSort: Sort, nextPage: number, append: boolean): Promise<void> => {
    setBusy(true);
    try {
      const res = await fetch(`${base}?page=${String(nextPage)}&sort=${nextSort}`);
      const body = (await res.json()) as Envelope<Paged>;
      if (!body.ok) return;
      setItems((prev) => (append ? [...prev, ...body.data.items] : body.data.items));
      setCount(body.data.total);
      setPage(nextPage);
      setSort(nextSort);
    } catch {
      /* a failed page load leaves the list as it was */
    } finally {
      setBusy(false);
    }
  };

  const vote = async (id: string): Promise<void> => {
    if (user === null || voted.has(id)) return;
    setVoted((prev) => new Set(prev).add(id));
    try {
      const res = await fetch(`${base}?vote=1`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reviewId: id }),
      });
      const body = (await res.json()) as Envelope<{ helpful: number }>;
      if (body.ok) setItems((prev) => prev.map((r) => (r.id === id ? { ...r, helpfulCount: body.data.helpful } : r)));
    } catch {
      /* the count simply does not move */
    }
  };

  if (items.length === 0) return <p className="t-body text-ink-2">{t("product.reviews.empty")}</p>;

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t("plp.sort")}>
        {SORTS.map((s) => {
          return (
            <button key={s} type="button" className="chip" aria-pressed={sort === s} disabled={busy} onClick={() => void load(s, 1, false)}>
              {t(SORT_KEY[s])}
            </button>
          );
        })}
      </div>

      <ul className="grid gap-5">
        {items.map((r) => (
          <li key={r.id} className="hairline-t grid gap-2 pt-4">
            <div className="flex flex-wrap items-center gap-3">
              <Stars rating={r.rating} />
              <span className="t-sm font-semibold">{r.customerDisplayName}</span>
              {r.isVerifiedPurchase ? (
                <span className="badge badge--new">{t("product.reviews.verified")}</span>
              ) : null}
              <span className="t-xs text-ink-3">{formatJalali(r.createdAt, "long")}</span>
            </div>
            {r.title !== "" ? <p className="t-body font-semibold">{r.title}</p> : null}
            <p className="t-body text-ink-2">{r.body}</p>
            {r.pros.length > 0 ? (
              <p className="t-sm">
                <span className="text-ok">{t("product.reviews.prosLabel")}: </span>
                {r.pros.join("، ")}
              </p>
            ) : null}
            {r.cons.length > 0 ? (
              <p className="t-sm">
                <span className="text-danger">{t("product.reviews.consLabel")}: </span>
                {r.cons.join("، ")}
              </p>
            ) : null}
            {r.adminReply !== null ? (
              <p className="border-s-2 border-line-strong ps-3 t-sm">
                <span className="text-ink-3">{t("product.reviews.reply")}: </span>
                {r.adminReply}
              </p>
            ) : null}
            <div className="flex items-center gap-3 t-xs text-ink-3">
              {user === null ? (
                <Link href="/account/login/" className="link-under">
                  {t("product.reviews.helpful")} ({faInt(r.helpfulCount)})
                </Link>
              ) : (
                <button type="button" className="link-under" disabled={voted.has(r.id)} onClick={() => void vote(r.id)}>
                  {t("product.reviews.helpful")} ({faInt(r.helpfulCount)})
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>

      {items.length < count ? (
        <Button variant="quiet" loading={busy} disabled={busy} onClick={() => void load(sort, page + 1, true)}>
          {t("product.reviews.more")}
        </Button>
      ) : null}
    </div>
  );
}
