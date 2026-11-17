"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Back and Forward re-read the page from the server.
 *
 * The router keeps a copy of every page it has shown and Back/Forward restores that copy as it was - 
 * `router.refresh()` after a save only renews the page it is called on. So a price edited in the
 * product editor and followed by Back showed the list with the OLD price, and the list's own price cell
 * then sent that old value again (24 Sep 2026: "I change the price and it goes back"). An admin screen
 * must show what the database holds, so every history move asks the server again.
 *
 * The refresh is deferred one task: this listener is registered before the router's own (child effects
 * run first), and a refresh queued ahead of the router's restore would renew the page being left.
 */
export function FreshOnHistory() {
  const router = useRouter();
  useEffect(() => {
    const onPop = (): void => {
      setTimeout(() => router.refresh(), 0);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [router]);
  return null;
}
