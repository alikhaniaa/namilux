import type { Question } from "@namilux/core/client";
import { faDigits, formatJalali } from "@namilux/core/client";
import { LazyForm } from "./LazyForm";
import { t } from "@/i18n";

export function Questions({ productId, items }: { productId: number; items: Question[] }): React.ReactNode {
  return (
    <section className="grid gap-6" aria-labelledby="questions-title">
      <h2 id="questions-title" className="d-3">
        {t("product.questions")}
      </h2>
      {items.length === 0 ? (
        <p className="t-body text-ink-2">{t("product.questions.empty")}</p>
      ) : (
        <ul className="grid gap-5">
          {items.map((q) => (
            <li key={q.id} className="hairline-t grid gap-2 pt-4">
              <p className="t-xs text-ink-3">
                <bdi>{faDigits(q.phoneMasked)}</bdi> · {formatJalali(q.createdAt, "long")}
              </p>
              <p className="t-body font-semibold">{q.body}</p>
              {q.answer !== null ? (
                <p className="border-s-2 border-line-strong ps-3 t-body text-ink-2">
                  <span className="t-xs text-ink-3">{t("product.questions.answer")}: </span>
                  {q.answer}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <div className="hairline-t pt-6">
        <LazyForm kind="question" productId={productId} />
      </div>
    </section>
  );
}
