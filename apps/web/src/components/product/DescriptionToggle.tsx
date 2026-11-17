"use client";
import { useEffect, useId, useRef, useState } from "react";
import { t } from "@/i18n";

export function DescriptionToggle({ children }: { children: React.ReactNode }): React.ReactNode {
  const id = useId();
  const body = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [clamp, setClamp] = useState<number | null>(null);
  useEffect(() => {
    const element = body.current;
    if (!element) return;
    const measure = () => {
      const paragraphs = element.querySelectorAll(".prose > p");
      const third = paragraphs.item(2);
      if (!third) { setClamp(null); return; }
      const bottom = third.getBoundingClientRect().bottom - element.getBoundingClientRect().top;
      setClamp(element.scrollHeight > bottom + 24 ? Math.ceil(bottom) : null);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return (
    <div className="description">
      <div id={id} ref={body} className="description__body" style={clamp !== null && !expanded ? { maxBlockSize: clamp, overflow: "hidden" } : undefined}>
        {children}
      </div>
      {clamp === null ? null : <button type="button" className="link-under t-sm mt-3" aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded(!expanded)}>
        {t(expanded ? "plp.readLess" : "plp.readMore")}
      </button>}
    </div>
  );
}
