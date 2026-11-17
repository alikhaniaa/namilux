import { faInt } from "@namilux/core/client";
import Link from "next/link";

export function Chip({
  pressed = false,
  count,
  href,
  onToggle,
  children,
}: {
  pressed?: boolean;
  count?: number;
  href?: string;
  onToggle?: () => void;
  children: React.ReactNode;
}): React.ReactNode {
  const inner = (
    <>
      {children}
      {count === undefined ? null : <span className="n">{faInt(count)}</span>}
    </>
  );

  // F-008: a facet is a real URL so a crawler (and a shared link) reaches the filtered listing.
  // `aria-pressed` on a link is invalid, so the selected state travels as aria-current instead.
  if (href !== undefined) {
    return (
      <Link href={href} className="chip" aria-current={pressed ? "true" : undefined}>
        {inner}
      </Link>
    );
  }

  return (
    <button type="button" className="chip" aria-pressed={pressed} onClick={onToggle}>
      {inner}
    </button>
  );
}
