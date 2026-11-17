export type IconName =
  | "search"
  | "bag"
  | "heart"
  | "heart-filled"
  | "user"
  | "menu"
  | "close"
  | "chevron-s"
  | "chevron-e"
  | "arrow-s"
  | "arrow-e"
  | "plus"
  | "minus"
  | "check"
  | "compare"
  | "sun"
  | "moon"
  | "phone"
  | "whatsapp"
  | "location"
  | "trash"
  | "filter"
  | "grid-3"
  | "grid-5"
  | "share"
  | "zoom"
  | "back"
  | "star"
  | "truck"
  | "shield"
  | "chat"
  // DECISION (M1): the spec lists 26 names for the UI set, but the tab bar of §8.4 needs a house
  // and a storefront and neither is in it (v1 drew both locally inside TabBar, off-system). Added
  // here to the same 1.5-stroke / 24-grid rules; logged in the spec.
  | "home"
  | "shop"
  // Added with the footer social row (the spec store block): the brand has ~500 k followers there.
  | "instagram";

/**
 * One hand-drawn set on a 24 grid, 1.5 stroke, round caps and joins, no fills.
 * Values are the element children of the <svg>, so a glyph can be more than one path.
 */
const PATHS: Record<IconName, React.ReactNode> = {
  search: (
    <>
      <circle cx="11" cy="11" r="6.25" />
      <path d="M15.6 15.6 20 20" />
    </>
  ),
  bag: (
    <>
      <path d="M4.5 7.5h15l-1 12.5h-13z" />
      <path d="M8.75 10V6.75a3.25 3.25 0 0 1 6.5 0V10" />
    </>
  ),
  heart: <path d="M12 20s-7.5-4.35-7.5-9.25A4.25 4.25 0 0 1 12 8.1a4.25 4.25 0 0 1 7.5 2.65C19.5 15.65 12 20 12 20Z" />,
  "heart-filled": (
    <path
      d="M12 20s-7.5-4.35-7.5-9.25A4.25 4.25 0 0 1 12 8.1a4.25 4.25 0 0 1 7.5 2.65C19.5 15.65 12 20 12 20Z"
      fill="currentColor"
      stroke="none"
    />
  ),
  user: (
    <>
      <circle cx="12" cy="8.25" r="3.75" />
      <path d="M4.75 20a7.25 7.25 0 0 1 14.5 0" />
    </>
  ),
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  // -s = "start of the block axis" (down); -e = inline-end, flipped for RTL by the class below.
  "chevron-s": <path d="M6 9.5 12 15.5l6-6" />,
  "chevron-e": <path d="M9.5 6 15.5 12l-6 6" />,
  "arrow-s": <path d="M12 4.5v15m0 0-5.5-5.5M12 19.5l5.5-5.5" />,
  "arrow-e": <path d="M4.5 12h15m0 0-5.5-5.5M19.5 12 14 17.5" />,
  plus: <path d="M12 5.5v13M5.5 12h13" />,
  minus: <path d="M5.5 12h13" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  // Two overlapping rectangles - always shown with a text label on first use.
  compare: (
    <>
      <rect x="4" y="4" width="11" height="11" />
      <rect x="9" y="9" width="11" height="11" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6M18.4 5.6l-1.6 1.6M7.2 16.8l-1.6 1.6" />
    </>
  ),
  moon: <path d="M20 13.4A8.2 8.2 0 0 1 10.6 4a8.25 8.25 0 1 0 9.4 9.4Z" />,
  phone: <path d="M6.2 4.5h3l1.4 3.6-2 1.4a11.5 11.5 0 0 0 5.9 5.9l1.4-2 3.6 1.4v3a1.7 1.7 0 0 1-1.9 1.7A15.6 15.6 0 0 1 4.5 6.4a1.7 1.7 0 0 1 1.7-1.9Z" />,
  whatsapp: (
    <>
      <path d="M4.5 19.5 5.8 15.7A7.75 7.75 0 1 1 8.9 18.6Z" />
      <path d="M9.4 9.1c.3-.1.6 0 .8.3l.7 1.2-.8.8a5 5 0 0 0 2.5 2.5l.8-.8 1.2.7c.3.2.4.5.3.8-.3.8-1.2 1.2-2 1a7 7 0 0 1-4.5-4.5c-.2-.8.2-1.7 1-2Z" />
    </>
  ),
  location: (
    <>
      <path d="M12 21s6.25-6.1 6.25-10.4a6.25 6.25 0 1 0-12.5 0C5.75 14.9 12 21 12 21Z" />
      <circle cx="12" cy="10.5" r="2.4" />
    </>
  ),
  trash: (
    <>
      <path d="M5 7h14M9.5 7V5.2a1.2 1.2 0 0 1 1.2-1.2h2.6a1.2 1.2 0 0 1 1.2 1.2V7" />
      <path d="M6.75 7 7.7 20h8.6l.95-13" />
      <path d="M10.5 10.5v6M13.5 10.5v6" />
    </>
  ),
  filter: (
    <>
      <path d="M4 6.5h16M7 12h10M10 17.5h4" />
    </>
  ),
  "grid-3": <path d="M4 4.5h4.6v15H4zM9.7 4.5h4.6v15H9.7zM15.4 4.5H20v15h-4.6z" />,
  "grid-5": <path d="M4 6h2.6v12H4zM7.7 6h2.6v12H7.7zM11.4 6H14v12h-2.6zM15.1 6h2.6v12h-2.6zM18.8 6H20v12h-1.2z" />,
  share: (
    <>
      <path d="M12 15.5V4.5m0 0L8.5 8M12 4.5 15.5 8" />
      <path d="M5.5 12.5V18a1.5 1.5 0 0 0 1.5 1.5h10a1.5 1.5 0 0 0 1.5-1.5v-5.5" />
    </>
  ),
  zoom: (
    <>
      <circle cx="11" cy="11" r="6.25" />
      <path d="M15.6 15.6 20 20M8.5 11h5M11 8.5v5" />
    </>
  ),
  back: <path d="M19.5 12h-15m0 0 5.5-5.5M4.5 12 10 17.5" />,
  star: <path d="m12 4.5 2.35 4.76 5.25.77-3.8 3.7.9 5.23L12 16.49l-4.7 2.47.9-5.23-3.8-3.7 5.25-.77Z" fill="currentColor" stroke="none" />,
  truck: (
    <>
      <path d="M3.5 7h10v9h-10zM13.5 10.5h3.4l2.6 3v2.5h-6z" />
      <circle cx="7" cy="17.5" r="1.75" />
      <circle cx="16.5" cy="17.5" r="1.75" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3.5 19 6v5.4c0 4.2-2.9 7.5-7 9.1-4.1-1.6-7-4.9-7-9.1V6Z" />
      <path d="m8.9 11.8 2.2 2.2 4-4.2" />
    </>
  ),
  chat: <path d="M4.5 5.5h15v10h-9.4L5.5 19v-3.5h-1Z" />,
  home: (
    <>
      <path d="M4 10.5 12 4l8 6.5" />
      <path d="M6 9.8V19.5h12V9.8" />
    </>
  ),
  instagram: (
    <>
      <rect x="4" y="4" width="16" height="16" />
      <circle cx="12" cy="12" r="3.6" />
      <circle cx="16.6" cy="7.4" r=".9" fill="currentColor" stroke="none" />
    </>
  ),
  shop: (
    <>
      <path d="M4.5 8.5h15l-1 11h-13z" />
      <path d="M4.5 8.5 6 4.5h12l1.5 4" />
      <path d="M9.5 12a2.5 2.5 0 0 0 5 0" />
    </>
  ),
};

/** Icons whose meaning depends on the writing direction; the CSS flips them under [dir="rtl"]. */
const DIRECTIONAL = new Set<IconName>(["chevron-e", "arrow-e", "back", "share", "whatsapp"]);

export function Icon({
  name,
  size = 24,
  label,
  className,
}: {
  name: IconName;
  size?: 16 | 20 | 24;
  label?: string;
  className?: string;
}): React.ReactNode {
  const classes = [DIRECTIONAL.has(name) ? "icon--dir" : null, className].filter(Boolean).join(" ");
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={classes === "" ? undefined : classes}
      role={label === undefined ? undefined : "img"}
      aria-hidden={label === undefined ? true : undefined}
      focusable="false"
    >
      {label === undefined ? null : <title>{label}</title>}
      {PATHS[name]}
    </svg>
  );
}
