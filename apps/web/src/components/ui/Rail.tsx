import { t } from "@/i18n";

const ITEM_CLASS = { card: "rail--card", tile: "rail--tile", thumb: "rail--thumb", chip: "rail--chip" } as const;

export function Rail({
  children,
  ariaLabel,
  itemWidth = "card",
}: {
  children: React.ReactNode;
  ariaLabel?: string;
  itemWidth?: "card" | "tile" | "thumb" | "chip";
}): React.ReactNode {
  // Native momentum + scroll-snap only: no JS scroller, so the rail costs nothing on the main
  // thread and keyboard/screen-reader users get the platform's own behaviour.
  return (
    <ul
      className={`rail edge-fade ${ITEM_CLASS[itemWidth]}`}
      // A horizontal list is not obvious on a phone; the label says it can be dragged.
      aria-label={ariaLabel ?? t("a11y.rail")}
      tabIndex={0}
    >
      {children}
    </ul>
  );
}
