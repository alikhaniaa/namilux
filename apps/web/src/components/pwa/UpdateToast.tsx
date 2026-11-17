"use client";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { applyUpdate, useWaitingWorker } from "./sw-update";
import { toast } from "@/components/state/toast-store";

export function UpdateToast(): null {
  const waiting = useWaitingWorker();
  const pathname = usePathname();
  const shownFor = useRef<ServiceWorker | null>(null);

  useEffect(() => {
    if (waiting === null) return;
    // the spec: never interrupt a payment with an update offer. The worker stays waiting; the
    // toast appears on the next page that is not checkout.
    if (pathname.startsWith("/billing")) return;
    if (shownFor.current === waiting) return;
    shownFor.current = waiting;

    toast.show({
      key: "toast.update",
      action: { key: "toast.update.cta", onClick: () => applyUpdate(waiting) },
      // Quiet, and it must outlive the default 2.6 s - this one asks for a decision.
      ttlMs: 12_000,
    });
  }, [waiting, pathname]);

  return null;
}
