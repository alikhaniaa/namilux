"use client";
import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { MediaThumb } from "@/components/media/MediaThumb";
import { cn } from "@/lib/utils";
import { describeChange, rowCode } from "@/lib/pricing";
import type { PriceRow } from "@/lib/pricing";

/** Thumbnail, name and the line a product is told apart by: brand · code · colour. */
export function ProductCell({ row, link = true, children }: { row: Pick<PriceRow, "id" | "displayName" | "brandName" | "sku" | "modelCode" | "colorName" | "imageKey" | "status">; link?: boolean; children?: ReactNode }) {
  const code = rowCode(row);
  return (
    <span className="cell-product price-product">
      <span className="cell-thumb overflow-hidden" aria-hidden="true">
        {row.imageKey === null ? null : <MediaThumb media={{ storageKey: row.imageKey, image: null }} />}
      </span>
      <span className="cell-product__text">
        {link ? (
          <Link href={`/products/${String(row.id)}`} tabIndex={-1} className="cell-name hover:text-[var(--accent)]">
            {row.displayName}
          </Link>
        ) : (
          <span className="cell-name">{row.displayName}</span>
        )}
        <small>
          {row.brandName ?? "بدون برند"}
          {code !== null && !row.displayName.includes(code) ? <> · <bdi>{code}</bdi></> : null}
          {row.colorName !== null && row.colorName !== "" && !row.displayName.includes(row.colorName) ? ` · ${row.colorName}` : ""}
          {row.status === "draft" ? " · پیش‌نویس" : ""}
          {children}
        </small>
      </span>
    </span>
  );
}

/** How far a price moved: an arrow, the amount and the per cent. Nothing when it did not move. */
export function Delta({ before, after, className }: { before: number; after: number; className?: string }) {
  const change = describeChange(before, after);
  if (change.direction === "same") return null;
  return (
    <span className={cn("price-delta", `price-delta--${change.direction}`, className)}>
      {change.direction === "up" ? <ArrowUp size={12} aria-hidden="true" /> : change.direction === "down" ? <ArrowDown size={12} aria-hidden="true" /> : null}
      <bdi>{change.text}</bdi>
    </span>
  );
}

/** A choice among a few, all visible at once - «افزایش | کاهش». Buttons, so it works without a form. */
export function Segmented<T extends string>({ label, options, value, onChange, disabled = false }: { label: string; options: readonly { value: T; label: string }[]; value: T; onChange: (v: T) => void; disabled?: boolean }) {
  return (
    <div className="ui-segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          className="ui-segmented__item"
          disabled={disabled}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** A numbered step of a short flow: «۱ کدام کالاها؟». */
export function Step({ n, title, hint, children, actions }: { n: string; title: string; hint?: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="ui-card price-step">
      <header className="price-step__head">
        <span className="price-step__n" aria-hidden="true">{n}</span>
        <div className="min-w-0 grow">
          <h2 className="ui-card__title">{title}</h2>
          {hint !== undefined ? <p className="ui-card__desc">{hint}</p> : null}
        </div>
        {actions !== undefined ? <div className="ui-card__actions">{actions}</div> : null}
      </header>
      <div className="price-step__body">{children}</div>
    </section>
  );
}
