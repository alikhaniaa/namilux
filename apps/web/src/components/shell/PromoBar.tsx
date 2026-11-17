"use client";
import Link from "next/link";
import { useEffect, useState } from "react";

export function PromoBar({
  messages,
  rotateSec,
}: {
  messages: { text: string; href?: string | null }[];
  rotateSec: number;
}): React.ReactNode {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (messages.length < 2 || paused) return undefined;
    // v2 §10.2: a promo line is time-bound copy, never a permanent slogan - so it rotates only
    // while there is more than one live message, and reduced motion pins it to the first.
    let reduced = false;
    try {
      reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch {
      /* no matchMedia: rotate */
    }
    if (reduced) return undefined;
    const timer = setInterval(() => setIndex((i) => (i + 1) % messages.length), Math.max(3, rotateSec) * 1000);
    return () => clearInterval(timer);
  }, [messages.length, paused, rotateSec]);

  if (messages.length === 0) return null;
  const current = messages[index % messages.length];
  if (current === undefined) return null;

  return (
    <div
      className="promo-bar frame hairline-b flex h-[32px] items-center justify-center px-4 md:h-[36px]"
      style={{ borderBlockEndColor: "var(--frame-line)" }}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <p key={current.text} className="anim-fade t-xs truncate text-frame-ink-2">
        {current.href == null ? current.text : <Link href={current.href}>{current.text}</Link>}
      </p>
    </div>
  );
}
