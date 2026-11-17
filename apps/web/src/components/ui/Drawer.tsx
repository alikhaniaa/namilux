"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { t } from "@/i18n";
import { FocusTrap } from "./FocusTrap";
import { Icon } from "./Icon";

// The overlay family shares one portal node; it is created on first open (see Sheet.tsx for the
// reasoning - app/layout.tsx is another file's contract).
function sheetsRoot(): HTMLElement {
  const existing = document.getElementById("sheets");
  if (existing !== null) return existing;
  const created = document.createElement("div");
  created.id = "sheets";
  document.body.append(created);
  return created;
}

// Same thresholds as the sheet, measured on the inline axis instead of the block one.
const DISMISS_RATIO = 0.4;
const DISMISS_VELOCITY = 500;
const AXIS_SLOP = 6;

type Drag = {
  pointer: number;
  startX: number;
  startY: number;
  lastX: number;
  lastAt: number;
  velocity: number;
  toward: 1 | -1;
  axis: "unknown" | "inline" | "block";
};

export function Drawer({
  open,
  onClose,
  label,
  title,
  className = "",
  children,
}: {
  open: boolean;
  /** Optional heading drawn beside the close control; the dialog's accessible name stays `label`. */
  title?: React.ReactNode;
  className?: string;
  // DECISION: spelled as a property, not the header's `onClose(): void` method shorthand - the type is
  // identical, and a method-shorthand prop trips `@typescript-eslint/unbound-method` when destructured.
  onClose: () => void;
  label: string;
  children: React.ReactNode;
}): React.ReactNode {
  const [root, setRoot] = useState<HTMLElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const drag = useRef<Drag | null>(null);

  useEffect(() => {
    if (!open) return;
    setRoot(sheetsRoot());
  }, [open]);

  // DECISION: the dismiss direction is read from the panel's computed `direction` at gesture start
  // rather than hard-coded, so "toward the start edge" stays true if a subtree is ever LTR - the
  // same reasoning as the `.icon--dir` mirror. Touch/pen only, as in Sheet.
  const startDrag = (event: React.PointerEvent<HTMLElement>): void => {
    const panel = panelRef.current;
    if (event.pointerType === "mouse" || panel === null) return;
    drag.current = {
      pointer: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastAt: event.timeStamp,
      velocity: 0,
      toward: getComputedStyle(panel).direction === "rtl" ? 1 : -1,
      axis: "unknown",
    };
  };

  const moveDrag = (event: React.PointerEvent<HTMLElement>): void => {
    const state = drag.current;
    const panel = panelRef.current;
    if (state === null || panel === null || event.pointerId !== state.pointer) return;
    const dx = event.clientX - state.startX;
    const dy = event.clientY - state.startY;
    if (state.axis === "unknown") {
      // A vertical drag belongs to the drawer's own scroller (`touch-pan-y`), not to the dismiss.
      if (Math.abs(dy) > AXIS_SLOP && Math.abs(dy) >= Math.abs(dx)) {
        state.axis = "block";
        return;
      }
      if (Math.abs(dx) <= AXIS_SLOP) return;
      state.axis = "inline";
      event.currentTarget.setPointerCapture(event.pointerId);
      panel.style.setProperty("transition", "none");
    }
    if (state.axis !== "inline") return;
    const elapsed = event.timeStamp - state.lastAt;
    if (elapsed > 0) state.velocity = (((event.clientX - state.lastX) * state.toward) / elapsed) * 1000;
    state.lastX = event.clientX;
    state.lastAt = event.timeStamp;
    // Only travel toward the start edge moves the panel; pulling it further into the page does not.
    const offset = Math.max(0, dx * state.toward);
    panel.style.setProperty("transform", `translateX(${String(Math.round(offset * state.toward))}px)`);
  };

  const endDrag = (event: React.PointerEvent<HTMLElement>): void => {
    const state = drag.current;
    const panel = panelRef.current;
    if (state === null || panel === null || event.pointerId !== state.pointer) return;
    drag.current = null;
    if (state.axis !== "inline") return;
    const offset = Math.max(0, (state.lastX - state.startX) * state.toward);
    const dismissed = offset > panel.offsetWidth * DISMISS_RATIO || state.velocity > DISMISS_VELOCITY;
    panel.style.setProperty("transition", "transform var(--t-base) var(--e-out)");
    panel.style.removeProperty("transform");
    if (dismissed) onClose();
  };

  if (!open || root === null) return null;

  return createPortal(
    <FocusTrap active onEscape={onClose}>
      <div className="fixed inset-0 z-50">
        <div className="anim-fade absolute inset-0 bg-frame/50" aria-hidden="true" onClick={onClose} />
        {/* DECISION: `bg-surface`, not `--bg`. the spec calls the panel porcelain, and --surface
            is the porcelain token whose stated role is "cards, sheets, checkout panel" (§4); using
            the page ground instead would leave the drawer flat against the page in dark mode. */}
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-label={label}
          className={`anim-drawer safe-b absolute inset-y-0 start-0 flex w-[min(92vw,420px)] max-w-full touch-pan-y flex-col bg-bg shadow-sheet ${className}`}
          onPointerDown={startDrag}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          {/* the spec: every drawer keeps a visible close control beside Esc and the scrim. */}
          <div className="drawer__head hairline-b flex items-center justify-between gap-4 px-5 py-3" onClick={(event) => {
            if ((event.target as HTMLElement).closest("a") !== null) onClose();
          }}>
            {title === undefined ? <span /> : <span className="label-fa text-ink-2">{title}</span>}
            <button
              type="button"
              onClick={onClose}
              aria-label={t("shell.close")}
              className="-me-2 grid size-[44px] shrink-0 place-items-center text-ink-2"
            >
              <Icon name="close" />
            </button>
          </div>
          <div className="grow overflow-y-auto overscroll-contain">{children}</div>
        </div>
      </div>
    </FocusTrap>,
    root,
  );
}
