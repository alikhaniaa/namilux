"use client";
import { useEffect } from "react";

const hasFiber = (el: Element): boolean => Object.keys(el).some((k) => k.startsWith("__reactFiber") || k.startsWith("__reactProps"));

export function RevealObserver(): null {
  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return undefined;
    const seen = new WeakSet<Element>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.setAttribute("data-inview", "");
          io.unobserve(entry.target);
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.08 },
    );
    const scan = (force = false): void => {
      for (const el of document.querySelectorAll("[data-reveal]:not([data-inview])")) {
        if (seen.has(el)) continue;
        if (!force && !hasFiber(el)) continue; // not hydrated yet - the next pass picks it up
        seen.add(el);
        io.observe(el);
      }
    };
    scan();
    const iv = setInterval(scan, 400);
    const stop = setTimeout(() => {
      clearInterval(iv);
      scan(true);
    }, 6000);
    const mo = new MutationObserver(() => {
      scan();
    });
    mo.observe(document.body, { childList: true, subtree: true });
    return () => {
      clearInterval(iv);
      clearTimeout(stop);
      io.disconnect();
      mo.disconnect();
    };
  }, []);
  return null;
}
