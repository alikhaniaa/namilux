"use client";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { t } from "@/i18n";
import { FocusTrap } from "./FocusTrap";
import { Icon } from "./Icon";

// DECISION: the portal target is created here on first open instead of being added to
// app/layout.tsx - the layout is another file's contract, and an empty <div id="sheets">
// in every server response is markup no page needs. One node for the whole overlay family means the
// stacking order is DOM order, which is what a sheet opened from a drawer needs.
function sheetsRoot(): HTMLElement {
  const existing = document.getElementById("sheets");
  if (existing !== null) return existing;
  const created = document.createElement("div");
  created.id = "sheets";
  document.body.append(created);
  return created;
}

// the spec: dismiss past 40 % of the panel height or at 500 px/s.
const DISMISS_RATIO = 0.4;
const DISMISS_VELOCITY = 500;

type Drag = { pointer: number; startY: number; lastY: number; lastAt: number; velocity: number };

export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
  size = "auto",
}: {
  open: boolean;
  // DECISION: spelled as a property, not the header's `onClose(): void` method shorthand - the type is
  // identical, and a method-shorthand prop trips `@typescript-eslint/unbound-method` when destructured.
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: "auto" | "full";
}): React.ReactNode {
  const [root, setRoot] = useState<HTMLElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const drag = useRef<Drag | null>(null);
  const titleId = useId();

  // The portal node is touched only once the sheet is actually opened, so a page that mounts five
  // closed sheets adds nothing to the document.
  useEffect(() => {
    if (!open) return;
    setRoot(sheetsRoot());
  }, [open]);

  // DECISION: drag-to-dismiss is a touch/pen gesture only. With a mouse the visible close button and
  // Esc are the affordances and a mouse drag would fight text selection in the header.
  const startDrag = (event: React.PointerEvent<HTMLElement>): void => {
    const panel = panelRef.current;
    if (event.pointerType === "mouse" || panel === null) return;
    drag.current = {
      pointer: event.pointerId,
      startY: event.clientY,
      lastY: event.clientY,
      lastAt: event.timeStamp,
      velocity: 0,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    panel.style.setProperty("transition", "none");
  };

  const moveDrag = (event: React.PointerEvent<HTMLElement>): void => {
    const state = drag.current;
    const panel = panelRef.current;
    if (state === null || panel === null || event.pointerId !== state.pointer) return;
    const elapsed = event.timeStamp - state.lastAt;
    if (elapsed > 0) state.velocity = ((event.clientY - state.lastY) / elapsed) * 1000;
    state.lastY = event.clientY;
    state.lastAt = event.timeStamp;
    // Only downward travel moves the panel: pulling up must not detach it from the bottom edge.
    const offset = Math.max(0, event.clientY - state.startY);
    panel.style.setProperty("transform", `translateY(${String(Math.round(offset))}px)`);
  };

  const endDrag = (event: React.PointerEvent<HTMLElement>): void => {
    const state = drag.current;
    const panel = panelRef.current;
    if (state === null || panel === null || event.pointerId !== state.pointer) return;
    drag.current = null;
    const offset = Math.max(0, state.lastY - state.startY);
    const dismissed = offset > panel.offsetHeight * DISMISS_RATIO || state.velocity > DISMISS_VELOCITY;
    // A drag that does not reach the threshold springs back; a cancelled gesture takes the same path.
    panel.style.setProperty("transition", "transform var(--t-base) var(--e-out)");
    panel.style.removeProperty("transform");
    if (dismissed) onClose();
  };

  if (!open || root === null) return null;

  return createPortal(
    <FocusTrap active onEscape={onClose}>
      <div className="fixed inset-0 z-50 flex items-end justify-center md:items-center">
        {/* The scrim is decoration with a shortcut: the labelled control is the close button below,
            so announcing it a second time would only add noise. */}
        <div className="anim-fade absolute inset-0 bg-frame/50" aria-hidden="true" onClick={onClose} />
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          className={`sheet-panel anim-sheet safe-b relative flex w-full flex-col bg-surface shadow-sheet md:max-w-[560px] ${
            size === "full" ? "h-[92dvh]" : "max-h-[92dvh]"
          }`}
        >
          <div className="sheet-handle" aria-hidden="true" />
          <div
            className="sheet-head hairline-b flex touch-none items-center justify-between gap-4 px-5 py-4"
            onPointerDown={startDrag}
            onPointerMove={moveDrag}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            <h2 id={titleId} className="d-3">
              {title}
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label={t("shell.close")}
              className="-me-2 grid size-[44px] shrink-0 place-items-center text-ink-2"
            >
              <Icon name="close" />
            </button>
          </div>
          <div className="grow overflow-y-auto overscroll-contain px-5 py-4">{children}</div>
          {footer === undefined ? null : <div className="hairline-t px-5 py-4">{footer}</div>}
        </div>
      </div>
    </FocusTrap>,
    root,
  );
}
