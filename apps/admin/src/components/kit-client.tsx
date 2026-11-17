"use client";
import type { ReactNode } from "react";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertCircle, CheckCircle2, X } from "lucide-react";
import { Button } from "./kit";
import type { ButtonVariant } from "./kit";
import { cn } from "@/lib/utils";
import { fa } from "@/i18n/fa";
import { faInt } from "@namilux/core/client";
import { ApiError } from "@/lib/api-client";

export function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const panel = useRef<HTMLDivElement | null>(null);
  // `onClose` is nearly always a fresh arrow from the parent's JSX, so it changes identity on every
  // parent render. Held in a ref, the effects below depend on `open` alone.
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });
  // Escape and the scroll lock, for as long as the dialog is open.
  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const onKey = (e: KeyboardEvent): void => {
      const dialogs = document.querySelectorAll('[role="dialog"][aria-modal="true"]');
      if (dialogs[dialogs.length - 1] !== panel.current) return;
      if (e.key === "Escape") close.current();
      if (e.key === "Tab") {
        const controls = Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]') ?? [])
          .filter(el => el.getClientRects().length > 0);
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (e.shiftKey && (document.activeElement === first || !panel.current?.contains(document.activeElement))) {
          e.preventDefault(); last?.focus();
        } else if (!e.shiftKey && (document.activeElement === last || !panel.current?.contains(document.activeElement))) {
          e.preventDefault(); first?.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [open]);
  // Focus the first field ONCE per opening. This used to sit in the effect above with `onClose` in
  // its dependency list, so every keystroke in a dialog re-ran it and threw the caret back to the
  // first input - typing a name into «نام» finished in «نام کاربری» (7 Sep 2026 walkthrough).
  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLElement>("input,select,textarea,button:not(.ui-dialog__close)")?.focus();
  }, [open]);
  if (!open || typeof document === "undefined") return null;
  // A filtered/sticky ancestor (the search header) otherwise contains the fixed scrim.
  return createPortal(
    <div className="ui-dialog__scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={panel} role="dialog" aria-modal="true" aria-label={title} className={cn("ui-dialog", wide ? "ui-dialog--wide" : "")}>
        <div className="ui-dialog__head">
          <h2>{title}</h2>
          <button type="button" className="ui-dialog__close" onClick={onClose} aria-label={fa["common.cancel"]}>
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <div className="ui-dialog__body">{children}</div>
        {footer !== undefined ? <div className="ui-dialog__foot">{footer}</div> : null}
      </div>
    </div>, document.body,
  );
}

export function Tabs({ tabs, current, onChange }: { tabs: { key: string; label: string; count?: number; alert?: boolean }[]; current: string; onChange: (key: string) => void }) {
  return (
    <div role="tablist" className="ui-tabs">
      {tabs.map((t) => (
        <button key={t.key} type="button" role="tab" aria-selected={current === t.key} className="ui-tab" onClick={() => onChange(t.key)}>
          {t.label}
          {t.count !== undefined && t.count > 0 ? <span className="ui-tab__count">{faInt(t.count)}</span> : null}
          {t.alert === true ? <span className="ui-tab__alert" title="خطا" aria-label="خطا" /> : null}
        </button>
      ))}
    </div>
  );
}

type ToastItem = { id: number; text: string; tone: "ok" | "error" };
const listeners = new Set<(items: ToastItem[]) => void>();
let items: ToastItem[] = [];
let seq = 0;
/** Small enough to read at a glance; the oldest goes when a newer one arrives. */
const MAX_TOASTS = 4;
const OK_MS = 3200;
function emit(): void {
  for (const l of listeners) l(items);
}
/** Remove one toast by hand - what the dismiss button on a persistent error calls. */
export function dismissToast(id: number): void {
  items = items.filter((i) => i.id !== id);
  emit();
}
/**
 * Successes fade on their own; an error stays until it is dismissed. A refusal has to survive long
 * enough to be read, selected and copied into a support message - five seconds never was.
 */
export function toast(text: string, tone: "ok" | "error" = "ok"): void {
  const id = (seq += 1);
  items = [...items, { id, text, tone }].slice(-MAX_TOASTS);
  emit();
  if (tone !== "error") {
    setTimeout(() => {
      dismissToast(id);
    }, OK_MS);
  }
}

