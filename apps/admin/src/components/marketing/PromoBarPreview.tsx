"use client";
import { useEffect, useState } from "react";
import { faInt } from "@namilux/core/client";
import { PROMO_T } from "./promo-bar-copy";

export type PreviewMessage = { key: string; title: string; linked: boolean; position: number };

/**
 * A miniature of the storefront header with the announcement bar on top, driven by the editor's
 * draft. It mirrors apps/web shell/PromoBar: one line, one message at a time, rotating every
 * `rotateSec` while more than one message is live, paused under the pointer. `pinned` shows one
 * chosen message (the «پیش‌نمایش این پیام» button) even when it is not live right now.
 */
export function PromoBarPreview({
  enabled,
  rotateSec,
  live,
  pinned,
  total,
}: {
  enabled: boolean;
  rotateSec: number;
  live: PreviewMessage[];
  pinned: PreviewMessage | null;
  total: number;
}) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const list = pinned === null ? live : [pinned];
  const seconds = Number.isFinite(rotateSec) ? Math.min(30, Math.max(4, rotateSec)) : 8;

  useEffect(() => {
    if (!enabled || list.length < 2 || paused) return undefined;
    const timer = setInterval(() => setIndex((i) => i + 1), seconds * 1000);
    return () => clearInterval(timer);
  }, [enabled, list.length, paused, seconds]);

  const current = list.length === 0 ? undefined : list[index % list.length];
  const showBar = enabled && current !== undefined;

  let caption: string;
  if (!enabled) caption = PROMO_T.previewOff;
  else if (current === undefined) caption = PROMO_T.previewNone;
  else caption = PROMO_T.previewShowing(faInt(current.position), faInt(total));

  return (
    <section aria-label={PROMO_T.previewTitle} className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">{PROMO_T.previewTitle}</h2>
        <span className="text-xs text-[var(--ink-3)]">{PROMO_T.previewHint}</span>
      </div>
      <div
        className="overflow-hidden border border-[var(--line)] bg-[var(--surface)]"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
      >
        {showBar ? (
          <div className="flex h-9 items-center justify-center bg-[var(--frame)] px-4" aria-live="polite">
            <p key={current.key} className="truncate text-xs text-[var(--frame-gilt)]">
              {current.linked ? <span className="underline decoration-dotted underline-offset-4">{current.title}</span> : current.title}
            </p>
          </div>
        ) : (
          <div className="flex h-9 items-center justify-center border-b border-dashed border-[var(--line-2)] bg-[var(--bg-soft)] px-4">
            <p className="truncate text-xs text-[var(--ink-3)]">{caption}</p>
          </div>
        )}
        <div className="flex items-center justify-between gap-4 px-4 py-3">
          <span className="text-sm font-bold tracking-tight">{PROMO_T.previewStore}</span>
          <span className="hidden gap-4 text-xs text-[var(--ink-3)] sm:flex">
            {PROMO_T.previewNav.map((n) => (
              <span key={n}>{n}</span>
            ))}
          </span>
          <span aria-hidden className="h-6 w-24 rounded-full bg-[var(--bg-soft)]" />
        </div>
      </div>
      {showBar ? <p className="text-xs text-[var(--ink-3)]">{caption}</p> : null}
    </section>
  );
}
