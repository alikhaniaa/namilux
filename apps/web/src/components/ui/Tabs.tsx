import { faInt } from "@namilux/core/client";
import Link from "next/link";

// DECISION: real links, not an ARIA tablist. Each tab is its own URL (the spec account tabs),
// so the browser's own focus order and back button already do the work an ARIA widget would have to
// re-implement - and the panels stay server-rendered and shareable. The accent underline is the
// active indicator, which is one of the four places the accent is allowed.
export function Tabs({
  items,
  current,
}: {
  items: { href: string; label: string; count?: number }[];
  current: string;
}): React.ReactNode {
  return (
    <nav className="hairline-b">
      <ul className="rail edge-fade -mx-0 gap-6 px-0">
        {items.map((item) => {
          const active = item.href === current;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`inline-flex items-center gap-2 py-3 t-sm ${
                  active ? "border-b-2 border-accent text-ink" : "border-b-2 border-transparent text-ink-2"
                }`}
              >
                {item.label}
                {item.count === undefined ? null : <span className="text-ink-3">{faInt(item.count)}</span>}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
