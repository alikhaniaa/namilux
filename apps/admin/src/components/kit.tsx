import Link from "next/link";
import { SearchMultiSelect } from "./forms/SearchMultiSelect";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { faInt } from "@namilux/core/client";
import { pageGuidance } from "@/components/shell/page-guidance";
import { cn } from "@/lib/utils";

export type ButtonVariant = "default" | "outline" | "soft" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "icon" | "icon-sm";

function buttonClass(variant: ButtonVariant, size: ButtonSize, className?: string): string {
  return cn("ui-btn", `ui-btn--${variant}`, size === "md" ? "" : `ui-btn--${size}`, className);
}

/** A spinner that inherits the button's text colour; decorative, the label says what is happening. */
function Spinner() {
  return <span className="ui-spinner" aria-hidden="true" />;
}

/**
 * The one button. `default` is the screen's primary action (one per screen), `outline` a secondary
 * one, `soft` a positive action that is not the main one, `ghost` a quiet tool, `danger` a
 * destructive one. `icon` leads the label; `size="icon"` is a square, icon-only button, which then
 * needs an aria-label. `busy` shows a spinner and blocks a second click while a request runs.
 */
export function Button({
  variant = "default",
  size = "md",
  icon,
  busy = false,
  className,
  type = "button",
  children,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize; icon?: ReactNode; busy?: boolean }) {
  return (
    <button type={type} className={buttonClass(variant, size, className)} disabled={disabled === true || busy} aria-busy={busy || undefined} {...props}>
      {busy ? <Spinner /> : icon}
      {children}
    </button>
  );
}

/** A link that looks like a button - page-header actions that navigate («محصول جدید», «ورود از CSV»). */
export function ButtonLink({
  href,
  variant = "default",
  size = "md",
  icon,
  external = false,
  className,
  children,
  title,
  "aria-label": ariaLabel,
}: {
  href: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
  external?: boolean;
  className?: string;
  children?: ReactNode;
  title?: string;
  "aria-label"?: string;
}) {
  const cls = buttonClass(variant, size, className);
  const extra = { ...(title === undefined ? {} : { title }), ...(ariaLabel === undefined ? {} : { "aria-label": ariaLabel }) };
  if (external) {
    return (
      <a href={href} className={cls} target="_blank" rel="noopener noreferrer" {...extra}>
        {icon}
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={cls} {...extra}>
      {icon}
      {children}
    </Link>
  );
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement> & { ref?: React.Ref<HTMLInputElement> }) {
  return <input className={cn("ui-input", className)} {...props} />;
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn("ui-textarea", className)} {...props} />;
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn("ui-select", className)} {...props}>
      {children}
    </select>
  );
}

export function Checkbox({ label, className, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className={cn("ui-check", className)}>
      <input type="checkbox" {...props} />
      <span>{label}</span>
    </label>
  );
}

/**
 * An on/off setting: a checkbox announced as a switch. It changes what happens right away when
 * saved («فعال», «نمایش در فروشگاه»), where a checkbox reads as one choice among several.
 * `description` is the consequence, in one line under the label.
 */
export function Switch({ label, description, className, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string; description?: string }) {
  return (
    <label className={cn("ui-switch", className)}>
      <input type="checkbox" role="switch" {...props} />
      <span className="ui-switch__text">
        <span className="ui-switch__label">{label}</span>
        {description !== undefined ? <span className="ui-switch__desc">{description}</span> : null}
      </span>
    </label>
  );
}

/** Searchable selection shared by category, collection and related settings forms. */
export function CheckList(props: { label: string; options: { id: number; name: string }[]; value: readonly number[]; onChange: (ids: number[]) => void }) {
  return <SearchMultiSelect {...props} />;
}

/**
 * A labelled control. `group` is for a field holding SEVERAL controls (a checkbox list, a tree, a
 * picker with its own buttons): a <label> may only label one control, and clicking anywhere in a
 * label wrapping many re-targets the click to the first of them - ticking «دستهٔ اول» when the
 * editor meant to scroll. Such fields render a named role="group" instead.
 */
