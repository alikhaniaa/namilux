import Link from "next/link";
import { Icon } from "./Icon";
import type { IconName } from "./Icon";

const VARIANT = { primary: "btn--primary", secondary: "btn--secondary", quiet: "btn--quiet" } as const;
const SIZE = { sm: "btn--sm", md: "", lg: "btn--lg" } as const;

/** The label twins: the visible line rises out on hover and the hidden one rises in (components.css). */
export function ButtonLabel({ children }: { children: React.ReactNode }): React.ReactNode {
  if (typeof children !== "string") return children;
  return (
    <span className="btn__label">
      <span>{children}</span>
      <span aria-hidden="true">{children}</span>
    </span>
  );
}

/** The coin: the round glyph slot at the inline end of a pill (also for raw `.btn` anchors). */
export function ButtonCoin({ icon, loading = false }: { icon: IconName; loading?: boolean }): React.ReactNode {
  return (
    <span className="btn__coin" aria-hidden="true">
      {loading ? <span className="btn__spinner" /> : <Icon name={icon} size={20} />}
    </span>
  );
}

export function Button({
  variant,
  size = "md",
  block = false,
  loading = false,
  icon,
  arrow = false,
  href,
  disabled = false,
  type = "button",
  onClick,
  children,
  className,
  "aria-label": ariaLabel,
  "aria-pressed": ariaPressed,
}: {
  variant: "primary" | "secondary" | "quiet";
  size?: "sm" | "md" | "lg";
  block?: boolean;
  loading?: boolean;
  icon?: IconName;
  arrow?: boolean;
  href?: string;
  disabled?: boolean;
  type?: "button" | "submit";
  onClick?: () => void;
  children: React.ReactNode;
  className?: string;
  "aria-label"?: string;
  "aria-pressed"?: boolean;
}): React.ReactNode {
  const classes = ["btn", VARIANT[variant], SIZE[size], block ? "btn--block" : "", className ?? ""]
    .filter((c) => c !== "")
    .join(" ");

  // The label never disappears while a request is in flight - only the glyph slot
  // changes, so the button keeps its width and the page does not shift.
  const glyph: IconName | undefined = icon ?? (arrow ? "arrow-e" : undefined);
  const inner = (
    <>
      {glyph === undefined && loading ? <span className="btn__spinner" aria-hidden="true" /> : null}
      <ButtonLabel>{children}</ButtonLabel>
      {glyph === undefined ? null : <ButtonCoin icon={glyph} loading={loading} />}
    </>
  );

  if (href !== undefined) {
    // A disabled link is not a thing; render it as an inert span so it leaves the tab order.
    if (disabled) {
      return (
        <span className={classes} aria-disabled="true" aria-label={ariaLabel}>
          {inner}
        </span>
      );
    }
    return (
      <Link href={href} className={classes} aria-label={ariaLabel} aria-busy={loading || undefined}>
        {inner}
      </Link>
    );
  }

  return (
    <button
      type={type}
      className={classes}
      onClick={onClick}
      disabled={disabled}
      aria-disabled={disabled || undefined}
      aria-busy={loading || undefined}
      aria-label={ariaLabel}
      aria-pressed={ariaPressed}
    >
      {inner}
    </button>
  );
}