export function ToastHost() {
  const [list, setList] = useState<ToastItem[]>([]);
  useEffect(() => {
    listeners.add(setList);
    return () => {
      listeners.delete(setList);
    };
  }, []);
  if (list.length === 0) return null;
  return (
    // Each toast is its own live region: an error is an alert, a success is a status. Nothing here
    // takes focus, so a keyboard user is never pulled out of the field they were editing.
    <div className="ui-toast-host">
      {list.map((t) => (
        <div key={t.id} role={t.tone === "error" ? "alert" : "status"} className={cn("ui-toast", t.tone === "error" ? "ui-toast--error" : "")}>
          <span className="ui-toast__icon" aria-hidden="true">
            {t.tone === "error" ? <AlertCircle size={18} /> : <CheckCircle2 size={18} />}
          </span>
          <span className="min-w-0 grow break-words select-text">{t.text}</span>
          {t.tone === "error" ? (
            <button type="button" className="ui-dialog__close" aria-label={fa["common.close"]} onClick={() => dismissToast(t.id)}>
              <X size={16} aria-hidden="true" />
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}

/**
 * A button whose first click asks for confirmation naming the consequence.
 *
 * The armed state used to lapse after four seconds, which is less time than it takes to read a
 * confirmation written as a whole Persian sentence («این حساب برای همیشه حذف شود؟»): the label
 * quietly went back to the idle one and the second click merely re-armed it, so «حذف کامل» never
 * sent its request at all. The window is long enough to read the question now, and the button
 * stays busy while the action runs so a failure has somewhere to show up.
 */
const ARM_MS = 12_000;

export function ConfirmButton({
  label,
  confirmLabel,
  onConfirm,
  variant = "danger",
  disabled = false,
  icon,
  size = "md",
}: {
  label: string;
  confirmLabel: string;
  onConfirm: () => void | Promise<void>;
  variant?: ButtonVariant;
  disabled?: boolean;
  icon?: ReactNode;
  size?: "sm" | "md";
}) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const id = setTimeout(() => setArmed(false), ARM_MS);
    return () => clearTimeout(id);
  }, [armed]);
  return (
    <Button
      variant={armed ? "danger" : variant}
      size={size}
      icon={icon}
      busy={busy}
      className={armed ? "is-armed" : undefined}
      disabled={disabled}
      onClick={() => {
        if (!armed) {
          setArmed(true);
          return;
        }
        setArmed(false);
        setBusy(true);
        // Awaited, so the caller's own catch (which toasts the Persian error) is reached and the
        // step-up dialog the request may open is not raced by a second click.
        void (async () => {
          try {
            await onConfirm();
          } catch (error) {
            toast(error instanceof ApiError ? error.message : fa["common.error"], "error");
          } finally {
            setBusy(false);
          }
        })();
      }}
    >
      {busy ? fa["common.loading"] : armed ? confirmLabel : label}
    </Button>
  );
}

/**
 * A small dropdown of actions - a table row's «⋯», the user menu. Built on <details> so it opens
 * without script and closes on Escape, an outside click, or a choice.
 */
export function Menu({ label, trigger, children, align = "end", className }: { label: string; trigger: ReactNode; children: ReactNode; align?: "start" | "end"; className?: string }) {
  const ref = useRef<HTMLDetailsElement | null>(null);
  const id = useId();
  useEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const onDoc = (e: MouseEvent): void => {
      if (el.open && !el.contains(e.target as Node)) el.open = false;
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape" && el.open) {
        el.open = false;
        el.querySelector<HTMLElement>("summary")?.focus();
      }
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, []);
  return (
    <details ref={ref} className={cn("ui-menu", className)} data-align={align}>
      <summary aria-label={label} aria-controls={id}>
        {trigger}
      </summary>
      <div
        id={id}
        className="ui-menu__panel"
        role="menu"
        onClick={(e) => {
          if ((e.target as HTMLElement).closest("a,button") !== null && ref.current !== null) ref.current.open = false;
        }}
      >
        {children}
      </div>
    </details>
  );
}
