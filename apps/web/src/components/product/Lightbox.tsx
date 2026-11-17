"use client";
import { mediaUrl } from "@namilux/core/client";
import type { ImageRef } from "@namilux/core/client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FocusTrap } from "@/components/ui/FocusTrap";
import { Icon } from "@/components/ui/Icon";
import { t } from "@/i18n";

// The overlay family shares one portal node; it is created on first open (see ui/Sheet.tsx for the
// reasoning - app/layout.tsx is another file's contract).
function sheetsRoot(): HTMLElement {
  const existing = document.getElementById("sheets");
  if (existing !== null) return existing;
  const created = document.createElement("div");
  created.id = "sheets";
  document.body.append(created);
  return created;
}

/**
 * Fixed steps instead of a continuous slider: every step is reachable from the keyboard in one
 * press, which is what the spec asks of the zoom. Native pinch-zoom stays continuous and is not
 * driven from here at all.
 */
const ZOOM_STEPS = [1, 1.5, 2, 3] as const;
// Same dismissal thresholds as ui/Sheet, measured against the viewport.
const DISMISS_RATIO = 0.25;
const DISMISS_VELOCITY = 500;

type Drag = { pointer: number; startY: number; lastY: number; lastAt: number; velocity: number };

/** The full-size source (renditions.master, else the original object key) - both first-party. */
function masterSrc(image: ImageRef): string {
  const master = image.renditions?.master;
  return mediaUrl(typeof master === "string" && master.trim() !== "" ? master : image.key);
}

export function Lightbox({
  images,
  index,
  open,
  onClose,
}: {
  images: ImageRef[];
  index: number;
  open: boolean;
  // DECISION: spelled as a property, not the header's `onClose(): void` method shorthand - the type
  // is identical, and a method-shorthand prop trips `@typescript-eslint/unbound-method` when
  // destructured (same call as ui/Sheet and ui/Drawer).
  onClose: () => void;
}): React.ReactNode {
  const [root, setRoot] = useState<HTMLElement | null>(null);
  const [step, setStep] = useState(0);
  const [entered, setEntered] = useState(false);
  const drag = useRef<Drag | null>(null);

  useEffect(() => {
    if (!open) return;
    setRoot(sheetsRoot());
  }, [open]);

  // Every opening starts at 1× and plays the entrance (the spec: scale .96 → 1).
  useEffect(() => {
    if (!open) {
      setEntered(false);
      return;
    }
    setStep(0);
    const raf = requestAnimationFrame(() => {
      setEntered(true);
    });
    return () => {
      cancelAnimationFrame(raf);
    };
  }, [open, index]);

  // DECISION: the lightbox shows exactly the image the gallery handed it and does not page. The
  // contract has no way to report a new index back, and a lightbox that silently disagrees with the
  // rail behind it is worse than one that closes and re-opens. Zoom is the only interaction here.
  const image = images[index];

  const zoom = ZOOM_STEPS[step] ?? 1;
  const zoomIn = (): void => {
    setStep((s) => Math.min(s + 1, ZOOM_STEPS.length - 1));
  };
  const zoomOut = (): void => {
    setStep((s) => Math.max(s - 1, 0));
  };

  // Swipe-down to dismiss, touch/pen only and only at 1× - once the image is magnified a drag is a
  // pan, and closing under the reader's finger would be the opposite of what they asked for.
  const startDrag = (event: React.PointerEvent<HTMLElement>): void => {
    if (event.pointerType === "mouse" || step !== 0) return;
    drag.current = { pointer: event.pointerId, startY: event.clientY, lastY: event.clientY, lastAt: event.timeStamp, velocity: 0 };
  };
  const moveDrag = (event: React.PointerEvent<HTMLElement>): void => {
    const state = drag.current;
    if (state === null || event.pointerId !== state.pointer) return;
    const elapsed = event.timeStamp - state.lastAt;
    if (elapsed > 0) state.velocity = ((event.clientY - state.lastY) / elapsed) * 1000;
    state.lastY = event.clientY;
    state.lastAt = event.timeStamp;
  };
  const endDrag = (event: React.PointerEvent<HTMLElement>): void => {
    const state = drag.current;
    if (state === null || event.pointerId !== state.pointer) return;
    drag.current = null;
    const travelled = state.lastY - state.startY;
    if (travelled > window.innerHeight * DISMISS_RATIO || state.velocity > DISMISS_VELOCITY) onClose();
  };

  if (!open || root === null || image === undefined) return null;

  return createPortal(
    <FocusTrap active onEscape={onClose}>
      <div
        className="fixed inset-0 z-50 flex flex-col bg-frame/95"
        onKeyDown={(event) => {
          if (event.key === "+" || event.key === "=") {
            event.preventDefault();
            zoomIn();
          } else if (event.key === "-" || event.key === "_") {
            event.preventDefault();
            zoomOut();
          } else if (event.key === "0") {
            event.preventDefault();
            setStep(0);
          }
        }}
      >
        {/* Decoration with a shortcut: the labelled control is the close button below. */}
        <div className="anim-fade absolute inset-0" aria-hidden="true" onClick={onClose} />
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t("product.gallery.of", { i: index + 1, n: images.length })}
          className="relative flex h-full flex-col text-frame-ink"
        >
          <div className="flex items-center justify-between gap-2 p-3">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={zoomOut}
                disabled={step === 0}
                aria-label={t("product.gallery.zoomOut")}
                className="grid size-[44px] place-items-center disabled:opacity-45"
              >
                <Icon name="minus" />
              </button>
              <button
                type="button"
                onClick={zoomIn}
                disabled={step === ZOOM_STEPS.length - 1}
                aria-label={t("product.gallery.zoom")}
                className="grid size-[44px] place-items-center disabled:opacity-45"
              >
                <Icon name="zoom" />
              </button>
            </div>
            <button type="button" onClick={onClose} aria-label={t("a11y.closeSheet")} className="grid size-[44px] place-items-center">
              <Icon name="close" />
            </button>
          </div>
          <div
            // Pinch-zoom is the platform's, not a library's: the stage opts into the
            // native gesture and JS never touches a touchmove.
            style={{ touchAction: "pinch-zoom" }}
            className="grid grow place-items-center overflow-auto overscroll-contain p-4"
            onPointerDown={startDrag}
            onPointerMove={moveDrag}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            <img
              src={masterSrc(image)}
              alt={image.alt}
              width={image.width}
              height={image.height}
              className="max-h-[80dvh] w-auto max-w-full object-contain"
              style={{
                scale: String(entered ? zoom : 0.96),
                transition: "scale var(--t-slow) var(--e-enter)",
              }}
            />
          </div>
        </div>
      </div>
    </FocusTrap>,
    root,
  );
}
