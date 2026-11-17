"use client";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { isInAppBrowser } from "./standalone";
import { setWaitingWorker } from "./sw-update";
import { PUBLIC } from "@/lib/public-env";

export function SwRegister(): null {
  const pathname = usePathname();

  useEffect(() => {
    // the spec: production only, never inside the Instagram/Facebook webview (pointless and
    // quirky there), never under automation - an e2e run must control its own network.
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    if (navigator.webdriver) return;
    if (isInAppBrowser(navigator.userAgent)) return;

    let cancelled = false;

    const register = (): void => {
      // The build id is a query parameter so a deploy changes the SW's own URL and the browser
      // fetches the new script; the cache names inside it carry the same id.
      void navigator.serviceWorker
        .register(`/sw.js?b=${encodeURIComponent(PUBLIC.buildId)}`, { scope: "/" })
        .then((reg) => {
          if (cancelled) return;
          if (reg.waiting !== null) setWaitingWorker(reg.waiting);
          reg.addEventListener("updatefound", () => {
            const installing = reg.installing;
            if (installing === null) return;
            installing.addEventListener("statechange", () => {
              // "installed" with an existing controller means a NEW version is waiting.
              if (installing.state === "installed" && navigator.serviceWorker.controller !== null) {
                setWaitingWorker(installing);
              }
            });
          });
        })
        .catch(() => {
          /* registration failure must never break the page */
        });
    };

    // After `load`, so the SW never competes with the first paint for bandwidth.
    if (document.readyState === "complete") register();
    else addEventListener("load", register, { once: true });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    let reloaded = false;
    const onChange = (): void => {
      // Never swap the app out from under a payment.
      if (reloaded || pathname.startsWith("/billing")) return;
      reloaded = true;
      location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onChange);
    return () => navigator.serviceWorker.removeEventListener("controllerchange", onChange);
  }, [pathname]);

  return null;
}
