"use client";
import Link from "next/link";
import { Icon } from "./Icon";
import { toast, useToasts } from "@/components/state/toast-store";
import { t } from "@/i18n";

export function ToastHost(): React.ReactNode {
  const items = useToasts();

  // The live region exists even when empty so a screen reader is already listening when the first
  // toast arrives - mounting the region with its content is announced inconsistently.
  return (
    <div
      className="pointer-events-none fixed inset-inline-0 top-0 z-50 flex flex-col items-center gap-2 p-4"
      role="status"
      aria-live="polite"
      aria-atomic="false"
    >
      {items.map((item) => (
        <div
          key={item.id}
          className="toast-card anim-toast pointer-events-auto flex w-full max-w-sm items-center gap-3 border border-line bg-surface p-3 shadow-pop"
          // the life bar under the toast runs for exactly its ttl (components.css reads --toast-life)
          style={{ "--toast-life": `${String(item.ttlMs)}ms` } as React.CSSProperties}
          onMouseEnter={() => toast.hold(item.id)}
          onMouseLeave={() => toast.release(item.id)}
          onFocus={() => toast.hold(item.id)}
          onBlur={() => toast.release(item.id)}
        >
          {item.image === undefined ? null : (
            // The add-to-cart toast shows the thumbnail so the confirmation is about *that* product
            //. It is decorative - the text already names what happened.
            <span className="plate h-14 w-[44px] shrink-0">
              <img src={item.image} alt="" width={44} height={56} />
            </span>
          )}
          <p className="t-sm grow">{t(item.key, item.vars)}</p>
          {item.action === undefined ? null : item.action.href === undefined ? (
            <button type="button" className="link-under t-sm shrink-0" onClick={item.action.onClick}>
              {t(item.action.key)}
            </button>
          ) : (
            <Link href={item.action.href} className="link-under t-sm shrink-0">
              {t(item.action.key)}
            </Link>
          )}
          <button
            type="button"
            className="shrink-0 text-ink-3"
            aria-label={t("shell.close")}
            onClick={() => toast.dismiss(item.id)}
          >
            <Icon name="close" size={16} />
          </button>
        </div>
      ))}
    </div>
  );
}
