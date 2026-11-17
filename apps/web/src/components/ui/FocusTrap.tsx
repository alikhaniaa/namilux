"use client";
import { useEffect, useRef } from "react";

// Tabbable, not merely focusable: `[tabindex="-1"]` is reachable by script only, so it must never be
// a stop in the Tab cycle.
const TABBABLE = [
  "a[href]",
  "area[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "iframe",
  "audio[controls]",
  "video[controls]",
  "summary",
  "[contenteditable]:not([contenteditable='false'])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

// Only the topmost trap answers the keyboard: a city-picker sheet opened from inside the nav drawer
// owns Esc and Tab until it closes, and the drawer takes them back afterwards.
const stack: symbol[] = [];

// DECISION: the scroll lock lives here rather than in Sheet/Drawer. Both of those specs ask for
// "scroll lock preserving position", both build on this component, and a single depth-counted lock
// is the only way nested overlays cannot unlock the page while one of them is still open (two
// independent locks would restore the wrong offset). Popover is not a trap, so it never locks.
let lockCount = 0;
let lockedScrollY = 0;

function lockScroll(): void {
  lockCount += 1;
  if (lockCount > 1) return;
  lockedScrollY = window.scrollY;
  // `position: fixed` is the only lock iOS Safari honours; the negative block offset keeps the page
  // exactly where the reader left it, and the gutter compensation keeps a desktop scrollbar's width
  // in the layout so nothing shifts sideways when the document stops scrolling (CLS budget = 0.00).
  const gutter = window.innerWidth - document.documentElement.clientWidth;
  const style = document.body.style;
  style.setProperty("position", "fixed");
  style.setProperty("inset-inline", "0");
  style.setProperty("inset-block-start", `-${String(lockedScrollY)}px`);
  if (gutter > 0) style.setProperty("padding-inline-end", `${String(gutter)}px`);
}

function unlockScroll(): void {
  lockCount = Math.max(0, lockCount - 1);
  if (lockCount > 0) return;
  const style = document.body.style;
  style.removeProperty("position");
  style.removeProperty("inset-inline");
  style.removeProperty("inset-block-start");
  style.removeProperty("padding-inline-end");
  window.scrollTo(0, lockedScrollY);
}

/**
 * Everything the trapped subtree is not: the siblings of the portal root, and - for a trap opened
 * inside another one - the siblings at every level up to <body>, so an earlier sheet in the same
 * portal node also goes inert. Elements that were already inert are left alone (and left inert).
 */
function inertBackground(node: HTMLElement): HTMLElement[] {
  const marked: HTMLElement[] = [];
  let current: HTMLElement = node;
  while (current.parentElement !== null) {
    for (const sibling of Array.from(current.parentElement.children)) {
      if (!(sibling instanceof HTMLElement) || sibling === current || sibling.hasAttribute("inert")) continue;
      sibling.setAttribute("inert", "");
      marked.push(sibling);
    }
    if (current.parentElement === document.body) break;
    current = current.parentElement;
  }
  return marked;
}

function tabbables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(TABBABLE)).filter(
    (el) => el.getClientRects().length > 0 && el.getAttribute("aria-hidden") !== "true",
  );
}

export function FocusTrap({
  active,
  children,
  onEscape,
  returnFocusTo,
}: {
  active: boolean;
  children: React.ReactNode;
  onEscape?: () => void;
  returnFocusTo?: HTMLElement | null;
}): React.ReactNode {
  const ref = useRef<HTMLDivElement | null>(null);
  const escapeRef = useRef<(() => void) | undefined>(onEscape);
  const returnRef = useRef<HTMLElement | null | undefined>(returnFocusTo);

  // Kept in refs so a re-render of the sheet's contents never re-runs the trap effect: re-running it
  // would re-lock the scroll, re-focus the first control and lose the caller's typing.
  useEffect(() => {
    escapeRef.current = onEscape;
    returnRef.current = returnFocusTo;
  });

  useEffect(() => {
    const container = ref.current;
    if (!active || container === null) return undefined;

    const token = Symbol("focus-trap");
    stack.push(token);
    const isTop = (): boolean => stack[stack.length - 1] === token;

    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const marked = inertBackground(container);
    lockScroll();

    // Focus lands on the first control of the overlay; with nothing to focus the container itself
    // takes it (tabIndex -1) so the reader is never left behind an inert page.
    const entry = tabbables(container)[0];
    if (entry === undefined) container.focus({ preventScroll: true });
    else entry.focus({ preventScroll: true });

    const onKeyDown = (event: KeyboardEvent): void => {
      if (!isTop()) return;
      if (event.key === "Escape") {
        event.preventDefault();
        escapeRef.current?.();
        return;
      }
      if (event.key !== "Tab") return;
      const items = tabbables(container);
      const first = items[0];
      const last = items[items.length - 1];
      if (first === undefined || last === undefined) {
        event.preventDefault();
        container.focus({ preventScroll: true });
        return;
      }
      const current = document.activeElement;
      if (!container.contains(current)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
        return;
      }
      if (!event.shiftKey && current === last) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && (current === first || current === container)) {
        event.preventDefault();
        last.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      const at = stack.indexOf(token);
      if (at !== -1) stack.splice(at, 1);
      for (const el of marked) el.removeAttribute("inert");
      unlockScroll();
      // Focus goes back to what opened the overlay - unless that element is gone (a row that was
      // deleted by the sheet itself), in which case the document keeps it and the reader is not
      // thrown to the top of the page.
      const back = returnRef.current ?? previous;
      if (back != null && back.isConnected) back.focus({ preventScroll: true });
    };
  }, [active]);

  return (
    <div ref={ref} tabIndex={-1}>
      {children}
    </div>
  );
}
