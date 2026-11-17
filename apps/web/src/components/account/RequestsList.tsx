"use client";
import type { BackInStockRequest, BackInStockStatus, ConciergeRequest, QuestionStatus } from "@namilux/core/client";
import { formatJalali } from "@namilux/core/client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Bdi } from "@/components/ui/Bdi";
import { Button } from "@/components/ui/Button";
import { t } from "@/i18n";
import type { FaKey } from "@/i18n";
import { AccountEmpty } from "./AccountEmpty";

const BIS_STATUS_KEY: Record<BackInStockStatus, FaKey> = {
  waiting: "requests.status.waiting",
  notified: "requests.status.notified",
  cancelled: "requests.status.cancelled",
};
const QUESTION_STATUS_KEY: Record<QuestionStatus, FaKey> = {
  pending: "requests.status.pending",
  answered: "requests.status.answered",
  hidden: "requests.status.hidden",
};

export function RequestsList({
  backInStock,
  concierge,
  products = {},
}: {
  backInStock: BackInStockRequest[];
  concierge: ConciergeRequest[];
  products?: Record<number, { name: string; href: string }>;
}): React.ReactNode {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  const cancel = async (r: BackInStockRequest): Promise<void> => {
    setBusy(r.id);
    try {
      await fetch(`/api/products/${String(r.productId)}/back-in-stock/`, { method: "DELETE" });
      router.refresh();
    } finally {
      setBusy(null);
    }
  };

  if (backInStock.length === 0 && concierge.length === 0) {
    return <AccountEmpty icon="chat" title="requests.empty" body="account.requests.hint" />;
  }

  return (
    <div className="grid gap-8">
      {backInStock.length > 0 ? (
        <section className="grid gap-3">
          <h3 className="t-sm font-semibold">{t("requests.backInStock")}</h3>
          <ul className="grid">
            {backInStock.map((r) => {
              const statusKey = BIS_STATUS_KEY[r.status];
              const p = products[r.productId];
              return (
                <li key={r.id} className="hairline-t flex items-center justify-between gap-3 py-3 t-sm">
                  <span className="grid min-w-0 gap-0.5">
                    {p === undefined ? (
                      <span>{t("requests.backInStock")}</span>
                    ) : (
                      <Link className="link-under" href={p.href}>
                        <Bdi text={p.name} />
                      </Link>
                    )}
                    <span className="t-xs text-ink-3">
                      {formatJalali(r.createdAt, "long")} · {t(statusKey)}
                    </span>
                  </span>
                  {r.status === "waiting" ? (
                    <Button variant="quiet" size="sm" loading={busy === r.id} disabled={busy !== null} onClick={() => void cancel(r)}>
                      {t("requests.cancel")}
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {concierge.length > 0 ? (
        <section className="grid gap-3">
          <h3 className="t-sm font-semibold">{t("requests.concierge")}</h3>
          <ul className="grid">
            {concierge.map((q) => {
              const statusKey = QUESTION_STATUS_KEY[q.status];
              return (
                <li key={q.id} className="hairline-t grid gap-1 py-3 t-sm">
                  <div className="flex items-center justify-between gap-3">
                    <Link className="link-under" href={`/product/${encodeURIComponent(q.productSlug)}/`}>
                      <Bdi text={q.productName} />
                    </Link>
                    <span className="t-xs text-ink-3">{t(statusKey)}</span>
                  </div>
                  <span className="t-xs text-ink-3">{formatJalali(q.createdAt, "long")}</span>
                  {q.body !== "" ? <p className="text-ink-2">{q.body}</p> : null}
                  {q.answer !== null ? (
                    <p className="border-s-2 border-line-strong ps-3">
                      <span className="t-xs text-ink-3">{t("requests.answer")}: </span>
                      {q.answer}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
