"use client";
import { useEffect, useRef, useState } from "react";

const GAP = 4; // space between the anchor and the panel
const EDGE = 8; // smallest distance the panel keeps from a viewport edge

export function Popover({
  open,
  onClose,
  anchor,
  children,
  label,
}: {
  open: boolean;
  // DECISION: spelled as a property, not the header's `onClose(): void` method shorthand - the type is
  // identical, and a method-shorthand prop trips `@typescript-eslint/unbound-method` when destructured.
  onClose: () => void;
  anchor: React.RefObject<HTMLElement | null>;
  children: React.ReactNode;
  label: string;
}): React.ReactNode {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<() => void>(onClose);
  const focusInside = useRef(false);
  const [pos, setPos] = useState<{ inlineStart: number; blockStart: number } | null>(null);

  useEffect(() => {
    closeRef.current = onClose;
  });

  // DECISION: no portal. The contract hands over an anchor ref, so the panel is positioned as a
  // fixed box from the anchor's rect; keeping it next to its trigger in the DOM also keeps the
  // reading order right and leaves #sheets to the modal family (Sheet/Drawer).
  useEffect(() => {
    if (!open) {
      setPos(null);
      return undefined;
    }
    const place = (): void => {
      const anchorEl = anchor.current;
      const panel = panelRef.current;
      if (anchorEl === null || panel === null) return;
      const a = anchorEl.getBoundingClientRect();
      const p = panel.getBoundingClientRect();
      const vw = document.documentElement.clientWidth;
      const vh = document.documentElement.clientHeight;
      // Distance from the viewport's inline-start edge - one number that is correct in both
      // directions, so the panel is never positioned by a physical side.
      const rtl = getComputedStyle(anchorEl).direction === "rtl";
      const fromEndEdge = vw - a.right;
      const anchorStart = rtl ? fromEndEdge : a.left;
      const inlineStart = Math.min(Math.max(EDGE, anchorStart), Math.max(EDGE, vw - p.width - EDGE));
      const below = a.bottom + GAP;
      const above = a.top - p.height - GAP;
      const blockStart = below + p.height > vh - EDGE && above >= EDGE ? above : below;
      setPos({ inlineStart, blockStart });
    };
    place();
    // A fixed panel does not travel with its anchor: re-place on scroll (capture, so a scrolling
    // toolbar counts too) and on resize instead of leaving it stranded.
    window.addEventListener("resize", place, { passive: true });
    window.addEventListener("scroll", place, { passive: true, capture: true });
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, { capture: true });
    };
  }, [open, anchor]);

  useEffect(() => {
    if (!open) return undefined;
    // The panel takes focus so Tab continues inside it; it is not modal, so nothing is trapped and
    // the background stays live.
    panelRef.current?.focus({ preventScroll: true });
    // The trigger as it was when the panel opened; focus goes back to this node, not to whatever
    // the ref points at by the time the panel closes.
    const trigger = anchor.current;

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closeRef.current();
    };
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (panelRef.current?.contains(target) === true) return;
      // The trigger owns its own toggle; closing here too would reopen-then-close on one click.
      if (anchor.current?.contains(target) === true) return;
      closeRef.current();
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
      // Focus goes back to the trigger only when it was still inside the panel: a click on some
      // other control elsewhere must keep the focus the reader chose.
      if (focusInside.current && trigger !== null && trigger.isConnected) trigger.focus({ preventScroll: true });
      focusInside.current = false;
    };
  }, [open, anchor]);

  if (!open) return null;

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label={label}
      tabIndex={-1}
      onFocus={() => {
        focusInside.current = true;
      }}
      onBlur={() => {
        focusInside.current = false;
      }}
      // DECISION: `bg-surface` for the "porcelain surface" of the spec - --surface is the porcelain
      // token whose role is panels; the page ground would not read as raised.
      className="anim-fade fixed z-50 border border-line bg-surface shadow-pop"
      style={{
        // The panel is rendered before it is measured; it stays invisible for that one frame rather
        // than flashing at the top of the viewport.
        insetInlineStart: pos === null ? 0 : `${String(pos.inlineStart)}px`,
        insetBlockStart: pos === null ? 0 : `${String(pos.blockStart)}px`,
        visibility: pos === null ? "hidden" : "visible",
      }}
    >
      {children}
    </div>
  );
}