export function Field({ label, children, hint, error, group = false, action }: { label: string; children: ReactNode; hint?: string; error?: string; group?: boolean; action?: ReactNode }) {
  const hasError = error !== undefined && error !== "";
  const head =
    action === undefined ? (
      <span className="ui-field__label">{label}</span>
    ) : (
      <span className="ui-field__head">
        <span className="ui-field__label">{label}</span>
        {action}
      </span>
    );
  const tail = (
    <>
      {hasError ? (
        <span className="ui-field__error" role="alert">
          {error}
        </span>
      ) : null}
      {hint !== undefined && !hasError ? <span className="ui-field__hint">{hint}</span> : null}
    </>
  );
  if (group) {
    return (
      <div role="group" aria-label={label} className={cn("ui-field", hasError ? "is-error" : "")}>
        {head}
        {children}
        {tail}
      </div>
    );
  }
  if (action !== undefined) {
    return (
      <div className={cn("ui-field", hasError ? "is-error" : "")}>
        {head}
        <label>
          <span className="sr-only">{label}</span>
          {children}
          {tail}
        </label>
      </div>
    );
  }
  return (
    <label className={cn("ui-field", hasError ? "is-error" : "")}>
      {head}
      {children}
      {tail}
    </label>
  );
}

/**
 * A sheet. `title` + optional `description` make its head, `actions` sit at the head's end;
 * `flush` drops the body padding for a table or a list that draws its own rows edge to edge.
 */
export function Card({
  className,
  children,
  title,
  description,
  actions,
  flush = false,
}: {
  className?: string;
  children: ReactNode;
  title?: string;
  description?: string;
  actions?: ReactNode;
  flush?: boolean;
}) {
  const hasHead = title !== undefined || actions !== undefined;
  return (
    <section className={cn("ui-card", flush ? "ui-card--flush" : "", className)}>
      {hasHead ? (
        <header className="ui-card__head">
          <div className="min-w-0">
            {title !== undefined ? <h2 className="ui-card__title">{title}</h2> : null}
            {description !== undefined ? <p className="ui-card__desc">{description}</p> : null}
          </div>
          {actions !== undefined ? <div className="ui-card__actions">{actions}</div> : null}
        </header>
      ) : null}
      {flush ? children : <div className="ui-card__body">{children}</div>}
    </section>
  );
}

/**
 * The screen's title block. When the page does not pass a subtitle of its own, a short purpose line
 * is looked up by title (see components/shell/page-guidance.ts) - a staff member should be able to
 * tell what editing this screen changes on the storefront without opening a manual. `count` is the
 * number of records the screen lists, drawn beside the title rather than in parentheses; `back`
 * links a detail screen to its list.
 */
export function PageHeader({
  title,
  actions,
  subtitle,
  count,
  back,
  badge,
}: {
  title: string;
  actions?: ReactNode;
  subtitle?: string;
  count?: number;
  back?: { href: string; label: string };
  badge?: ReactNode;
}) {
  const guide = subtitle === undefined ? pageGuidance(title) : undefined;
  const note = subtitle ?? guide;
  return (
    <div className="page-head">
      <div className="page-head__main">
        {back !== undefined ? (
          <Link href={back.href} className="page-head__back">
            <span aria-hidden="true">→</span>
            {back.label}
          </Link>
        ) : null}
        <div className="page-head__title">
          <h1>{title}</h1>
          {count !== undefined ? <span className="page-head__count">{faInt(count)}</span> : null}
          {badge}
        </div>
        {note !== undefined ? <p className={cn("page-head__sub", guide !== undefined ? "page-head__sub--guide" : "")}>{note}</p> : null}
      </div>
      {actions !== undefined ? <div className="page-head__actions">{actions}</div> : null}
    </div>
  );
}

export type Tone = "default" | "ok" | "warn" | "danger" | "muted" | "accent";

export function StatusBadge({ children, tone = "default", dot = true }: { children: ReactNode; tone?: Tone; dot?: boolean }) {
  return (
    <span className={cn("ui-badge", tone === "default" ? "" : `ui-badge--${tone}`)}>
      {dot ? <span className="ui-badge__dot" aria-hidden="true" /> : null}
      {children}
    </span>
  );
}

