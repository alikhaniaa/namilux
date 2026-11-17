"use client";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useLayoutEffect, useRef } from "react";

export function ScrollReset(): null {
  const pathname = usePathname();
  const search = useSearchParams();
  const key = `${pathname}?${search.toString()}`;
  const first = useRef(true);
  const popped = useRef(false);

  useEffect(() => {
    const onPop = (): void => {
      popped.current = true;
    };
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
    };
  }, []);

  useLayoutEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (popped.current) {
      popped.current = false;
      return;
    }
    if (window.location.hash !== "") return;
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [key]);

  return null;
}
