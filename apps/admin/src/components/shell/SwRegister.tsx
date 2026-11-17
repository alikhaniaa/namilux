"use client";
import { useEffect } from "react";

const BUILD_ID = process.env.NEXT_PUBLIC_BUILD_ID ?? "dev";

export function SwRegister(): null {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator) || navigator.webdriver) return;
    const register = (): void => {
      void navigator.serviceWorker.register(`/sw.js?b=${encodeURIComponent(BUILD_ID)}`, { scope: "/" }).catch(() => {
        /* registration failure must never break the panel */
      });
    };
    if (document.readyState === "complete") register();
    else addEventListener("load", register, { once: true });
  }, []);
  return null;
}