/** Dense table scaffold (the spec: sticky header, one row height, a scroll region of its own). */
export function Table({ children, minWidth = 640 }: { children: ReactNode; minWidth?: number }) {
  return (
    <div className="admin-table-scroll">
      <table className="admin-data-table" style={{ minInlineSize: `${String(minWidth)}px` }}>
        {children}
      </table>
    </div>
  );
}

export function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return <th className={className}>{children}</th>;
}

export function Td({ children, className, ltr = false }: { children?: ReactNode; className?: string; ltr?: boolean }) {
  return <td className={cn(ltr ? "ltr" : "", className)}>{children}</td>;
}

/** The row a table shows when it has nothing to show: a title, and optionally the next step. */
export function EmptyRow({ colSpan, text, hint }: { colSpan: number; text: string; hint?: string }) {
  return (
    <tr>
      <td colSpan={colSpan} className="admin-empty">
        <span className="admin-empty__art" aria-hidden="true" />
        <span className="admin-empty__title">{text}</span>
        {hint !== undefined ? <span className="admin-empty__hint">{hint}</span> : null}
      </td>
    </tr>
  );
}

/** The same empty state outside a table: a list, a card body, a panel. */
export function EmptyState({ text, hint, action }: { text: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="admin-empty admin-empty--block">
      <span className="admin-empty__art" aria-hidden="true" />
      <span className="admin-empty__title">{text}</span>
      {hint !== undefined ? <span className="admin-empty__hint">{hint}</span> : null}
      {action !== undefined ? <span className="admin-empty__action">{action}</span> : null}
    </div>
  );
}

/**
 * A key figure. `delta` is the change against the previous period as a fraction (0.12 = +12 %),
 * drawn as a small up/down pill; `icon` sits in a tinted tile at the card's start.
 */
export function Kpi({
  label,
  value,
  hint,
  tone = "default",
  delta,
  icon,
  unit,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "warn";
  delta?: { value: number; label: string } | null;
  icon?: ReactNode;
  unit?: string;
}) {
  const dir = delta === undefined || delta === null ? null : delta.value > 0.0005 ? "up" : delta.value < -0.0005 ? "down" : "flat";
  return (
    <div className="ui-kpi">
      <div className="ui-kpi__top">
        <p className="ui-kpi__label">{label}</p>
        {icon !== undefined ? <span className="ui-kpi__icon" aria-hidden="true">{icon}</span> : null}
      </div>
      <p className={cn("ui-kpi__value", tone === "warn" ? "ui-kpi__value--warn" : "")}>
        {value}
        {unit !== undefined ? <span className="ui-kpi__unit">{unit}</span> : null}
      </p>
      {dir !== null && delta !== undefined && delta !== null ? (
        <p className="ui-kpi__foot">
          <span className={cn("ui-delta", `ui-delta--${dir}`)}>
            <span aria-hidden="true">{dir === "up" ? "↑" : dir === "down" ? "↓" : "–"}</span>
            {faInt(Math.round(Math.abs(delta.value) * 100))}٪
          </span>
          <span className="ui-kpi__hint">{delta.label}</span>
        </p>
      ) : hint !== undefined ? (
        <p className="ui-kpi__hint">{hint}</p>
      ) : null}
    </div>
  );
}

/** The list-page toolbar row: filters at the start, views / export at the end. */
export function Toolbar({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("data-toolbar", className)}>{children}</div>;
}

/** Initials in a tinted circle - a staff member or a customer, where a photo would go. */
export function Avatar({ name, size = "md" }: { name: string; size?: "sm" | "md" }) {
  const letters = name
    .trim()
    .split(/\s+/)
    .filter((w) => w !== "")
    .slice(0, 2)
    .map((w) => w[0] ?? "")
    .join("‌");
  return (
    <span className={cn("ui-avatar", size === "sm" ? "ui-avatar--sm" : "")} aria-hidden="true">
      {letters === "" ? "؟" : letters}
    </span>
  );
}

/** A label/value list for a detail sheet (an order's payment, a customer's contact…). */
export function DescList({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="ui-dl">
      {items.map((i) => (
        <div key={i.label} className="ui-dl__row">
          <dt>{i.label}</dt>
          <dd>{i.value}</dd>
        </div>
      ))}
    </dl>
  );
}
